/**
 * Scheduled-collections report: the contractual installments of the selected invoices, by due
 * month and by payment term. Pure and deterministic, safe for the browser; it takes the same
 * lines and filters as `buildSalesReport`.
 *
 * Installments belong to whole invoices, so filters select whole invoices by invoice attributes:
 * customer, seller, business unit and billing period. The period selects invoices by billing
 * date; their installments may fall due after it. A product filter selects individual lines, and
 * an invoice's schedule is never recomputed from part of its lines, so with a product filter the
 * report is refused (`FILTER_SELECTS_LINES`) instead of showing a distorted schedule.
 */
import type { CalendarDate } from "../sales-import/dates";
import type { BusinessUnit, PaymentSchedule, SalesLine } from "../sales-import/types";
import { normalizeReportFilters, type ReportFilters } from "../sales-report/report";
import { scheduleInstallments } from "./schedule";

export interface CollectionsTotals {
  invoiceCount: number;
  installmentCount: number;
  scheduledCents: number;
}

export interface CollectionsRow<K extends string = string> extends CollectionsTotals {
  key: K;
}

export interface CollectionsReport {
  /** Selected invoices, their installments and the installments' sum. */
  totals: CollectionsTotals;
  /**
   * Keyed `YYYY-MM` by due date. `invoiceCount` counts invoices with an installment due that
   * month, so one invoice can appear in several months; installments and amounts add up.
   */
  byDueMonth: CollectionsRow[];
  byPaymentSchedule: CollectionsRow<PaymentSchedule>[];
  /** Invoiced sales of the same invoices, summed from their lines separately from the schedules. */
  invoicedSalesCents: number;
  /** Breakdowns sum to the totals, and the installments sum exactly to the invoiced sales. */
  reconciled: boolean;
}

export type CollectionsReportResult =
  | { ok: true; report: CollectionsReport }
  | { ok: false; code: "FILTER_INVALID_PERIOD" | "FILTER_SELECTS_LINES" | "TOTAL_OUT_OF_RANGE"; message: string };

export const PAYMENT_SCHEDULE_ORDER: readonly PaymentSchedule[] = [
  "UPFRONT",
  "NET_30",
  "INSTALLMENTS_30_60_90",
  "INSTALLMENTS_0_30_60_90",
];

export const FILTER_SELECTS_LINES_MESSAGE =
  "Scheduled collections belong to whole invoices. The product filter selects individual lines, so collections are not shown for it; clear the product filter to see them.";

const TOTAL_OUT_OF_RANGE = {
  ok: false,
  code: "TOTAL_OUT_OF_RANGE",
  message: "The selected total is too large to represent exactly in cents.",
} as const;

/** The invoice attributes the schedule and the filters use; every line of an invoice repeats them. */
interface InvoiceOfLines {
  invoiceNumber: string;
  billingDate: CalendarDate;
  customerId: string;
  sellerName: string;
  businessUnit: BusinessUnit;
  paymentSchedule: PaymentSchedule;
  lines: SalesLine[];
}

/** Groups lines into invoices once. Lines of one invoice must agree on its attributes. */
export function groupInvoices(lines: readonly SalesLine[]): InvoiceOfLines[] {
  const invoices = new Map<string, InvoiceOfLines>();
  for (const line of lines) {
    const invoice = invoices.get(line.invoiceNumber);
    if (!invoice) {
      const { invoiceNumber, billingDate, customerId, sellerName, businessUnit, paymentSchedule } = line;
      invoices.set(invoiceNumber, { invoiceNumber, billingDate, customerId, sellerName, businessUnit, paymentSchedule, lines: [line] });
      continue;
    }
    for (const field of ["billingDate", "customerId", "sellerName", "businessUnit", "paymentSchedule"] as const) {
      if (invoice[field] !== line[field]) throw new Error(`Invoice lines disagree on ${field}; accepted data never does`);
    }
    invoice.lines.push(line);
  }
  return [...invoices.values()];
}

class Totals {
  invoiceCount = 0;
  installmentCount = 0;
  scheduledCents = 0;

  /** Returns false if the amount would lose precision. */
  add(invoices: number, installments: number, cents: number): boolean {
    const scheduled = this.scheduledCents + cents;
    if (!Number.isSafeInteger(scheduled)) return false;
    this.scheduledCents = scheduled;
    this.invoiceCount += invoices;
    this.installmentCount += installments;
    return true;
  }

