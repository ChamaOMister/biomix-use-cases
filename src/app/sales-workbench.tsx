"use client";

import { useMemo, useState, type FormEvent } from "react";
import { DEFAULT_INPUT_LIMITS } from "@/domain/sales-import/limits";
import type { TextDateFormat } from "@/domain/sales-import/dates";
import type { ImportIssue, SalesImportResult } from "@/domain/sales-import/types";
import { formatBrlCents } from "@/domain/sales-report/format";
import { buildSalesReport, reconcileDataset, reportFilterOptions, type ReportFilters } from "@/domain/sales-report/report";
import type { UploadResponseBody } from "@/server/sales-import-handler";
import { BUSINESS_UNIT_NAMES, integer, SalesReportView } from "./sales-report-view";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ISSUES_SHOWN = 200;

/** One upload: the file, how to read text dates, and a sheet the user picked (none = the only sheet). */
interface UploadRequest {
  file: File;
  textDateFormat: TextDateFormat;
  sheet?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "done"; request: UploadRequest; body: UploadResponseBody }
  | { kind: "failed"; message: string };

type AcceptedResult = Extract<SalesImportResult, { status: "accepted" }>;
type RejectedResult = Extract<SalesImportResult, { status: "rejected" }>;

export function SalesWorkbench() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function upload(request: UploadRequest) {
    const { file } = request;
    // Clears any previous report before the new result arrives.
    setPhase({ kind: "uploading", fileName: file.name });
    if (file.size > DEFAULT_INPUT_LIMITS.maxFileBytes) {
      setPhase({
        kind: "failed",
        message: `${file.name} is ${(file.size / 1048576).toFixed(1)} MiB; the limit is ${DEFAULT_INPUT_LIMITS.maxFileBytes / 1048576} MiB.`,
      });
      return;
    }
    // The ERP export has a single sheet: use it unless the user picked one from the list.
    const query = new URLSearchParams(request.sheet === undefined ? { singleSheet: "true" } : { sheet: request.sheet });
    query.set("textDateFormat", request.textDateFormat);
    try {
      const response = await fetch(`/api/sales-imports?${query}`, {
        method: "POST",
        headers: { "content-type": XLSX_CONTENT_TYPE },
        body: file,
      });
      setPhase({ kind: "done", request, body: (await response.json()) as UploadResponseBody });
    } catch {
      setPhase({
        kind: "failed",
        message: "The upload failed before the server returned a result. Check the connection and try again.",
      });
    }
  }

  return (
    <>
      <UploadForm busy={phase.kind === "uploading"} onSubmit={upload} />
      <div aria-live="polite">
        {phase.kind === "uploading" && <p className="panel">Validating {phase.fileName}…</p>}
        {phase.kind === "failed" && <p className="panel error">{phase.message}</p>}
        {phase.kind === "done" && phase.body.status === "error" && (
          <p className="panel error">{phase.body.message}</p>
        )}
        {phase.kind === "done" && phase.body.status === "rejected" && (
          <RejectedView
            fileName={phase.request.file.name}
            result={phase.body}
            onChooseSheet={(sheet) => upload({ ...phase.request, sheet })}
          />
        )}
        {phase.kind === "done" && phase.body.status === "accepted" && (
          // Keyed by import so filters reset for every new dataset.
          <AcceptedView key={phase.body.importId} fileName={phase.request.file.name} result={phase.body} />
        )}
      </div>
    </>
  );
}

function UploadForm(props: { busy: boolean; onSubmit: (request: UploadRequest) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [textDateFormat, setTextDateFormat] = useState<TextDateFormat>("YYYY-MM-DD");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (file) props.onSubmit({ file, textDateFormat });
  }

  return (
    <form className="upload panel" onSubmit={submit}>
      <h2>Import a sales workbook</h2>
      <div className="fields">
        <label>
          Workbook (.xlsx, up to {DEFAULT_INPUT_LIMITS.maxFileBytes / 1048576} MiB)
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Text dates (date cells are always read)
          <select value={textDateFormat} onChange={(event) => setTextDateFormat(event.target.value as TextDateFormat)}>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          </select>
        </label>
      </div>
      <button type="submit" disabled={props.busy || !file}>
        {props.busy ? "Validating…" : "Validate and report"}
      </button>
    </form>
  );
}

function SummaryLine({ result }: { result: SalesImportResult }) {
  const { summary } = result;
  return (
    <p className="muted">
      {summary.rowsValidated
        ? `${integer.format(summary.dataRows)} data rows read · ${integer.format(summary.validRows)} valid · ${integer.format(summary.rowsWithErrors)} with errors · ${integer.format(summary.blankRowsSkipped)} blank rows skipped`
        : "Rows were not validated because the file or sheet failed an earlier check."}
    </p>
  );
}

