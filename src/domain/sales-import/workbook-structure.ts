/**
 * Pre-load bounds on workbook structures that ExcelJS materializes cell by cell while loading,
 * before this importer can look at the selected sheet's extent:
 *
 * - merged ranges: every cell in each range is created (and each merge is compared with every
 *   other), on every sheet;
 * - data validations: one entry per cell in each `sqref` range;
 * - defined names: one entry per cell in each range (Excel's hidden auto-filter name covers the
 *   whole filtered table);
 * - column definitions and cell references: one column object per column up to the widest;
 * - rows and cells on every sheet.
 *
 * The scan parses the same parts ExcelJS parses (worksheets matched by ExcelJS's own name
 * pattern, and `xl/workbook.xml`) with the same XML parser (saxes, which expands no custom
 * entities), counts elements by local name wherever they appear (a superset of what ExcelJS
 * reads), and sizes ranges with ExcelJS's own address decoder. Server-side only.
 */
import colCache from "exceljs/lib/utils/col-cache.js";
import { SaxesParser } from "saxes";
import type { LimitProblem, PartInspector } from "./archive-limits";
import type { InputLimits } from "./limits";

/** exceljs 4.4.0 lib/xlsx/xlsx.js: part names it loads, after stripping one leading "/". */
const EXCELJS_WORKSHEET_PART = /xl\/worksheets\/sheet(\d+)[.]xml/;
const EXCELJS_WORKBOOK_PART = "xl/workbook.xml";
/** exceljs 4.4.0 lib/doc/defined-names.js: ranges it expands cell by cell. */
const EXCELJS_EXPANDED_NAME = /[$](\w+)[$](\d+)(:[$](\w+)[$](\d+))?/;
/** Names ExcelJS turns into page setup instead of expanding. */
const PAGE_SETUP_NAMES = new Set(["_xlnm.Print_Area", "_xlnm.Print_Titles"]);

const formatCount = (value: number) => value.toLocaleString("en-US");

class StopScan extends Error {
  constructor(readonly problem: LimitProblem) {
    super(problem.code);
  }
}

