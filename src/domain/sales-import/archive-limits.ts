/**
 * Resource limits for uploaded XLSX files, enforced before the spreadsheet library sees them.
 *
 * An XLSX file is a ZIP archive. ExcelJS (through JSZip) inflates every entry fully, so a small
 * file can expand into gigabytes. This pre-flight check reads the ZIP central directory itself,
 * caps the declared sizes, and then inflates each entry with a hard output cap equal to its
 * declared size, so the archive's real expansion is verified without ever exceeding the limits.
 *
 * The checks only protect ExcelJS if JSZip reads the same entries. JSZip tolerates prefixed,
 * concatenated and gapped archives by shifting its offsets, so this check accepts only the
 * canonical layout that leaves no room for a second interpretation: entries packed from byte 0
 * with no gaps or overlaps, the central directory right after them, the end record right after
 * that, and its comment ending exactly at the end of the file. Names must be the same in the
 * local and central headers and unaffected by JSZip's path normalization. This is a targeted
 * consistency check for this importer, not a complete ZIP validator. Server-side only.
 */
import { inflateRawSync } from "node:zlib";
import type { InputLimits } from "./limits";
import type { IssueCode } from "./types";

export interface LimitProblem {
  code: IssueCode;
  message: string;
  suggestion: string;
}

export type ArchiveCheck = { ok: true } | { ok: false; issue: LimitProblem };

/** A verified archive part: its name and its fully inflated content (within the limits). */
export interface ArchivePart {
  name: string;
  content: Uint8Array;
}

/** Inspects each verified part before the archive is accepted; returns a problem to reject it. */
export type PartInspector = (part: ArchivePart) => LimitProblem | null;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_DATA_DESCRIPTOR = 0x8;
const FLAG_STRONG_ENCRYPTION = 0x40;
const EXTRA_ZIP64 = 0x0001;
const EXTRA_UNICODE_PATH = 0x7075;
const MADE_BY_DOS = 0;
const DOS_DIRECTORY_ATTRIBUTE = 0x10;

const MiB = 1024 * 1024;
const formatMiB = (bytes: number) => `${(bytes / MiB).toFixed(1)} MiB`;

function unreadable(detail: string): { ok: false; issue: LimitProblem } {
  return {
    ok: false,
    issue: {
      code: "WORKBOOK_UNREADABLE",
      message: `The file is not a readable XLSX workbook (${detail}).`,
      suggestion: "Save the workbook again as .xlsx from Excel or a compatible application, without a password.",
    },
  };
}

function tooLarge(code: IssueCode, message: string): { ok: false; issue: LimitProblem } {
  return {
    ok: false,
    issue: {
      code,
      message,
      suggestion: "Split the export into smaller workbooks or remove unrelated sheets, images and formatting.",
    },
  };
}

/** The last end-record signature in the file, as JSZip finds it; -1 if none could be complete. */
function findEndOfCentralDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - EOCD_SIZE - MAX_COMMENT);
  for (let offset = view.byteLength - 4; offset >= lowest; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset <= view.byteLength - EOCD_SIZE ? offset : -1;
    }
  }
  return -1;
}

/** Rejects names JSZip would rewrite (it drops "." and empty segments and resolves ".."). */
function isCanonicalName(name: string): boolean {
  if (name === "") return false;
  const segments = name.split("/");
  return segments.every(
    (segment, index) =>
      segment !== "." && segment !== ".." && (segment !== "" || index === 0 || index === segments.length - 1),
  );
}

/** Checks the extra-field records fit exactly and include no field that changes interpretation. */
function extraFieldsProblem(view: DataView, start: number, end: number): string | null {
  let cursor = start;
  while (cursor < end) {
    if (cursor + 4 > end) return "a ZIP extra field is truncated";
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    if (id === EXTRA_ZIP64) return "ZIP64 archives are not supported";
    if (id === EXTRA_UNICODE_PATH) return "alternative Unicode part names are not supported";
    cursor += 4 + size;
  }
  return cursor === end ? null : "a ZIP extra field is truncated";
}