function IssueTable({ issues }: { issues: ImportIssue[] }) {
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Severity</th><th>Where</th><th>Column</th><th>Problem</th><th>How to fix</th></tr>
          </thead>
          <tbody>
            {shown.map((issue, index) => (
              <tr key={index} className={issue.severity}>
                <td>{issue.severity}<br /><code>{issue.code}</code></td>
                <td>{[issue.sheet, issue.cell ?? (issue.row !== null ? `row ${issue.row}` : null)].filter(Boolean).join(" · ") || "workbook"}</td>
                <td>{issue.column ?? "—"}</td>
                <td>{issue.message}{issue.relatedRows?.length ? ` (see row ${issue.relatedRows.join(", ")})` : ""}</td>
                <td>{issue.suggestion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issues.length > shown.length && (
        <p className="muted">Showing the first {MAX_ISSUES_SHOWN} of {integer.format(issues.length)} issues.</p>
      )}
    </>
  );
}

function RejectedView({
  fileName,
  result,
  onChooseSheet,
}: {
  fileName: string;
  result: RejectedResult;
  onChooseSheet: (sheet: string) => void;
}) {
  const errors = result.issues.filter((issue) => issue.severity === "error").length;
  if (result.sheetNames && result.sheetNames.length > 0) {
    return (
      <section className="panel" aria-labelledby="choose-sheet-title">
        <h2 id="choose-sheet-title">Which sheet holds the sales rows?</h2>
        <p>
          {fileName} has {integer.format(result.sheetNames.length)} sheets. The sales export has one; choose the sheet
          with the sales lines. Other sheets are never imported.
        </p>
        <div className="sheet-choices">
          {result.sheetNames.map((name) => (
            <button key={name} type="button" className="secondary" onClick={() => onChooseSheet(name)}>
              {name}
            </button>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="panel rejected" aria-labelledby="rejected-title">
      <h2 id="rejected-title">Import rejected: no report produced</h2>
      <p>
        {fileName} has {integer.format(errors)} blocking {errors === 1 ? "issue" : "issues"}. No rows were loaded, so no
        partial totals are shown. Correct the source and upload it again.
      </p>
      <SummaryLine result={result} />
      <IssueTable issues={result.issues} />
    </section>
  );
}

function AcceptedView({ fileName, result }: { fileName: string; result: AcceptedResult }) {
  const [filters, setFilters] = useState<ReportFilters>({});
  const options = useMemo(() => reportFilterOptions(result.lines), [result.lines]);
  const reconciliation = useMemo(() => reconcileDataset(result.lines, result.invoices), [result]);
  const report = useMemo(() => buildSalesReport(result.lines, filters), [result.lines, filters]);
  const set = (key: keyof ReportFilters) => (value: string) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <section className="panel" aria-labelledby="accepted-title">
      <h2 id="accepted-title">Invoiced sales: {fileName}</h2>
      <SummaryLine result={result} />
      <p className={reconciliation.matches ? "check ok" : "check bad"}>
        {reconciliation.matches ? "✓" : "✗"} Source reconciliation:{" "}
        {integer.format(reconciliation.lineCount)} lines totalling{" "}
        {reconciliation.lineSalesCents === null ? "an out-of-range amount" : formatBrlCents(reconciliation.lineSalesCents)} ·{" "}
        {integer.format(reconciliation.invoiceCount)} invoices totalling{" "}
        {reconciliation.invoiceSalesCents === null ? "an out-of-range amount" : formatBrlCents(reconciliation.invoiceSalesCents)}
        {reconciliation.matches ? " (match)" : " (MISMATCH)"}
      </p>
      {result.issues.length > 0 && (
        <details>
          <summary>{integer.format(result.issues.length)} warnings (not blocking)</summary>
          <IssueTable issues={result.issues} />
        </details>
      )}

      <form className="filters" onSubmit={(event) => event.preventDefault()}>
        <h3>Filters</h3>
        <label>
          Customer
          <select value={filters.customerId ?? ""} onChange={(event) => set("customerId")(event.target.value)}>
            <option value="">All customers</option>
            {options.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.label}{customer.otherNames ? ` (+${customer.otherNames} other name${customer.otherNames > 1 ? "s" : ""})` : ""} · {customer.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Product
          <select value={filters.productId ?? ""} onChange={(event) => set("productId")(event.target.value)}>
            <option value="">All products</option>
            {options.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.label}{product.otherNames ? ` (+${product.otherNames} other name${product.otherNames > 1 ? "s" : ""})` : ""} · {product.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Seller
          <select value={filters.sellerName ?? ""} onChange={(event) => set("sellerName")(event.target.value)}>
            <option value="">All sellers</option>
            {options.sellers.map((seller) => <option key={seller} value={seller}>{seller}</option>)}
          </select>
        </label>
        <label>
          Business unit
          <select value={filters.businessUnit ?? ""} onChange={(event) => set("businessUnit")(event.target.value)}>
            <option value="">All units</option>
            {options.businessUnits.map((unit) => <option key={unit} value={unit}>{BUSINESS_UNIT_NAMES[unit]}</option>)}
          </select>
        </label>
        <label>
          From
          <input type="date" value={filters.from ?? ""} min={options.firstDate ?? undefined} max={options.lastDate ?? undefined} onChange={(event) => set("from")(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={filters.to ?? ""} min={options.firstDate ?? undefined} max={options.lastDate ?? undefined} onChange={(event) => set("to")(event.target.value)} />
        </label>
        <button type="button" className="secondary" onClick={() => setFilters({})}>Clear filters</button>
      </form>

      {!report.ok ? <p className="panel error">{report.message}</p> : <SalesReportView report={report.report} />}
    </section>
  );
}
