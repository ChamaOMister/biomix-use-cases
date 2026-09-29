/**
 * HTTP boundary for `POST /api/sales-feed/deliveries` (docs/api/sales-feed.openapi.json). Checks
 * the development API key, media type, size and JSON syntax, then hands the payload to
 * `ingestDelivery`. Logs only allowlisted diagnostics: never payload values or error messages.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import type { FeedReference } from "@/domain/sales-feed/reference-data";
import { databaseErrorDiagnostics, DatabaseNotConfiguredError, getPool } from "../db/pool";
import { cancelQuietly, readBodyWithLimit } from "../request-body";
import { ingestDelivery, type DeliveryAppliedBody, type DeliveryRejectedBody, type IngestOutcome } from "./ingest";

/**
 * Generous for monthly deliveries (the largest generated one is about 0.35 MB) while bounding
 * memory. A delivery at the contract's 5,000-invoice limit with a few lines each fits.
 */
export const DELIVERY_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const API_KEY_HEADER = "x-api-key";

/** Codes of the endpoint's own errors; contract violations are `DeliveryRejectedBody` instead. */
export const FEED_ERROR_CODES = [
  "JSON_INVALID",
  "UNAUTHORIZED",
  "DELIVERY_ID_REUSED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INTERNAL_ERROR",
  "FEED_NOT_CONFIGURED",
  "DATABASE_UNAVAILABLE",
] as const;

export type FeedErrorCode = (typeof FEED_ERROR_CODES)[number];

export interface FeedErrorBody {
  status: "error";
  code: FeedErrorCode;
  message: string;
}

export type DeliveryResponseBody = DeliveryAppliedBody | DeliveryRejectedBody | FeedErrorBody;

/** Receives only allowlisted diagnostics: never payload values or error messages. */
export type DiagnosticLogger = (event: string, data: Record<string, unknown>) => void;

export interface DeliveryHandlerOptions {
  /** Defaults to `SALES_FEED_API_KEY`. Without a key the endpoint refuses every request. */
  apiKey?: string;
  /** Defaults to the shared application pool (`DATABASE_URL`). */
  pool?: () => pg.Pool;
  reference?: FeedReference;
  maxBodyBytes?: number;
  log?: DiagnosticLogger;
}

const defaultLog: DiagnosticLogger = (event, data) => console.info(event, JSON.stringify(data));

function respond(body: DeliveryResponseBody, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function fail(code: FeedErrorCode, status: number, message: string): Response {
  return respond({ status: "error", code, message }, status);
}

/** Compares digests so the comparison takes the same time whatever the key's length or content. */
function sameKey(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function isJsonContentType(header: string | null): boolean {
  const [type, ...parameters] = (header ?? "").split(";").map((part) => part.trim().toLowerCase());
  if (type !== "application/json") return false;
  const charset = parameters.find((parameter) => parameter.startsWith("charset="));
  return charset === undefined || charset === "charset=utf-8";
}

function errorCounts(body: DeliveryRejectedBody): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const error of body.errors) counts[error.code] = (counts[error.code] ?? 0) + 1;
  return counts;
}

function outcomeResponse(outcome: IngestOutcome, log: DiagnosticLogger): Response {
  if (outcome.kind === "delivery-id-reused") {
    log("sales-feed-delivery", { deliveryId: outcome.deliveryId, outcome: "delivery-id-reused" });
    return fail(
      "DELIVERY_ID_REUSED",
      409,
      "This deliveryId was already received with different content. Send a changed delivery under a new deliveryId.",
    );
  }
  const headers: Record<string, string> = outcome.replayed ? { "idempotent-replayed": "true" } : {};
  if (outcome.kind === "rejected") {
    log("sales-feed-delivery", {
      deliveryId: outcome.body.deliveryId,
      outcome: "rejected",
      replayed: outcome.replayed,
      errorCount: outcome.body.errors.length,
      truncated: outcome.body.truncated,
      errorCodes: errorCounts(outcome.body),
    });
    return respond(outcome.body, 422, headers);
  }
  log("sales-feed-delivery", {
    deliveryId: outcome.body.deliveryId,
    outcome: "applied",
    replayed: outcome.replayed,
    invoicesAdded: outcome.body.invoicesAdded,
    invoicesReplaced: outcome.body.invoicesReplaced,
    lineCount: outcome.body.lineCount,
  });
  return respond(outcome.body, 200, headers);
}

export async function handleDeliveryRequest(request: Request, options: DeliveryHandlerOptions = {}): Promise<Response> {
  const log = options.log ?? defaultLog;
  const expectedKey = "apiKey" in options ? options.apiKey : process.env.SALES_FEED_API_KEY;
  const maxBytes = options.maxBodyBytes ?? DELIVERY_MAX_BODY_BYTES;

  if (!expectedKey) {
    await cancelQuietly(request.body);
    return fail("FEED_NOT_CONFIGURED", 503, "The sales feed has no API key configured on the server (SALES_FEED_API_KEY).");
  }
  const givenKey = request.headers.get(API_KEY_HEADER);
  if (givenKey === null || !sameKey(givenKey, expectedKey)) {
    await cancelQuietly(request.body);
    return fail("UNAUTHORIZED", 401, "The X-Api-Key header is missing or wrong.");
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    await cancelQuietly(request.body);
    return fail("UNSUPPORTED_MEDIA_TYPE", 415, "Send the delivery as application/json (UTF-8).");
  }
  const tooLarge = () =>
    fail("PAYLOAD_TOO_LARGE", 413, `The delivery is larger than the ${maxBytes / (1024 * 1024)} MiB limit; split it.`);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelQuietly(request.body);
    return tooLarge();
  }

  const body = await readBodyWithLimit(request, maxBytes);
  if (!body.ok) {
    if (body.reason === "too-large") return tooLarge();
    if (body.reason === "failed") log("sales-feed-delivery-failed", { stage: "read-body", error: "stream" });
    return fail("JSON_INVALID", 400, "The request body is empty or incomplete; send the delivery JSON as the body.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return fail("JSON_INVALID", 400, "The request body is not valid UTF-8 JSON.");
  }

  let pool: pg.Pool;
  try {
    pool = (options.pool ?? getPool)();
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) throw error;
    return fail("DATABASE_UNAVAILABLE", 503, "The database is not configured (DATABASE_URL).");
  }
  try {
    const outcome = await ingestDelivery(pool, payload, options.reference ? { reference: options.reference } : {});
    return outcomeResponse(outcome, log);
  } catch (error) {
    log("sales-feed-delivery-failed", { stage: "ingest", ...databaseErrorDiagnostics(error) });
    return fail("INTERNAL_ERROR", 500, "The delivery could not be stored. Nothing was changed; send it again.");
  }
}