function unreadable(detail: string): LimitProblem {
  return {
    code: "WORKBOOK_UNREADABLE",
    message: `The file is not a readable XLSX workbook (${detail}).`,
    suggestion: "Save the workbook again as .xlsx from Excel or a compatible application.",
  };
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** Excel's grid. ExcelJS does not check rows at all. */
const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;

const inGrid = (value: number | undefined, max: number): value is number =>
  Number.isSafeInteger(value) && value !== undefined && value >= 1 && value <= max;

function outsideGrid(): StopScan {
  return new StopScan(unreadable("a cell reference is outside Excel's rows 1–1,048,576 or columns A–XFD"));
}

/**
 * Cells ExcelJS visits for a reference (a range, or a single cell), decoded with ExcelJS's own
 * decoder. Every coordinate must lie in Excel's grid before any arithmetic: ExcelJS loops
 * `for (row = top; row <= bottom; row++)`, which never ends when a row is 2^53 or more (the
 * increment is lost) or Infinity (a 310-digit row), and treats NaN or 0 unpredictably. Invalid
 * references reject the workbook; they are never counted as one cell.
 */
function referenceArea(reference: string): number {
  let decoded: ReturnType<typeof colCache.decodeEx>;
  try {
    decoded = colCache.decodeEx(reference);
  } catch {
    throw outsideGrid();
  }
  const isRange = "top" in decoded;
  const top = isRange ? decoded.top : decoded.row;
  const bottom = isRange ? decoded.bottom : decoded.row;
  const left = isRange ? decoded.left : decoded.col;
  const right = isRange ? decoded.right : decoded.col;
  if (!inGrid(top, MAX_ROW) || !inGrid(bottom, MAX_ROW) || !inGrid(left, MAX_COLUMN) || !inGrid(right, MAX_COLUMN)) {
    throw outsideGrid();
  }
  // At most 1,048,576 × 16,384 ≈ 1.7e10: an exact, finite integer.
  return (bottom - top + 1) * (right - left + 1);
}

/** A column index from a `<col min|max>` attribute, as ExcelJS parses it; absent means 0 (unused). */
function columnAttribute(value: string | undefined): number {
  if (value === undefined) return 0;
  const column = Number.parseInt(value, 10);
  if (!inGrid(column, MAX_COLUMN)) throw outsideGrid();
  return column;
}

function cellColumn(reference: string): number {
  try {
    return colCache.decodeAddress(reference).col ?? 0;
  } catch {
    throw new StopScan(unreadable("a cell reference is invalid"));
  }
}

function isValidRange(range: string): boolean {
  try {
    colCache.decodeEx(range);
    return true;
  } catch {
    return false;
  }
}

/** Mirrors exceljs 4.4.0 defined-name-xform.js `extractRanges` (quoted sheet names may hold commas). */
function extractRanges(text: string): string[] {
  const ranges: string[] = [];
  let quotesOpened = false;
  let last = "";
  for (const item of text.split(",")) {
    if (!item) continue;
    const quotes = (item.match(/'/g) ?? []).length;
    if (!quotes) {
      if (quotesOpened) last += `${item},`;
      else if (isValidRange(item)) ranges.push(item);
      continue;
    }
    const quotesEven = quotes % 2 === 0;
    if (!quotesOpened && quotesEven && isValidRange(item)) {
      ranges.push(item);
    } else if (quotesOpened && !quotesEven) {
      quotesOpened = false;
      if (isValidRange(last + item)) ranges.push(last + item);
      last = "";
    } else {
      quotesOpened = true;
      last += `${item},`;
    }
  }
  return ranges;
}

function definedNameArea(name: string | undefined, text: string): number {
  if (name !== undefined && PAGE_SETUP_NAMES.has(name)) return 0;
  let area = 0;
  for (const range of extractRanges(text)) {
    if (EXCELJS_EXPANDED_NAME.test(range.split("!").pop() ?? "")) area += referenceArea(range);
  }
  return area;
}

/**
 * Returns a part inspector that accumulates structure counts across all parts of one workbook
 * and rejects it as soon as a limit is exceeded.
 */
export function createStructureInspector(limits: InputLimits): PartInspector {
  let mergedCells = 0;
  let workbookCells = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

  const addMerged = (count: number) => {
    mergedCells += count;
    if (mergedCells > limits.maxMergedCells) {
      throw new StopScan({
        code: "INPUT_TOO_MANY_MERGED_CELLS",
        message: `The workbook's merged ranges cover more than ${formatCount(limits.maxMergedCells)} cells across its sheets.`,
        suggestion: "Unmerge cells, or remove sheets that are not part of the sales export, and save again.",
      });
    }
  };
  const addCells = (count: number) => {
    workbookCells += count;
    if (workbookCells > limits.maxWorkbookCells) {
      throw new StopScan({
        code: "INPUT_TOO_MANY_CELLS",
        message: `The workbook defines more than ${formatCount(limits.maxWorkbookCells)} cells, rows, columns and range entries across its sheets.`,
        suggestion:
          "Remove unrelated sheets, named ranges, data validations and formatting applied to entire rows or columns, or split the export.",
      });
    }
  };

  function scanWorksheet(parser: SaxesParser) {
    let columns = 0;
    let previousColumn = 0;
    parser.on("opentag", (node) => {
      const attributes = node.attributes as Record<string, string>;
      switch (localName(node.name)) {
        case "row":
          previousColumn = 0;
          addCells(1);
          break;
        case "c": {
          const column = attributes.r === undefined ? previousColumn + 1 : cellColumn(attributes.r);
          previousColumn = column;
          if (column > columns) {
            addCells(column - columns);
            columns = column;
          }
          addCells(1);
          break;
        }
        case "col": {
          // ExcelJS creates column objects from 1 up to the largest min/max it is given.
          const extent = Math.max(columnAttribute(attributes.min), columnAttribute(attributes.max));
          if (extent > columns) {
            addCells(extent - columns);
            columns = extent;
          }
          break;
        }
        case "mergeCell":
          // ExcelJS fails on a merge without a range; reject it here rather than guess.
          if (attributes.ref === undefined) throw new StopScan(unreadable("a merged range has no reference"));
          addMerged(referenceArea(attributes.ref));
          break;
        case "dataValidation":
          // ExcelJS splits sqref on whitespace; every piece must be a cell or range in the grid.
          if (attributes.sqref === undefined) throw new StopScan(unreadable("a data validation has no range"));
          for (const reference of attributes.sqref.split(/\s+/g)) addCells(referenceArea(reference));
          break;
      }
    });
  }

  function scanWorkbook(parser: SaxesParser) {
    let definedName: { name: string | undefined; text: string[] } | null = null;
    parser.on("opentag", (node) => {
      if (definedName) throw new StopScan(unreadable("a defined name contains markup"));
      if (localName(node.name) === "definedName") {
        definedName = { name: (node.attributes as Record<string, string>).name, text: [] };
      }
    });
    // Like ExcelJS, only text events form the name's value (CDATA and comments are skipped).
    parser.on("text", (text) => definedName?.text.push(text));
    parser.on("closetag", () => {
      if (!definedName) return;
      addCells(definedNameArea(definedName.name, definedName.text.join("")));
      definedName = null;
    });
  }

  return ({ name, content }) => {
    const loadedName = name.startsWith("/") ? name.slice(1) : name;
    const isWorkbook = loadedName === EXCELJS_WORKBOOK_PART;
    if (name.endsWith("/") || (!isWorkbook && !EXCELJS_WORKSHEET_PART.test(loadedName))) return null;

    let xml: string;
    try {
      // Strict decoding: malformed bytes could otherwise decode differently in JSZip.
      xml = decoder.decode(content);
    } catch {
      return unreadable("a workbook part is not valid UTF-8");
    }
    const parser = new SaxesParser();
    parser.on("doctype", () => {
      throw new StopScan(unreadable("document type declarations are not supported"));
    });
    if (isWorkbook) scanWorkbook(parser);
    else scanWorksheet(parser);
    try {
      parser.write(xml).close();
    } catch (error) {
      if (error instanceof StopScan) return error.problem;
      return unreadable("a workbook part is not well-formed XML");
    }
    return null;
  };
}
