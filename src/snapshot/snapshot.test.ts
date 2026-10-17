import { createHash } from "node:crypto";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { buildCollectionsReport, FILTER_SELECTS_LINES_MESSAGE } from "@/domain/collections/report";
import { validateDelivery, type InvoicePayload } from "@/domain/sales-feed/contract";
import { SELLERS } from "@/domain/sales-feed/reference-data";
import type { SalesLine } from "@/domain/sales-import/types";
import { formatBrlCents } from "@/domain/sales-report/format";
import { buildSalesRankings } from "@/domain/sales-report/rankings";
import { buildSalesReport, type ReportFilters } from "@/domain/sales-report/report";
import { DEFAULT_SEED, generateSyntheticFeed, replayDeliveries, type SyntheticFeed } from "@/synthetic-data/generate";
import { buildSnapshotHtml } from "./build";
import { expandSnapshotLines, type SnapshotData } from "./data";
import { escapeHtml, FILTER_FIELDS, renderResults, type FilterField } from "./render";

const SELLER_NAME = new Map(SELLERS.map((seller) => [seller.sellerId, seller.name]));

/** The replayed invoices as report lines, converted independently of the snapshot's own format. */
function replayedLines(invoices: Iterable<InvoicePayload>): SalesLine[] {
  const lines: SalesLine[] = [];
  for (const payload of invoices) {
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

function between(html: string, pattern: RegExp): string {
  const match = pattern.exec(html);
  if (!match) throw new Error(`not found: ${pattern}`);
  return match[1]!;
}

const dataOf = (html: string) =>
  JSON.parse(between(html, /<script type="application\/json" id="snapshot-data">([\s\S]*?)<\/script>/)) as SnapshotData;
const scriptOf = (html: string) => between(html, /<script>([\s\S]*?)<\/script>/);
const styleOf = (html: string) => between(html, /<style>([\s\S]*?)<\/style>/);
const resultsOf = (html: string) => between(html, /<div id="results">([\s\S]*?)<\/div>\n<footer>/);
/** The exact amount shown on an indicator card. */
const kpiValue = (html: string, label: string) =>
  between(html, new RegExp(`${label}<span class="kpi-icon" aria-hidden="true">[^<]*</span></div><div class="kpi-value">([^<]*)</div>`));

/**
 * Runs the file's bundled script against a stand-in for the few DOM features it uses, and returns
 * handles to change filters the way the form would.
 */
function runSnapshotScript(html: string) {
  const values = Object.fromEntries(FILTER_FIELDS.map((field) => [field, ""])) as Record<FilterField, string>;
  const listeners = new Map<string, ((event: { preventDefault(): void }) => void)[]>();
  const on = (target: string) => (type: string, listener: (event: { preventDefault(): void }) => void) =>
    listeners.set(`${target}:${type}`, [...(listeners.get(`${target}:${type}`) ?? []), listener]);
  const fields = Object.fromEntries(
    FILTER_FIELDS.map((field) => [
      field,
      {
        get value() {
          return values[field];
        },
        set value(value: string) {
          values[field] = value;
        },
      },
    ]),
  );
  const results = { innerHTML: "" };
  const elements: Record<string, unknown> = {
    "snapshot-data": { textContent: between(html, /<script type="application\/json" id="snapshot-data">([\s\S]*?)<\/script>/) },
    filters: { elements: { namedItem: (name: FilterField) => fields[name] ?? null }, addEventListener: on("filters") },
    results,
    clear: { addEventListener: on("clear") },
  };
  vm.runInNewContext(scriptOf(html), { document: { getElementById: (id: string) => elements[id] ?? null } });
  const fire = (key: string) => {
    let prevented = false;
    for (const listener of listeners.get(key) ?? []) listener({ preventDefault: () => (prevented = true) });
    return prevented;
  };
  return {
    results: () => results.innerHTML,
    values,
    change(filters: Partial<Record<FilterField, string>>) {
      Object.assign(values, filters);
      fire("filters:change");
    },
    submit: () => fire("filters:submit"),
    clear: () => fire("clear:click"),
  };
}

describe("report snapshot", () => {
  let feed: SyntheticFeed;
  let html: string;
  let lines: SalesLine[];

  beforeAll(async () => {
    feed = generateSyntheticFeed({ seed: DEFAULT_SEED });
    html = await buildSnapshotHtml({ seed: feed.seed, deliveries: feed.deliveries, pendingDelivery: feed.pendingDelivery });
    lines = replayedLines(replayDeliveries([...feed.deliveries, feed.pendingDelivery]).values());
  }, 120_000);

  it("is deterministic: the same seed builds the same bytes", async () => {
    const again = generateSyntheticFeed({ seed: DEFAULT_SEED });
    expect(await buildSnapshotHtml({ seed: again.seed, deliveries: again.deliveries, pendingDelivery: again.pendingDelivery })).toBe(html);
  });

  it("embeds exactly the invoices stored after replaying every delivery", () => {
    const data = dataOf(html);
    expect(data).toMatchObject({ format: 2, seed: DEFAULT_SEED, asOf: feed.summary.lastBillingDate, closedMonthDeliveries: 44, pendingDeliveryMonth: "2026-09" });
    const embedded = expandSnapshotLines(data);
    expect(embedded).toHaveLength(feed.summary.lines);
    expect(data.totals).toEqual({
      invoices: feed.summary.invoices,
      lines: feed.summary.lines,
      salesCents: feed.summary.byYear.reduce((sum, year) => sum + year.actualCents, 0),
    });
    const key = (line: SalesLine) =>
      [line.invoiceNumber, line.lineId, line.billingDate, line.customerId, line.customerState, line.customerCity, line.productId,
        line.sellerName, line.businessUnit, line.paymentSchedule, line.packageQuantity, line.unitPriceCents, line.lineAmountCents, line.commissionAmountCents].join("|");
    expect(embedded.map(key).sort()).toEqual(lines.map(key).sort());
  });

  it("shows the same totals as the report modules on the replayed invoices", () => {
    const sales = buildSalesReport(lines, {});
    const collections = buildCollectionsReport(lines, {});
    if (!sales.ok || !collections.ok) throw new Error("expected reports");
    expect(resultsOf(html)).toBe(renderResults(lines, {}));
    expect(kpiValue(resultsOf(html), "Invoiced sales")).toBe(formatBrlCents(sales.report.totals.salesCents));
    expect(kpiValue(resultsOf(html), "Scheduled collections")).toBe(formatBrlCents(collections.report.totals.scheduledCents));
    expect(resultsOf(html)).not.toContain("✗");
  });

  it("shows the rankings of the replayed invoices, largest first, and every customer", () => {
    const rankings = buildSalesRankings(lines, {});
    if (!rankings.ok) throw new Error("expected rankings");
    const results = resultsOf(html);
    const top = rankings.rankings.byProduct[0]!;
    expect(results).toContain(`<span class="rank-num">01</span><span class="rank-main"><b>${escapeHtml(top.label)}</b>`);
    expect(results).toContain(`${formatBrlCents(top.salesCents)}<small>`);
    for (const state of rankings.rankings.byState) expect(results).toContain(formatBrlCents(state.salesCents));
    expect(results.match(/<span class="customer-cell">/g)).toHaveLength(new Set(lines.map((line) => line.customerId)).size);
  });

  it("offers every state, seller and business unit by name, never by ID", () => {
    const form = between(html, /<form class="filter-bar" id="filters" aria-label="Report filters">([\s\S]*?)<\/form>/);
    for (const state of new Set(lines.map((line) => line.customerState!))) expect(form).toContain(`<option value="${state}">`);
    const { customerId, customerName, productId, productName } = lines[0]!;
    expect(form).toContain(`<option value="${customerId}">${escapeHtml(customerName)}</option>`);
    expect(form).toContain(`<option value="${productId}">${escapeHtml(productName)}</option>`);
    for (const seller of SELLERS) expect(form).toContain(`<option value="${escapeHtml(seller.name)}">`);
    expect(form).toContain('<option value="HOME_GARDEN">Home &amp; Garden</option>');
    expect(form).not.toContain(" · ");
  });

  it("labels months as 'Jan 2025' and keeps them on one line", () => {
    const results = resultsOf(html);
    expect(results).toMatch(/<td class="key">Jan 2025<\/td>/);
    expect(results).not.toMatch(/<td class="key">\d{4}-\d{2}<\/td>/);
    expect(styleOf(html)).toContain("td.key { white-space: nowrap; }");
  });

  it("recomputes both reports in the browser when filters change", () => {
    const page = runSnapshotScript(html);
    // On load the script renders exactly what the file already shows.
    expect(page.results()).toBe(resultsOf(html));

    const cases: ReportFilters[] = [
      { businessUnit: "AGRO", from: "2025-01-01", to: "2025-12-31" },
      { sellerName: SELLER_NAME.get("S01")!, from: "2024-11-01", to: "2024-11-30" },
      { customerId: lines[0]!.customerId },
      { customerState: "MG", sellerName: SELLER_NAME.get("S04")! },
    ];
    for (const filters of cases) {
      page.clear();
      page.change(filters as Partial<Record<FilterField, string>>);
      const sales = buildSalesReport(lines, filters);
      const collections = buildCollectionsReport(lines, filters);
      if (!sales.ok || !collections.ok) throw new Error("expected reports");
      expect(page.results()).toBe(renderResults(lines, filters));
      expect(kpiValue(page.results(), "Invoiced sales")).toBe(formatBrlCents(sales.report.totals.salesCents));
      expect(kpiValue(page.results(), "Scheduled collections")).toBe(formatBrlCents(collections.report.totals.scheduledCents));
      expect(sales.report.totals.salesCents).toBeGreaterThan(0);
      expect(page.results()).not.toContain("✗");
    }

    page.change({ productId: lines[0]!.productId });
    expect(page.results()).toContain(escapeHtml(FILTER_SELECTS_LINES_MESSAGE));
    expect(page.results()).toContain("The product filter selects individual lines");

    page.change({ productId: "", from: "2025-03-01", to: "2025-02-01" });
    expect(page.results()).toContain("The period start is after its end.");

    expect(page.submit()).toBe(true);
    page.clear();
    expect(Object.values(page.values).every((value) => value === "")).toBe(true);
    expect(page.results()).toBe(resultsOf(html));
  });

  it("opens without network access: nothing external, and a policy that forbids it", () => {
    const csp = between(html, /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
    const sha = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
    expect(csp).toBe(
      `default-src 'none'; script-src ${sha(scriptOf(html))}; style-src ${sha(styleOf(html))}; base-uri 'none'; form-action 'none'`,
    );
    expect(html).not.toMatch(/https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i);
    expect(html).not.toMatch(/<(link|img|iframe|object|embed|base)\b|\ssrc=|@import|url\(|fetch\(|XMLHttpRequest|WebSocket|import\(/i);
    expect(html.match(/<script\b/g)).toHaveLength(2);
    // The policy also forbids inline style attributes, so nothing may rely on them.
    expect(html).not.toMatch(/\sstyle=/i);
    expect(Buffer.byteLength(html)).toBeLessThan(3 * 1024 * 1024);
  });

  it("contains no evaluation answer-key data", () => {
    expect(html).not.toMatch(/answer|scenario|evaluation|planted/i);
    expect(html).not.toContain(feed.answerKey.purpose);
    for (const scenario of feed.answerKey.scenarios) expect(html).not.toContain(scenario.description);
    expect(Object.keys(dataOf(html)).sort()).toEqual(
      ["asOf", "closedMonthDeliveries", "customers", "format", "invoices", "pendingDeliveryMonth", "products", "seed", "sellers", "totals"],
    );
  });

  it("labels the data as synthetic, with its as-of date", () => {
    expect(html).toContain(`<strong>Synthetic, fictional data</strong>, as of ${feed.summary.lastBillingDate}`);
    expect(html).toContain("<title>Biomix report snapshot (synthetic data)</title>");
  });
});