interface Entry {
  name: string;
  nameBytes: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export function checkArchiveLimits(data: Uint8Array, limits: InputLimits, inspect?: PartInspector): ArchiveCheck {
  if (data.byteLength > limits.maxFileBytes) {
    return tooLarge(
      "INPUT_FILE_TOO_LARGE",
      `The file is ${formatMiB(data.byteLength)}; the limit is ${formatMiB(limits.maxFileBytes)}.`,
    );
  }
  if (data.byteLength < EOCD_SIZE) return unreadable("too short to be a ZIP archive");

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return unreadable("no ZIP directory found");

  const diskNumber = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (
    diskNumber === 0xffff ||
    directoryDisk === 0xffff ||
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    return unreadable("ZIP64 archives are not supported");
  }
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    return unreadable("multi-part archives are not supported");
  }
  if (eocd + EOCD_SIZE + commentLength !== data.byteLength) {
    return unreadable("the file has data before or after the ZIP archive");
  }
  if (entryCount > limits.maxArchiveEntries) {
    return tooLarge(
      "INPUT_TOO_MANY_ENTRIES",
      `The workbook archive has ${entryCount} parts; the limit is ${limits.maxArchiveEntries}.`,
    );
  }
  // No gap before the end record: otherwise JSZip shifts every offset by the gap.
  if (directoryOffset + directorySize !== eocd) return unreadable("the ZIP directory is not where the archive says");

