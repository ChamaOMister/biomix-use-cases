/**
 * Review R2 (milestone 2): workbook structures that ExcelJS expands cell by cell while loading
 * (merged ranges, data validations, defined names, column definitions, sheet cells) must be
 * bounded before ExcelJS sees the file, on every sheet, not only the selected one.
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importSalesXlsx, type SalesImportOptions, type SalesImportResult } from "./index";
import { buildWorkbook, line, salesSheet } from "./testing/workbook-fixtures";

const BASE_OPTIONS: SalesImportOptions = {
  importId: "imp-structure",
  sheet: { name: "Sales" },
  invoiceIdentity: "invoice-number-unique-within-import",
};

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const SALES_SHEET = "xl/worksheets/sheet1.xml";
const OTHER_SHEET = "xl/worksheets/sheet2.xml";

/** Sales (sheet1) with one valid line, plus a second sheet "Other" (sheet2). */
function twoSheetWorkbook() {
  return buildWorkbook([salesSheet([line()]), { name: "Other", headers: ["Nota"], rows: [] }]);
}

/** Rewrites parts of a workbook the way a hand-crafted upload could, then re-zips with DEFLATE. */
async function patch(workbook: ArrayBuffer, edits: Record<string, (xml: string) => string>) {
  const zip = await JSZip.loadAsync(workbook);
  for (const [name, edit] of Object.entries(edits)) {
    const file = zip.file(name);
    if (!file) throw new Error(`fixture has no ${name}`);
    zip.file(name, edit(await file.async("string")));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const replaceWith = (xml: string) => () => xml;
const afterSheetData = (fragment: string) => (xml: string) => xml.replace("</sheetData>", `</sheetData>${fragment}`);
const worksheet = (inner: string) => `<worksheet xmlns="${MAIN_NS}"><sheetData/>${inner}</worksheet>`;

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Imports with spies on ExcelJS's workbook load and cell materialization. With `blockLoad`, the
 * load is replaced by a failure so a guard regression cannot run a (possibly endless) expansion.
 */
async function importObserved(
  bytes: Uint8Array,
  options: Partial<SalesImportOptions> = {},
  { blockLoad = false } = {},
) {
  vi.restoreAllMocks(); // a previous blocked load in the same test must not leak into this one
  const probe = new ExcelJS.Workbook();
  const load = vi.spyOn(Object.getPrototypeOf(probe.xlsx) as { load: () => Promise<unknown> }, "load");
  if (blockLoad) load.mockRejectedValue(new Error("ExcelJS load must not run for this input"));
  const getCell = vi.spyOn(
    Object.getPrototypeOf(probe.addWorksheet("probe")) as { getCell: () => unknown },
    "getCell",
  );
  const result: SalesImportResult = await importSalesXlsx(bytes, { ...BASE_OPTIONS, ...options });
  return { result, loadCalls: load.mock.calls.length, getCellCalls: getCell.mock.calls.length };
}

function codes(result: SalesImportResult) {
  return result.issues.map((issue) => issue.code);
}

async function expectRejectedBeforeLoad(
  bytes: Uint8Array,
  code: string,
  options: Partial<SalesImportOptions> = {},
) {
  const observed = await importObserved(bytes, options, { blockLoad: true });
  expect(observed.result.status).toBe("rejected");
  expect(codes(observed.result)).toEqual([code]);
  expect(observed.result.summary.rowsValidated).toBe(false);
  expect(observed.loadCalls).toBe(0);
  expect(observed.getCellCalls).toBe(0);
}

describe("merged ranges", () => {
  it("rejects the reproduced 163-byte unselected-sheet merge before ExcelJS materializes a cell", async () => {
    const xml = `<worksheet xmlns="${MAIN_NS}"><sheetData/><mergeCells count="1"><mergeCell ref="A1:CV100"/></mergeCells></worksheet>`;
    expect(xml.length).toBe(163);
    const bytes = await patch(await twoSheetWorkbook(), { [OTHER_SHEET]: replaceWith(xml) });
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_MERGED_CELLS", {
      limits: { maxDataRows: 10, maxColumns: 24 },
    });
  });

  it("rejects a large merge on the selected sheet before loading", async () => {
    const bytes = await patch(await twoSheetWorkbook(), {
      [SALES_SHEET]: afterSheetData('<mergeCells count="1"><mergeCell ref="A5:XFD1048576"/></mergeCells>'),
    });
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_MERGED_CELLS");
  });

  it("adds merged areas across all sheets", async () => {
    const merge = afterSheetData('<mergeCells count="1"><mergeCell ref="$AA$10:$AF$60"/></mergeCells>'); // 306 cells
    const workbook = await buildWorkbook([
      salesSheet([line()]),
      { name: "Other", headers: ["Nota"], rows: [] },
      { name: "Notes", headers: ["Nota"], rows: [] },
    ]);
    const bytes = await patch(workbook, { [OTHER_SHEET]: merge, "xl/worksheets/sheet3.xml": merge });
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_MERGED_CELLS", { limits: { maxMergedCells: 600 } });
    expect((await importObserved(bytes, { limits: { maxMergedCells: 612 } })).result.status).toBe("accepted");
  });

  it.each([
    ["a namespace prefix", `<x:worksheet xmlns:x="${MAIN_NS}"><x:sheetData/><x:mergeCells><x:mergeCell ref="A1:CV100"/></x:mergeCells></x:worksheet>`],
    ["character references in the range", worksheet('<mergeCells><mergeCell ref="A1:&#67;&#x56;100"/></mergeCells>')],
    ["a reversed range", worksheet('<mergeCells><mergeCell ref="CV100:A1"/></mergeCells>')],
    ["a nested, unexpected location", worksheet('<extLst><ext><mergeCells><mergeCell ref="A1:CV100"/></mergeCells></ext></extLst>')],
  ])("counts merges written with %s", async (_label, xml) => {
    const bytes = await patch(await twoSheetWorkbook(), { [OTHER_SHEET]: replaceWith(xml) });
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_MERGED_CELLS");
  });

  it("still accepts a workbook with a small merged title on another sheet", async () => {
    const bytes = await patch(await twoSheetWorkbook(), {
      [OTHER_SHEET]: replaceWith(worksheet('<mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>')),
    });
    expect((await importObserved(bytes)).result.status).toBe("accepted");
  });
});

