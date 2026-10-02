/**
 * Invoiced-sales report over the stored feed data. It returns the same `SalesReport` shape and
 * follows the same rules as the pure `buildSalesReport`: filters select whole invoices except
 * the product filter, which selects lines; invoices are counted distinct; breakdowns must sum to
 * the totals. The tests compare both on the same data. One SQL statement computes the totals and
 * both breakdowns, so they come from one consistent snapshot.
 */
import type pg from "pg";
import type { CalendarDate } from "@/domain/sales-import/dates";
import type { BusinessUnit } from "@/domain/sales-import/types";
import {
  breakdownsReconcile,
  BUSINESS_UNIT_ORDER,
  normalizeReportFilters,
  type LabeledOption,
  type ReportRow,
  type ReportTotals,
  type SalesReportResult,
} from "@/domain/sales-report/report";
import { toSafeInteger } from "../db/pool";

type Queryable = Pick<pg.Pool, "query">;

/** Like `ReportFilters`, but the seller is chosen by ID: stored sellers are identified by ID. */
export interface StoredReportFilters {
  customerId?: string;
  productId?: string;
  sellerId?: string;
  businessUnit?: BusinessUnit;
  /** The customer's state (UF). */
  state?: string;
  /** Inclusive billing-date bounds (ISO). */
  from?: CalendarDate;
  to?: CalendarDate;
}

interface AggregateRow {
  level: number;
  month: string | null;
  business_unit: BusinessUnit | null;
  line_count: string;
  invoice_count: string;
  sales_cents: string;
  commission_cents: string;
}

/**
 * Every filter combined with AND; an unset filter is NULL and matches everything. Shared by the
 * report and the rankings, which alias invoice lines `l`, invoices `i` and customers `c`.
 */
export const FILTER_SQL = `($1::text IS NULL OR i.customer_id = $1)
    AND ($2::text IS NULL OR l.product_id = $2)
    AND ($3::text IS NULL OR i.seller_id = $3)
    AND ($4::text IS NULL OR i.business_unit = $4)
    AND ($5::text IS NULL OR c.state = $5)
    AND ($6::date IS NULL OR i.billing_date >= $6)
    AND ($7::date IS NULL OR i.billing_date <= $7)`;

/** The query parameters of `FILTER_SQL`, in order. */
export function filterParams(filters: StoredReportFilters): (string | null)[] {
  return [
    filters.customerId ?? null,
    filters.productId ?? null,
    filters.sellerId ?? null,
    filters.businessUnit ?? null,
    filters.state ?? null,
    filters.from ?? null,
    filters.to ?? null,
  ];
}

// GROUPING() bitmask: 3 = grand total, 1 = per month, 2 = per business unit.
const REPORT_SQL = `
  SELECT GROUPING(to_char(i.billing_date, 'YYYY-MM'), i.business_unit) AS level,
         to_char(i.billing_date, 'YYYY-MM') AS month,
         i.business_unit,
         count(*)::text AS line_count,
         count(DISTINCT l.invoice_number)::text AS invoice_count,
         coalesce(sum(l.line_amount_cents), 0)::text AS sales_cents,
         coalesce(sum(l.commission_amount_cents), 0)::text AS commission_cents
  FROM invoice_lines l
  JOIN invoices i ON i.invoice_number = l.invoice_number
  JOIN customers c ON c.customer_id = i.customer_id
  WHERE ${FILTER_SQL}
  GROUP BY GROUPING SETS ((), (to_char(i.billing_date, 'YYYY-MM')), (i.business_unit))`;

function totalsOf(row: AggregateRow): ReportTotals | null {
  const lineCount = toSafeInteger(row.line_count);
  const invoiceCount = toSafeInteger(row.invoice_count);
  const salesCents = toSafeInteger(row.sales_cents);
  const commissionCents = toSafeInteger(row.commission_cents);
  if (lineCount === null || invoiceCount === null || salesCents === null || commissionCents === null) return null;
  return { lineCount, invoiceCount, salesCents, commissionCents };
}

