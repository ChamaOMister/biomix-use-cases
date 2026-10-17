/**
 * Invoiced sales ranked by product, customer, seller and customer state, with the same filters and
 * rules as `buildSalesReport`: amounts are invoice-line amounts, so with a product filter only that
 * product's lines count. Each ranking's sales and lines sum to the report's totals; invoice counts
 * do not add up across products, because one invoice can hold several products. The stored
 * rankings return the same shape, and the tests compare both on the same data.
 *
 * Safe for the browser. Reachable from Node scripts through built-in type stripping, so relative
 * imports keep their `.ts` extension and type-only imports use `import type`.
 */
import { BUSINESS_UNIT_LABELS } from "../sales-feed/contract.ts";
import type { BusinessUnit, SalesLine } from "../sales-import/types.ts";
import { Bucket, lineMatcher, normalizeReportFilters, type ReportFilters } from "./report.ts";

export interface RankingRow {
  /** The value used to filter by this row: an ID, the seller's name here (the seller's ID when stored), or the state. */
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

/** Largest sales first, then by label, then by key, so equal amounts have a stable order. */
export function compareRankingRows(a: RankingRow, b: RankingRow): number {
  return b.salesCents - a.salesCents || a.label.localeCompare(b.label, "pt-BR") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

interface Group {
  label: string;
  detail: string | null;
  bucket: Bucket;
}

class Ranking {
  private readonly groups = new Map<string, Group>();

  /** Labels and details come from the first line seen for a key. Returns false on overflow. */
  add(key: string, line: SalesLine, label: string, detail: string | null): boolean {
    let group = this.groups.get(key);
    if (!group) {
      group = { label, detail, bucket: new Bucket() };
      this.groups.set(key, group);
    }
    return group.bucket.add(line);
  }

  rows(detail?: (key: string, group: Group) => string | null): RankingRow[] {
    return [...this.groups]
      .map(([key, group]) => {
        const { lineCount, invoiceCount, salesCents } = group.bucket.totals();
        return { key, label: group.label, detail: detail ? detail(key, group) : group.detail, lineCount, invoiceCount, salesCents };
      })
      .sort(compareRankingRows);
  }
}

export function buildSalesRankings(lines: readonly SalesLine[], rawFilters: ReportFilters): SalesRankingsResult {
  const normalized = normalizeReportFilters(rawFilters);
  if (!normalized.ok) return normalized;
  const matches = lineMatcher(normalized.filters);

  const products = new Ranking();
  const customers = new Ranking();
  const sellers = new Ranking();
  const states = new Ranking();
  // A seller's detail is its business unit, shown only when all its selected lines share one.
  const sellerUnits = new Map<string, Set<BusinessUnit>>();
  for (const line of lines) {
    if (!matches(line)) continue;
    const location = line.customerCity !== null && line.customerState !== null ? `${line.customerCity}, ${line.customerState}` : null;
    const units = sellerUnits.get(line.sellerName) ?? new Set<BusinessUnit>();
    sellerUnits.set(line.sellerName, units);
    units.add(line.businessUnit);
    const added =
      products.add(line.productId, line, line.productName, line.productCategory) &&
      customers.add(line.customerId, line, line.customerName, location) &&
      sellers.add(line.sellerName, line, line.sellerName, null) &&
      // Lines without a customer state are left out of the state ranking.
      (line.customerState === null || states.add(line.customerState, line, line.customerState, null));
    if (!added) return { ok: false, code: "TOTAL_OUT_OF_RANGE", message: "The selected total is too large to represent exactly in cents." };
  }
  return {
    ok: true,
    rankings: {
      byProduct: products.rows(),
      byCustomer: customers.rows(),
      bySeller: sellers.rows((key) => {
        const units = [...sellerUnits.get(key)!];
        return units.length === 1 ? BUSINESS_UNIT_LABELS[units[0]!] : null;
      }),
      byState: states.rows(),
    },
  };
}
