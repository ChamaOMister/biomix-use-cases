/**
 * Scheduled-collections report over the stored installments. It returns the same
 * `CollectionsReport` shape and follows the same rules as the pure `buildCollectionsReport`:
 * filters select whole invoices by invoice attributes, and a product filter is refused. The tests
 * compare both on the same data.
 *
 * One SQL statement reads the selected invoices once and computes the installment totals, both
 * breakdowns, and the invoiced sales of the same invoices from their lines. The sales come from
 * `invoice_lines`, independently of the stored installments, so the reconciliation catches
 * missing or stale installments.
 */
import type pg from "pg";
import {
  collectionsReconcile,
  FILTER_SELECTS_LINES_MESSAGE,
  PAYMENT_SCHEDULE_ORDER,
  type CollectionsReportResult,
  type CollectionsRow,
  type CollectionsTotals,
} from "@/domain/collections/report";
import type { PaymentSchedule } from "@/domain/sales-import/types";
import { normalizeReportFilters } from "@/domain/sales-report/report";
import { toSafeInteger } from "../db/pool";
import type { StoredReportFilters } from "../sales-report/stored-report";

type Queryable = Pick<pg.Pool, "query">;

interface AggregateRow {
  level: number;
  month: string | null;
  payment_schedule: PaymentSchedule | null;
  invoice_count: string;
  installment_count: string;
  scheduled_cents: string;
  invoiced_sales_cents: string;
}

// GROUPING() bitmask: 3 = grand total, 1 = per due month, 2 = per payment schedule. The left join
// keeps every selected invoice, so the grand total counts them all even if one had no installments.
const COLLECTIONS_SQL = `
  WITH selected AS MATERIALIZED (
    SELECT i.invoice_number, i.payment_schedule
    FROM invoices i
    JOIN customers c ON c.customer_id = i.customer_id
    WHERE ($1::text IS NULL OR i.customer_id = $1)
      AND ($2::text IS NULL OR i.seller_id = $2)
      AND ($3::text IS NULL OR i.business_unit = $3)
      AND ($4::text IS NULL OR c.state = $4)
      AND ($5::date IS NULL OR i.billing_date >= $5)
      AND ($6::date IS NULL OR i.billing_date <= $6)
  )
  SELECT GROUPING(to_char(i.due_date, 'YYYY-MM'), s.payment_schedule) AS level,
         to_char(i.due_date, 'YYYY-MM') AS month,
         s.payment_schedule,
         count(DISTINCT s.invoice_number)::text AS invoice_count,
         count(i.invoice_number)::text AS installment_count,
         coalesce(sum(i.amount_cents), 0)::text AS scheduled_cents,
         (SELECT coalesce(sum(l.line_amount_cents), 0)
          FROM selected ss JOIN invoice_lines l ON l.invoice_number = ss.invoice_number)::text AS invoiced_sales_cents
  FROM selected s
  LEFT JOIN scheduled_installments i ON i.invoice_number = s.invoice_number
  GROUP BY GROUPING SETS ((), (to_char(i.due_date, 'YYYY-MM')), (s.payment_schedule))`;

function totalsOf(row: AggregateRow): CollectionsTotals | null {
  const invoiceCount = toSafeInteger(row.invoice_count);
  const installmentCount = toSafeInteger(row.installment_count);
  const scheduledCents = toSafeInteger(row.scheduled_cents);
  if (invoiceCount === null || installmentCount === null || scheduledCents === null) return null;
  return { invoiceCount, installmentCount, scheduledCents };
}

const TOTAL_OUT_OF_RANGE = {
  ok: false,
  code: "TOTAL_OUT_OF_RANGE",
  message: "The selected total is too large to represent exactly in cents.",
} as const;

export async function buildStoredCollectionsReport(
  db: Queryable,
  rawFilters: StoredReportFilters,
): Promise<CollectionsReportResult> {
  const normalized = normalizeReportFilters(rawFilters);
  if (!normalized.ok) return normalized;
  const { filters } = normalized;
  if (filters.productId !== undefined) return { ok: false, code: "FILTER_SELECTS_LINES", message: FILTER_SELECTS_LINES_MESSAGE };

  const { rows } = await db.query<AggregateRow>(COLLECTIONS_SQL, [
    filters.customerId ?? null,
    filters.sellerId ?? null,
    filters.businessUnit ?? null,
    filters.state ?? null,
    filters.from ?? null,
    filters.to ?? null,
  ]);

  let totals: CollectionsTotals | null = null;
  let invoicedSalesCents: number | null = null;
  const byDueMonth: CollectionsRow[] = [];
  const bySchedule = new Map<PaymentSchedule, CollectionsRow<PaymentSchedule>>();
  for (const row of rows) {
    const rowTotals = totalsOf(row);
    if (rowTotals === null) return TOTAL_OUT_OF_RANGE;
    if (row.level === 3) {
      totals = rowTotals;
      invoicedSalesCents = toSafeInteger(row.invoiced_sales_cents);
      if (invoicedSalesCents === null) return TOTAL_OUT_OF_RANGE;
    } else if (row.level === 1 && row.month !== null) {
      byDueMonth.push({ key: row.month, ...rowTotals });
    } else if (row.level === 2 && row.payment_schedule !== null) {
      bySchedule.set(row.payment_schedule, { key: row.payment_schedule, ...rowTotals });
    }
    // A selected invoice without installments (only possible if storage is inconsistent) gives a
    // due-month row with a null month; it is left out, so the reconciliation fails visibly.
  }
  if (totals === null || invoicedSalesCents === null) throw new Error("Collections query returned no grand total");
  const months = byDueMonth.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const byPaymentSchedule = PAYMENT_SCHEDULE_ORDER.flatMap((schedule) => {
    const row = bySchedule.get(schedule);
    return row ? [row] : [];
  });
  return {
    ok: true,
    report: {
      totals,
      byDueMonth: months,
      byPaymentSchedule,
      invoicedSalesCents,
      reconciled: collectionsReconcile(totals, months, byPaymentSchedule, invoicedSalesCents),
    },
  };
}
