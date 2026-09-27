import { afterEach, describe, expect, it } from "vitest";
import {
  importSalesXlsx,
  issueDiagnostics,
  type SalesImportOptions,
  type SalesImportResult,
} from "./index";
import {
  ALL_HEADERS,
  buildWorkbook,
  line,
  salesSheet,
  type FixtureRow,
  type FixtureSheet,
} from "./testing/workbook-fixtures";
import { buildZip } from "./testing/zip-fixtures";

const BASE_OPTIONS: SalesImportOptions = {
  importId: "imp-test",
  sheet: { name: "Sales" },
  invoiceIdentity: "invoice-number-unique-within-import",
};

async function importSheets(
  sheets: FixtureSheet[],
  options: Partial<SalesImportOptions> = {},
  workbookOptions: { date1904?: boolean } = {},
): Promise<SalesImportResult> {
  return importSalesXlsx(await buildWorkbook(sheets, workbookOptions), {
    ...BASE_OPTIONS,
    ...options,
  });
}

function importRows(rows: Array<FixtureRow | null>, options: Partial<SalesImportOptions> = {}) {
  return importSheets([salesSheet(rows)], options);
}

function accepted(result: SalesImportResult) {
  if (result.status !== "accepted") {
    throw new Error(`expected accepted import, got issues: ${JSON.stringify(result.issues, null, 2)}`);
  }
  return result;
}

function errorCodes(result: SalesImportResult) {
  return result.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code);
}

describe("valid invoices", () => {
  it("accepts a multi-line invoice and groups it once", async () => {
    const result = accepted(
      await importRows([
        line(),
        line({
          "Product ID": "P-002",
          "Product Name": "Produto Demo B 25 kg",
          Type: "Solid",
          Quantity: 3,
          "Amount per unity (R$)": 99.9,
          "Amount (R$)": 299.7,
          "Comission Fee": 14.99,
          "Measurement Unity": "kg",
          "Weight (kg)": 25,
        }),
      ]),
    );

    expect(result.lines).toHaveLength(2);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({
      invoiceNumber: "000101",
      customerId: "C-0001",
      billingDate: "2024-03-15",
      sellerName: "Vendedora Demo",
      businessUnit: "AGRO",
      paymentSchedule: "NET_30",
      lineIds: ["imp-test/Sales/2", "imp-test/Sales/3"],
      totalAmountCents: 122040 + 29970,
      totalCommissionCents: 6102 + 1499,
    });
    expect(result.summary).toMatchObject({ dataRows: 2, validRows: 2, rowsWithErrors: 0 });
  });

  it("normalizes a line into typed fields while keeping its source reference", async () => {
    const result = accepted(await importRows([line()]));
    expect(result.lines[0]).toEqual({
      lineId: "imp-test/Sales/2",
      source: { importId: "imp-test", sheet: "Sales", row: 2 },
      billingDate: "2024-03-15",
      invoiceNumber: "000101",
      customerId: "C-0001",
      customerName: "Fazenda Exemplo Ficticia",
      taxId: "TEST-TAX-0001",
      customerState: "PR",
      customerCity: "Cidade Ficticia",
      productId: "P-001",
      productName: "Produto Demo A 1 L",
      productCategory: "Fertilizante Foliar",
      productUsage: "Foliar",
      productType: "Liquid",
      sellerName: "Vendedora Demo",
      businessUnit: "AGRO",
      paymentSchedule: "NET_30",
      packageQuantity: 10,
      unitPriceCents: 12204,
      lineAmountCents: 122040,
      commissionAmountCents: 6102,
      sourceWeight: "1",
      sourceMeasurementUnit: "L",
    });
  });

  it("keeps repeated product lines in one invoice as separate lines", async () => {
    const result = accepted(await importRows([line(), line()]));
    expect(result.lines.map((l) => l.lineId)).toEqual(["imp-test/Sales/2", "imp-test/Sales/3"]);
    expect(result.lines.map((l) => l.productId)).toEqual(["P-001", "P-001"]);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]?.totalAmountCents).toBe(244080);
  });

  it("maps every supported payment schedule and business unit label", async () => {
    const result = accepted(
      await importRows([
        line({ "Invoince Number": "1", "Payment Schedule": "Upfront" }),
        line({ "Invoince Number": "2", "Payment Schedule": "30 Days" }),
        line({ "Invoince Number": "3", "Payment Schedule": "3 installments (30, 60 and 90 days)" }),
        line({
          "Invoince Number": "4",
          "Payment Schedule": "4 installments (Upfront, 30, 60 and 90 days)",
          "Business Unity": "Home & Garden",
        }),
      ]),
    );
    expect(result.lines.map((l) => l.paymentSchedule)).toEqual([
      "UPFRONT",
      "NET_30",
      "INSTALLMENTS_30_60_90",
      "INSTALLMENTS_0_30_60_90",
    ]);
    expect(result.lines[3]?.businessUnit).toBe("HOME_GARDEN");
  });

  it("preserves leading zeroes in text identifiers and converts integer ID cells to strings", async () => {
    const result = accepted(
      await importRows([line({ "Invoince Number": "000777", "Customer ID": 123, "Product ID": 45 })]),
    );
    expect(result.lines[0]).toMatchObject({
      invoiceNumber: "000777",
      customerId: "123",
      productId: "45",
    });
  });

  it("accepts a missing tax ID when the customer ID is present", async () => {
    const result = accepted(await importRows([line({ "TAX ID": null })]));
    expect(result.lines[0]?.taxId).toBeNull();
  });
});

