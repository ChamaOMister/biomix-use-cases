import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateDelivery, type InvoicePayload } from "@/domain/sales-feed/contract";
import { SELLERS } from "@/domain/sales-feed/reference-data";
import type { SalesLine } from "@/domain/sales-import/types";
import { buildSalesReport, type ReportFilters } from "@/domain/sales-report/report";
import { generateSyntheticFeed, replayDeliveries } from "@/synthetic-data/generate";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../db/testing";
import { ingestDelivery } from "../sales-feed/ingest";
import { buildStoredSalesReport, storedFilterOptions, type StoredReportFilters } from "./stored-report";

const SELLER_NAME = new Map(SELLERS.map((seller) => [seller.sellerId, seller.name]));

/** The replayed invoices as the pure report's input lines, built without the database. */
function toSalesLines(invoices: Iterable<InvoicePayload>): SalesLine[] {
  const lines: SalesLine[] = [];
  for (const payload of invoices) {
    // Converts labels to codes exactly as the endpoint does.
    const checked = validateDelivery({ deliveryId: "00000000-0000-4000-8000-000000000000", invoices: [payload] });
    if (!checked.ok) throw new Error("replayed invoice is invalid");
    const invoice = checked.delivery.invoices[0]!;
    invoice.lines.forEach((line, index) => {
      lines.push({
        lineId: `${invoice.invoiceNumber}/${index + 1}`,
        source: { importId: "replay", sheet: "feed", row: lines.length + 1 },
        billingDate: invoice.billingDate,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customer.id,
        customerName: invoice.customer.name,
        taxId: null,
        customerState: invoice.customer.state,
        customerCity: invoice.customer.city,
        productId: line.productId,
        productName: line.productName,
        productCategory: line.productCategory,
        productUsage: null,
        productType: null,
        sellerName: SELLER_NAME.get(invoice.sellerId)!,
        businessUnit: invoice.businessUnit,
        paymentSchedule: invoice.paymentSchedule,
        packageQuantity: line.packageQuantity,
        unitPriceCents: line.unitPriceCents,
        lineAmountCents: line.lineAmountCents,
        commissionAmountCents: line.commissionAmountCents,
        sourceWeight: null,
        sourceMeasurementUnit: null,
      });
    });
  }
  return lines;
}

function pureFilters({ sellerId, ...rest }: StoredReportFilters): ReportFilters {
  return { ...rest, ...(sellerId !== undefined ? { sellerName: SELLER_NAME.get(sellerId)! } : {}) };
}

describe.skipIf(!hasDatabase)("stored report against the pure report module", () => {
  let db: TestDatabase;
  let lines: SalesLine[];
  let summary: ReturnType<typeof generateSyntheticFeed>["summary"];

  beforeAll(async () => {
    db = await createTestDatabase();
    const feed = generateSyntheticFeed({ seed: 2026 });
    summary = feed.summary;
    // Every closed month in order, then the pending delivery: corrections replace earlier invoices.
    const deliveries = [...feed.deliveries, feed.pendingDelivery];
    for (const { payload } of deliveries) {
      const outcome = await ingestDelivery(db.pool, payload);
      if (outcome.kind !== "applied") throw new Error(`generated delivery was not applied: ${outcome.kind}`);
    }
    lines = toSalesLines(replayDeliveries(deliveries).values());
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("stores exactly the replayed invoices, with corrections applied", async () => {
    const counts = await db.pool.query<{ invoices: number; lines: number; replaced: number }>(
      `SELECT (SELECT count(*)::int FROM invoices) AS invoices,
              (SELECT count(*)::int FROM invoice_lines) AS lines,
              (SELECT sum(invoices_replaced)::int FROM feed_deliveries) AS replaced`,
    );
    expect(counts.rows[0]).toMatchObject({ invoices: new Set(lines.map((line) => line.invoiceNumber)).size, lines: lines.length });
    expect(counts.rows[0]!.replaced).toBeGreaterThan(0);
    expect(lines.length).toBe(summary.lines);
  });

  const top = { customerId: "", productId: "" };
  beforeAll(() => {
    // The customer and product with the most lines, so the filters select real data.
    const most = (key: "customerId" | "productId") => {
      const counts = new Map<string, number>();
      for (const line of lines) counts.set(line[key], (counts.get(line[key]) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
    };
    top.customerId = most("customerId");
    top.productId = most("productId");
  });

  const cases: [string, () => StoredReportFilters][] = [
    ["no filters", () => ({})],
    ["Agro", () => ({ businessUnit: "AGRO" })],
    ["Home & Garden", () => ({ businessUnit: "HOME_GARDEN" })],
    ["one seller", () => ({ sellerId: "S04" })],
    ["one customer", () => ({ customerId: top.customerId })],
    ["one product (matching lines)", () => ({ productId: top.productId })],
    ["a comparison period", () => ({ from: "2025-01-01", to: "2025-09-25" })],
    ["a single day at a month boundary", () => ({ from: "2024-03-01", to: "2024-03-01" })],
    ["product within a period and unit", () => ({ productId: top.productId, from: "2024-06-01", to: "2024-12-31", businessUnit: "AGRO" })],
    ["a seller of the other unit", () => ({ sellerId: "S01", businessUnit: "AGRO" })],
    ["a period without sales", () => ({ from: "2020-01-01", to: "2020-12-31" })],
    ["empty strings as no filter", () => ({ customerId: "", from: "" }) as StoredReportFilters],
  ];

  it.each(cases)("matches the pure report: %s", async (_name, filters) => {
    const stored = await buildStoredSalesReport(db.pool, filters());
    const pure = buildSalesReport(lines, pureFilters(filters()));
    expect(stored).toEqual(pure);
    expect(stored.ok && stored.report.reconciled).toBe(true);
  });

  it("rejects an invalid period like the pure report", async () => {
    const filters = { from: "2025-02-30" } as StoredReportFilters;
    expect(await buildStoredSalesReport(db.pool, filters)).toEqual(buildSalesReport(lines, filters));
    const reversed = { from: "2025-03-01", to: "2025-02-01" } as StoredReportFilters;
    expect(await buildStoredSalesReport(db.pool, reversed)).toEqual(buildSalesReport(lines, reversed));
  });

  it("offers the stored customers, products, sellers, units and date range as filter choices", async () => {
    const options = await storedFilterOptions(db.pool);
    expect(options.customers).toHaveLength(new Set(lines.map((line) => line.customerId)).size);
    expect(options.products).toHaveLength(new Set(lines.map((line) => line.productId)).size);
    expect(options.sellers.map((seller) => seller.id).sort()).toEqual(SELLERS.map((seller) => seller.sellerId));
    expect(options.businessUnits).toEqual(["AGRO", "HOME_GARDEN"]);
    expect(options.firstDate).toBe(lines.reduce((min, line) => (line.billingDate < min ? line.billingDate : min), "9999-12-31"));
    expect(options.lastDate).toBe(lines.reduce((max, line) => (line.billingDate > max ? line.billingDate : max), "0000-01-01"));
    expect(options).toMatchObject({ appliedDeliveries: 45, rejectedDeliveries: 0 });
  });
});
