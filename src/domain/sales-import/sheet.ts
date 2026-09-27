/**
 * Library-independent view of one worksheet. The XLSX adapter produces it; validation reads
 * only this model, so it never depends on ExcelJS types.
 */
export type SheetCell =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number }
  /** UTC components are the workbook's calendar date/time, after its 1900/1904 date system. */
  | { kind: "date"; value: Date }
  | { kind: "boolean"; value: boolean }
  /** Cached formula results are deliberately not carried over. */
  | { kind: "formula" }
  | { kind: "error"; value: string }
  /** A non-master cell of a merged range; spreadsheet libraries copy the master value here. */
  | { kind: "merged"; master: string }
  | { kind: "unsupported" };

export interface SheetData {
  name: string;
  /** `rows[0]` is spreadsheet row 1; `rows[r][0]` is column A. Rows may be ragged. */
  rows: SheetCell[][];
}

export const EMPTY_CELL: SheetCell = { kind: "empty" };

export function columnLetter(columnIndex: number): string {
  let n = columnIndex + 1;
  let letters = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function cellAddress(columnIndex: number, rowNumber: number): string {
  return `${columnLetter(columnIndex)}${rowNumber}`;
}

export function isBlankCell(cell: SheetCell): boolean {
  return cell.kind === "empty" || (cell.kind === "text" && cell.text.trim() === "");
}
