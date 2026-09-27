import JSZip from "jszip";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkArchiveLimits } from "./archive-limits";
import { DEFAULT_INPUT_LIMITS, type InputLimits } from "./limits";
import { buildWorkbook, line, salesSheet } from "./testing/workbook-fixtures";
import { buildZip } from "./testing/zip-fixtures";

const SMALL: InputLimits = {
  maxFileBytes: 64 * 1024,
  maxArchiveEntries: 5,
  maxEntryUncompressedBytes: 32 * 1024,
  maxTotalUncompressedBytes: 48 * 1024,
  maxMergedCells: 10,
  maxWorkbookCells: 1000,
  maxDataRows: 10,
  maxColumns: 30,
};

const text = (value: string) => new TextEncoder().encode(value);

function codeOf(result: ReturnType<typeof checkArchiveLimits>) {
  return result.ok ? "ok" : result.issue.code;
}

describe("checkArchiveLimits", () => {
  it("accepts a real workbook within the default limits", async () => {
    const workbook = new Uint8Array(await buildWorkbook([salesSheet([line(), line()])]));
    expect(checkArchiveLimits(workbook, DEFAULT_INPUT_LIMITS)).toEqual({ ok: true });
  });

  it("accepts stored and deflated entries within the limits", () => {
    const zip = buildZip([
      { name: "a.xml", data: text("<a/>"), method: 0 },
      { name: "b.xml", data: text("<b>".repeat(100)), method: 8 },
    ]);
    expect(checkArchiveLimits(zip, SMALL)).toEqual({ ok: true });
  });

  it("rejects a file larger than the compressed size limit before reading it", () => {
    // Not even a ZIP: the size check must come first.
    expect(codeOf(checkArchiveLimits(new Uint8Array(SMALL.maxFileBytes + 1), SMALL))).toBe(
      "INPUT_FILE_TOO_LARGE",
    );
  });

  it("rejects bytes that are not a ZIP archive", () => {
    expect(codeOf(checkArchiveLimits(text("not a workbook"), SMALL))).toBe("WORKBOOK_UNREADABLE");
  });

  it("rejects archives with too many entries", () => {
    const entries = Array.from({ length: SMALL.maxArchiveEntries + 1 }, (_, i) => ({
      name: `e${i}.xml`,
      data: text("<x/>"),
    }));
    expect(codeOf(checkArchiveLimits(buildZip(entries), SMALL))).toBe("INPUT_TOO_MANY_ENTRIES");
  });

  it("rejects an entry that declares more than the per-entry expansion limit", () => {
    const zip = buildZip([{ name: "big.xml", data: new Uint8Array(SMALL.maxEntryUncompressedBytes + 1) }]);
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("INPUT_EXPANSION_TOO_LARGE");
  });

  it("rejects entries whose combined declared size exceeds the total expansion limit", () => {
    const quarter = new Uint8Array(SMALL.maxTotalUncompressedBytes / 4 + 1);
    const zip = buildZip([0, 1, 2, 3].map((i) => ({ name: `p${i}.xml`, data: quarter })));
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("INPUT_EXPANSION_TOO_LARGE");
  });

  it("stops inflating an entry that expands beyond its declared size (lying header)", () => {
    // 64 MiB of zeros deflates to ~64 KiB; the header claims 100 bytes.
    const bomb = buildZip([{ name: "xl/worksheets/sheet1.xml", data: new Uint8Array(64 * 1024 * 1024), declaredSize: 100 }]);
    const limits = { ...DEFAULT_INPUT_LIMITS };
    const heapBefore = process.memoryUsage().arrayBuffers;
    const result = checkArchiveLimits(bomb, limits);
    expect(codeOf(result)).toBe("INPUT_EXPANSION_TOO_LARGE");
    // The inflater is capped at the declared size, so the 64 MiB payload is never materialized.
    expect(process.memoryUsage().arrayBuffers - heapBefore).toBeLessThan(16 * 1024 * 1024);
  });

  it("rejects an entry that expands to less than its declared size", () => {
    const zip = buildZip([{ name: "a.xml", data: text("<a/>"), declaredSize: 50 }]);
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("WORKBOOK_UNREADABLE");
  });

  it("rejects encrypted entries", () => {
    const zip = buildZip([{ name: "a.xml", data: text("<a/>"), flags: 0x1 }]);
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("WORKBOOK_UNREADABLE");
  });

  it("rejects unsupported compression methods", () => {
    const zip = buildZip([{ name: "a.xml", data: text("<a/>"), method: 0 }]);
    // Patch the method field (stored → 12, bzip2) in both local and central headers.
    const view = new DataView(zip.buffer);
    view.setUint16(8, 12, true);
    const central = zip.length - 22 - 46 - "a.xml".length;
    view.setUint16(central + 10, 12, true);
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("WORKBOOK_UNREADABLE");
  });

  it("rejects ZIP64 archives", () => {
    const zip = buildZip([{ name: "a.xml", data: text("<a/>") }], { eocdEntryCount: 0xffff });
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("WORKBOOK_UNREADABLE");
  });

  it("rejects duplicate entry names", () => {
    const zip = buildZip([
      { name: "a.xml", data: text("<a/>") },
      { name: "a.xml", data: text("<b/>") },
    ]);
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("WORKBOOK_UNREADABLE");
  });

  it("rejects a central directory that does not match the entry count", () => {
    const zip = buildZip([{ name: "a.xml", data: text("<a/>") }], { eocdEntryCount: 2 });
    expect(codeOf(checkArchiveLimits(zip, SMALL))).toBe("WORKBOOK_UNREADABLE");
  });
});

