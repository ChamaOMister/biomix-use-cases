// Server component: queries Postgres at request time. Filters travel in the URL, so a filtered view
// can be reloaded or shared. Every filter combines with the others (AND).
import Link from "next/link";
import type { CollectionsReport, CollectionsReportResult } from "@/domain/collections/report";
import { PAYMENT_SCHEDULE_LABELS } from "@/domain/sales-feed/contract";
import type { CalendarDate } from "@/domain/sales-import/dates";
import type { BusinessUnit } from "@/domain/sales-import/types";
import { formatBrlCents } from "@/domain/sales-report/format";
import type { SalesReport, SalesReportResult } from "@/domain/sales-report/report";
import { buildStoredCollectionsReport } from "@/server/collections/stored-collections";
import { databaseErrorDiagnostics, DatabaseNotConfiguredError, getPool } from "@/server/db/pool";
import { buildStoredRankings, type RankingRow, type SalesRankings, type SalesRankingsResult } from "@/server/sales-report/stored-rankings";
import {
  buildStoredSalesReport,
  storedFilterOptions,
  type StoredFilterOptions,
  type StoredReportFilters,
} from "@/server/sales-report/stored-report";
import { CollectionsView } from "./collections-view";
import { BarList, ColumnChart, formatMonth, initials, RankList } from "./dashboard-charts";
import { FilterBar } from "./filter-bar";
import { stateLabel, toggleFilterHref, type FilterKey, type FilterValues } from "./report-filters";
import { BUSINESS_UNIT_NAMES, integer, SalesBreakdowns } from "./sales-report-view";

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
  const state = first(params.state);
  const from = first(params.from);
  const to = first(params.to);
  if (customerId) filters.customerId = customerId;
  if (productId) filters.productId = productId;
  if (sellerId) filters.sellerId = sellerId;
  if (state) filters.state = state;
  if (unit === "AGRO" || unit === "HOME_GARDEN") filters.businessUnit = unit satisfies BusinessUnit;
  if (from) filters.from = from as CalendarDate;
  if (to) filters.to = to as CalendarDate;
  return filters;
}

type Loaded =
  | {
      ok: true;
      options: StoredFilterOptions;
      report: SalesReportResult;
      collections: CollectionsReportResult;
      rankings: SalesRankingsResult;
    }
  | { ok: false; message: string };