  get(): CollectionsTotals {
    return { invoiceCount: this.invoiceCount, installmentCount: this.installmentCount, scheduledCents: this.scheduledCents };
  }
}

function sumOf(rows: readonly CollectionsTotals[], field: keyof CollectionsTotals): number {
  return rows.reduce((sum, row) => sum + row[field], 0);
}

/**
 * True when both breakdowns sum to the totals and the installments equal the invoiced sales.
 * Due months are checked on installments and amounts only: an invoice spans several months.
 */
export function collectionsReconcile(
  totals: CollectionsTotals,
  byDueMonth: readonly CollectionsRow[],
  byPaymentSchedule: readonly CollectionsRow[],
  invoicedSalesCents: number,
): boolean {
  return (
    totals.scheduledCents === invoicedSalesCents &&
    sumOf(byDueMonth, "installmentCount") === totals.installmentCount &&
    sumOf(byDueMonth, "scheduledCents") === totals.scheduledCents &&
    sumOf(byPaymentSchedule, "invoiceCount") === totals.invoiceCount &&
    sumOf(byPaymentSchedule, "installmentCount") === totals.installmentCount &&
    sumOf(byPaymentSchedule, "scheduledCents") === totals.scheduledCents
  );
}

export function buildCollectionsReport(lines: readonly SalesLine[], rawFilters: ReportFilters): CollectionsReportResult {
  const normalized = normalizeReportFilters(rawFilters);
  if (!normalized.ok) return normalized;
  const { filters } = normalized;
  if (filters.productId !== undefined) return { ok: false, code: "FILTER_SELECTS_LINES", message: FILTER_SELECTS_LINES_MESSAGE };

  const matches = (invoice: InvoiceOfLines) =>
    (filters.customerId === undefined || invoice.customerId === filters.customerId) &&
    (filters.sellerName === undefined || invoice.sellerName === filters.sellerName) &&
    (filters.businessUnit === undefined || invoice.businessUnit === filters.businessUnit) &&
    (filters.from === undefined || invoice.billingDate >= filters.from) &&
    (filters.to === undefined || invoice.billingDate <= filters.to);

  const total = new Totals();
  const months = new Map<string, { totals: Totals; invoices: Set<string> }>();
  const schedules = new Map<PaymentSchedule, Totals>();
  let invoicedSalesCents = 0;
  for (const invoice of groupInvoices(lines)) {
    if (!matches(invoice)) continue;
    const scheduled = scheduleInstallments(invoice);
    if (!scheduled.ok) return TOTAL_OUT_OF_RANGE;
    const { installments } = scheduled;
    const invoiceCents = installments.reduce((sum, installment) => sum + installment.amountCents, 0);
    for (const line of invoice.lines) invoicedSalesCents += line.lineAmountCents;
    const schedule = schedules.get(invoice.paymentSchedule) ?? new Totals();
    schedules.set(invoice.paymentSchedule, schedule);
    if (
      !Number.isSafeInteger(invoicedSalesCents) ||
      !total.add(1, installments.length, invoiceCents) ||
      !schedule.add(1, installments.length, invoiceCents)
    ) {
      return TOTAL_OUT_OF_RANGE;
    }
    for (const installment of installments) {
      const key = installment.dueDate.slice(0, 7);
      const month = months.get(key) ?? { totals: new Totals(), invoices: new Set<string>() };
      months.set(key, month);
      month.invoices.add(invoice.invoiceNumber);
      if (!month.totals.add(0, 1, installment.amountCents)) return TOTAL_OUT_OF_RANGE;
    }
  }

  const totals = total.get();
  const byDueMonth = [...months.keys()].sort().map((key) => {
    const month = months.get(key)!;
    return { key, ...month.totals.get(), invoiceCount: month.invoices.size };
  });
  const byPaymentSchedule = PAYMENT_SCHEDULE_ORDER.filter((schedule) => schedules.has(schedule)).map((key) => ({
    key,
    ...schedules.get(key)!.get(),
  }));
  return {
    ok: true,
    report: {
      totals,
      byDueMonth,
      byPaymentSchedule,
      invoicedSalesCents,
      reconciled: collectionsReconcile(totals, byDueMonth, byPaymentSchedule, invoicedSalesCents),
    },
  };
}
