/**
 * Reads a request body up to a byte limit while streaming, so an oversized upload is cut off
 * without being buffered whole. Shared by the XLSX upload and the sales-feed endpoint.
 */
export type BodyRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too-large" | "empty" }
  | { ok: false; reason: "failed"; error: unknown };

/** Best effort: the response does not depend on whether the client stream accepts the cancel. */
export async function cancelQuietly(stream: { cancel(): Promise<void> } | null): Promise<void> {
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
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<BodyRead> {
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
