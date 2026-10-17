import { describe, expect, it } from "vitest";
import type { SalesLine } from "../sales-import/types";
import { buildSalesRankings, type SalesRankings } from "./rankings";
import { buildSalesReport } from "./report";

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
    customerState: "MG",
    customerCity: "Cidade Demo",
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

function rankings(lines: SalesLine[], filters = {}): SalesRankings {
  const result = buildSalesRankings(lines, filters);
  if (!result.ok) throw new Error(`expected rankings, got ${result.code}`);
  return result.rankings;
}

// INV-1: two products for C-1 in MG. INV-2: one product for C-2 in RJ, by a seller of the other unit.
const dataset = [
  makeLine({ invoiceNumber: "INV-1", productId: "P-1", lineAmountCents: 1000 }),
  makeLine({ invoiceNumber: "INV-1", productId: "P-2", productName: "Produto Demo Dois", productCategory: "Outra", lineAmountCents: 2500 }),
  makeLine({ invoiceNumber: "INV-1", productId: "P-1", lineAmountCents: 1000 }),
  makeLine({
    invoiceNumber: "INV-2",
    billingDate: "2024-04-01",
    customerId: "C-2",
    customerName: "Cliente Ficticio Dois",
    customerState: "RJ",
    customerCity: "Outra Cidade",
    sellerName: "Vendedor Demo",
    businessUnit: "HOME_GARDEN",
    productId: "P-2",
    productName: "Produto Demo Dois",
    productCategory: "Outra",
    lineAmountCents: 700,
  }),
];

describe("buildSalesRankings", () => {
  it("ranks each dimension by sales, counting invoices distinct, with names and details", () => {
    const result = rankings(dataset);
    expect(result.byProduct).toEqual([
      { key: "P-2", label: "Produto Demo Dois", detail: "Outra", lineCount: 2, invoiceCount: 2, salesCents: 3200 },
      { key: "P-1", label: "Produto Demo Um", detail: "Categoria Demo", lineCount: 2, invoiceCount: 1, salesCents: 2000 },
    ]);
    expect(result.byCustomer).toEqual([
      { key: "C-1", label: "Cliente Ficticio Um", detail: "Cidade Demo, MG", lineCount: 3, invoiceCount: 1, salesCents: 4500 },
      { key: "C-2", label: "Cliente Ficticio Dois", detail: "Outra Cidade, RJ", lineCount: 1, invoiceCount: 1, salesCents: 700 },
    ]);
    expect(result.bySeller).toEqual([
      { key: "Vendedora Demo", label: "Vendedora Demo", detail: "Agro", lineCount: 3, invoiceCount: 1, salesCents: 4500 },
      { key: "Vendedor Demo", label: "Vendedor Demo", detail: "Home & Garden", lineCount: 1, invoiceCount: 1, salesCents: 700 },
    ]);
    expect(result.byState.map((row) => [row.key, row.salesCents])).toEqual([["MG", 4500], ["RJ", 700]]);
  });

  it("sums each ranking's sales and lines to the report's totals, for any filters", () => {
    for (const filters of [{}, { productId: "P-2" }, { customerState: "RJ" }, { businessUnit: "AGRO" as const, productId: "P-1" }]) {
      const report = buildSalesReport(dataset, filters);
      if (!report.ok) throw new Error("expected report");
      const result = rankings(dataset, filters);
      for (const list of [result.byProduct, result.byCustomer, result.bySeller, result.byState]) {
        expect(list.reduce((sum, row) => sum + row.salesCents, 0)).toBe(report.report.totals.salesCents);
        expect(list.reduce((sum, row) => sum + row.lineCount, 0)).toBe(report.report.totals.lineCount);
      }
    }
  });

  it("counts only the selected product's lines under a product filter", () => {
    const result = rankings(dataset, { productId: "P-2" });
    expect(result.byProduct.map((row) => row.key)).toEqual(["P-2"]);
    expect(result.byCustomer.map((row) => [row.key, row.salesCents])).toEqual([["C-1", 2500], ["C-2", 700]]);
  });

  it("combines filters with AND, including the customer state", () => {
    expect(rankings(dataset, { customerState: "RJ" }).byCustomer.map((row) => row.key)).toEqual(["C-2"]);
    expect(rankings(dataset, { customerState: "RJ", businessUnit: "AGRO" })).toEqual({ byProduct: [], byCustomer: [], bySeller: [], byState: [] });
  });

  it("breaks ties by label, then key", () => {
    const tied = [
      makeLine({ productId: "P-B", productName: "Beta" }),
      makeLine({ productId: "P-A", productName: "Beta" }),
      makeLine({ productId: "P-C", productName: "Alfa" }),
    ];
    expect(rankings(tied).byProduct.map((row) => row.key)).toEqual(["P-C", "P-A", "P-B"]);
  });

  it("gives no unit detail to a seller selling for both units, and no location without city and state", () => {
    const lines = [makeLine(), makeLine({ invoiceNumber: "INV-9", businessUnit: "HOME_GARDEN", customerId: "C-9", customerCity: null })];
    const result = rankings(lines);
    expect(result.bySeller[0]!.detail).toBeNull();
    expect(result.byCustomer.find((row) => row.key === "C-9")!.detail).toBeNull();
  });

  it("leaves lines without a customer state out of the state ranking only", () => {
    const result = rankings([makeLine(), makeLine({ invoiceNumber: "INV-2", customerState: null })]);
    expect(result.byState).toEqual([{ key: "MG", label: "MG", detail: null, lineCount: 1, invoiceCount: 1, salesCents: 1000 }]);
    expect(result.byProduct[0]!.lineCount).toBe(2);
  });

  it("rejects an invalid period and totals that cannot be exact, like the report", () => {
    expect(buildSalesRankings(dataset, { from: "2024-02-30" })).toMatchObject({ ok: false, code: "FILTER_INVALID_PERIOD" });
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const huge = [makeLine({ invoiceNumber: "A", lineAmountCents: half }), makeLine({ invoiceNumber: "B", lineAmountCents: half })];
    expect(buildSalesRankings(huge, {})).toMatchObject({ ok: false, code: "TOTAL_OUT_OF_RANGE" });
  });
});
