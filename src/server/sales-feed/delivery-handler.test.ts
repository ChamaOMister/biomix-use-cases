import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseNotConfiguredError } from "../db/pool";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../db/testing";
import { handleDeliveryRequest, type DeliveryHandlerOptions } from "./delivery-handler";
import { delivery, invoice } from "./testing/fixtures";

const KEY = "test-key-for-the-feed";

function post(body: string | Uint8Array<ArrayBuffer> | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/sales-feed/deliveries", {
    method: "POST",
    headers: { "x-api-key": KEY, "content-type": "application/json", ...headers },
    ...(body === null ? {} : { body }),
  });
}

const unusedPool = (): pg.Pool => {
  throw new Error("the database must not be reached");
};

function collectingLog() {
  const events: string[] = [];
  return { events, log: (event: string, data: Record<string, unknown>) => events.push(`${event} ${JSON.stringify(data)}`) };
}

async function send(request: Request, options: DeliveryHandlerOptions) {
  const response = await handleDeliveryRequest(request, { apiKey: KEY, ...options });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe("sales-feed endpoint: request checks before the database", () => {
  const payload = JSON.stringify(delivery([invoice("000001")]));

  it("refuses every request when no API key is configured", async () => {
    const response = await send(post(payload), { apiKey: undefined, pool: unusedPool });
    expect(response).toMatchObject({ status: 503, body: { status: "error", code: "FEED_NOT_CONFIGURED" } });
  });

  it.each([
    ["missing", { "x-api-key": "" }],
    ["wrong", { "x-api-key": "not-the-key" }],
    ["a prefix of the right one", { "x-api-key": KEY.slice(0, -1) }],
  ])("rejects a %s API key", async (_name, headers) => {
    const request = post(payload, headers);
    if (headers["x-api-key"] === "") request.headers.delete("x-api-key");
    expect(await send(request, { pool: unusedPool })).toMatchObject({ status: 401, body: { code: "UNAUTHORIZED" } });
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "application/json; charset=latin1", ""])(
    "rejects content type %j",
    async (contentType) => {
      expect(await send(post(payload, { "content-type": contentType }), { pool: unusedPool })).toMatchObject({
        status: 415,
        body: { code: "UNSUPPORTED_MEDIA_TYPE" },
      });
    },
  );

  it("rejects a body over the size limit, declared or streamed", async () => {
    const big = JSON.stringify({ padding: "x".repeat(2000) });
    expect(await send(post(big), { pool: unusedPool, maxBodyBytes: 1000 })).toMatchObject({
      status: 413,
      body: { code: "PAYLOAD_TOO_LARGE" },
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i += 1) controller.enqueue(new TextEncoder().encode("x".repeat(400)));
        controller.close();
      },
    });
    const streamed = new Request("http://localhost/api/sales-feed/deliveries", {
      method: "POST",
      headers: { "x-api-key": KEY, "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(await send(streamed, { pool: unusedPool, maxBodyBytes: 1000 })).toMatchObject({ status: 413 });
  });

  it.each([
    ["empty", null],
    ["not JSON", "{\"deliveryId\": "],
    ["not UTF-8", new Uint8Array([0x7b, 0xff, 0x7d])],
  ])("rejects a body that is %s", async (_name, body) => {
    expect(await send(post(body), { pool: unusedPool })).toMatchObject({ status: 400, body: { code: "JSON_INVALID" } });
  });

  it("reports a missing database configuration", async () => {
    const pool = () => {
      throw new DatabaseNotConfiguredError();
    };
    expect(await send(post(payload), { pool })).toMatchObject({ status: 503, body: { code: "DATABASE_UNAVAILABLE" } });
  });

  it("answers a database failure with a retryable error and logs no error message", async () => {
    const { events, log } = collectingLog();
    const failing = {
      connect: async () => {
        throw Object.assign(new Error("connection to Fictional Agro Ltda refused"), { code: "08006" });
      },
    } as unknown as pg.Pool;
    expect(await send(post(payload), { pool: () => failing, log })).toMatchObject({
      status: 500,
      body: { code: "INTERNAL_ERROR" },
    });
    expect(events).toEqual(['sales-feed-delivery-failed {"stage":"ingest","error":"Error","sqlState":"08006"}']);
  });
});

describe.skipIf(!hasDatabase)("sales-feed endpoint with Postgres", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("applies a delivery, then replays it with the original result", async () => {
    const { events, log } = collectingLog();
    const payload = delivery([invoice("000001"), invoice("000002")]);
    const first = await send(post(JSON.stringify(payload)), { pool: () => db.pool, log });
    expect(first).toMatchObject({
      status: 200,
      body: { deliveryId: payload.deliveryId, status: "applied", invoicesAdded: 2, invoicesReplaced: 0, lineCount: 2 },
    });
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    const again = await send(post(JSON.stringify(payload, null, 2)), { pool: () => db.pool, log });
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    // Diagnostics only: no customer, product or invoice values.
    expect(events.join("\n")).not.toMatch(/Fictional|C0001|PA1|000001/);
  });

  it("rejects a contract violation with located errors and replays the rejection", async () => {
    const { events, log } = collectingLog();
    const customer = { id: "C0010", name: "Fictional Unstored", segment: "farmer", city: "Viçosa", state: "MG" };
    const payload = delivery([invoice("000010", { sellerId: "S99", customer })]);
    const first = await send(post(JSON.stringify(payload)), { pool: () => db.pool, log });
    expect(first).toEqual({
      status: 422,
      headers: first.headers,
      body: {
        deliveryId: payload.deliveryId,
        status: "rejected",
        errors: [
          {
            code: "SELLER_UNKNOWN",
            path: "/invoices/0/sellerId",
            invoiceNumber: "000010",
            message: "sellerId is not a known seller.",
          },
        ],
        truncated: false,
      },
    });
    const again = await send(post(JSON.stringify(payload)), { pool: () => db.pool, log });
    expect(again).toMatchObject({ status: 422, body: first.body });
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(events.join("\n")).not.toMatch(/000010|S99/);
  });

  it("refuses a reused deliveryId with different content", async () => {
    const payload = delivery([invoice("000020")]);
    await send(post(JSON.stringify(payload)), { pool: () => db.pool });
    const changed = { ...payload, invoices: [invoice("000021")] };
    expect(await send(post(JSON.stringify(changed)), { pool: () => db.pool })).toMatchObject({
      status: 409,
      body: { status: "error", code: "DELIVERY_ID_REUSED" },
    });
  });
});
