/**
 * HTML for the report snapshot, as strings. The same functions pre-render the file when it is
 * built and re-render it in the browser when a filter changes. All arithmetic comes from the
 * application's pure report modules (`buildSalesReport`, `buildCollectionsReport`); this file only
 * formats their results. Every value from the data is escaped.
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
import { formatBrlCents } from "../domain/sales-report/format.ts";
import {
  buildSalesReport,
  type ReportFilterOptions,
  type ReportFilters,
  type ReportRow,
  type SalesReport,
} from "../domain/sales-report/report.ts";

export const FILTER_FIELDS = ["customerId", "productId", "sellerName", "businessUnit", "from", "to"] as const;
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
  const businessUnit = value("businessUnit");
  const from = value("from");
  const to = value("to");
  if (customerId) filters.customerId = customerId;
  if (productId) filters.productId = productId;
  if (sellerName) filters.sellerName = sellerName;
  if (businessUnit === "AGRO" || businessUnit === "HOME_GARDEN") filters.businessUnit = businessUnit;
  if (from) filters.from = from as CalendarDate;
  if (to) filters.to = to as CalendarDate;
  return filters;
}

function select(name: FilterField, label: string, all: string, options: readonly [string, string][]): string {
  const choices = options.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join("");
  return `<label>${label}<select name="${name}"><option value="">${all}</option>${choices}</select></label>`;
}

/** The filter form, with every choice present in the data. */
export function renderFilterForm(options: ReportFilterOptions): string {
  const dateBounds = `${options.firstDate ? ` min="${options.firstDate}"` : ""}${options.lastDate ? ` max="${options.lastDate}"` : ""}`;
  return [
    "<h2>Filters</h2>",
    select("customerId", "Customer", "All customers", options.customers.map((c) => [c.id, `${c.label} · ${c.id}`])),
    select("productId", "Product", "All products", options.products.map((p) => [p.id, `${p.label} · ${p.id}`])),
    select("sellerName", "Seller", "All sellers", options.sellers.map((name) => [name, name])),
    select("businessUnit", "Business unit", "All units", options.businessUnits.map((unit) => [unit, BUSINESS_UNIT_LABELS[unit]])),
    `<label>From<input type="date" name="from"${dateBounds}></label>`,
    `<label>To<input type="date" name="to"${dateBounds}></label>`,
    '<button type="submit">Apply filters</button>',
    '<button type="button" class="secondary" id="clear">Clear filters</button>',
  ].join("");
}

function totalsList(entries: [string, string][]): string {
  return `<dl class="totals">${entries.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function check(ok: boolean, good: string, bad: string): string {
  return `<p class="check ${ok ? "ok" : "bad"}">${ok ? `✓ ${good}` : `✗ ${bad}`}</p>`;
}

function table(title: string, headings: string[], rows: string[][]): string {
  if (rows.length === 0) return `<div><h3>${title}</h3><p class="muted">Nothing matches.</p></div>`;
  const head = headings.map((heading, index) => `<th${index > 0 ? ' class="num"' : ""}>${heading}</th>`).join("");
  const body = rows
    .map((cells) => `<tr>${cells.map((cell, index) => `<td${index > 0 ? ' class="num"' : ""}>${cell}</td>`).join("")}</tr>`)
    .join("");
  return `<div><h3>${title}</h3><div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

function salesRows(rows: readonly ReportRow[], label: (key: string) => string): string[][] {
  return rows.map((row) => [
    escapeHtml(label(row.key)),
    integer.format(row.invoiceCount),
    integer.format(row.lineCount),
    formatBrlCents(row.salesCents),
  ]);
}

function renderSales(report: SalesReport): string {
  return [
    totalsList([
      ["Invoiced sales", formatBrlCents(report.totals.salesCents)],
      ["Distinct invoices", integer.format(report.totals.invoiceCount)],
      ["Invoice lines", integer.format(report.totals.lineCount)],
      ["Commission recorded", formatBrlCents(report.totals.commissionCents)],
    ]),
    `<p class="muted">${
      report.scope === "whole-invoices"
        ? "All filters apply to whole invoices: totals include every line of each matching invoice."
        : "The product filter selects individual lines: totals include only this product's lines, and an invoice counts if at least one of its lines matches. These are not whole-invoice totals."
    }</p>`,
    check(report.reconciled, "Month and business-unit breakdowns each sum exactly to the totals above.", "Breakdowns do not sum to the totals."),
    '<div class="breakdowns">',
    table("By billing month", ["Billing month", "Invoices", "Lines", "Invoiced sales"], salesRows(report.byMonth, (key) => key)),
    table(
      "By business unit",
      ["Business unit", "Invoices", "Lines", "Invoiced sales"],
      salesRows(report.byBusinessUnit, (key) => BUSINESS_UNIT_LABELS[key as BusinessUnit]),
    ),
    "</div>",
  ].join("");
}

function collectionsRows(rows: readonly CollectionsRow[], label: (key: string) => string): string[][] {
  return rows.map((row) => [
    escapeHtml(label(row.key)),
    integer.format(row.invoiceCount),
    integer.format(row.installmentCount),
    formatBrlCents(row.scheduledCents),
  ]);
}

function renderCollections(report: CollectionsReport): string {
  return [
    totalsList([
      ["Scheduled collections", formatBrlCents(report.totals.scheduledCents)],
      ["Installments", integer.format(report.totals.installmentCount)],
      ["Invoices", integer.format(report.totals.invoiceCount)],
    ]),
    '<p class="muted">Contractual installments from each invoice\'s payment schedule, not payments received. Filters select whole invoices; the period selects invoices by billing date, and their installments may fall due after it.</p>',
    check(
      report.reconciled,
      `The installments sum exactly to the invoiced sales of these invoices (${formatBrlCents(report.invoicedSalesCents)}), and both breakdowns sum to the totals.`,
      `The installments do not reconcile with the invoiced sales of these invoices (${formatBrlCents(report.invoicedSalesCents)}) or with the breakdowns.`,
    ),
    '<div class="breakdowns">',
    table(
      "By due month",
      ["Due month", "Invoices with an installment due", "Installments", "Scheduled"],
      collectionsRows(report.byDueMonth, (key) => key),
    ),
    table(
      "By payment schedule",
      ["Payment schedule", "Invoices", "Installments", "Scheduled"],
      collectionsRows(report.byPaymentSchedule, (key) => PAYMENT_SCHEDULE_LABELS[key as PaymentSchedule]),
    ),
    "</div>",
  ].join("");
}

/** Both report sections for one set of filters. */
export function renderResults(lines: readonly SalesLine[], filters: ReportFilters): string {
  const sales = buildSalesReport(lines, filters);
  const collections = buildCollectionsReport(lines, filters);
  return [
    '<section class="panel" aria-labelledby="sales-title"><h2 id="sales-title">Invoiced sales</h2>',
    sales.ok ? renderSales(sales.report) : `<p class="error">${escapeHtml(sales.message)}</p>`,
    "</section>",
    '<section class="panel" aria-labelledby="collections-title"><h2 id="collections-title">Scheduled collections</h2>',
    '<p class="muted">Same filters as the invoiced sales above.</p>',
    collections.ok
      ? renderCollections(collections.report)
      : `<p class="${collections.code === "FILTER_SELECTS_LINES" ? "muted" : "error"}">${escapeHtml(collections.message)}</p>`,
    "</section>",
  ].join("");
}