describe("conflicting invoice attributes", () => {
  it.each([
    ["Seller", "sellerName", "Outro Vendedor Demo"],
    ["Customer ID", "customerId", "C-0002"],
    ["Business Unity", "businessUnit", "Home & Garden"],
    ["Payment Schedule", "paymentSchedule", "Upfront"],
  ] as const)("rejects an invoice whose lines disagree on %s", async (header, field, value) => {
    const result = await importRows([line(), line({ [header]: value })]);
    expect(result.status).toBe("rejected");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "INVOICE_ATTRIBUTE_CONFLICT",
        sheet: "Sales",
        row: 3,
        column: header,
        field,
        relatedRows: [2],
      }),
    );
  });

  it("rejects an invoice whose lines disagree on billing date", async () => {
    const result = await importRows([
      line(),
      line({ "Billing Date": new Date(Date.UTC(2024, 2, 16)), "Billing Day": 16 }),
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "INVOICE_ATTRIBUTE_CONFLICT", row: 3, field: "billingDate" }),
    );
  });
});

describe("required identifiers and fields", () => {
  it.each([
    ["Customer ID", "customerId", "X2"],
    ["Product ID", "productId", "K2"],
    ["Invoince Number", "invoiceNumber", "E2"],
  ] as const)("rejects a line with a blank %s", async (header, field, cell) => {
    const result = await importRows([line({ [header]: "   " })]);
    expect(result.status).toBe("rejected");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "FIELD_REQUIRED",
        sheet: "Sales",
        row: 2,
        cell,
        column: header,
        field,
      }),
    );
    expect(result.issues[0]?.suggestion).toBeTruthy();
  });

  it("rejects non-integer numeric identifiers", async () => {
    const result = await importRows([line({ "Customer ID": 12.5 })]);
    expect(errorCodes(result)).toContain("ID_INVALID");
  });

  it("rejects unknown business units instead of inferring them from the product", async () => {
    const result = await importRows([line({ "Business Unity": "Fertilizers" })]);
    expect(errorCodes(result)).toEqual(["BUSINESS_UNIT_UNKNOWN"]);
  });

  it("rejects unknown payment schedules", async () => {
    const result = await importRows([line({ "Payment Schedule": "60 Days" })]);
    expect(errorCodes(result)).toEqual(["PAYMENT_TERM_UNKNOWN"]);
  });

  // Review R1: plain-object lookups accepted inherited properties such as "constructor".
  const inheritedNames = ["constructor", "__proto__", " Constructor ", "__PROTO__", "toString", "hasOwnProperty"];
  it.each(
    (["Business Unity", "Payment Schedule"] as const).flatMap((header) =>
      inheritedNames.map((label) => [header, label] as const),
    ),
  )("rejects the inherited property name in %s: %j", async (header, label) => {
    const result = await importRows([line({ [header]: label })]);
    expect(result.status).toBe("rejected");
    expect(result).not.toHaveProperty("lines");
    expect(errorCodes(result)).toEqual([
      header === "Business Unity" ? "BUSINESS_UNIT_UNKNOWN" : "PAYMENT_TERM_UNKNOWN",
    ]);
  });

  it.each([0, 2.5, -1, "dez"])("rejects package quantity %j", async (quantity) => {
    const result = await importRows([line({ Quantity: quantity })]);
    expect(errorCodes(result)).toContain("QUANTITY_INVALID");
  });
});

