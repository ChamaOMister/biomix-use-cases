/**
 * Invoiced sales ranked by product, customer, seller and customer state, over the stored feed data
 * and with the same filters as the report. Rows carry names, not just IDs, for the dashboard.
 *
 * Amounts are invoice-line amounts, like the report: with a product filter, only that product's
 * lines count. Each ranking's sales and lines sum to the report's totals; invoice counts do not
 * add up across products, because one invoice can hold several products. One SQL statement
 * computes all four rankings, so they come from one consistent snapshot.
 */
import type pg from "pg";
import { BUSINESS_UNIT_LABELS } from "@/domain/sales-feed/contract";
import type { BusinessUnit } from "@/domain/sales-import/types";
import { normalizeReportFilters } from "@/domain/sales-report/report";
import { toSafeInteger } from "../db/pool";
import { FILTER_SQL, filterParams, type StoredReportFilters } from "./stored-report";

type Queryable = Pick<pg.Pool, "query">;

export interface RankingRow {
  /** The ID used to filter by this row (the state itself for states). */
  key: string;
  label: string;
  /** Short context shown under the label: category, location or business unit. */
  detail: string | null;
  lineCount: number;
  invoiceCount: number;
  salesCents: number;
}

export interface SalesRankings {
  /** Each sorted by sales, largest first, then by label. */
  byProduct: RankingRow[];
  byCustomer: RankingRow[];
  bySeller: RankingRow[];
  byState: RankingRow[];
}

export type SalesRankingsResult =
  | { ok: true; rankings: SalesRankings }
  | { ok: false; code: "FILTER_INVALID_PERIOD" | "TOTAL_OUT_OF_RANGE"; message: string };

interface AggregateRow {
  level: number;
  product_id: string | null;
  customer_id: string | null;
  seller_id: string | null;
  state: string | null;
  label: string;
  detail: string | null;
  line_count: string;
  invoice_count: string;
  sales_cents: string;
}

// GROUPING() bitmask over (product, customer, seller, state): the one zero bit names the dimension.
const LEVEL = { product: 7, customer: 11, seller: 13, state: 14 } as const;

const RANKINGS_SQL = `
  SELECT GROUPING(l.product_id, i.customer_id, i.seller_id, c.state) AS level,
         l.product_id, i.customer_id, i.seller_id, c.state,
         CASE GROUPING(l.product_id, i.customer_id, i.seller_id, c.state)
           WHEN ${LEVEL.product} THEN min(p.name)
           WHEN ${LEVEL.customer} THEN min(c.name)
           WHEN ${LEVEL.seller} THEN min(s.name)
           ELSE c.state
         END AS label,
         CASE GROUPING(l.product_id, i.customer_id, i.seller_id, c.state)
           WHEN ${LEVEL.product} THEN min(p.category)
           WHEN ${LEVEL.customer} THEN min(c.city) || ', ' || min(c.state)
           WHEN ${LEVEL.seller} THEN min(s.business_unit)
         END AS detail,
         count(*)::text AS line_count,
         count(DISTINCT l.invoice_number)::text AS invoice_count,
         sum(l.line_amount_cents)::text AS sales_cents
  FROM invoice_lines l
  JOIN invoices i ON i.invoice_number = l.invoice_number
  JOIN customers c ON c.customer_id = i.customer_id
  JOIN products p ON p.product_id = l.product_id
  JOIN sellers s ON s.seller_id = i.seller_id
  WHERE ${FILTER_SQL}
  GROUP BY GROUPING SETS ((l.product_id), (i.customer_id), (i.seller_id), (c.state))`;

const byRank = (a: RankingRow, b: RankingRow) =>
  b.salesCents - a.salesCents || a.label.localeCompare(b.label, "pt-BR") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export async function buildStoredRankings(db: Queryable, rawFilters: StoredReportFilters): Promise<SalesRankingsResult> {
  const normalized = normalizeReportFilters(rawFilters);
  if (!normalized.ok) return normalized;
  const { rows } = await db.query<AggregateRow>(RANKINGS_SQL, filterParams(normalized.filters));

  const rankings: SalesRankings = { byProduct: [], byCustomer: [], bySeller: [], byState: [] };
  for (const row of rows) {
    const lineCount = toSafeInteger(row.line_count);
    const invoiceCount = toSafeInteger(row.invoice_count);
    const salesCents = toSafeInteger(row.sales_cents);
    if (lineCount === null || invoiceCount === null || salesCents === null) {
      return { ok: false, code: "TOTAL_OUT_OF_RANGE", message: "The selected total is too large to represent exactly in cents." };
    }
    const totals = { label: row.label, lineCount, invoiceCount, salesCents };
    if (row.level === LEVEL.product && row.product_id !== null) {
      rankings.byProduct.push({ key: row.product_id, detail: row.detail, ...totals });
    } else if (row.level === LEVEL.customer && row.customer_id !== null) {
      rankings.byCustomer.push({ key: row.customer_id, detail: row.detail, ...totals });
    } else if (row.level === LEVEL.seller && row.seller_id !== null) {
      const unit = row.detail as BusinessUnit | null;
      rankings.bySeller.push({ key: row.seller_id, detail: unit ? BUSINESS_UNIT_LABELS[unit] : null, ...totals });
    } else if (row.level === LEVEL.state && row.state !== null) {
      rankings.byState.push({ key: row.state, detail: null, ...totals });
    }
  }
  for (const list of [rankings.byProduct, rankings.byCustomer, rankings.bySeller, rankings.byState]) list.sort(byRank);
  return { ok: true, rankings };
}