export async function buildStoredSalesReport(db: Queryable, rawFilters: StoredReportFilters): Promise<SalesReportResult> {
  const normalized = normalizeReportFilters(rawFilters);
  if (!normalized.ok) return normalized;
  const { filters } = normalized;
  const { rows } = await db.query<AggregateRow>(REPORT_SQL, filterParams(filters));

  let totals: ReportTotals | null = null;
  const byMonth: ReportRow[] = [];
  const byUnit = new Map<BusinessUnit, ReportRow<BusinessUnit>>();
  for (const row of rows) {
    const rowTotals = totalsOf(row);
    if (rowTotals === null) {
      return { ok: false, code: "TOTAL_OUT_OF_RANGE", message: "The selected total is too large to represent exactly in cents." };
    }
    if (row.level === 3) totals = rowTotals;
    else if (row.level === 1 && row.month !== null) byMonth.push({ key: row.month, ...rowTotals });
    else if (row.level === 2 && row.business_unit !== null) byUnit.set(row.business_unit, { key: row.business_unit, ...rowTotals });
  }
  if (totals === null) throw new Error("Report query returned no grand total");
  // An empty selection returns only the grand-total row, with zero counts.
  const months = byMonth.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byBusinessUnit = BUSINESS_UNIT_ORDER.flatMap((unit) => {
    const row = byUnit.get(unit);
    return row ? [row] : [];
  });
  return {
    ok: true,
    report: {
      totals,
      byMonth: months,
      byBusinessUnit,
      scope: filters.productId === undefined ? "whole-invoices" : "matching-lines",
      reconciled: breakdownsReconcile(totals, months, byBusinessUnit),
    },
  };
}

export interface StoredFilterOptions {
  customers: LabeledOption[];
  products: LabeledOption[];
  sellers: LabeledOption[];
  businessUnits: BusinessUnit[];
  /** States (UF) of customers with invoices, sorted. */
  states: string[];
  firstDate: CalendarDate | null;
  lastDate: CalendarDate | null;
  appliedDeliveries: number;
  rejectedDeliveries: number;
}

const byLabel = (a: LabeledOption, b: LabeledOption) => a.label.localeCompare(b.label, "pt-BR") || a.id.localeCompare(b.id);

/** Filter choices and dataset context for the report page. */
export async function storedFilterOptions(db: Queryable): Promise<StoredFilterOptions> {
  const labeled = async (sql: string) =>
    (await db.query<{ id: string; label: string }>(sql)).rows.map(({ id, label }) => ({ id, label, otherNames: 0 })).sort(byLabel);
  const customers = await labeled("SELECT customer_id AS id, name AS label FROM customers");
  const products = await labeled("SELECT product_id AS id, name AS label FROM products");
  const sellers = await labeled(
    "SELECT seller_id AS id, name AS label FROM sellers s WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.seller_id = s.seller_id)",
  );
  const invoiceFacts = await db.query<{
    units: BusinessUnit[] | null;
    states: string[] | null;
    first_date: CalendarDate | null;
    last_date: CalendarDate | null;
  }>(
    `SELECT array_agg(DISTINCT i.business_unit) AS units, array_agg(DISTINCT c.state ORDER BY c.state) AS states,
            min(i.billing_date) AS first_date, max(i.billing_date) AS last_date
     FROM invoices i JOIN customers c ON c.customer_id = i.customer_id`,
  );
  const deliveryFacts = await db.query<{ applied: number; rejected: number }>(
    `SELECT count(*) FILTER (WHERE status = 'applied')::int AS applied,
            count(*) FILTER (WHERE status = 'rejected')::int AS rejected
     FROM feed_deliveries`,
  );
  const facts = invoiceFacts.rows[0]!;
  const units = new Set(facts.units ?? []);
  return {
    customers,
    products,
    sellers,
    businessUnits: BUSINESS_UNIT_ORDER.filter((unit) => units.has(unit)),
    states: facts.states ?? [],
    firstDate: facts.first_date,
    lastDate: facts.last_date,
    appliedDeliveries: deliveryFacts.rows[0]!.applied,
    rejectedDeliveries: deliveryFacts.rows[0]!.rejected,
  };
}
