/**
 * HTML for the report snapshot, as strings, laid out like the application's dashboard. The same
 * functions pre-render the file when it is built and re-render it in the browser when a filter
 * changes. All arithmetic comes from the application's pure modules (`buildSalesReport`,
 * `buildSalesRankings`, `buildCollectionsReport`); this file only formats their results. Every
 * value from the data is escaped.
 *
 * The file's Content-Security-Policy forbids inline `style` attributes, so chart geometry is SVG
 * attributes and hover details are SVG `<title>` elements.
 *
 * Safe for the browser. Reachable from Node scripts through built-in type stripping, so relative
 * imports keep their `.ts` extension and type-only imports use `import type`.
 */
import {
  buildCollectionsReport,
  type CollectionsReport,
  type CollectionsRow,
} from "../domain/collections/report.ts";
import { BUSINESS_UNIT_LABELS, PAYMENT_SCHEDULE_LABELS } from "../domain/sales-feed/contract.ts";
import type { CalendarDate } from "../domain/sales-import/dates.ts";
import type { BusinessUnit, PaymentSchedule, SalesLine } from "../domain/sales-import/types.ts";
import { axisLabel, formatMonth, initials, niceCeiling, share, stateLabel } from "../domain/sales-report/display.ts";
import { formatBrlCents } from "../domain/sales-report/format.ts";
import { buildSalesRankings, type RankingRow, type SalesRankings } from "../domain/sales-report/rankings.ts";
import {
  buildSalesReport,
  type LabeledOption,
  type ReportFilterOptions,
  type ReportFilters,
  type ReportRow,
  type SalesReport,
} from "../domain/sales-report/report.ts";

