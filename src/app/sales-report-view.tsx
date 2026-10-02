// No "use client": renders on the server for the stored report and in the browser for the XLSX check.
import type { BusinessUnit } from "@/domain/sales-import/types";
import { formatBrlCents } from "@/domain/sales-report/format";
import type { ReportRow, SalesReport } from "@/domain/sales-report/report";

export const BUSINESS_UNIT_NAMES: Record<BusinessUnit, string> = { AGRO: "Agro", HOME_GARDEN: "Home & Garden" };
export const integer = new Intl.NumberFormat("pt-BR");

/** Totals, filter scope, reconciliation check and breakdowns of one computed report. */
export function SalesReportView({ report }: { report: SalesReport }) {
  return (
    <>
      <dl className="totals">
        <div><dt>Invoiced sales</dt><dd>{formatBrlCents(report.totals.salesCents)}</dd></div>
        <div><dt>Distinct invoices</dt><dd>{integer.format(report.totals.invoiceCount)}</dd></div>
        <div><dt>Invoice lines</dt><dd>{integer.format(report.totals.lineCount)}</dd></div>
        <div><dt>Commission recorded</dt><dd>{formatBrlCents(report.totals.commissionCents)}</dd></div>
      </dl>
      <p className="muted">
        {report.scope === "whole-invoices"
          ? "All filters apply to whole invoices: totals include every line of each matching invoice."
          : "The product filter selects individual lines: totals include only this product's lines, and an invoice counts if at least one of its lines matches. These are not whole-invoice totals."}
      </p>
      <p className={report.reconciled ? "check ok" : "check bad"}>
        {report.reconciled ? "✓ Month and business-unit breakdowns each sum exactly to the totals above." : "✗ Breakdowns do not sum to the totals."}
      </p>
      <SalesBreakdowns report={report} />
    </>
  );
}

/** The month and business-unit breakdown tables alone. */
export function SalesBreakdowns({ report }: { report: SalesReport }) {
  return (
    <div className="breakdowns">
      <Breakdown title="By billing month" rows={report.byMonth} label={(key) => key} />
      <Breakdown title="By business unit" rows={report.byBusinessUnit} label={(key) => BUSINESS_UNIT_NAMES[key as BusinessUnit]} />
    </div>
  );
}

function Breakdown({ title, rows, label }: { title: string; rows: ReportRow[]; label: (key: string) => string }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">No matching lines.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{title.replace(/^By (.)/, (_, first: string) => first.toUpperCase())}</th><th className="num">Invoices</th><th className="num">Lines</th><th className="num">Invoiced sales</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{label(row.key)}</td>
                  <td className="num">{integer.format(row.invoiceCount)}</td>
                  <td className="num">{integer.format(row.lineCount)}</td>
                  <td className="num">{formatBrlCents(row.salesCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
