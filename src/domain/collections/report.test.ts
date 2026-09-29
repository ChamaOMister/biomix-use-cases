import { describe, expect, it } from "vitest";
import type { SalesLine } from "../sales-import/types";
import { buildSalesReport } from "../sales-report/report";
import { buildCollectionsReport, collectionsReconcile, groupInvoices, type CollectionsReport } from "./report";

let rowCounter = 1;
function makeLine(overrides: Partial<SalesLine> = {}): SalesLine {
  const row = ++rowCounter;
  return {
    lineId: `imp/Sales/${row}`,
    source: { importId: "imp", sheet: "Sales", row },
    billingDate: "2025-12-15",
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
    paymentSchedule: "INSTALLMENTS_0_30_60_90",
    packageQuantity: 1,
    unitPriceCents: 1000,
    lineAmountCents: 1000,
    commissionAmountCents: 50,
    sourceWeight: null,
    sourceMeasurementUnit: null,
    ...overrides,
  };
}

function report(lines: SalesLine[], filters = {}): CollectionsReport {
  const result = buildCollectionsReport(lines, filters);
  if (!result.ok) throw new Error(`expected report, got ${result.code}`);
  return result.report;
}

// INV-1: Agro, billed 2025-12-15, four installments (0/30/60/90), three lines totalling 4,501 cents,
// P-1 twice. INV-2: Home & Garden, billed 2026-01-20, 30 days, 700 cents. INV-3: Agro, billed
// 2026-01-31, 3 installments (30/60/90), 100 cents.
const dataset = [
  makeLine({ productId: "P-1", lineAmountCents: 1000 }),
  makeLine({ productId: "P-2", lineAmountCents: 2501 }),
  makeLine({ productId: "P-1", lineAmountCents: 1000 }),
  makeLine({
    invoiceNumber: "INV-2",
    billingDate: "2026-01-20",
    customerId: "C-2",
    sellerName: "Vendedor Demo",
    businessUnit: "HOME_GARDEN",
    paymentSchedule: "NET_30",
    productId: "P-2",
    lineAmountCents: 700,
  }),
  makeLine({ invoiceNumber: "INV-3", billingDate: "2026-01-31", paymentSchedule: "INSTALLMENTS_30_60_90", lineAmountCents: 100 }),
];

