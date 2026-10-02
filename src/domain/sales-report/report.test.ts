import { describe, expect, it } from "vitest";
import type { InvoiceGroup, SalesLine } from "../sales-import/types";
import { formatBrlCents } from "./format";
import { buildSalesReport, reconcileDataset, reportFilterOptions } from "./report";

let rowCounter = 1;
function makeLine(overrides: Partial<SalesLine> = {}): SalesLine {
  const row = ++rowCounter;
  return {
    lineId: `imp/Sales/${row}`,
    source: { importId: "imp", sheet: "Sales", row },
    billingDate: "2024-03-15",
    invoiceNumber: "INV-1",
    customerId: "C-1",
    customerName: "Cliente Ficticio Um",
    taxId: null,
    customerState: null,
    customerCity: null,
    productId: "P-1",
    productName: "Produto Demo Um",
    productCategory: "Categoria Demo",
    productUsage: null,
    productType: null,
    sellerName: "Vendedora Demo",
    businessUnit: "AGRO",
    paymentSchedule: "NET_30",
    packageQuantity: 1,
    unitPriceCents: 1000,
    lineAmountCents: 1000,
    commissionAmountCents: 50,
    sourceWeight: null,
    sourceMeasurementUnit: null,
    ...overrides,
  };
}

function report(lines: SalesLine[], filters = {}) {
  const result = buildSalesReport(lines, filters);
  if (!result.ok) throw new Error(`expected report, got ${result.code}`);
  return result.report;
}

// Two invoices: INV-1 (Agro, March, two products) and INV-2 (Home & Garden, April, one product).
const dataset = [
  makeLine({ invoiceNumber: "INV-1", productId: "P-1", lineAmountCents: 1000, commissionAmountCents: 50 }),
  makeLine({ invoiceNumber: "INV-1", productId: "P-2", productName: "Produto Demo Dois", lineAmountCents: 2500, commissionAmountCents: 125 }),
  makeLine({ invoiceNumber: "INV-1", productId: "P-1", lineAmountCents: 1000, commissionAmountCents: 50 }),
  makeLine({
    invoiceNumber: "INV-2",
    billingDate: "2024-04-01",
    customerId: "C-2",
    customerName: "Cliente Ficticio Dois",
    sellerName: "Vendedor Demo",
    businessUnit: "HOME_GARDEN",
    productId: "P-2",
    productName: "Produto Demo Dois",
    lineAmountCents: 700,
    commissionAmountCents: 35,
  }),
];

describe("buildSalesReport totals", () => {
  it("counts a multi-line invoice once and sums every line", () => {
    const { totals } = report(dataset);
    expect(totals).toEqual({ lineCount: 4, invoiceCount: 2, salesCents: 5200, commissionCents: 260 });
  });

  it("returns zero totals and empty breakdowns when nothing matches", () => {
    const result = report(dataset, { customerId: "C-404" });
    expect(result.totals).toEqual({ lineCount: 0, invoiceCount: 0, salesCents: 0, commissionCents: 0 });
    expect(result.byMonth).toEqual([]);
    expect(result.byBusinessUnit).toEqual([]);
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(dataset);
    report(dataset, { productId: "P-2", from: "2024-04-01" });
    expect(dataset).toEqual(copy);
  });
});