async function load(filters: StoredReportFilters): Promise<Loaded> {
  try {
    const pool = getPool();
    const [options, report, collections, rankings] = await Promise.all([
      storedFilterOptions(pool),
      buildStoredSalesReport(pool, filters),
      buildStoredCollectionsReport(pool, filters),
      buildStoredRankings(pool, filters),
    ]);
    return { ok: true, options, report, collections, rankings };
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

/** The dashboard: filters, indicators, charts, rankings and scheduled collections. */
export async function StoredSalesReport({ filters }: { filters: StoredReportFilters }) {
  const loaded = await load(filters);
  if (!loaded.ok) {
    return (
      <>
        <Intro />
        <p className="card panel error">{loaded.message}</p>
      </>
    );
  }
  const { options } = loaded;
  if (options.appliedDeliveries === 0) {
    return (
      <>
        <Intro />
        <p className="card panel">
          No deliveries have been applied yet. Generate the synthetic feed and send it to{" "}
          <code>POST /api/sales-feed/deliveries</code> (see docs/database.md).
        </p>
      </>
    );
  }
  const values = filters as FilterValues;
  return (
    <>
      <Intro options={options} />
      {/* key: the filter fields take the URL's values again after each navigation. */}
      <FilterBar key={JSON.stringify(filters)} filters={values} options={options} />
      {!loaded.report.ok ? (
        <p className="card panel error">{loaded.report.message}</p>
      ) : (
        <SalesSections
          report={loaded.report.report}
          rankings={loaded.rankings.ok ? loaded.rankings.rankings : null}
          filters={values}
        />
      )}
      <section id="collections" aria-labelledby="collections-title">
        <SectionTitle id="collections-title" title="Scheduled collections" subtitle="Contractual installments of the selected invoices, by due month. Not payments received." />
        {loaded.collections.ok ? (
          <CollectionsSection report={loaded.collections.report} />
        ) : (
          <p className={`card panel ${loaded.collections.code === "FILTER_SELECTS_LINES" ? "" : "error"}`}>{loaded.collections.message}</p>
        )}
      </section>
    </>
  );
}

function Intro({ options }: { options?: StoredFilterOptions }) {
  return (
    <section className="intro" id="overview" aria-labelledby="title">
      <div>
        <p className="eyebrow">Sales intelligence</p>
        <h1 id="title">Sales dashboard</h1>
        <p>Invoiced sales and scheduled collections from the clean sales feed. Combine any filters to focus on a product, seller, state or period.</p>
      </div>
      {options ? (
        <p className="intro-facts">
          <b>{integer.format(options.appliedDeliveries)}</b> deliveries applied
          {options.rejectedDeliveries > 0 ? <> · <b>{integer.format(options.rejectedDeliveries)}</b> rejected</> : null}
          {options.firstDate && options.lastDate ? <><br />Billing dates {options.firstDate} to {options.lastDate}</> : null}
        </p>
      ) : null}
    </section>
  );
}

function SectionTitle({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
  return (
    <div className="section-title">
      <h2 id={id}>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function Kpi({ label, value, foot, icon }: { label: string; value: string; foot: string; icon: string }) {
  return (
    <article className="card kpi">
      <div className="kpi-head">{label}<span className="kpi-icon" aria-hidden="true">{icon}</span></div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
    </article>
  );
}

function SalesSections({ report, rankings, filters }: { report: SalesReport; rankings: SalesRankings | null; filters: FilterValues }) {
  const { totals } = report;
  const rankRows = (rows: RankingRow[], key: FilterKey, limit: number) =>
    rows.slice(0, limit).map((row) => ({
      key: row.key,
      label: row.label,
      detail: row.detail,
      valueCents: row.salesCents,
      invoiceCount: row.invoiceCount,
      href: toggleFilterHref(filters, key, row.key),
      active: filters[key] === row.key,
    }));
  const barRows = (rows: RankingRow[], key: FilterKey, label: (row: RankingRow) => string = (row) => row.label) =>
    rows.map((row) => ({
      key: row.key,
      label: label(row),
      detail: row.detail,
      valueCents: row.salesCents,
      note: `${integer.format(row.invoiceCount)} invoices`,
      href: toggleFilterHref(filters, key, row.key),
      active: filters[key] === row.key,
    }));
  return (
    <>
      <section className="kpis" aria-label="Indicators">
        <Kpi label="Invoiced sales" icon="↗" value={formatBrlCents(totals.salesCents)} foot={report.scope === "whole-invoices" ? "Whole invoices in the selection" : "Only the selected product's lines"} />
        <Kpi label="Invoices" icon="▤" value={integer.format(totals.invoiceCount)} foot="Distinct invoice numbers" />
        <Kpi label="Invoice lines" icon="≡" value={integer.format(totals.lineCount)} foot="Product lines on those invoices" />
        <Kpi label="Commission recorded" icon="◎" value={formatBrlCents(totals.commissionCents)} foot="Sum of the lines' commission" />
      </section>
      <p className="scope-note">
        <span className={report.reconciled ? "check ok" : "check bad"}>
          {report.reconciled ? "✓ Month and business-unit breakdowns sum exactly to these totals." : "✗ Breakdowns do not sum to the totals."}
        </span>{" "}
        {report.scope === "whole-invoices"
          ? "All filters select whole invoices."
          : "The product filter selects individual lines: an invoice counts if at least one of its lines matches."}
      </p>

      <section aria-labelledby="trend-title">
        <SectionTitle id="trend-title" title="Sales over time" subtitle="Invoiced sales by billing month for the current selection" />
        <article className="card chart-card">
          <div className="chart-title">Invoiced sales by month</div>
          <div className="chart-sub">Hover or focus a column for its exact amount</div>
          <ColumnChart
            label="Invoiced sales by billing month"
            data={report.byMonth.map((row) => ({ key: row.key, valueCents: row.salesCents, note: `${integer.format(row.invoiceCount)} invoices` }))}
          />
          <details>
            <summary>Show as a table</summary>
            <SalesBreakdowns report={report} />
          </details>
        </article>
      </section>

      <section id="distribution" aria-labelledby="distribution-title">
        <SectionTitle id="distribution-title" title="Where the sales come from" subtitle="Click a name to add it as a filter; click it again to remove it" />
        {rankings === null ? (
          <p className="card panel error">The rankings could not be computed for this selection.</p>
        ) : (
          <>
            <div className="charts">
              <article className="card chart-card">
                <div className="chart-title">By seller</div>
                <div className="chart-sub">Invoiced sales and share of the selection</div>
                <BarList data={barRows(rankings.bySeller, "sellerId")} totalCents={totals.salesCents} />
              </article>
              <article className="card chart-card">
                <div className="chart-title">By state</div>
                <div className="chart-sub">Customer location</div>
                <BarList data={barRows(rankings.byState, "state", (row) => stateLabel(row.key))} totalCents={totals.salesCents} />
              </article>
              <article className="card chart-card">
                <div className="chart-title">By business unit</div>
                <div className="chart-sub">Agro and Home &amp; Garden</div>
                <BarList
                  data={report.byBusinessUnit.map((row) => ({
                    key: row.key,
                    label: BUSINESS_UNIT_NAMES[row.key],
                    valueCents: row.salesCents,
                    note: `${integer.format(row.invoiceCount)} invoices`,
                    href: toggleFilterHref(filters, "businessUnit", row.key),
                    active: filters.businessUnit === row.key,
                  }))}
                  totalCents={totals.salesCents}
                />
              </article>
            </div>
            <div className="charts two">
              <article className="card chart-card">
                <div className="chart-title">Top products</div>
                <div className="chart-sub">Ranked by invoiced sales of their lines</div>
                <RankList data={rankRows(rankings.byProduct, "productId", 8)} />
              </article>
              <article className="card chart-card">
                <div className="chart-title">Top customers</div>
                <div className="chart-sub">Ranked by invoiced sales</div>
                <RankList data={rankRows(rankings.byCustomer, "customerId", 8)} />
              </article>
            </div>
            <CustomerTable rows={rankings.byCustomer} filters={filters} totalCents={totals.salesCents} />
          </>
        )}
      </section>
    </>
  );
}

function CustomerTable({ rows, filters, totalCents }: { rows: RankingRow[]; filters: FilterValues; totalCents: number }) {
  return (
    <section id="customers" aria-labelledby="customers-title">
      <SectionTitle id="customers-title" title="Customers" subtitle="Every customer in the selection, largest first" />
      <article className="card table-card">
        <div className="table-head">
          <h3>Customers in the selection</h3>
          <span>{integer.format(rows.length)} {rows.length === 1 ? "customer" : "customers"}</span>
        </div>
        {rows.length === 0 ? (
          <p className="empty">No customer matches all the selected filters.</p>
        ) : (
          <div className="table-wrap scroll">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Location</th>
                  <th className="num">Invoices</th>
                  <th className="num">Lines</th>
                  <th className="num">Share</th>
                  <th className="num">Invoiced sales</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={filters.customerId === row.key ? "active" : undefined}>
                    <td>
                      <span className="customer-cell">
                        <span className="initial" aria-hidden="true">{initials(row.label)}</span>
                        <Link href={toggleFilterHref(filters, "customerId", row.key)} scroll={false}>{row.label}</Link>
                      </span>
                    </td>
                    <td>{row.detail}</td>
                    <td className="num">{integer.format(row.invoiceCount)}</td>
                    <td className="num">{integer.format(row.lineCount)}</td>
                    <td className="num">{totalCents > 0 ? `${(Math.round((row.salesCents * 1000) / totalCents) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%` : ""}</td>
                    <td className="num money">{formatBrlCents(row.salesCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function CollectionsSection({ report }: { report: CollectionsReport }) {
  return (
    <>
      <section className="kpis three" aria-label="Collections indicators">
        <Kpi label="Scheduled collections" icon="◷" value={formatBrlCents(report.totals.scheduledCents)} foot="Sum of the installments" />
        <Kpi label="Installments" icon="▦" value={integer.format(report.totals.installmentCount)} foot="From each invoice's payment schedule" />
        <Kpi label="Invoices" icon="▤" value={integer.format(report.totals.invoiceCount)} foot="Whole invoices in the selection" />
      </section>
      <div className="charts two">
        <article className="card chart-card">
          <div className="chart-title">Scheduled by due month</div>
          <div className="chart-sub">Installments may fall due after the selected period</div>
          <ColumnChart
            label="Scheduled collections by due month"
            data={report.byDueMonth.map((row) => ({ key: row.key, valueCents: row.scheduledCents, note: `${integer.format(row.installmentCount)} installments` }))}
          />
        </article>
        <article className="card chart-card">
          <div className="chart-title">By payment schedule</div>
          <div className="chart-sub">Scheduled amount and share</div>
          <BarList
            data={report.byPaymentSchedule.map((row) => ({
              key: row.key,
              label: PAYMENT_SCHEDULE_LABELS[row.key],
              valueCents: row.scheduledCents,
              note: `${integer.format(row.invoiceCount)} invoices`,
            }))}
            totalCents={report.totals.scheduledCents}
          />
        </article>
      </div>
      <details className="card details-card">
        <summary>Reconciliation and exact figures {report.byDueMonth.length > 0 ? `(${formatMonth(report.byDueMonth[0]!.key)} – ${formatMonth(report.byDueMonth.at(-1)!.key)})` : ""}</summary>
        <CollectionsView report={report} />
      </details>
    </>
  );
}
