// No "use client": renders on the server; kept free of data access so other pages can reuse it.
import type { CollectionsReport, CollectionsRow } from "@/domain/collections/report";
import { PAYMENT_SCHEDULE_LABELS } from "@/domain/sales-feed/contract";
import type { PaymentSchedule } from "@/domain/sales-import/types";
import { formatBrlCents } from "@/domain/sales-report/format";
import { integer } from "./sales-report-view";

/** Totals, reconciliation check and breakdowns of one scheduled-collections report. */
export function CollectionsView({ report }: { report: CollectionsReport }) {
  return (
    <>
      <dl className="totals">
        <div><dt>Scheduled collections</dt><dd>{formatBrlCents(report.totals.scheduledCents)}</dd></div>
        <div><dt>Installments</dt><dd>{integer.format(report.totals.installmentCount)}</dd></div>
        <div><dt>Invoices</dt><dd>{integer.format(report.totals.invoiceCount)}</dd></div>
      </dl>
      <p className="muted">
        Contractual installments from each invoice&apos;s payment schedule, not payments received. Filters select whole
        invoices; the period selects invoices by billing date, and their installments may fall due after it.
      </p>
      <p className={report.reconciled ? "check ok" : "check bad"}>
        {report.reconciled
          ? `✓ The installments sum exactly to the invoiced sales of these invoices (${formatBrlCents(report.invoicedSalesCents)}), and both breakdowns sum to the totals.`
          : `✗ The installments do not reconcile with the invoiced sales of these invoices (${formatBrlCents(report.invoicedSalesCents)}) or with the breakdowns.`}
      </p>
      <div className="breakdowns">
        <Breakdown
          title="By due month"
          rows={report.byDueMonth}
          label={(key) => key}
          invoicesHeading="Invoices with an installment due"
        />
        <Breakdown
          title="By payment schedule"
          rows={report.byPaymentSchedule}
          label={(key) => PAYMENT_SCHEDULE_LABELS[key as PaymentSchedule]}
          invoicesHeading="Invoices"
        />
      </div>
    </>
  );
}

function Breakdown({
  title,
  rows,
  label,
  invoicesHeading,
}: {
  title: string;
  rows: CollectionsRow[];
  label: (key: string) => string;
  invoicesHeading: string;
}) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">No installments.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{title.replace(/^By /, "")}</th>
                <th className="num">{invoicesHeading}</th>
                <th className="num">Installments</th>
                <th className="num">Scheduled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{label(row.key)}</td>
                  <td className="num">{integer.format(row.invoiceCount)}</td>
                  <td className="num">{integer.format(row.installmentCount)}</td>
                  <td className="num">{formatBrlCents(row.scheduledCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