describe("Brazilian money", () => {
  it("accepts pt-BR currency text cells", async () => {
    const result = accepted(
      await importRows([
        line({
          "Amount (R$)": "R$ 1.220,40",
          "Amount per unity (R$)": "R$ 122,04",
          "Comission Fee": "61,02",
        }),
      ]),
    );
    expect(result.lines[0]).toMatchObject({
      lineAmountCents: 122040,
      unitPriceCents: 12204,
      commissionAmountCents: 6102,
    });
  });

  it("rejects US-formatted currency text with a cell reference", async () => {
    const result = await importRows([line({ "Amount (R$)": "1,220.40" })]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "MONEY_FORMAT", row: 2, cell: "R2", field: "lineAmountCents" }),
    );
  });

  it("rejects numeric amounts with sub-cent precision instead of rounding", async () => {
    const result = await importRows([line({ "Amount (R$)": 1220.405 })]);
    expect(errorCodes(result)).toContain("MONEY_PRECISION");
  });

  it("rejects a line amount that is not quantity × unit price", async () => {
    const result = await importRows([line({ "Amount (R$)": 1220.41 })]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "LINE_AMOUNT_MISMATCH", row: 2, field: "lineAmountCents" }),
    );
  });

  it("rejects a non-positive unit price", async () => {
    const result = await importRows([
      line({ "Amount per unity (R$)": 0, "Amount (R$)": 0, "Comission Fee": 0 }),
    ]);
    expect(errorCodes(result)).toContain("MONEY_NOT_POSITIVE");
  });

  it("warns, without blocking, when commission differs from a declared demo rate", async () => {
    const result = accepted(
      await importRows([line({ "Comission Fee": 60 })], { expectedCommissionBasisPoints: 500 }),
    );
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "COMMISSION_RATE_MISMATCH",
        row: 2,
        field: "commissionAmountCents",
      }),
    ]);
  });

  it("rounds the declared commission rate half-up when checking", async () => {
    // 5% of R$ 1.000,10 is R$ 50,005 → R$ 50,01 under half-up rounding.
    const result = accepted(
      await importRows(
        [
          line({
            Quantity: 1,
            "Amount per unity (R$)": 1000.1,
            "Amount (R$)": 1000.1,
            "Comission Fee": 50.01,
          }),
        ],
        { expectedCommissionBasisPoints: 500 },
      ),
    );
    expect(result.issues).toEqual([]);
  });

  it("does not check commission when no demo rate is declared", async () => {
    const result = accepted(await importRows([line({ "Comission Fee": 60 })]));
    expect(result.issues).toEqual([]);
  });
});

