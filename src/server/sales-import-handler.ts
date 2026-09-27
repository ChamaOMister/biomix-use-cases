/**
 * HTTP boundary for XLSX sales uploads. The request body is the raw workbook (no multipart), so
 * the compressed size can be capped while streaming. Nothing is stored: the response carries
 * the validation result, and the accepted dataset lives only in the uploader's page state.
 */
import { importSalesXlsx } from "../domain/sales-import/xlsx";
import { issueDiagnostics } from "../domain/sales-import/diagnostics";
import { resolveInputLimits, type InputLimits } from "../domain/sales-import/limits";
import { rejectWithoutSheet } from "../domain/sales-import/validate-sheet";
import type { TextDateFormat } from "../domain/sales-import/dates";
import type { SalesImportResult, SheetSelection } from "../domain/sales-import/types";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ACCEPTED_CONTENT_TYPES = new Set([XLSX_CONTENT_TYPE, "application/octet-stream"]);
const TEXT_DATE_FORMATS = new Set<string>(["YYYY-MM-DD", "DD/MM/YYYY"]);

export type UploadErrorBody = {
  status: "error";
  code: "BAD_REQUEST" | "UNSUPPORTED_MEDIA_TYPE" | "UPLOAD_INCOMPLETE" | "INTERNAL_ERROR";
  message: string;
};

export type UploadResponseBody = SalesImportResult | UploadErrorBody;

/** Receives only allowlisted diagnostics: never workbook text, issues or sales rows. */
export type DiagnosticLogger = (event: string, data: Record<string, unknown>) => void;

export interface UploadHandlerOptions {
  limits?: Partial<InputLimits>;
  newImportId?: () => string;
  log?: DiagnosticLogger;
}

const defaultLog: DiagnosticLogger = (event, data) => console.info(event, JSON.stringify(data));

function respond(body: UploadResponseBody, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

function badRequest(message: string): Response {
  return respond({ status: "error", code: "BAD_REQUEST", message }, 400);
}

function tooLarge(importId: string, limits: InputLimits): Response {
  const result = rejectWithoutSheet(importId, null, {
    code: "INPUT_FILE_TOO_LARGE",
    message: `The file is larger than the ${(limits.maxFileBytes / (1024 * 1024)).toFixed(1)} MiB limit.`,
    suggestion: "Split the export into smaller workbooks or remove unrelated sheets, images and formatting.",
  });
  return respond(result, 413);
}

type BodyRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too-large" | "empty" }
  | { ok: false; reason: "failed"; error: unknown };

/** Best effort: the response does not depend on whether the client stream accepts the cancel. */
async function cancelQuietly(stream: { cancel(): Promise<void> } | null): Promise<void> {
  try {
    await stream?.cancel();
  } catch {
    // Already errored or closed; nothing else to release.
  }
}

/**
 * Reads the body up to `maxBytes`. Never rejects: a failed read (for example a disconnected
 * upload) is returned as `failed`, and the reader lock is always released.
 */
async function readBodyWithLimit(request: Request, maxBytes: number): Promise<BodyRead> {
  if (!request.body) return { ok: false, reason: "empty" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch (error) {
    return { ok: false, reason: "failed", error };
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelQuietly(reader);
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false, reason: "failed", error };
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return { ok: false, reason: "empty" };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function parseQuery(url: URL): { ok: true; sheet: SheetSelection; textDateFormat?: TextDateFormat } | { ok: false; message: string } {
  const sheetName = url.searchParams.get("sheet");
  const single = url.searchParams.get("singleSheet") === "true";
  if ((sheetName !== null) === single) {
    return { ok: false, message: "Give either a sheet name (sheet=…) or singleSheet=true, not both." };
  }
  if (sheetName !== null && sheetName.trim() === "") return { ok: false, message: "The sheet name is empty." };
  const format = url.searchParams.get("textDateFormat");
  if (format !== null && !TEXT_DATE_FORMATS.has(format)) {
    return { ok: false, message: "textDateFormat must be YYYY-MM-DD or DD/MM/YYYY." };
  }
  return {
    ok: true,
    sheet: sheetName !== null ? { name: sheetName } : { single: true },
    ...(format !== null ? { textDateFormat: format as TextDateFormat } : {}),
  };
}

export async function handleSalesImportUpload(
  request: Request,
  options: UploadHandlerOptions = {},
): Promise<Response> {
  const limits = resolveInputLimits(options.limits);
  const log = options.log ?? defaultLog;
  const importId = (options.newImportId ?? (() => crypto.randomUUID()))();

  const query = parseQuery(new URL(request.url));
  if (!query.ok) return badRequest(query.message);

  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    return respond(
      { status: "error", code: "UNSUPPORTED_MEDIA_TYPE", message: "Upload the workbook as an .xlsx file." },
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limits.maxFileBytes) {
    await cancelQuietly(request.body);
    log("sales-import", { importId, status: "rejected", issues: [{ code: "INPUT_FILE_TOO_LARGE" }] });
    return tooLarge(importId, limits);
  }

  const body = await readBodyWithLimit(request, limits.maxFileBytes);
  if (!body.ok) {
    if (body.reason === "empty") return badRequest("The request body is empty; send the .xlsx file as the body.");
    if (body.reason === "failed") {
      // The error name only: stream errors are not ours to describe or echo.
      log("sales-import-failed", { importId, stage: "read-body", error: errorName(body.error) });
      return respond(
        { status: "error", code: "UPLOAD_INCOMPLETE", message: "The upload did not complete. Send the file again." },
        400,
      );
    }
    log("sales-import", { importId, status: "rejected", issues: [{ code: "INPUT_FILE_TOO_LARGE" }] });
    return tooLarge(importId, limits);
  }

  let result: SalesImportResult;
  try {
    result = await importSalesXlsx(body.bytes, {
      importId,
      sheet: query.sheet,
      invoiceIdentity: "invoice-number-unique-within-import",
      limits,
      ...(query.textDateFormat ? { textDateFormat: query.textDateFormat } : {}),
    });
  } catch (error) {
    // The error name only: messages from parsers can quote workbook content.
    log("sales-import-failed", { importId, stage: "import", error: errorName(error) });
    return respond({ status: "error", code: "INTERNAL_ERROR", message: "The workbook could not be processed." }, 500);
  }

  log("sales-import", {
    importId,
    status: result.status,
    dataRows: result.summary.dataRows,
    rowsWithErrors: result.summary.rowsWithErrors,
    issueCount: result.issues.length,
    issues: result.issues.slice(0, 50).map(issueDiagnostics),
  });
  return respond(result, result.status === "accepted" ? 200 : 422);
}