  const entries: Entry[] = [];
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalUncompressed = 0;
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + CENTRAL_SIZE > eocd) return unreadable("ZIP directory is truncated");
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) return unreadable("ZIP directory is corrupt");
    const madeBy = view.getUint8(cursor + 5);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameEnd = cursor + CENTRAL_SIZE + nameLength;
    const recordEnd = nameEnd + extraLength + commentLength;
    if (recordEnd > eocd) return unreadable("ZIP directory is truncated");

    const nameBytes = data.subarray(cursor + CENTRAL_SIZE, nameEnd);
    let name: string;
    try {
      name = decoder.decode(nameBytes);
    } catch {
      return unreadable("a part name is not valid UTF-8");
    }
    if (!isCanonicalName(name)) return unreadable("a part name is not a plain path");
    const extraProblem = extraFieldsProblem(view, nameEnd, nameEnd + extraLength);
    if (extraProblem) return unreadable(extraProblem);

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) return unreadable("the workbook is encrypted");
    if (method !== 0 && method !== 8) return unreadable("unsupported compression method");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      return unreadable("ZIP64 archives are not supported");
    }
    const dosDirectory = madeBy === MADE_BY_DOS && (externalAttributes & DOS_DIRECTORY_ATTRIBUTE) !== 0;
    if (dosDirectory && !name.endsWith("/")) return unreadable("a folder entry is ambiguous");
    if (name.endsWith("/") && uncompressedSize !== 0) return unreadable("a folder entry has content");

    // ExcelJS strips one leading "/" before matching part names.
    const loadedName = name.startsWith("/") ? name.slice(1) : name;
    if (names.has(loadedName)) return unreadable("the archive contains duplicate parts");
    names.add(loadedName);
    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      return tooLarge(
        "INPUT_EXPANSION_TOO_LARGE",
        `A workbook part expands to ${formatMiB(uncompressedSize)}; the limit per part is ${formatMiB(limits.maxEntryUncompressedBytes)}.`,
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) {
      return tooLarge(
        "INPUT_EXPANSION_TOO_LARGE",
        `The workbook expands to more than ${formatMiB(limits.maxTotalUncompressedBytes)}.`,
      );
    }
    entries.push({ name, nameBytes, flags, method, crc, compressedSize, uncompressedSize, localOffset });
    cursor = recordEnd;
  }
  if (cursor !== eocd) return unreadable("ZIP directory size is inconsistent");

  // Local records must tile [0, directoryOffset) exactly: no prefix, gap, overlap or hidden data.
  const layout: Array<{ entry: Entry; dataStart: number; recordEnd: number }> = [];
  for (const entry of entries) {
    const local = entry.localOffset;
    if (local + LOCAL_SIZE > directoryOffset || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
      return unreadable("a ZIP entry header is corrupt");
    }
    const localFlags = view.getUint16(local + 6, true);
    const localMethod = view.getUint16(local + 8, true);
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const localName = data.subarray(local + LOCAL_SIZE, local + LOCAL_SIZE + localNameLength);
    // JSZip takes the name from the local header and everything else from the directory.
    if (localNameLength !== entry.nameBytes.byteLength || !localName.every((byte, i) => byte === entry.nameBytes[i])) {
      return unreadable("a part name differs between ZIP headers");
    }
    if (localMethod !== entry.method || (localFlags & FLAG_DATA_DESCRIPTOR) !== (entry.flags & FLAG_DATA_DESCRIPTOR)) {
      return unreadable("ZIP headers disagree");
    }
    const dataStart = local + LOCAL_SIZE + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    let recordEnd = dataEnd;
    if (entry.flags & FLAG_DATA_DESCRIPTOR) {
      const signed = dataEnd + 4 <= directoryOffset && view.getUint32(dataEnd, true) === DESCRIPTOR_SIGNATURE;
      const fields = signed ? dataEnd + 4 : dataEnd;
      recordEnd = fields + 12;
      if (
        recordEnd > directoryOffset ||
        view.getUint32(fields, true) !== entry.crc ||
        view.getUint32(fields + 4, true) !== entry.compressedSize ||
        view.getUint32(fields + 8, true) !== entry.uncompressedSize
      ) {
        return unreadable("a ZIP data descriptor is inconsistent");
      }
    } else if (
      view.getUint32(local + 14, true) !== entry.crc ||
      view.getUint32(local + 18, true) !== entry.compressedSize ||
      view.getUint32(local + 22, true) !== entry.uncompressedSize
    ) {
      return unreadable("ZIP headers disagree");
    }
    if (recordEnd > directoryOffset) return unreadable("a ZIP entry is out of bounds");
    layout.push({ entry, dataStart, recordEnd });
  }
  layout.sort((a, b) => a.entry.localOffset - b.entry.localOffset);
  let expected = 0;
  for (const { entry, recordEnd } of layout) {
    if (entry.localOffset !== expected) return unreadable("the archive has unreferenced or overlapping data");
    expected = recordEnd;
  }
  if (expected !== directoryOffset) return unreadable("the archive has unreferenced data");

  // Verify real expansion: never inflate beyond what the (already capped) header declares.
  for (const { entry, dataStart } of layout) {
    const compressed = data.subarray(dataStart, dataStart + entry.compressedSize);
    let content: Uint8Array;
    if (entry.method === 0) {
      content = compressed;
    } else {
      try {
        // +1 so that output beyond the declared size is detected rather than silently truncated.
        content = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 });
      } catch (error) {
        if (error instanceof RangeError) {
          return tooLarge(
            "INPUT_EXPANSION_TOO_LARGE",
            "A workbook part expands beyond the size recorded in the file, a sign of a decompression bomb or corruption.",
          );
        }
        return unreadable("a ZIP entry cannot be decompressed");
      }
    }
    if (content.byteLength > entry.uncompressedSize) {
      return tooLarge(
        "INPUT_EXPANSION_TOO_LARGE",
        "A workbook part expands beyond the size recorded in the file, a sign of a decompression bomb or corruption.",
      );
    }
    if (content.byteLength !== entry.uncompressedSize) return unreadable("a ZIP entry size does not match its header");
    const problem = inspect?.({ name: entry.name, content });
    if (problem) return { ok: false, issue: problem };
  }
  return { ok: true };
}