describe("dates", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("rejects a billing date that contradicts its day/month/year columns", async () => {
    const result = await importRows([line({ "Billing Day": 16 })]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "DATE_COMPONENT_MISMATCH",
        row: 2,
        cell: "B2",
        field: "billingDay",
      }),
    );
  });

  it("does not cascade a contradicted date into an invoice conflict", async () => {
    // Row 3's date cell disagrees with its own components; that is the one actionable issue.
    const result = await importRows([
      line(),
      line({ "Billing Date": new Date(Date.UTC(2024, 2, 16)) }),
    ]);
    expect(errorCodes(result)).toEqual(["DATE_COMPONENT_MISMATCH"]);
  });

  it("flags a possible day/month swap without correcting it", async () => {
    // Date cell says 1 Feb 2023; components say 2 Jan 2023. Neither is chosen automatically.
    const result = await importRows([
      line({
        "Billing Date": new Date(Date.UTC(2023, 1, 1)),
        "Billing Day": 2,
        "Billing Month": 1,
        "Billing Year": 2023,
      }),
    ]);
    expect(result.status).toBe("rejected");
    expect(errorCodes(result)).toEqual(["DATE_DAY_MONTH_SWAPPED"]);
    expect(result.issues[0]).toMatchObject({ row: 2, cell: "A2", field: "billingDate" });
  });

  it("accepts blank date components because the billing date is authoritative", async () => {
    const result = accepted(
      await importRows([line({ "Billing Day": null, "Billing Month": null, "Billing Year": null })]),
    );
    expect(result.lines[0]?.billingDate).toBe("2024-03-15");
  });

  it("rejects invalid date components", async () => {
    const result = await importRows([line({ "Billing Month": 13 })]);
    expect(errorCodes(result)).toContain("DATE_COMPONENT_INVALID");
  });

  it("accepts text dates only in the declared format", async () => {
    const ptBr = accepted(
      await importRows([line({ "Billing Date": "15/03/2024" })], { textDateFormat: "DD/MM/YYYY" }),
    );
    expect(ptBr.lines[0]?.billingDate).toBe("2024-03-15");

    const undeclared = await importRows([line({ "Billing Date": "15/03/2024" })]);
    expect(errorCodes(undeclared)).toEqual(["DATE_TEXT_FORMAT"]);
  });

  it("rejects impossible text dates and accepts a real leap day", async () => {
    const invalid = await importRows([
      line({ "Billing Date": "2023-02-29", "Billing Day": 29, "Billing Month": 2, "Billing Year": 2023 }),
    ]);
    expect(errorCodes(invalid)).toEqual(["DATE_INVALID"]);

    const leap = accepted(
      await importRows([
        line({ "Billing Date": "2024-02-29", "Billing Day": 29, "Billing Month": 2, "Billing Year": 2024 }),
      ]),
    );
    expect(leap.lines[0]?.billingDate).toBe("2024-02-29");
  });

  // Review R2: the 1900-03-01 minimum applies to every billing-date representation.
  const noComponents = { "Billing Day": null, "Billing Month": null, "Billing Year": null };
  it.each([
    ["YYYY-MM-DD", "1800-01-01", null],
    ["YYYY-MM-DD", "1900-02-28", null],
    ["YYYY-MM-DD", "1900-03-01", "1900-03-01"],
    ["DD/MM/YYYY", "28/02/1900", null],
    ["DD/MM/YYYY", "01/03/1900", "1900-03-01"],
  ] as const)("applies the minimum billing date to %s text %s", async (format, text, expected) => {
    const result = await importRows([line({ "Billing Date": text, ...noComponents })], {
      textDateFormat: format,
    });
    if (expected === null) {
      expect(result.status).toBe("rejected");
      expect(errorCodes(result)).toEqual(["DATE_OUT_OF_RANGE"]);
    } else {
      expect(accepted(result).lines[0]?.billingDate).toBe(expected);
    }
  });

  it("applies the minimum billing date to native date cells", async () => {
    const before = await importRows([
      line({ "Billing Date": new Date(Date.UTC(1900, 1, 28)), ...noComponents }),
    ]);
    expect(errorCodes(before)).toEqual(["DATE_OUT_OF_RANGE"]);

    const at = accepted(
      await importRows([line({ "Billing Date": new Date(Date.UTC(1900, 2, 1)), ...noComponents })]),
    );
    expect(at.lines[0]?.billingDate).toBe("1900-03-01");
  });

  it("rejects an unformatted number in the date column instead of guessing a serial", async () => {
    const result = await importRows([line({ "Billing Date": 45366 })]);
    expect(errorCodes(result)).toEqual(["DATE_NOT_A_DATE_CELL"]);
  });

  it("rejects a date cell that includes a time of day", async () => {
    const result = await importRows([line({ "Billing Date": new Date(Date.UTC(2024, 2, 15, 13, 30)) })]);
    expect(errorCodes(result)).toEqual(["DATE_HAS_TIME"]);
  });

  it("applies the workbook's 1904 date system to date serials", async () => {
    // Serial 43466 is 2023-01-02 in the 1904 system (it would be 2019-01-01 in the 1900 system).
    const serialCell = { value: 43466, numFmt: "dd/mm/yyyy" };
    const row = line({
      "Billing Date": serialCell,
      "Billing Day": 2,
      "Billing Month": 1,
      "Billing Year": 2023,
    });
    const in1904 = accepted(await importSheets([salesSheet([row])], {}, { date1904: true }));
    expect(in1904.lines[0]?.billingDate).toBe("2023-01-02");

    const in1900 = await importSheets([salesSheet([row])], {}, { date1904: false });
    expect(in1900.status).toBe("rejected");
    expect(errorCodes(in1900)).toContain("DATE_COMPONENT_MISMATCH");
  });

  it("produces the same calendar dates regardless of the machine time zone", async () => {
    const workbook = await buildWorkbook([salesSheet([line()])]);
    const dates: string[] = [];
    for (const tz of ["Pacific/Kiritimati", "America/Sao_Paulo", "Pacific/Pago_Pago", "UTC"]) {
      process.env.TZ = tz;
      const result = accepted(await importSalesXlsx(workbook, BASE_OPTIONS));
      dates.push(result.lines[0]?.billingDate ?? "missing");
    }
    expect(dates).toEqual(["2024-03-15", "2024-03-15", "2024-03-15", "2024-03-15"]);
  });
});

