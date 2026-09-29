// Server component: queries Postgres at request time. Filters travel in the URL (a GET form), so a
// filtered view can be reloaded or shared and needs no client-side JavaScript.
import Link from "next/link";
import type { CalendarDate } from "@/domain/sales-import/dates";
import type { BusinessUnit } from "@/domain/sales-import/types";
import { databaseErrorDiagnostics, DatabaseNotConfiguredError, getPool } from "@/server/db/pool";
import {
  buildStoredSalesReport,
  storedFilterOptions,
  type StoredFilterOptions,
  type StoredReportFilters,
} from "@/server/sales-report/stored-report";
import type { SalesReportResult } from "@/domain/sales-report/report";
import { BUSINESS_UNIT_NAMES, integer, SalesReportView } from "./sales-report-view";

export type SearchParams = Record<string, string | string[] | undefined>;

const UNDEFINED_TABLE = "42P01";

function first(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text === undefined || text === "" ? undefined : text;
}

/** Reads the report filters from the URL; unknown business units are ignored. */
export function filtersFromSearchParams(params: SearchParams): StoredReportFilters {
  const unit = first(params.businessUnit);
  const filters: StoredReportFilters = {};
  const customerId = first(params.customerId);
  const productId = first(params.productId);
  const sellerId = first(params.sellerId);
  const from = first(params.from);
  const to = first(params.to);
  if (customerId) filters.customerId = customerId;
  if (productId) filters.productId = productId;
  if (sellerId) filters.sellerId = sellerId;
  if (unit === "AGRO" || unit === "HOME_GARDEN") filters.businessUnit = unit satisfies BusinessUnit;
  if (from) filters.from = from as CalendarDate;
  if (to) filters.to = to as CalendarDate;
  return filters;
}

type Loaded =
  | { ok: true; options: StoredFilterOptions; report: SalesReportResult }
  | { ok: false; message: string };

async function load(filters: StoredReportFilters): Promise<Loaded> {
  try {
    const pool = getPool();
    const [options, report] = await Promise.all([storedFilterOptions(pool), buildStoredSalesReport(pool, filters)]);
    return { ok: true, options, report };
  } catch (error) {
    if (error instanceof DatabaseNotConfiguredError) {
      return { ok: false, message: "The database is not configured: DATABASE_URL is not set. See docs/database.md." };
    }
    const diagnostics = databaseErrorDiagnostics(error);
    console.error("stored-report-failed", JSON.stringify(diagnostics));
    return {
      ok: false,
      message:
        diagnostics.sqlState === UNDEFINED_TABLE
          ? "The database has no sales tables yet. Run npm run db:migrate, then send deliveries."
          : "The database could not be reached. Check that Postgres is running (see docs/database.md).",
    };
  }
}

export async function StoredSalesReport({ filters }: { filters: StoredReportFilters }) {
  const loaded = await load(filters);
  return (
    <section className="panel" aria-labelledby="stored-title">
      <h2 id="stored-title">Invoiced sales: stored feed data</h2>
      {!loaded.ok ? (
        <p className="panel error">{loaded.message}</p>
      ) : (
        <StoredReportBody filters={filters} options={loaded.options} report={loaded.report} />
      )}
    </section>
  );
}

function StoredReportBody({
  filters,
  options,
  report,
}: {
  filters: StoredReportFilters;
  options: StoredFilterOptions;
  report: SalesReportResult;
}) {
  if (options.appliedDeliveries === 0) {
    return (
      <p className="muted">
        No deliveries have been applied yet. Generate the synthetic feed and send it to{" "}
        <code>POST /api/sales-feed/deliveries</code> (see docs/database.md).
      </p>
    );
  }
  return (
    <>
      <p className="muted">
        {integer.format(options.appliedDeliveries)} deliveries applied
        {options.rejectedDeliveries > 0 ? ` · ${integer.format(options.rejectedDeliveries)} rejected (nothing stored from them)` : ""}
        {options.firstDate && options.lastDate ? ` · billing dates ${options.firstDate} to ${options.lastDate}` : ""}.
        Synthetic, fictional data.
      </p>
      {/* key: the uncontrolled inputs take the URL's values again after each navigation. */}
      <form className="filters" method="get" action="/" key={JSON.stringify(filters)}>
        <h3>Filters</h3>
        <label>
          Customer
          <select name="customerId" defaultValue={filters.customerId ?? ""}>
            <option value="">All customers</option>
            {options.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.label} · {customer.id}</option>
            ))}
          </select>
        </label>
        <label>
          Product
          <select name="productId" defaultValue={filters.productId ?? ""}>
            <option value="">All products</option>
            {options.products.map((product) => (
              <option key={product.id} value={product.id}>{product.label} · {product.id}</option>
            ))}
          </select>
        </label>
        <label>
          Seller
          <select name="sellerId" defaultValue={filters.sellerId ?? ""}>
            <option value="">All sellers</option>
            {options.sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.label}</option>)}
          </select>
        </label>
        <label>
          Business unit
          <select name="businessUnit" defaultValue={filters.businessUnit ?? ""}>
            <option value="">All units</option>
            {options.businessUnits.map((unit) => <option key={unit} value={unit}>{BUSINESS_UNIT_NAMES[unit]}</option>)}
          </select>
        </label>
        <label>
          From
          <input type="date" name="from" defaultValue={filters.from ?? ""} min={options.firstDate ?? undefined} max={options.lastDate ?? undefined} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={filters.to ?? ""} min={options.firstDate ?? undefined} max={options.lastDate ?? undefined} />
        </label>
        <button type="submit">Apply filters</button>
        <Link className="button secondary" href="/">Clear filters</Link>
      </form>
      {!report.ok ? <p className="panel error">{report.message}</p> : <SalesReportView report={report.report} />}
    </>
  );
}