/** Info-ZIP Unicode path field (0x7075): JSZip uses it instead of the stored name. */
function unicodePathExtra(storedName: string, unicodeName: string): Uint8Array {
  const name = Buffer.from(unicodeName, "utf8");
  const field = Buffer.alloc(9 + name.byteLength);
  field.writeUInt16LE(0x7075, 0);
  field.writeUInt16LE(5 + name.byteLength, 2);
  field.writeUInt8(1, 4);
  field.writeUInt32LE(crc32(Buffer.from(storedName, "utf8")), 5);
  name.copy(field, 9);
  return new Uint8Array(field);
}

/** The parts the pre-flight check verified, by name and inflated size; null when it rejects. */
function preflightView(bytes: Uint8Array, limits: InputLimits): Map<string, number> | null {
  const parts = new Map<string, number>();
  const result = checkArchiveLimits(bytes, limits, (part) => {
    parts.set(part.name, part.content.byteLength);
    return null;
  });
  return result.ok ? parts : null;
}

/** What the installed downstream reader (JSZip, used by ExcelJS) extracts; null when it fails. */
async function jszipView(bytes: Uint8Array): Promise<Map<string, number> | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const parts = new Map<string, number>();
    for (const file of Object.values(zip.files)) {
      parts.set(file.name, (await file.async("uint8array")).byteLength);
    }
    return parts;
  } catch {
    return null;
  }
}

/** Whenever the pre-flight check accepts, JSZip must read exactly the parts it verified. */
async function expectReadersAgree(bytes: Uint8Array, limits: InputLimits = SMALL) {
  const checked = preflightView(bytes, limits);
  if (checked === null) return "rejected";
  expect(await jszipView(bytes)).toEqual(checked);
  return "accepted";
}

