/**
 * XLSX adapter: the only module that touches ExcelJS. It converts the selected worksheet into
 * the neutral `SheetData` model and hands it to the pure validator. Server-side only.
 */
import ExcelJS from "exceljs";
import { checkArchiveLimits } from "./archive-limits";
import { resolveInputLimits } from "./limits";
import { createStructureInspector } from "./workbook-structure";
import type { SheetCell, SheetData } from "./sheet";
import type { SalesImportOptions, SalesImportResult } from "./types";
import { assertImportOptions, rejectWithoutSheet, selectSheet, validateSalesSheet } from "./validate-sheet";

function richTextToString(value: ExcelJS.CellRichTextValue): string {
  return value.richText.map((run) => run.text).join("");
}

function toSheetCell(cell: ExcelJS.Cell): SheetCell {
  if (cell.isMerged && cell.master.address !== cell.address) {
    return { kind: "merged", master: cell.master.address };
  }
  const value = cell.value;
  if (value === null || value === undefined) return { kind: "empty" };
  if (typeof value === "string") return { kind: "text", text: value };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (value instanceof Date) return { kind: "date", value };
  if ("formula" in value || "sharedFormula" in value) return { kind: "formula" };
  if ("error" in value) return { kind: "error", value: String(value.error) };
  if ("richText" in value) return { kind: "text", text: richTextToString(value) };
  if ("hyperlink" in value) {
    const text: unknown = value.text;
    if (typeof text === "string") return { kind: "text", text };
    if (text && typeof text === "object" && "richText" in text) {
      return { kind: "text", text: richTextToString(text as ExcelJS.CellRichTextValue) };
    }
  }
  return { kind: "unsupported" };
}

function toSheetData(worksheet: ExcelJS.Worksheet): SheetData {
  const rows: SheetCell[][] = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.findRow(rowNumber);
    const cells: SheetCell[] = [];
    if (row) {
      for (let columnNumber = 1; columnNumber <= row.cellCount; columnNumber++) {
        const cell = row.findCell(columnNumber);
        cells.push(cell ? toSheetCell(cell) : { kind: "empty" });
      }
    }
    rows.push(cells);
  }
  return { name: worksheet.name, rows };
}

/**
 * Parse and validate the sales sheet of an XLSX workbook. Resource limits are enforced first:
 * archive layout, size and real expansion, then structure counts on every sheet (merged ranges,
 * cells, validations, named ranges), all before ExcelJS reads anything; then the selected
 * sheet's row/column extent before cells are converted. Workbook date systems (1900/1904) are applied
 * by ExcelJS when it reads date-formatted cells.
 */
export async function importSalesXlsx(
  data: ArrayBuffer | Uint8Array,
  options: SalesImportOptions,
): Promise<SalesImportResult> {
  assertImportOptions(options);
  const limits = resolveInputLimits(options.limits);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  const archive = checkArchiveLimits(bytes, limits, createStructureInspector(limits));
  if (!archive.ok) return rejectWithoutSheet(options.importId, null, archive.issue);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    return rejectWithoutSheet(options.importId, null, {
      code: "WORKBOOK_UNREADABLE",
      message: "The file could not be read as an XLSX workbook.",
      suggestion: "Upload an .xlsx file saved by Excel or a compatible spreadsheet application.",
    });
  }

  const sheetNames = workbook.worksheets.map((worksheet) => worksheet.name);
  const selection = selectSheet(sheetNames, options.sheet);
  if (!selection.ok) return { ...rejectWithoutSheet(options.importId, null, selection.issue), sheetNames };

  const worksheet = workbook.getWorksheet(selection.name);
  if (!worksheet) throw new Error("selected worksheet disappeared");

  const dataRows = Math.max(0, worksheet.rowCount - 1);
  if (dataRows > limits.maxDataRows) {
    return rejectWithoutSheet(options.importId, worksheet.name, {
      code: "INPUT_TOO_MANY_ROWS",
      message: `The sheet has ${dataRows} rows below the header (blank rows included); the limit is ${limits.maxDataRows}.`,
      suggestion: "Split the export into smaller workbooks, or delete trailing empty or formatted rows.",
    });
  }
  if (worksheet.columnCount > limits.maxColumns) {
    return rejectWithoutSheet(options.importId, worksheet.name, {
      code: "INPUT_TOO_MANY_COLUMNS",
      message: `The sheet uses ${worksheet.columnCount} columns; the limit is ${limits.maxColumns}.`,
      suggestion: "Remove columns that are not part of the import contract.",
    });
  }
  return validateSalesSheet(toSheetData(worksheet), options);
}
