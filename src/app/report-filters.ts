// Shared by the server page and the client filter bar: the report filters as URL search params.
import type { StoredReportFilters } from "@/server/sales-report/stored-report";

/** URL parameter names, in the order they appear in the filter bar. */
export const FILTER_KEYS = ["customerId", "productId", "sellerId", "state", "businessUnit", "from", "to"] as const satisfies readonly (keyof StoredReportFilters)[];

export type FilterKey = (typeof FILTER_KEYS)[number];
export type FilterValues = Partial<Record<FilterKey, string>>;

/** The dashboard URL for these filters; empty values are left out, so the URL stays readable. */
export function filtersHref(filters: FilterValues): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** The URL with one filter set, or removed if it already has that value (a toggle). */
export function toggleFilterHref(filters: FilterValues, key: FilterKey, value: string): string {
  return filtersHref({ ...filters, [key]: filters[key] === value ? undefined : value });
}