describe("scheduled-collections report", () => {
  it("schedules each whole invoice once and reconciles with its invoiced sales", () => {
    const result = report(dataset);
    expect(result.totals).toEqual({ invoiceCount: 3, installmentCount: 8, scheduledCents: 5301 });
    expect(result.invoicedSalesCents).toBe(5301);
    expect(buildSalesReport(dataset, {})).toMatchObject({ ok: true, report: { totals: { salesCents: 5301, invoiceCount: 3 } } });
    // INV-1 4,501 → 1,126 / 1,125 / 1,125 / 1,125 due 12-15, 01-14, 02-13, 03-15.
    // INV-2 700 due 02-19. INV-3 100 → 34 / 33 / 33 due 03-02, 04-01, 05-01.
    expect(result.byDueMonth).toEqual([
      { key: "2025-12", invoiceCount: 1, installmentCount: 1, scheduledCents: 1126 },
      { key: "2026-01", invoiceCount: 1, installmentCount: 1, scheduledCents: 1125 },
      { key: "2026-02", invoiceCount: 2, installmentCount: 2, scheduledCents: 1125 + 700 },
      { key: "2026-03", invoiceCount: 2, installmentCount: 2, scheduledCents: 1125 + 34 },
      { key: "2026-04", invoiceCount: 1, installmentCount: 1, scheduledCents: 33 },
      { key: "2026-05", invoiceCount: 1, installmentCount: 1, scheduledCents: 33 },
    ]);
    expect(result.byPaymentSchedule).toEqual([
      { key: "NET_30", invoiceCount: 1, installmentCount: 1, scheduledCents: 700 },
      { key: "INSTALLMENTS_30_60_90", invoiceCount: 1, installmentCount: 3, scheduledCents: 100 },
      { key: "INSTALLMENTS_0_30_60_90", invoiceCount: 1, installmentCount: 4, scheduledCents: 4501 },
    ]);
    expect(result.reconciled).toBe(true);
  });

  it("does not depend on line order", () => {
    expect(report([...dataset].reverse())).toEqual(report(dataset));
  });

  it("selects whole invoices by customer, seller and business unit", () => {
    expect(report(dataset, { customerId: "C-2" }).totals).toEqual({ invoiceCount: 1, installmentCount: 1, scheduledCents: 700 });
    expect(report(dataset, { sellerName: "Vendedora Demo" }).totals).toEqual({ invoiceCount: 2, installmentCount: 7, scheduledCents: 4601 });
    const agro = report(dataset, { businessUnit: "AGRO" });
    expect(agro.totals).toEqual({ invoiceCount: 2, installmentCount: 7, scheduledCents: 4601 });
    expect(agro.reconciled).toBe(true);
  });

  it("selects invoices by billing date; their installments may fall due after the period", () => {
    const december = report(dataset, { from: "2025-12-01", to: "2025-12-31" });
    expect(december.totals).toEqual({ invoiceCount: 1, installmentCount: 4, scheduledCents: 4501 });
    expect(december.byDueMonth.map((row) => row.key)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
    // Nothing billed in March, although installments fall due then.
    expect(report(dataset, { from: "2026-03-01", to: "2026-03-31" }).totals).toEqual({ invoiceCount: 0, installmentCount: 0, scheduledCents: 0 });
  });

  it("returns an empty, reconciled report when nothing matches", () => {
    const empty = report(dataset, { customerId: "C-404" });
    expect(empty).toEqual({
      totals: { invoiceCount: 0, installmentCount: 0, scheduledCents: 0 },
      byDueMonth: [],
      byPaymentSchedule: [],
      invoicedSalesCents: 0,
      reconciled: true,
    });
  });

  it("refuses a product filter instead of scheduling part of an invoice's lines", () => {
    // The sales report can show P-2's lines: 2,501 of INV-1's 4,501 cents plus INV-2's 700.
    const sales = buildSalesReport(dataset, { productId: "P-2" });
    expect(sales.ok && sales.report).toMatchObject({ scope: "matching-lines", totals: { salesCents: 3201, invoiceCount: 2 } });
    // Collections would have to split INV-1's schedule by product; they are not shown instead.
    for (const filters of [{ productId: "P-2" }, { productId: "P-2", businessUnit: "AGRO" as const }]) {
      expect(buildCollectionsReport(dataset, filters)).toMatchObject({ ok: false, code: "FILTER_SELECTS_LINES" });
    }
    // An empty product choice is no filter.
    expect(buildCollectionsReport(dataset, { productId: "" }).ok).toBe(true);
  });

  it("checks the period like the sales report", () => {
    expect(buildCollectionsReport(dataset, { from: "2025-02-30" })).toMatchObject({ ok: false, code: "FILTER_INVALID_PERIOD" });
    expect(buildCollectionsReport(dataset, { from: "2026-02-01", to: "2026-01-01" })).toMatchObject({ ok: false, code: "FILTER_INVALID_PERIOD" });
  });

  it("refuses totals that cannot be represented exactly", () => {
    const huge = [
      makeLine({ invoiceNumber: "INV-A", lineAmountCents: Number.MAX_SAFE_INTEGER - 10 }),
      makeLine({ invoiceNumber: "INV-B", lineAmountCents: 20 }),
    ];
    expect(buildCollectionsReport(huge, {})).toMatchObject({ ok: false, code: "TOTAL_OUT_OF_RANGE" });
  });

  it("refuses lines of one invoice that disagree on invoice attributes", () => {
    const conflicting = [makeLine(), makeLine({ paymentSchedule: "NET_30" })];
    expect(() => groupInvoices(conflicting)).toThrow(/paymentSchedule/);
    expect(() => buildCollectionsReport(conflicting, {})).toThrow(/paymentSchedule/);
  });

  it("flags installments that do not match the invoiced sales or the breakdowns", () => {
    const { totals, byDueMonth, byPaymentSchedule } = report(dataset);
    expect(collectionsReconcile(totals, byDueMonth, byPaymentSchedule, 5301)).toBe(true);
    expect(collectionsReconcile(totals, byDueMonth, byPaymentSchedule, 5300)).toBe(false);
    expect(collectionsReconcile(totals, byDueMonth.slice(1), byPaymentSchedule, 5301)).toBe(false);
    expect(collectionsReconcile(totals, byDueMonth, byPaymentSchedule.slice(1), 5301)).toBe(false);
  });
});