describe("untrusted cell contents", () => {
  it("rejects formulas even when the cached result would be valid", async () => {
    const result = await importRows([line({ "Amount (R$)": { formula: "Q2*U2", result: 1220.4 } })]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "CELL_FORMULA", row: 2, cell: "R2", field: "lineAmountCents" }),
    );
    expect(result.status).toBe("rejected");
  });

  it("rejects formulas in optional fields too", async () => {
    const result = await importRows([line({ City: { formula: 'UPPER("x")', result: "X" } })]);
    expect(errorCodes(result)).toEqual(["CELL_FORMULA"]);
  });

  it("rejects Excel error values", async () => {
    const result = await importRows([line({ "Product ID": { error: "#N/A" } })]);
    expect(errorCodes(result)).toEqual(["CELL_ERROR_VALUE"]);
  });

  it("rejects merged cells instead of copying the merged value into each row", async () => {
    const result = await importSheets([
      {
        ...salesSheet([line(), line({ Seller: null })]),
        apply: (sheet) => sheet.mergeCells("N2:N3"),
      },
    ]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "CELL_MERGED", row: 3, cell: "N3", field: "sellerName" }),
    );
  });

  it("rejects boolean cells in text fields", async () => {
    const result = await importRows([line({ Seller: true })]);
    expect(errorCodes(result)).toEqual(["CELL_UNSUPPORTED_TYPE"]);
  });
});

describe("whole-import policy", () => {
  it("rejects the whole import when any row is invalid and exposes no partial lines", async () => {
    const result = await importRows([
      line({ "Invoince Number": "1" }),
      line({ "Invoince Number": "2", "Product ID": null }),
      line({ "Invoince Number": "3" }),
    ]);
    expect(result.status).toBe("rejected");
    expect(result).not.toHaveProperty("lines");
    expect(result.summary).toMatchObject({ dataRows: 3, validRows: 2, rowsWithErrors: 1 });
  });

  it("skips fully blank rows but counts them", async () => {
    const result = accepted(await importRows([line(), null, null, line({ "Invoince Number": "2" })]));
    expect(result.lines.map((l) => l.source.row)).toEqual([2, 5]);
    expect(result.summary).toMatchObject({ dataRows: 2, blankRowsSkipped: 2 });
  });

  it("rejects a sheet with a header but no sales rows", async () => {
    const result = await importRows([]);
    expect(errorCodes(result)).toEqual(["NO_DATA_ROWS"]);
  });
});

