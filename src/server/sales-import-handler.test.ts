import { describe, expect, it, vi } from "vitest";
import { ALL_HEADERS, buildWorkbook, line, salesSheet } from "../domain/sales-import/testing/workbook-fixtures";
import { handleSalesImportUpload, XLSX_CONTENT_TYPE, type UploadResponseBody } from "./sales-import-handler";

const URL_BASE = "http://localhost/api/sales-imports";

function upload(body: BodyInit | null, query = "?sheet=Sales", headers: Record<string, string> = {}) {
  return new Request(`${URL_BASE}${query}`, {
    method: "POST",
    body,
    headers: { "content-type": XLSX_CONTENT_TYPE, ...headers },
    duplex: "half",
  } as RequestInit);
}

async function json(response: Response): Promise<UploadResponseBody> {
  return (await response.json()) as UploadResponseBody;
}

const validWorkbook = () => buildWorkbook([salesSheet([line(), line({ "Product ID": "P-002" })])]);

describe("handleSalesImportUpload", () => {
  it("returns the accepted dataset for a valid workbook", async () => {
    const response = await handleSalesImportUpload(upload(await validWorkbook()), { log: () => {} });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await json(response);
    expect(body.status).toBe("accepted");
    if (body.status !== "accepted") return;
    expect(body.lines).toHaveLength(2);
    expect(body.invoices).toHaveLength(1);
  });

  it("returns issues and no lines for an invalid workbook", async () => {
    const workbook = await buildWorkbook([salesSheet([line({ "Customer ID": null })])]);
    const response = await handleSalesImportUpload(upload(workbook), { log: () => {} });
    expect(response.status).toBe(422);
    const body = await json(response);
    expect(body).toMatchObject({ status: "rejected" });
    expect(body).not.toHaveProperty("lines");
  });

  it("gives every upload its own import ID, with no data carried between requests", async () => {
    const first = await json(await handleSalesImportUpload(upload(await validWorkbook()), { log: () => {} }));
    const second = await json(
      await handleSalesImportUpload(upload(await buildWorkbook([salesSheet([line()])])), { log: () => {} }),
    );
    if (first.status !== "accepted" || second.status !== "accepted") throw new Error("expected accepted");
    expect(first.importId).not.toBe(second.importId);
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]?.lineId.startsWith(`${second.importId}/`)).toBe(true);
  });

  it("supports single-sheet mode and a declared text date format", async () => {
    const workbook = await buildWorkbook([salesSheet([line({ "Billing Date": "15/03/2024" })], "Qualquer")]);
    const body = await json(
      await handleSalesImportUpload(upload(workbook, "?singleSheet=true&textDateFormat=DD%2FMM%2FYYYY"), {
        log: () => {},
      }),
    );
    expect(body.status).toBe("accepted");
  });

  it.each([
    ["", "no sheet choice"],
    ["?sheet=Sales&singleSheet=true", "both sheet choices"],
    ["?sheet=", "an empty sheet name"],
    ["?sheet=Sales&textDateFormat=MM%2FDD%2FYYYY", "an unsupported date format"],
  ])("rejects a request with %j (%s)", async (query) => {
    const response = await handleSalesImportUpload(upload(await validWorkbook(), query), { log: () => {} });
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ status: "error", code: "BAD_REQUEST" });
  });

  it("rejects a non-XLSX content type", async () => {
    const response = await handleSalesImportUpload(
      upload(await validWorkbook(), "?sheet=Sales", { "content-type": "text/csv" }),
      { log: () => {} },
    );
    expect(response.status).toBe(415);
    expect(await json(response)).toMatchObject({ status: "error", code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("rejects an empty body", async () => {
    const response = await handleSalesImportUpload(upload(new Uint8Array(0)), { log: () => {} });
    expect(response.status).toBe(400);
  });

  it("rejects an oversized declared Content-Length without reading the body", async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled = true;
      },
    });
    const response = await handleSalesImportUpload(upload(body, "?sheet=Sales", { "content-length": "5000" }), {
      limits: { maxFileBytes: 1000 },
      log: () => {},
    });
    expect(response.status).toBe(413);
    expect(await json(response)).toMatchObject({
      status: "rejected",
      issues: [expect.objectContaining({ code: "INPUT_FILE_TOO_LARGE" })],
    });
    expect(pulled).toBe(false);
  });

  it("stops reading a streamed body as soon as it passes the size limit", async () => {
    let bytesServed = 0;
    let cancelled = false;
    // 16 KiB in 256-byte chunks, no Content-Length; the limit is 1000 bytes.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (bytesServed >= 16 * 1024) {
          controller.close();
          return;
        }
        bytesServed += 256;
        controller.enqueue(new Uint8Array(256));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await handleSalesImportUpload(upload(body), { limits: { maxFileBytes: 1000 }, log: () => {} });
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(bytesServed).toBeLessThanOrEqual(1000 + 256 * 2);
  });

  describe("request body failures (review R3)", () => {
    const SENTINEL = "SENTINEL-Ciclano-Ficticio";

    /** Captures the handler's logger and console output so neither can leak the sentinel. */
    function observeLogs() {
      const log = vi.fn();
      const consoleCalls = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      );
      return {
        log,
        text: () => JSON.stringify([log.mock.calls, ...consoleCalls.map((spy) => spy.mock.calls)]),
        restore: () => consoleCalls.forEach((spy) => spy.mockRestore()),
      };
    }

    async function expectControlledJson(response: Response, status: number) {
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      const text = await response.text();
      expect(text).not.toContain(SENTINEL);
      return JSON.parse(text) as UploadResponseBody;
    }

    it("returns a generic 400 when the body stream fails mid-upload", async () => {
      const logs = observeLogs();
      let served = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (served++ === 0) controller.enqueue(new Uint8Array(100));
          else controller.error(new Error(SENTINEL));
        },
      });
      const request = upload(body);
      const response = await handleSalesImportUpload(request, { log: logs.log, newImportId: () => "imp-read" });
      logs.restore();

      expect(await expectControlledJson(response, 400)).toEqual({
        status: "error",
        code: "UPLOAD_INCOMPLETE",
        message: "The upload did not complete. Send the file again.",
      });
      expect(request.body?.locked).toBe(false);
      expect(logs.log).toHaveBeenCalledWith("sales-import-failed", {
        importId: "imp-read",
        stage: "read-body",
        error: "Error",
      });
      expect(logs.text()).not.toContain(SENTINEL);
    });

    it("keeps a streamed oversize upload at 413 when cancelling the stream fails", async () => {
      const logs = observeLogs();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(256));
        },
        cancel() {
          throw new Error(SENTINEL);
        },
      });
      const request = upload(body);
      const response = await handleSalesImportUpload(request, { limits: { maxFileBytes: 1000 }, log: logs.log });
      logs.restore();

      expect(await expectControlledJson(response, 413)).toMatchObject({
        status: "rejected",
        issues: [expect.objectContaining({ code: "INPUT_FILE_TOO_LARGE" })],
      });
      expect(request.body?.locked).toBe(false);
      expect(logs.text()).not.toContain(SENTINEL);
    });

    it("keeps a declared oversize upload at 413 when cancelling the stream fails", async () => {
      const logs = observeLogs();
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          return Promise.reject(new Error(SENTINEL));
        },
      });
      const response = await handleSalesImportUpload(upload(body, "?sheet=Sales", { "content-length": "5000" }), {
        limits: { maxFileBytes: 1000 },
        log: logs.log,
      });
      logs.restore();

      expect(await expectControlledJson(response, 413)).toMatchObject({ status: "rejected" });
      expect(logs.text()).not.toContain(SENTINEL);
    });
  });

  it("logs only allowlisted diagnostics, never workbook text", async () => {
    const SENTINEL = "SENTINEL Fulana Ficticia";
    const log = vi.fn();
    const workbook = await buildWorkbook([
      { ...salesSheet([line({ "Customer ID": null })]), headers: [...ALL_HEADERS, SENTINEL] },
    ]);
    await handleSalesImportUpload(upload(workbook), { log });
    const missingSheet = await buildWorkbook([salesSheet([line()], SENTINEL)]);
    await handleSalesImportUpload(upload(missingSheet, `?sheet=${encodeURIComponent(SENTINEL)}x`), { log });

    expect(log).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(SENTINEL);
    expect(logged).not.toContain("Cliente");
    expect(logged).toContain("FIELD_REQUIRED");
    expect(logged).toContain("SHEET_NOT_FOUND");
  });
});