describe("filters", () => {
  it("filters by customer", () => {
    expect(report(dataset, { customerId: "C-2" }).totals).toMatchObject({ invoiceCount: 1, salesCents: 700 });
  });

  it("filters by seller", () => {
    expect(report(dataset, { sellerName: "Vendedora Demo" }).totals).toMatchObject({
      invoiceCount: 1,
      salesCents: 4500,
    });
  });

  it("filters by business unit", () => {
    expect(report(dataset, { businessUnit: "HOME_GARDEN" }).totals).toMatchObject({
      invoiceCount: 1,
      salesCents: 700,
    });
  });

  it("filters by product using matching lines only and says so", () => {
    const result = report(dataset, { productId: "P-2" });
    // P-2 appears on INV-1 (R$ 25,00) and INV-2 (R$ 7,00): two distinct invoices, not whole-invoice totals.
    expect(result.totals).toEqual({ lineCount: 2, invoiceCount: 2, salesCents: 3200, commissionCents: 160 });
    expect(result.scope).toBe("matching-lines");
    expect(report(dataset).scope).toBe("whole-invoices");
    expect(report(dataset, { customerId: "C-1" }).scope).toBe("whole-invoices");
  });

  it("treats the period as inclusive on both ends", () => {
    expect(report(dataset, { from: "2024-04-01", to: "2024-04-01" }).totals.invoiceCount).toBe(1);
    expect(report(dataset, { to: "2024-03-15" }).totals.salesCents).toBe(4500);
    expect(report(dataset, { from: "2024-03-16" }).totals.salesCents).toBe(700);
  });

  it("filters by the customer's state", () => {
    const located = dataset.map((line) => ({ ...line, customerState: line.customerId === "C-1" ? "MG" : "SP" }));
    expect(report(located, { customerState: "SP" }).totals).toMatchObject({ invoiceCount: 1, salesCents: 700 });
    expect(report(located, { customerState: "RJ" }).totals).toMatchObject({ invoiceCount: 0, salesCents: 0 });
  });

  it("combines filters with AND", () => {
    expect(report(dataset, { productId: "P-2", businessUnit: "AGRO" }).totals).toMatchObject({
      lineCount: 1,
      invoiceCount: 1,
      salesCents: 2500,
    });
    const located = dataset.map((line) => ({ ...line, customerState: line.customerId === "C-1" ? "MG" : "SP" }));
    expect(report(located, { productId: "P-2", sellerName: "Vendedor Demo", customerState: "SP" }).totals).toMatchObject({
      lineCount: 1,
      salesCents: 700,
    });
    expect(report(located, { productId: "P-2", sellerName: "Vendedor Demo", customerState: "MG" }).totals.lineCount).toBe(0);
  });

  it("rejects a reversed period", () => {
    expect(buildSalesReport(dataset, { from: "2024-05-01", to: "2024-04-01" })).toMatchObject({
      ok: false,
      code: "FILTER_INVALID_PERIOD",
    });
  });

  it("rejects malformed or impossible period dates", () => {
    expect(buildSalesReport(dataset, { from: "01/04/2024" })).toMatchObject({ ok: false, code: "FILTER_INVALID_PERIOD" });
    expect(buildSalesReport(dataset, { to: "2023-02-29" })).toMatchObject({ ok: false, code: "FILTER_INVALID_PERIOD" });
  });

  it("ignores empty-string filters", () => {
    expect(report(dataset, { customerId: "", from: "", to: "" }).totals.invoiceCount).toBe(2);
  });
});

describe("breakdowns reconcile to the totals", () => {
  it("splits by billing month in date order", () => {
    const result = report(dataset);
    expect(result.byMonth).toEqual([
      { key: "2024-03", lineCount: 3, invoiceCount: 1, salesCents: 4500, commissionCents: 225 },
      { key: "2024-04", lineCount: 1, invoiceCount: 1, salesCents: 700, commissionCents: 35 },
    ]);
  });

  it("splits by business unit", () => {
    expect(report(dataset).byBusinessUnit).toEqual([
      { key: "AGRO", lineCount: 3, invoiceCount: 1, salesCents: 4500, commissionCents: 225 },
      { key: "HOME_GARDEN", lineCount: 1, invoiceCount: 1, salesCents: 700, commissionCents: 35 },
    ]);
  });

  it.each([{}, { productId: "P-2" }, { from: "2024-04-01" }, { businessUnit: "AGRO" as const }])(
    "breakdown sums equal the totals for filters %j",
    (filters) => {
      const result = report(dataset, filters);
      for (const rows of [result.byMonth, result.byBusinessUnit]) {
        const sum = (key: "lineCount" | "invoiceCount" | "salesCents" | "commissionCents") =>
          rows.reduce((total, row) => total + row[key], 0);
        expect({
          lineCount: sum("lineCount"),
          invoiceCount: sum("invoiceCount"),
          salesCents: sum("salesCents"),
          commissionCents: sum("commissionCents"),
        }).toEqual(result.totals);
      }
      expect(result.reconciled).toBe(true);
    },
  );
});