describe("other range-expanding structures", () => {
  it("rejects a data validation covering a huge range", async () => {
    const bytes = await patch(await twoSheetWorkbook(), {
      [OTHER_SHEET]: replaceWith(
        worksheet('<dataValidations count="1"><dataValidation type="list" sqref="A1 B2:XFD1048576"><formula1>"a"</formula1></dataValidation></dataValidations>'),
      ),
    });
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_CELLS");
  });

  it("rejects a defined name covering a huge range, including quoted sheet names and lists", async () => {
    const bytes = await patch(await twoSheetWorkbook(), {
      "xl/workbook.xml": (xml) =>
        xml.replace(
          "</sheets>",
          "</sheets><definedNames><definedName name=\"Tudo\">'Other, copy'!$A$1:$CV$10000,Other!$A$1:$CV$10000</definedName></definedNames>",
        ),
    });
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_CELLS", { limits: { maxWorkbookCells: 1_500_000 } });
  });

  it.each(["16385", "1000000000", "9".repeat(310), "-1", "0"])(
    "rejects a column definition with max=%s outside Excel's 1–16,384 columns",
    async (max) => {
      const bytes = await patch(await twoSheetWorkbook(), {
        [OTHER_SHEET]: replaceWith(`<worksheet xmlns="${MAIN_NS}"><cols><col min="1" max="${max}" width="9"/></cols><sheetData/></worksheet>`),
      });
      await expectRejectedBeforeLoad(bytes, "WORKBOOK_UNREADABLE");
    },
  );

  it("accepts a column definition reaching Excel's last column (hidden trailing columns)", async () => {
    const bytes = await patch(await twoSheetWorkbook(), {
      [OTHER_SHEET]: replaceWith(`<worksheet xmlns="${MAIN_NS}"><cols><col min="2" max="16384" hidden="1"/></cols><sheetData/></worksheet>`),
    });
    expect((await importObserved(bytes)).result.status).toBe("accepted");
  });

  it("counts rows and cells on unselected sheets toward the workbook cell limit", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"/><c r="B${i + 1}"/></row>`);
    const bytes = await patch(await twoSheetWorkbook(), {
      [OTHER_SHEET]: replaceWith(`<worksheet xmlns="${MAIN_NS}"><sheetData>${rows.join("")}</sheetData></worksheet>`),
    });
    // Other: 40 rows + 80 cells + 2 columns; Sales: 2 rows + 48 cells + 24 columns.
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_CELLS", { limits: { maxWorkbookCells: 150 } });
    expect((await importObserved(bytes, { limits: { maxWorkbookCells: 196 } })).result.status).toBe("accepted");
  });

  it("scans every part ExcelJS would load as a worksheet, whatever its folder prefix", async () => {
    const zip = await JSZip.loadAsync(await twoSheetWorkbook());
    zip.file("extra/xl/worksheets/sheet9.xml", worksheet('<mergeCells><mergeCell ref="A1:CV100"/></mergeCells>'));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    await expectRejectedBeforeLoad(bytes, "INPUT_TOO_MANY_MERGED_CELLS");
  });

  it.each([
    ["malformed XML", `<worksheet xmlns="${MAIN_NS}"><sheetData></worksheet>`],
    ["a document type declaration", `<!DOCTYPE worksheet [<!ENTITY e "x">]><worksheet xmlns="${MAIN_NS}"><sheetData/></worksheet>`],
  ])("rejects worksheet XML with %s before loading", async (_label, xml) => {
    const bytes = await patch(await twoSheetWorkbook(), { [OTHER_SHEET]: replaceWith(xml) });
    await expectRejectedBeforeLoad(bytes, "WORKBOOK_UNREADABLE");
  });
});

