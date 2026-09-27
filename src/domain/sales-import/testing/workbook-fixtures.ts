/**
 * Test-only builders for tiny fictional in-memory workbooks. Every identity here is invented;
 * none is derived from the reference ERP sample.
 */
import ExcelJS from "exceljs";
import { SOURCE_COLUMNS, type SourceHeader } from "../columns";

export type FixtureCell = ExcelJS.CellValue | { value: ExcelJS.CellValue; numFmt: string };
export type FixtureRow = Partial<Record<SourceHeader, FixtureCell>>;

export const ALL_HEADERS: SourceHeader[] = SOURCE_COLUMNS.map((column) => column.header);

/** A valid fictional line: 10 packages × R$ 122,04 = R$ 1.220,40; 5% commission = R$ 61,02. */
export function line(overrides: FixtureRow = {}): FixtureRow {
  return {
    "Billing Date": new Date(Date.UTC(2024, 2, 15)),
    "Billing Day": 15,
    "Billing Month": 3,
    "Billing Year": 2024,
    "Invoince Number": "000101",
    "Customer Business Name": "Fazenda Exemplo Ficticia",
    "Customer State": "PR",
    City: "Cidade Ficticia",
    "Produtc Line": "Fertilizante Foliar",
    "Product Usage": "Foliar",
    "Product ID": "P-001",
    "Product Name": "Produto Demo A 1 L",
    Type: "Liquid",
    Seller: "Vendedora Demo",
    "Business Unity": "Agro",
    "Payment Schedule": "30 Days",
    Quantity: 10,
    "Amount (R$)": 1220.4,
    "Comission Fee": 61.02,
    "Weight (kg)": 1,
    "Amount per unity (R$)": 122.04,
    "Measurement Unity": "L",
    "TAX ID": "TEST-TAX-0001",
    "Customer ID": "C-0001",
    ...overrides,
  };
}

export interface FixtureSheet {
  name: string;
  headers?: string[];
  /** `null` writes a blank row. */
  rows: Array<FixtureRow | null>;
  /** Extra cells by address, applied after rows (e.g. to add merges or stray values). */
  apply?: (sheet: ExcelJS.Worksheet) => void;
}

export async function buildWorkbook(
  sheets: FixtureSheet[],
  options: { date1904?: boolean } = {},
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.properties.date1904 = options.date1904 ?? false;
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name);
    const headers = spec.headers ?? ALL_HEADERS;
    headers.forEach((header, index) => {
      sheet.getRow(1).getCell(index + 1).value = header;
    });
    spec.rows.forEach((row, rowIndex) => {
      if (!row) return;
      headers.forEach((header, columnIndex) => {
        const fixture = row[header as SourceHeader];
        if (fixture === undefined) return;
        const cell = sheet.getRow(rowIndex + 2).getCell(columnIndex + 1);
        if (fixture !== null && typeof fixture === "object" && "numFmt" in fixture) {
          cell.value = fixture.value;
          cell.numFmt = fixture.numFmt;
        } else {
          cell.value = fixture;
        }
      });
    });
    spec.apply?.(sheet);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function salesSheet(rows: Array<FixtureRow | null>, name = "Sales"): FixtureSheet {
  return { name, rows };
}