describe("headers", () => {
  it("reports missing columns before validating rows", async () => {
    const headers = ALL_HEADERS.filter((header) => header !== "Customer ID");
    const result = await importSheets([{ name: "Sales", headers, rows: [line({ "Product ID": null })] }]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "HEADER_MISSING_COLUMN",
        sheet: "Sales",
        row: 1,
        column: "Customer ID",
        field: "customerId",
      }),
    ]);
  });

  it("requires the source spelling rather than guessing corrected names", async () => {
    const headers = ALL_HEADERS.map((header) => (header === "Invoince Number" ? "Invoice Number" : header));
    const result = await importSheets([{ name: "Sales", headers, rows: [line()] }]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", code: "HEADER_MISSING_COLUMN", column: "Invoince Number" }),
        expect.objectContaining({ severity: "warning", code: "HEADER_UNKNOWN_COLUMN", column: "Invoice Number" }),
      ]),
    );
  });

  it("matches headers ignoring case and surrounding whitespace", async () => {
    const result = accepted(
      await importSheets([
        {
          ...salesSheet([line()]),
          apply: (sheet) => {
            sheet.getCell("N1").value = "  SELLER ";
          },
        },
      ]),
    );
    expect(result.lines[0]?.sellerName).toBe("Vendedora Demo");
  });

  it("rejects duplicate mapped columns", async () => {
    const result = await importSheets([{ name: "Sales", headers: [...ALL_HEADERS, "Seller"], rows: [line()] }]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "HEADER_DUPLICATE_COLUMN", row: 1, cell: "Y1", column: "Seller" }),
    );
    expect(result.status).toBe("rejected");
  });

  it("warns about and ignores unmapped extra columns", async () => {
    const result = accepted(
      await importSheets([
        {
          name: "Sales",
          headers: [...ALL_HEADERS, "Customer Segment"],
          rows: [line()],
          apply: (sheet) => {
            sheet.getCell("Y2").value = "Grande";
          },
        },
      ]),
    );
    expect(result.issues).toEqual([
      expect.objectContaining({ severity: "warning", code: "HEADER_UNKNOWN_COLUMN", cell: "Y1" }),
    ]);
  });
});

describe("input resource limits", () => {
  it("accepts a sheet with exactly the maximum number of data rows", async () => {
    const result = await importRows([line(), line()], { limits: { maxDataRows: 2 } });
    expect(result.status).toBe("accepted");
  });

  it("rejects a sheet over the row limit before validating any row", async () => {
    const result = await importRows([line(), line(), line({ "Product ID": null })], {
      limits: { maxDataRows: 2 },
    });
    expect(result.status).toBe("rejected");
    expect(errorCodes(result)).toEqual(["INPUT_TOO_MANY_ROWS"]);
    expect(result.summary.rowsValidated).toBe(false);
  });

  it("counts blank rows toward the row limit", async () => {
    const result = await importRows([line(), null, null, line()], { limits: { maxDataRows: 3 } });
    expect(errorCodes(result)).toEqual(["INPUT_TOO_MANY_ROWS"]);
  });

  it("rejects a sheet wider than the column limit", async () => {
    const result = await importSheets([{ ...salesSheet([line()]), headers: [...ALL_HEADERS, "Extra"] }], {
      limits: { maxColumns: 24 },
    });
    expect(errorCodes(result)).toEqual(["INPUT_TOO_MANY_COLUMNS"]);
  });

  it("rejects a file over the compressed size limit", async () => {
    const result = await importRows([line()], { limits: { maxFileBytes: 1024 } });
    expect(errorCodes(result)).toEqual(["INPUT_FILE_TOO_LARGE"]);
  });

  it("rejects a decompression bomb before the spreadsheet library reads it", async () => {
    const bomb = buildZip([
      { name: "xl/worksheets/sheet1.xml", data: new Uint8Array(64 * 1024 * 1024), declaredSize: 1000 },
    ]);
    const result = await importSalesXlsx(bomb, BASE_OPTIONS);
    expect(errorCodes(result)).toEqual(["INPUT_EXPANSION_TOO_LARGE"]);
  });

  it("rejects invalid limit overrides as a programming error", async () => {
    const workbook = await buildWorkbook([salesSheet([line()])]);
    await expect(
      importSalesXlsx(workbook, { ...BASE_OPTIONS, limits: { maxDataRows: 0 } }),
    ).rejects.toThrow(TypeError);
  });
});

