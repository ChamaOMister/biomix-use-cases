import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCollectionsReport } from "@/domain/collections/report";
import { PAYMENT_SCHEDULE_OFFSETS } from "@/domain/collections/schedule";
import { validateDelivery, type InvoicePayload } from "@/domain/sales-feed/contract";
import { SELLERS } from "@/domain/sales-feed/reference-data";
import type { SalesLine } from "@/domain/sales-import/types";
import { buildSalesReport, normalizeReportFilters, type ReportFilters } from "@/domain/sales-report/report";
import { buildSnapshotData } from "@/snapshot/build";
import { expandSnapshotLines } from "@/snapshot/data";
import { generateSyntheticFeed, replayDeliveries } from "@/synthetic-data/generate";
import { buildStoredCollectionsReport } from "../collections/stored-collections";
import { createTestDatabase, hasDatabase, type TestDatabase } from "../db/testing";
import { ingestDelivery } from "../sales-feed/ingest";
import { buildStoredRankings, type RankingRow } from "./stored-rankings";
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

function pureFilters({ sellerId, state, ...rest }: StoredReportFilters): ReportFilters {
  return {
    ...rest,
    ...(sellerId !== undefined ? { sellerName: SELLER_NAME.get(sellerId)! } : {}),
    ...(state !== undefined ? { customerState: state } : {}),
  };
}