describe("safe accumulated totals", () => {
  it("fails instead of returning an inexact total", () => {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const huge = [
      makeLine({ invoiceNumber: "A", lineAmountCents: half }),
      makeLine({ invoiceNumber: "B", lineAmountCents: half }),
    ];
    expect(buildSalesReport(huge, {})).toMatchObject({ ok: false, code: "TOTAL_OUT_OF_RANGE" });
  });

  it("accepts totals exactly at the safe-integer limit", () => {
    const lines = [
      makeLine({ invoiceNumber: "A", lineAmountCents: Number.MAX_SAFE_INTEGER - 1 }),
      makeLine({ invoiceNumber: "B", lineAmountCents: 1 }),
    ];
    expect(report(lines).totals.salesCents).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("reportFilterOptions", () => {
  it("lists distinct values sorted by label, flagging IDs with several source names", () => {
    const options = reportFilterOptions([
      ...dataset,
      makeLine({ customerId: "C-1", customerName: "Cliente Ficticio Um Ltda" }),
    ]);
    expect(options.customers).toEqual([
      { id: "C-2", label: "Cliente Ficticio Dois", otherNames: 0 },
      { id: "C-1", label: "Cliente Ficticio Um", otherNames: 1 },
    ]);
    expect(options.products.map((product) => product.id)).toEqual(["P-2", "P-1"]);
    expect(options.sellers).toEqual(["Vendedor Demo", "Vendedora Demo"]);
    expect(options.businessUnits).toEqual(["AGRO", "HOME_GARDEN"]);
    expect(options.firstDate).toBe("2024-03-15");
    expect(options.lastDate).toBe("2024-04-01");
  });

  it("handles an empty dataset", () => {
    expect(reportFilterOptions([])).toMatchObject({ customers: [], firstDate: null, lastDate: null });
  });
});

describe("reconcileDataset", () => {
  const invoices: InvoiceGroup[] = [
    {
      invoiceNumber: "INV-1",
      customerId: "C-1",
      billingDate: "2024-03-15",
      sellerName: "Vendedora Demo",
      businessUnit: "AGRO",
      paymentSchedule: "NET_30",
      lineIds: dataset.slice(0, 3).map((l) => l.lineId),
      totalAmountCents: 4500,
      totalCommissionCents: 225,
    },
    {
      invoiceNumber: "INV-2",
      customerId: "C-2",
      billingDate: "2024-04-01",
      sellerName: "Vendedor Demo",
      businessUnit: "HOME_GARDEN",
      paymentSchedule: "NET_30",
      lineIds: [dataset[3]?.lineId ?? ""],
      totalAmountCents: 700,
      totalCommissionCents: 35,
    },
  ];

  it("confirms line totals match the importer's invoice totals", () => {
    expect(reconcileDataset(dataset, invoices)).toEqual({
      lineSalesCents: 5200,
      invoiceSalesCents: 5200,
      lineCount: 4,
      invoiceLineCount: 4,
      distinctInvoiceNumbers: 2,
      invoiceCount: 2,
      matches: true,
    });
  });

  it("reports a mismatch", () => {
    const tampered = invoices.map((invoice, i) => (i === 0 ? { ...invoice, totalAmountCents: 4499 } : invoice));
    expect(reconcileDataset(dataset, tampered).matches).toBe(false);
  });
});

describe("formatBrlCents", () => {
  it.each([
    [0, "R$ 0,00"],
    [5, "R$ 0,05"],
    [122040, "R$ 1.220,40"],
    [123456789, "R$ 1.234.567,89"],
    [-1050, "-R$ 10,50"],
    [Number.MAX_SAFE_INTEGER, "R$ 90.071.992.547.409,91"],
  ])("formats %i as %s", (cents, text) => {
    expect(formatBrlCents(cents)).toBe(text);
  });
});