// Review R3: issues can carry workbook-controlled text (sheet names, unknown headers), so only
// the allowlisted diagnostic projection is suitable for logs.
describe("issue diagnostics", () => {
  const SENTINEL = "SENTINEL Fulana Ficticia";

  it("drops workbook-controlled text that raw issues can contain", async () => {
    const unknownHeader = await importSheets([
      {
        ...salesSheet([line()]),
        headers: [...ALL_HEADERS, SENTINEL],
      },
    ]);
    const missingSheet = await importSheets([salesSheet([line()], SENTINEL)], {
      sheet: { name: `${SENTINEL} 2` },
    });

    for (const result of [unknownHeader, missingSheet]) {
      expect(JSON.stringify(result.issues)).toContain(SENTINEL);
      const diagnostics = result.issues.map(issueDiagnostics);
      expect(JSON.stringify(diagnostics)).not.toContain(SENTINEL);
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of diagnostics) {
        expect(Object.keys(diagnostic).sort()).toEqual(["cell", "code", "field", "row", "severity"]);
      }
    }
  });

  it("keeps the location and canonical field", async () => {
    const result = await importRows([line({ "Customer ID": null })]);
    expect(result.issues.map(issueDiagnostics)).toEqual([
      { severity: "error", code: "FIELD_REQUIRED", row: 2, cell: "X2", field: "customerId" },
    ]);
  });
});

describe("sheet selection", () => {
  const referenceTab: FixtureSheet = { name: "File Structure", headers: ["Column", "Meaning"], rows: [] };

  it("imports only the explicitly named sales sheet", async () => {
    const result = accepted(await importSheets([referenceTab, salesSheet([line()], "Vendas 2024")], {
      sheet: { name: "Vendas 2024" },
    }));
    expect(result.sheet).toBe("Vendas 2024");
    expect(result.lines[0]?.lineId).toBe("imp-test/Vendas%202024/2");
  });

  it("reports a missing named sheet and lists the sheets that exist", async () => {
    const result = await importSheets([referenceTab], { sheet: { name: "Sales" } });
    expect(errorCodes(result)).toEqual(["SHEET_NOT_FOUND"]);
    expect(result).toMatchObject({ sheetNames: ["File Structure"] });
  });

  it("accepts single-sheet mode only when the workbook has exactly one sheet", async () => {
    const single = accepted(await importSheets([salesSheet([line()], "Qualquer")], { sheet: { single: true } }));
    expect(single.sheet).toBe("Qualquer");

    const multiple = await importSheets([referenceTab, salesSheet([line()])], { sheet: { single: true } });
    expect(errorCodes(multiple)).toEqual(["SHEET_SELECTION_AMBIGUOUS"]);
    // The uploader picks from these names instead of typing one.
    expect(multiple).toMatchObject({ status: "rejected", sheetNames: ["File Structure", "Sales"] });
  });

  it("lists sheet names only when the sheet choice itself failed", async () => {
    const result = await importSheets([salesSheet([line({ "Customer ID": null })])], { sheet: { single: true } });
    expect(errorCodes(result)).toEqual(["FIELD_REQUIRED"]);
    expect(result).not.toHaveProperty("sheetNames");
  });

  it("reports an unreadable workbook as an issue", async () => {
    const result = await importSalesXlsx(new TextEncoder().encode("not a workbook"), BASE_OPTIONS);
    expect(result.status).toBe("rejected");
    expect(errorCodes(result)).toEqual(["WORKBOOK_UNREADABLE"]);
  });
});
