/**
 * Invoiced-sales reporting over an accepted import. Pure and deterministic: callers pass the
 * lines of one accepted import; nothing is cached or shared between calls. Safe for the browser.
 *
 * Reachable from Node scripts (the report snapshot) through built-in type stripping, so relative
 * imports keep their `.ts` extension and type-only imports use `import type`.
 */
import { isValidCalendarDate, type CalendarDate } from "../sales-import/dates.ts";
import type { BusinessUnit, InvoiceGroup, SalesLine } from "../sales-import/types.ts";

export interface ReportFilters {
  customerId?: string;
  productId?: string;
  sellerName?: string;
  businessUnit?: BusinessUnit;
  /** Inclusive billing-date bounds (ISO). */
  from?: CalendarDate;
  to?: CalendarDate;
}

export interface ReportTotals {
  lineCount: number;
  /** Distinct invoice numbers among the matching lines. */
  invoiceCount: number;
  salesCents: number;
  commissionCents: number;
}

export interface ReportRow<K extends string = string> extends ReportTotals {
  key: K;
}

export interface SalesReport {
  totals: ReportTotals;
  /** Keyed `YYYY-MM` by billing date. */
  byMonth: ReportRow[];
  byBusinessUnit: ReportRow<BusinessUnit>[];
  /**
   * `whole-invoices`: every filter is an invoice attribute, so matched invoices are complete.
   * `matching-lines`: a product filter selects individual lines; amounts are those lines only,
   * and invoices are counted if at least one of their lines matches.
   */
  scope: "whole-invoices" | "matching-lines";
  /** Every breakdown sums exactly to `totals`. */
  reconciled: boolean;
}

export type SalesReportResult =
  | { ok: true; report: SalesReport }
  | { ok: false; code: "FILTER_INVALID_PERIOD" | "TOTAL_OUT_OF_RANGE"; message: string };

export const BUSINESS_UNIT_ORDER: readonly BusinessUnit[] = ["AGRO", "HOME_GARDEN"];

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match !== null && isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Adds exact integers; returns null once the result can no longer be represented exactly. */
function checkedAdd(a: number, b: number): number | null {
  const sum = a + b;
  return Number.isSafeInteger(sum) ? sum : null;
}

class Bucket {
  lineCount = 0;
  salesCents = 0;
  commissionCents = 0;
  private readonly invoices = new Set<string>();

  /** Returns false if a total would lose precision. */
  add(line: SalesLine): boolean {
    const sales = checkedAdd(this.salesCents, line.lineAmountCents);
    const commission = checkedAdd(this.commissionCents, line.commissionAmountCents);
    if (sales === null || commission === null) return false;
    this.salesCents = sales;
    this.commissionCents = commission;
    this.lineCount += 1;
    this.invoices.add(line.invoiceNumber);
    return true;
  }

  totals(): ReportTotals {
    return {
      lineCount: this.lineCount,
      invoiceCount: this.invoices.size,
      salesCents: this.salesCents,
      commissionCents: this.commissionCents,
    };
  }
}

function sumRows(rows: ReportRow[]): ReportTotals {
  return rows.reduce(
    (sum, row) => ({
      lineCount: sum.lineCount + row.lineCount,
      invoiceCount: sum.invoiceCount + row.invoiceCount,
      salesCents: sum.salesCents + row.salesCents,
      commissionCents: sum.commissionCents + row.commissionCents,
    }),
    { lineCount: 0, invoiceCount: 0, salesCents: 0, commissionCents: 0 },
  );
}

function sameTotals(a: ReportTotals, b: ReportTotals): boolean {
  return (
    a.lineCount === b.lineCount &&
    a.invoiceCount === b.invoiceCount &&
    a.salesCents === b.salesCents &&
    a.commissionCents === b.commissionCents
  );
}

export type FilterValidation<F> =
  | { ok: true; filters: F }
  | { ok: false; code: "FILTER_INVALID_PERIOD"; message: string };

/**
 * Drops empty filters (e.g. an unselected <select>) and checks the period. Shared with the
 * database-backed report so both apply the same rules.
 */
export function normalizeReportFilters<F extends { from?: CalendarDate; to?: CalendarDate }>(
  rawFilters: F,
): FilterValidation<F> {
  const filters = Object.fromEntries(
    Object.entries(rawFilters).filter(([, value]) => value !== undefined && value !== ""),
  ) as F;
  for (const bound of [filters.from, filters.to]) {
    if (bound !== undefined && !isCalendarDate(bound)) {
      return { ok: false, code: "FILTER_INVALID_PERIOD", message: "Period dates must be real dates in YYYY-MM-DD." };
    }
  }
  if (filters.from !== undefined && filters.to !== undefined && filters.from > filters.to) {
    return { ok: false, code: "FILTER_INVALID_PERIOD", message: "The period start is after its end." };
  }
  return { ok: true, filters };
}

/** True when the month and business-unit breakdowns each sum exactly to the totals. */
export function breakdownsReconcile(totals: ReportTotals, byMonth: ReportRow[], byBusinessUnit: ReportRow[]): boolean {
  return sameTotals(sumRows(byMonth), totals) && sameTotals(sumRows(byBusinessUnit), totals);
}