export const FILTER_FIELDS = ["customerId", "productId", "sellerName", "customerState", "businessUnit", "from", "to"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

const integer = new Intl.NumberFormat("pt-BR");

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Filters from the form's values; empty values mean "all", unknown business units are ignored. */
export function readFilters(value: (field: FilterField) => string): ReportFilters {
  const filters: ReportFilters = {};
  const customerId = value("customerId");
  const productId = value("productId");
  const sellerName = value("sellerName");
  const customerState = value("customerState");
  const businessUnit = value("businessUnit");
  const from = value("from");
  const to = value("to");
  if (customerId) filters.customerId = customerId;
  if (productId) filters.productId = productId;
  if (sellerName) filters.sellerName = sellerName;
  if (customerState) filters.customerState = customerState;
  if (businessUnit === "AGRO" || businessUnit === "HOME_GARDEN") filters.businessUnit = businessUnit;
  if (from) filters.from = from as CalendarDate;
  if (to) filters.to = to as CalendarDate;
  return filters;
}

// ---- Filter bar ----

function select(name: FilterField, label: string, all: string, options: readonly [string, string][], kind = ""): string {
  const choices = options.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join("");
  return `<div class="filter${kind}"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}"><option value="">${all}</option>${choices}</select></div>`;
}

/** Names, never IDs, unless two choices share a name. */
function byName(options: readonly LabeledOption[]): [string, string][] {
  const counts = new Map<string, number>();
  for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  return options.map((option) => [option.id, counts.get(option.label)! > 1 ? `${option.label} · ${option.id}` : option.label]);
}

/** The filter bar, with every choice present in the data. Each change applies at once. */
export function renderFilterForm(options: ReportFilterOptions, states: readonly string[]): string {
  const dateBounds = `${options.firstDate ? ` min="${options.firstDate}"` : ""}${options.lastDate ? ` max="${options.lastDate}"` : ""}`;
  return [
    select("customerId", "Customer", "All customers", byName(options.customers), " wide"),
    select("productId", "Product", "All products", byName(options.products), " wide"),
    select("sellerName", "Seller", "All sellers", options.sellers.map((name) => [name, name])),
    select("customerState", "State", "All states", states.map((state) => [state, stateLabel(state)])),
    select("businessUnit", "Business unit", "All units", options.businessUnits.map((unit) => [unit, BUSINESS_UNIT_LABELS[unit]]), " unit"),
    `<div class="filter date"><label for="f-from">From</label><input type="date" id="f-from" name="from"${dateBounds}></div>`,
    `<div class="filter date"><label for="f-to">To</label><input type="date" id="f-to" name="to"${dateBounds}></div>`,
    '<div class="filter-footer"><span class="filter-status">Each change applies at once; every filter combines with the others.</span>',
    '<button type="button" class="clear" id="clear">Clear filters</button></div>',
  ].join("");
}

// ---- Building blocks ----

function sectionTitle(id: string, title: string, subtitle: string): string {
  return `<div class="section-title"><h2 id="${id}">${title}</h2><p>${subtitle}</p></div>`;
}

function kpi(label: string, icon: string, value: string, foot: string): string {
  return `<article class="card kpi"><div class="kpi-head">${label}<span class="kpi-icon" aria-hidden="true">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></article>`;
}

function check(ok: boolean, good: string, bad: string): string {
  return `<span class="check ${ok ? "ok" : "bad"}">${ok ? `✓ ${good}` : `✗ ${bad}`}</span>`;
}

function card(title: string, subtitle: string, body: string): string {
  return `<article class="card chart-card"><div class="chart-title">${title}</div><div class="chart-sub">${subtitle}</div>${body}</article>`;
}

const EMPTY = '<p class="empty">Nothing matches the selected filters.</p>';

/** Rounded for drawing only; three decimals keep the file small and its bytes deterministic. */
const coordinate = (value: number) => String(Math.round(value * 1000) / 1000);

interface ColumnDatum {
  key: string;
  valueCents: number;
  note: string;
}

/** Monthly columns: SVG stretched to the card's width, a rounded scale, a hover title per column. */
function columnChart(label: string, data: readonly ColumnDatum[]): string {
  if (data.length === 0) return EMPTY;
  const top = niceCeiling(Math.max(...data.map((datum) => datum.valueCents)));
  const columns = data
    .map((datum, index) => {
      const height = datum.valueCents > 0 ? Math.max((datum.valueCents / top) * 100, 0.5) : 0;
      const text = `${formatMonth(datum.key)}: ${formatBrlCents(datum.valueCents)} · ${datum.note}`;
      return `<rect x="${coordinate(index + 0.12)}" y="${coordinate(100 - height)}" width="0.76" height="${coordinate(height)}"><title>${escapeHtml(text)}</title></rect>`;
    })
    .join("");
  const n = data.length;
  const grid = [0.5, 50].map((y) => `<line x1="0" x2="${n}" y1="${y}" y2="${y}" vector-effect="non-scaling-stroke"/>`).join("");
  return [
    '<div class="column-chart">',
    `<div class="column-scale" aria-hidden="true"><span>${escapeHtml(axisLabel(top))}</span><span>${escapeHtml(axisLabel(top / 2))}</span><span>R$ 0</span></div>`,
    `<div class="column-plot"><svg viewBox="0 0 ${n} 100" preserveAspectRatio="none" role="img" aria-label="${label}">${grid}${columns}</svg>`,
    `<div class="column-range" aria-hidden="true"><span>${formatMonth(data[0]!.key)}</span><span>${formatMonth(data.at(-1)!.key)}</span></div></div>`,
    "</div>",
  ].join("");
}

interface BarDatum {
  label: string;
  detail?: string | null;
  valueCents: number;
  note: string;
}

/** Horizontal bars with the exact amount and the share of the total at the end of each row. */
function barList(data: readonly BarDatum[], totalCents: number): string {
  if (data.length === 0) return EMPTY;
  const max = Math.max(...data.map((datum) => datum.valueCents), 1);
  const rows = data.map((datum) => {
    const width = datum.valueCents > 0 ? Math.max((datum.valueCents / max) * 100, 1) : 0;
    return [
      `<li title="${escapeHtml(`${datum.label}: ${formatBrlCents(datum.valueCents)} · ${datum.note}`)}">`,
      `<span class="bar-name"><b>${escapeHtml(datum.label)}</b>${datum.detail ? `<small>${escapeHtml(datum.detail)}</small>` : ""}</span>`,
      `<svg class="bar-track" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="10"/><rect class="fill" width="${coordinate(width)}" height="10"/></svg>`,
      `<span class="bar-value">${formatBrlCents(datum.valueCents)}<small>${share(datum.valueCents, totalCents)}</small></span>`,
      "</li>",
    ].join("");
  });
  return `<ul class="bar-list">${rows.join("")}</ul>`;
}

/** Numbered ranking, largest first. */
function rankList(rows: readonly RankingRow[]): string {
  if (rows.length === 0) return EMPTY;
  const items = rows.map(
    (row, index) =>
      `<li><span class="rank-num">${String(index + 1).padStart(2, "0")}</span><span class="rank-main"><b>${escapeHtml(row.label)}</b>${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ""}</span><span class="rank-value">${formatBrlCents(row.salesCents)}<small>${integer.format(row.invoiceCount)} ${row.invoiceCount === 1 ? "invoice" : "invoices"}</small></span></li>`,
  );
  return `<ol class="rank-list">${items.join("")}</ol>`;
}

/** An exact-figures table. The first column (a month or name) never wraps. */
function table(title: string, headings: string[], rows: string[][]): string {
  if (rows.length === 0) return `<div><h3>${title}</h3><p class="muted">Nothing matches.</p></div>`;
  const head = headings.map((heading, index) => `<th${index > 0 ? ' class="num"' : ""}>${heading}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((cell, index) => `<td class="${index > 0 ? "num" : "key"}">${cell}</td>`).join("")}</tr>`)
    .join("");
  return `<div><h3>${title}</h3><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

const invoices = (count: number) => `${integer.format(count)} ${count === 1 ? "invoice" : "invoices"}`;

// ---- Invoiced sales ----

function salesRows(rows: readonly ReportRow[], label: (key: string) => string): string[][] {
  return rows.map((row) => [
    escapeHtml(label(row.key)),
    integer.format(row.invoiceCount),
    integer.format(row.lineCount),
    formatBrlCents(row.salesCents),
  ]);
}

function customerTable(rows: readonly RankingRow[], totalCents: number): string {
  const body =
    rows.length === 0
      ? '<p class="empty">No customer matches all the selected filters.</p>'
      : [
          '<div class="table-wrap scroll"><table><thead><tr><th>Customer</th><th>Location</th><th class="num">Invoices</th><th class="num">Lines</th><th class="num">Share</th><th class="num">Invoiced sales</th></tr></thead><tbody>',
          rows
            .map(
              (row) =>
                `<tr><td><span class="customer-cell"><span class="initial" aria-hidden="true">${escapeHtml(initials(row.label))}</span>${escapeHtml(row.label)}</span></td><td>${escapeHtml(row.detail ?? "")}</td><td class="num">${integer.format(row.invoiceCount)}</td><td class="num">${integer.format(row.lineCount)}</td><td class="num">${share(row.salesCents, totalCents)}</td><td class="num money">${formatBrlCents(row.salesCents)}</td></tr>`,
            )
            .join(""),
          "</tbody></table></div>",
        ].join("");
  return [
    '<section aria-labelledby="customers-title">',
    sectionTitle("customers-title", "Customers", "Every customer in the selection, largest first"),
    `<article class="card table-card"><div class="table-head"><h3>Customers in the selection</h3><span>${integer.format(rows.length)} ${rows.length === 1 ? "customer" : "customers"}</span></div>${body}</article>`,
    "</section>",
  ].join("");
}

function renderDistribution(report: SalesReport, rankings: SalesRankings): string {
  const { salesCents } = report.totals;
  const bars = (rows: readonly RankingRow[], label: (row: RankingRow) => string = (row) => row.label): BarDatum[] =>
    rows.map((row) => ({ label: label(row), detail: row.detail, valueCents: row.salesCents, note: invoices(row.invoiceCount) }));
  return [
    '<section aria-labelledby="distribution-title">',
    sectionTitle("distribution-title", "Where the sales come from", "Use the filters above to focus on any of these"),
    '<div class="charts">',
    card("By seller", "Invoiced sales and share of the selection", barList(bars(rankings.bySeller), salesCents)),
    card("By state", "Customer location", barList(bars(rankings.byState, (row) => stateLabel(row.key)), salesCents)),
    card(
      "By business unit",
      "Agro and Home &amp; Garden",
      barList(
        report.byBusinessUnit.map((row) => ({ label: BUSINESS_UNIT_LABELS[row.key], valueCents: row.salesCents, note: invoices(row.invoiceCount) })),
        salesCents,
      ),
    ),
    "</div>",
    '<div class="charts two">',
    card("Top products", "Ranked by invoiced sales of their lines", rankList(rankings.byProduct.slice(0, 8))),
    card("Top customers", "Ranked by invoiced sales", rankList(rankings.byCustomer.slice(0, 8))),
    "</div>",
    customerTable(rankings.byCustomer, salesCents),
    "</section>",
  ].join("");
}

function renderSales(report: SalesReport, rankings: SalesRankings | null, rankingsMessage: string): string {
  const { totals } = report;
  return [
    '<section class="kpis" aria-label="Indicators">',
    kpi("Invoiced sales", "↗", formatBrlCents(totals.salesCents), report.scope === "whole-invoices" ? "Whole invoices in the selection" : "Only the selected product's lines"),
    kpi("Invoices", "▤", integer.format(totals.invoiceCount), "Distinct invoice numbers"),
    kpi("Invoice lines", "≡", integer.format(totals.lineCount), "Product lines on those invoices"),
    kpi("Commission recorded", "◎", formatBrlCents(totals.commissionCents), "Sum of the lines' commission"),
    "</section>",
    '<p class="scope-note">',
    check(report.reconciled, "Month and business-unit breakdowns sum exactly to these totals.", "Breakdowns do not sum to the totals."),
    " ",
    report.scope === "whole-invoices"
      ? "All filters select whole invoices: totals include every line of each matching invoice."
      : "The product filter selects individual lines: totals include only this product's lines, and an invoice counts if at least one of its lines matches. These are not whole-invoice totals.",
    "</p>",
    '<section aria-labelledby="trend-title">',
    sectionTitle("trend-title", "Sales over time", "Invoiced sales by billing month for the current selection"),
    card(
      "Invoiced sales by month",
      "Hover a column for its exact amount, or open the table",
      [
        columnChart(
          "Invoiced sales by billing month",
          report.byMonth.map((row) => ({ key: row.key, valueCents: row.salesCents, note: invoices(row.invoiceCount) })),
        ),
        '<details><summary>Show as a table</summary><div class="breakdowns">',
        table("By billing month", ["Billing month", "Invoices", "Lines", "Invoiced sales"], salesRows(report.byMonth, formatMonth)),
        table(
          "By business unit",
          ["Business unit", "Invoices", "Lines", "Invoiced sales"],
          salesRows(report.byBusinessUnit, (key) => BUSINESS_UNIT_LABELS[key as BusinessUnit]),
        ),
        "</div></details>",
      ].join(""),
    ),
    "</section>",
    rankings ? renderDistribution(report, rankings) : `<p class="card panel error">${escapeHtml(rankingsMessage)}</p>`,
  ].join("");
}

// ---- Scheduled collections ----

function collectionsRows(rows: readonly CollectionsRow[], label: (key: string) => string): string[][] {
  return rows.map((row) => [
    escapeHtml(label(row.key)),
    integer.format(row.invoiceCount),
    integer.format(row.installmentCount),
    formatBrlCents(row.scheduledCents),
  ]);
}

function renderCollections(report: CollectionsReport): string {
  const { byDueMonth } = report;
  const range = byDueMonth.length > 0 ? ` (${formatMonth(byDueMonth[0]!.key)} – ${formatMonth(byDueMonth.at(-1)!.key)})` : "";
  return [
    '<section class="kpis three" aria-label="Collections indicators">',
    kpi("Scheduled collections", "◷", formatBrlCents(report.totals.scheduledCents), "Sum of the installments"),
    kpi("Installments", "▦", integer.format(report.totals.installmentCount), "From each invoice's payment schedule"),
    kpi("Invoices", "▤", integer.format(report.totals.invoiceCount), "Whole invoices in the selection"),
    "</section>",
    '<p class="scope-note">',
    check(
      report.reconciled,
      `The installments sum exactly to the invoiced sales of these invoices (${formatBrlCents(report.invoicedSalesCents)}), and both breakdowns sum to the totals.`,
      `The installments do not reconcile with the invoiced sales of these invoices (${formatBrlCents(report.invoicedSalesCents)}) or with the breakdowns.`,
    ),
    "</p>",
    '<div class="charts two">',
    card(
      "Scheduled by due month",
      "Installments may fall due after the selected period",
      columnChart(
        "Scheduled collections by due month",
        byDueMonth.map((row) => ({ key: row.key, valueCents: row.scheduledCents, note: `${integer.format(row.installmentCount)} installments` })),
      ),
    ),
    card(
      "By payment schedule",
      "Scheduled amount and share",
      barList(
        report.byPaymentSchedule.map((row) => ({ label: PAYMENT_SCHEDULE_LABELS[row.key], valueCents: row.scheduledCents, note: invoices(row.invoiceCount) })),
        report.totals.scheduledCents,
      ),
    ),
    "</div>",
    `<details class="card details-card"><summary>Exact figures${range}</summary><div class="breakdowns">`,
    table(
      "By due month",
      ["Due month", "Invoices with an installment due", "Installments", "Scheduled"],
      collectionsRows(byDueMonth, formatMonth),
    ),
    table(
      "By payment schedule",
      ["Payment schedule", "Invoices", "Installments", "Scheduled"],
      collectionsRows(report.byPaymentSchedule, (key) => PAYMENT_SCHEDULE_LABELS[key as PaymentSchedule]),
    ),
    "</div></details>",
  ].join("");
}

/** Every report section for one set of filters. */
export function renderResults(lines: readonly SalesLine[], filters: ReportFilters): string {
  const sales = buildSalesReport(lines, filters);
  const rankings = buildSalesRankings(lines, filters);
  const collections = buildCollectionsReport(lines, filters);
  return [
    sales.ok
      ? renderSales(sales.report, rankings.ok ? rankings.rankings : null, rankings.ok ? "" : rankings.message)
      : `<p class="card panel error">${escapeHtml(sales.message)}</p>`,
    '<section aria-labelledby="collections-title">',
    sectionTitle(
      "collections-title",
      "Scheduled collections",
      "Contractual installments of the selected invoices, by due month. Not payments received. Filters select whole invoices; the period selects invoices by billing date, and their installments may fall due after it.",
    ),
    collections.ok
      ? renderCollections(collections.report)
      : `<p class="card panel${collections.code === "FILTER_SELECTS_LINES" ? " muted" : " error"}">${escapeHtml(collections.message)}</p>`,
    "</section>",
  ].join("");
}
