/**
 * Test-only ZIP writer that can produce malformed or hostile archives (lying size headers,
 * encryption flags, ZIP64 markers, prefixed or gapped layouts) that a normal spreadsheet
 * library would never write.
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntrySpec {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  /** Overrides the uncompressed size written to the headers (e.g. to under-declare a bomb). */
  declaredSize?: number;
  flags?: number;
  /** Name written to the local header only (the central directory keeps `name`). */
  localName?: string;
  /** Central-directory extra field (raw bytes). */
  centralExtra?: Uint8Array;
}

export interface ZipLayoutOptions {
  eocdEntryCount?: number;
  eocdCentralDirectorySize?: number;
  /** Bytes before the first entry; offsets account for them (a self-extractor-style stub). */
  stub?: Uint8Array;
  /** Unreferenced bytes after each entry's data; offsets account for them. */
  gapAfterEntry?: number;
  /** Unreferenced bytes between the central directory and the end record. */
  gapBeforeEnd?: number;
  comment?: Uint8Array;
  /** Overrides the comment length written to the end record. */
  commentLength?: number;
  /** Bytes after the end record (and its comment). */
  trailing?: Uint8Array;
  /** Overrides the local header offset recorded in the central directory, by entry index. */
  localOffsets?: Record<number, number>;
}

export function buildZip(entries: ZipEntrySpec[], options: ZipLayoutOptions = {}): Uint8Array {
  const stub = Buffer.from(options.stub ?? new Uint8Array(0));
  const gap = Buffer.alloc(options.gapAfterEntry ?? 0, 0x20);
  const locals: Buffer[] = [stub];
  const centrals: Buffer[] = [];
  let offset = stub.byteLength;
  entries.forEach((entry, index) => {
    const method = entry.method ?? 8;
    const payload = method === 8 ? deflateRawSync(entry.data) : Buffer.from(entry.data);
    const name = Buffer.from(entry.name, "utf8");
    const localName = Buffer.from(entry.localName ?? entry.name, "utf8");
    const extra = Buffer.from(entry.centralExtra ?? new Uint8Array(0));
    const size = entry.declaredSize ?? entry.data.byteLength;
    const crc = crc32(entry.data);
    const flags = entry.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.byteLength, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localName.byteLength, 26);
    locals.push(local, localName, payload, gap);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.byteLength, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(extra.byteLength, 30);
    central.writeUInt32LE(options.localOffsets?.[index] ?? offset, 42);
    centrals.push(central, name, extra);

    offset += 30 + localName.byteLength + payload.byteLength + gap.byteLength;
  });
  const centralDirectory = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? new Uint8Array(0));
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.eocdEntryCount ?? entries.length, 8);
  eocd.writeUInt16LE(options.eocdEntryCount ?? entries.length, 10);
  eocd.writeUInt32LE(options.eocdCentralDirectorySize ?? centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(options.commentLength ?? comment.byteLength, 20);
  return new Uint8Array(
    Buffer.concat([
      ...locals,
      centralDirectory,
      Buffer.alloc(options.gapBeforeEnd ?? 0, 0x20),
      eocd,
      comment,
      Buffer.from(options.trailing ?? new Uint8Array(0)),
    ]),
  );
}