describe.skipIf(!hasDatabase)("stored reports against the pure report modules", () => {
  let db: TestDatabase;
  let lines: SalesLine[];
  /** The lines the downloadable snapshot embeds, built from the same feed. */
  let snapshotLines: SalesLine[];
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
    snapshotLines = expandSnapshotLines(buildSnapshotData({ seed: feed.seed, deliveries: feed.deliveries, pendingDelivery: feed.pendingDelivery }));
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
  // The snapshot does not embed customer states, so these cases are compared with the pure modules only.
  const stateCases: [string, () => StoredReportFilters][] = [
    ["one state", () => ({ state: "MG" })],
    ["a seller within a state", () => ({ sellerId: "S03", state: "RJ" })],
    ["product, seller and state", () => ({ productId: top.productId, sellerId: "S04", state: "MG" })],
    ["a state outside the seller's territory", () => ({ sellerId: "S01", state: "ES" })],
  ];
  const allCases = [...cases, ...stateCases];

  it.each(allCases)("matches the pure report: %s", async (_name, filters) => {
    const stored = await buildStoredSalesReport(db.pool, filters());
    const pure = buildSalesReport(lines, pureFilters(filters()));
    expect(stored).toEqual(pure);
    expect(stored.ok && stored.report.reconciled).toBe(true);
  });

  it.each(allCases)("scheduled collections match the pure module: %s", async (_name, filters) => {
    const stored = await buildStoredCollectionsReport(db.pool, filters());
    const pure = buildCollectionsReport(lines, pureFilters(filters()));
    expect(stored).toEqual(pure);
    if (filters().productId) {
      expect(stored).toMatchObject({ ok: false, code: "FILTER_SELECTS_LINES" });
    } else {
      expect(stored.ok && stored.report.reconciled).toBe(true);
      // The installments of the selected invoices sum exactly to the invoiced sales of the same selection.
      const sales = await buildStoredSalesReport(db.pool, filters());
      expect(stored.ok && sales.ok && stored.report.totals.scheduledCents).toBe(sales.ok && sales.report.totals.salesCents);
      expect(stored.ok && sales.ok && stored.report.totals.invoiceCount).toBe(sales.ok && sales.report.totals.invoiceCount);
    }
  });

  it.each(cases)("the report snapshot's data gives the stored reports: %s", async (_name, filters) => {
    expect(buildSalesReport(snapshotLines, pureFilters(filters()))).toEqual(await buildStoredSalesReport(db.pool, filters()));
    expect(buildCollectionsReport(snapshotLines, pureFilters(filters()))).toEqual(await buildStoredCollectionsReport(db.pool, filters()));
  });

  it.each(allCases)("rankings match an independent count of the lines: %s", async (_name, filters) => {
    const stored = await buildStoredRankings(db.pool, filters());
    const sales = await buildStoredSalesReport(db.pool, filters());
    if (!stored.ok || !sales.ok) throw new Error("expected both reports");
    const normalized = normalizeReportFilters(pureFilters(filters()));
    if (!normalized.ok) throw new Error("expected valid filters");
    const pure = normalized.filters;
    const selected = lines.filter(
      (line) =>
        (pure.customerId === undefined || line.customerId === pure.customerId) &&
        (pure.productId === undefined || line.productId === pure.productId) &&
        (pure.sellerName === undefined || line.sellerName === pure.sellerName) &&
        (pure.businessUnit === undefined || line.businessUnit === pure.businessUnit) &&
        (pure.customerState === undefined || line.customerState === pure.customerState) &&
        (pure.from === undefined || line.billingDate >= pure.from) &&
        (pure.to === undefined || line.billingDate <= pure.to),
    );
    const rank = (key: (line: SalesLine) => string) => {
      const groups = new Map<string, { label: string; lineCount: number; invoices: Set<string>; salesCents: number }>();
      for (const line of selected) {
        const group = groups.get(key(line)) ?? { label: key(line), lineCount: 0, invoices: new Set<string>(), salesCents: 0 };
        groups.set(key(line), group);
        group.lineCount += 1;
        group.invoices.add(line.invoiceNumber);
        group.salesCents += line.lineAmountCents;
      }
      return [...groups.values()]
        .map(({ label, lineCount, invoices, salesCents }) => ({ label, lineCount, invoiceCount: invoices.size, salesCents }))
        .sort((a, b) => b.salesCents - a.salesCents || a.label.localeCompare(b.label, "pt-BR"));
    };
    const shape = (rows: RankingRow[]) => rows.map(({ label, lineCount, invoiceCount, salesCents }) => ({ label, lineCount, invoiceCount, salesCents }));
    expect(shape(stored.rankings.byProduct)).toEqual(rank((line) => line.productName));
    expect(shape(stored.rankings.byCustomer)).toEqual(rank((line) => line.customerName));
    expect(shape(stored.rankings.bySeller)).toEqual(rank((line) => line.sellerName));
    expect(shape(stored.rankings.byState)).toEqual(rank((line) => line.customerState!));
    // Every ranking's sales and lines add up to the report's totals.
    for (const list of [stored.rankings.byProduct, stored.rankings.byCustomer, stored.rankings.bySeller, stored.rankings.byState]) {
      expect(list.reduce((sum, row) => sum + row.salesCents, 0)).toBe(sales.report.totals.salesCents);
      expect(list.reduce((sum, row) => sum + row.lineCount, 0)).toBe(sales.report.totals.lineCount);
    }
    expect(stored.rankings.byCustomer.every((row) => row.detail?.endsWith(`, ${selected.find((line) => line.customerId === row.key)!.customerState}`))).toBe(true);
  });

  it("stores every invoice's installments summing to its lines, due on its schedule's offsets", async () => {
    const { rows } = await db.pool.query<{
      payment_schedule: keyof typeof PAYMENT_SCHEDULE_OFFSETS;
      offsets: number[];
      amounts: string[];
      line_total: string;
    }>(
      `SELECT i.payment_schedule,
              array_agg(s.due_date - i.billing_date ORDER BY s.installment_number) AS offsets,
              array_agg(s.amount_cents::text ORDER BY s.installment_number) AS amounts,
              (SELECT sum(l.line_amount_cents) FROM invoice_lines l WHERE l.invoice_number = i.invoice_number)::text AS line_total
       FROM invoices i JOIN scheduled_installments s ON s.invoice_number = i.invoice_number
       GROUP BY i.invoice_number`,
    );
    expect(rows).toHaveLength(new Set(lines.map((line) => line.invoiceNumber)).size);
    for (const row of rows) {
      // Postgres's own date arithmetic gives the contract's day offsets.
      expect(row.offsets).toEqual(PAYMENT_SCHEDULE_OFFSETS[row.payment_schedule]);
      const amounts = row.amounts.map(BigInt);
      expect(amounts.reduce((sum, amount) => sum + amount, 0n)).toBe(BigInt(row.line_total));
      // Equal installments; the extra cents come first.
      amounts.slice(1).forEach((amount, index) => {
        const previous = amounts[index]!;
        expect(previous === amount || previous === amount + 1n).toBe(true);
      });
    }
    expect(new Set(rows.map((row) => row.payment_schedule))).toEqual(new Set(Object.keys(PAYMENT_SCHEDULE_OFFSETS)));
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
    expect(options.states).toEqual([...new Set(lines.map((line) => line.customerState!))].sort());
    expect(options.firstDate).toBe(lines.reduce((min, line) => (line.billingDate < min ? line.billingDate : min), "9999-12-31"));
    expect(options.lastDate).toBe(lines.reduce((max, line) => (line.billingDate > max ? line.billingDate : max), "0000-01-01"));
    expect(options).toMatchObject({ appliedDeliveries: 45, rejectedDeliveries: 0 });
  });
});