/**
 * Coordinates beyond Excel's grid (rows 1–1,048,576, columns 1–16,384). Row 2^53 cannot be
 * incremented in floating point, and a 310-digit row decodes to Infinity, so ExcelJS's
 * `for (row = top; row <= bottom; row++)` loops would never end. The load is blocked in these
 * tests, so a regression fails instead of hanging.
 */
describe("coordinates outside Excel's grid", () => {
  // [label, first row, last row] of the range A{first}:B{last}.
  const HUGE_ROWS: Array<[string, string, string]> = [
    ["row 2^53 (A9007199254740992:B9007199254740992)", "9007199254740992", "9007199254740992"],
    ["a 310-digit row endpoint", "1", "9".repeat(310)],
  ];
  const merge = (ref: string) => `<mergeCells count="1"><mergeCell ref="${ref}"/></mergeCells>`;
  const validation = (sqref: string) =>
    `<dataValidations count="1"><dataValidation type="list" sqref="${sqref}"><formula1>"a"</formula1></dataValidation></dataValidations>`;
  const definedName = (reference: string) => (xml: string) =>
    xml.replace("</sheets>", `</sheets><definedNames><definedName name="N">${reference}</definedName></definedNames>`);

  describe.each(HUGE_ROWS)("with %s", (_label, first, last) => {
    const ref = `A${first}:B${last}`;
    const absolute = `$A$${first}:$B$${last}`;
    it.each<[string, Record<string, (xml: string) => string>]>([
      ["a merge on the selected sheet", { [SALES_SHEET]: afterSheetData(merge(ref)) }],
      ["a merge on an unselected sheet", { [OTHER_SHEET]: replaceWith(worksheet(merge(ref))) }],
      ["a data validation on the selected sheet", { [SALES_SHEET]: afterSheetData(validation(ref)) }],
      ["a data validation on an unselected sheet", { [OTHER_SHEET]: replaceWith(worksheet(validation(ref))) }],
      ["a defined name over the selected sheet", { "xl/workbook.xml": definedName(`Sales!${absolute}`) }],
      ["a defined name over an unselected sheet", { "xl/workbook.xml": definedName(`Other!${absolute}`) }],
    ])("rejects %s before ExcelJS loads", async (_where, edits) => {
      const bytes = await patch(await twoSheetWorkbook(), edits);
      await expectRejectedBeforeLoad(bytes, "WORKBOOK_UNREADABLE");
    });
  });

  it.each([
    ["a single out-of-grid cell", "A9007199254740992"],
    ["row 0", "A0:B2"],
    ["a missing row", "A:B"],
    ["the row after the last", "A1048577:B1048577"],
  ])("rejects a merge on %s", async (_label, ref) => {
    const bytes = await patch(await twoSheetWorkbook(), { [OTHER_SHEET]: replaceWith(worksheet(merge(ref))) });
    await expectRejectedBeforeLoad(bytes, "WORKBOOK_UNREADABLE");
  });

  it("accepts a small merge in Excel's last row and column", async () => {
    const bytes = await patch(await twoSheetWorkbook(), {
      [OTHER_SHEET]: replaceWith(worksheet(merge("XFC1048575:XFD1048576"))),
    });
    expect((await importObserved(bytes)).result.status).toBe("accepted");
  });
});

describe("ordinary workbook features stay accepted", () => {
  it("accepts an auto-filter, a column data validation and column widths on the sales sheet", async () => {
    const workbook = await buildWorkbook([
      {
        ...salesSheet([line(), line({ "Product ID": "P-002" })]),
        apply: (sheet) => {
          sheet.autoFilter = "A1:X3";
          sheet.getColumn(1).width = 14;
          for (const address of ["P2", "P3"]) {
            sheet.getCell(address).dataValidation = { type: "list", allowBlank: false, formulae: ['"30 Days,60 Days"'] };
          }
        },
      },
    ]);
    const observed = await importObserved(new Uint8Array(workbook));
    expect(observed.result.status).toBe("accepted");
    expect(observed.loadCalls).toBe(1);
  });
});