describe("checkArchiveLimits agrees with the downstream ZIP reader", () => {
  const entries = [
    { name: "a.xml", data: text("<a/>") },
    { name: "b.xml", data: text("<b>".repeat(50)) },
  ];

  it("rejects the reproduced concatenation where JSZip reads a different, larger archive", async () => {
    const payload = new Uint8Array(4096);
    const name = "xl/worksheets/sheet1.xml";
    const prefix = buildZip([{ name, data: new Uint8Array(deflateRawSync(payload).byteLength), method: 0 }]);
    const actual = buildZip([{ name, data: payload }]);
    const bytes = new Uint8Array(Buffer.concat([prefix, actual]));
    const limits = { ...DEFAULT_INPUT_LIMITS, maxEntryUncompressedBytes: 1024, maxTotalUncompressedBytes: 1024 };

    // Evidence of the disagreement this guards against: JSZip inflates the second archive.
    expect((await jszipView(bytes))?.get(name)).toBe(4096);
    expect(codeOf(checkArchiveLimits(bytes, limits))).toBe("WORKBOOK_UNREADABLE");
  });

  it.each<[string, Uint8Array]>([
    ["a prefixed stub before the first entry", buildZip(entries, { stub: text("MZ stub") })],
    ["bytes after the end record", buildZip(entries, { trailing: text("junk") })],
    ["a gap between the directory and the end record", buildZip(entries, { gapBeforeEnd: 12 })],
    ["unreferenced bytes between entries", buildZip(entries, { gapAfterEntry: 7 })],
    ["two directory records sharing one local entry", buildZip(entries, { localOffsets: { 1: 0 } })],
    ["a local name that differs from the directory name", buildZip([{ name: "a.xml", localName: "z.xml", data: text("<a/>") }])],
    ["a comment length beyond the end of the file", buildZip(entries, { comment: text("c"), commentLength: 5 })],
    ["a comment length shorter than the comment", buildZip(entries, { comment: text("comment"), commentLength: 2 })],
    ["a path with a parent segment", buildZip([{ name: "x/../a.xml", data: text("<a/>") }])],
    ["a path with an empty segment", buildZip([{ name: "x//a.xml", data: text("<a/>") }])],
    ["the same part with and without a leading slash", buildZip([
      { name: "a.xml", data: text("<a/>") },
      { name: "/a.xml", data: text("<b/>") },
    ])],
    ["a Unicode path extra field that renames the part", buildZip([
      { name: "a.xml", data: text("<a/>"), centralExtra: unicodePathExtra("a.xml", "b.xml") },
    ])],
    ["a name that is not valid UTF-8", (() => {
      const zip = buildZip([{ name: "a.xml", data: text("<a/>") }]);
      zip[30] = 0xff; // local header name
      zip[zip.length - 22 - 5] = 0xff; // central directory name
      return zip;
    })()],
  ])("rejects %s", async (_label, bytes) => {
    expect(codeOf(checkArchiveLimits(bytes, SMALL))).toBe("WORKBOOK_UNREADABLE");
    await expectReadersAgree(bytes);
  });

  it.each<[string, () => Promise<Uint8Array>]>([
    ["an ordinary archive", async () => buildZip(entries)],
    ["an archive with a comment", async () => buildZip(entries, { comment: text("fictional comment") })],
    ["a leading-slash part name", async () => buildZip([{ name: "/a.xml", data: text("<a/>") }])],
    ["an ExcelJS workbook", async () => new Uint8Array(await buildWorkbook([salesSheet([line(), line()])]))],
    ["a JSZip archive with data descriptors and a folder entry", async () => {
      const zip = new JSZip();
      zip.folder("xl");
      zip.file("xl/a.xml", "<a/>".repeat(40));
      zip.file("b.xml", "<b/>", { compression: "STORE" });
      return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", streamFiles: true });
    }],
  ])("accepts %s, and JSZip reads the same parts", async (_label, build) => {
    expect(await expectReadersAgree(await build(), DEFAULT_INPUT_LIMITS)).toBe("accepted");
  });

  it("never accepts a mutated archive that JSZip would read differently", async () => {
    // Deterministic byte-level mutations of small valid archives (differential fuzzing).
    const seeds = [
      buildZip(entries),
      buildZip([{ name: "xl/worksheets/sheet1.xml", data: text("<w/>".repeat(30)), method: 0 }, ...entries]),
    ];
    let state = 0x2545f491;
    const random = (n: number) => {
      // mulberry32
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    let accepted = 0;
    for (let iteration = 0; iteration < 600; iteration++) {
      const seed = seeds[iteration % seeds.length]!;
      let bytes = Array.from(seed);
      const at = random(bytes.length);
      switch (random(4)) {
        case 0:
          bytes[at] = random(256);
          break;
        case 1:
          bytes.splice(at, 0, ...Array.from({ length: 1 + random(8) }, () => random(256)));
          break;
        case 2:
          bytes.splice(at, 1 + random(8));
          break;
        default:
          bytes = [...bytes.slice(0, at), ...seed.subarray(random(seed.length)), ...bytes.slice(at)];
      }
      if ((await expectReadersAgree(new Uint8Array(bytes))) === "accepted") accepted++;
    }
    // Some mutations (e.g. of CRC or version fields) keep the archive valid; most are rejected.
    expect(accepted).toBeGreaterThanOrEqual(10);
  });
});