export function buildSalesReport(lines: readonly SalesLine[], rawFilters: ReportFilters): SalesReportResult {
  const normalized = normalizeReportFilters(rawFilters);
  if (!normalized.ok) return normalized;
  const { filters } = normalized;

  const matches = (line: SalesLine) =>
    (filters.customerId === undefined || line.customerId === filters.customerId) &&
    (filters.productId === undefined || line.productId === filters.productId) &&
    (filters.sellerName === undefined || line.sellerName === filters.sellerName) &&
    (filters.businessUnit === undefined || line.businessUnit === filters.businessUnit) &&
    (filters.from === undefined || line.billingDate >= filters.from) &&
    (filters.to === undefined || line.billingDate <= filters.to);

  const total = new Bucket();
  const months = new Map<string, Bucket>();
  const units = new Map<BusinessUnit, Bucket>();
  for (const line of lines) {
    if (!matches(line)) continue;
    const month = line.billingDate.slice(0, 7);
    const monthBucket = months.get(month) ?? new Bucket();
    months.set(month, monthBucket);
    const unitBucket = units.get(line.businessUnit) ?? new Bucket();
    units.set(line.businessUnit, unitBucket);
    if (!total.add(line) || !monthBucket.add(line) || !unitBucket.add(line)) {
      return {
        ok: false,
        code: "TOTAL_OUT_OF_RANGE",
        message: "The selected total is too large to represent exactly in cents.",
      };
    }
  }

  const totals = total.totals();
  const byMonth = [...months.keys()].sort().map((key) => ({ key, ...months.get(key)!.totals() }));
  const byBusinessUnit = BUSINESS_UNIT_ORDER.filter((unit) => units.has(unit)).map((key) => ({
    key,
    ...units.get(key)!.totals(),
  }));
  return {
    ok: true,
    report: {
      totals,
      byMonth,
      byBusinessUnit,
      scope: filters.productId === undefined ? "whole-invoices" : "matching-lines",
      reconciled: breakdownsReconcile(totals, byMonth, byBusinessUnit),
    },
  };
}

export interface LabeledOption {
  id: string;
  /** First name seen for this ID in the source. */
  label: string;
  /** Other names the source uses for the same ID (not validated by the importer). */
  otherNames: number;
}

export interface ReportFilterOptions {
  customers: LabeledOption[];
  products: LabeledOption[];
  sellers: string[];
  businessUnits: BusinessUnit[];
  firstDate: CalendarDate | null;
  lastDate: CalendarDate | null;
}

function labeled(entries: Map<string, { label: string; names: Set<string> }>): LabeledOption[] {
  return [...entries]
    .map(([id, { label, names }]) => ({ id, label, otherNames: names.size - 1 }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR") || a.id.localeCompare(b.id));
}

export function reportFilterOptions(lines: readonly SalesLine[]): ReportFilterOptions {
  const customers = new Map<string, { label: string; names: Set<string> }>();
  const products = new Map<string, { label: string; names: Set<string> }>();
  const sellers = new Set<string>();
  const units = new Set<BusinessUnit>();
  let firstDate: CalendarDate | null = null;
  let lastDate: CalendarDate | null = null;
  const note = (map: typeof customers, id: string, name: string) => {
    const entry = map.get(id);
    if (entry) entry.names.add(name);
    else map.set(id, { label: name, names: new Set([name]) });
  };
  for (const line of lines) {
    note(customers, line.customerId, line.customerName);
    note(products, line.productId, line.productName);
    sellers.add(line.sellerName);
    units.add(line.businessUnit);
    if (firstDate === null || line.billingDate < firstDate) firstDate = line.billingDate;
    if (lastDate === null || line.billingDate > lastDate) lastDate = line.billingDate;
  }
  return {
    customers: labeled(customers),
    products: labeled(products),
    sellers: [...sellers].sort((a, b) => a.localeCompare(b, "pt-BR")),
    businessUnits: BUSINESS_UNIT_ORDER.filter((unit) => units.has(unit)),
    firstDate,
    lastDate,
  };
}

export interface DatasetReconciliation {
  /** Sum of line amounts; null if it cannot be represented exactly. */
  lineSalesCents: number | null;
  /** Sum of the importer's invoice totals, computed separately during import. */
  invoiceSalesCents: number | null;
  lineCount: number;
  invoiceLineCount: number;
  distinctInvoiceNumbers: number;
  invoiceCount: number;
  matches: boolean;
}

/** Cross-checks the report's input lines against the importer's independently built invoices. */
export function reconcileDataset(
  lines: readonly SalesLine[],
  invoices: readonly InvoiceGroup[],
): DatasetReconciliation {
  let lineSalesCents: number | null = 0;
  for (const line of lines) lineSalesCents = lineSalesCents === null ? null : checkedAdd(lineSalesCents, line.lineAmountCents);
  let invoiceSalesCents: number | null = 0;
  let invoiceLineCount = 0;
  for (const invoice of invoices) {
    invoiceSalesCents = invoiceSalesCents === null ? null : checkedAdd(invoiceSalesCents, invoice.totalAmountCents);
    invoiceLineCount += invoice.lineIds.length;
  }
  const distinctInvoiceNumbers = new Set(lines.map((line) => line.invoiceNumber)).size;
  return {
    lineSalesCents,
    invoiceSalesCents,
    lineCount: lines.length,
    invoiceLineCount,
    distinctInvoiceNumbers,
    invoiceCount: invoices.length,
    matches:
      lineSalesCents !== null &&
      lineSalesCents === invoiceSalesCents &&
      lines.length === invoiceLineCount &&
      distinctInvoiceNumbers === invoices.length,
  };
}
