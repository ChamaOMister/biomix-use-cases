/**
 * Builds the downloadable report snapshot (decision 002, item 7): one self-contained HTML file with
 * the synthetic invoices as stored after replaying every delivery, and the application's pure report
 * and collections modules bundled by esbuild. It opens from disk without network access: a
 * Content-Security-Policy allows only the file's own script and style (by hash) and nothing else.
 *
 * It takes the deliveries only, never the evaluation answer key. The output is deterministic: the
 * same seed and code give the same bytes.
 *
 * Reachable from Node scripts through built-in type stripping, so relative imports keep their
 * `.ts` extension and type-only imports use `import type`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { BUSINESS_UNIT_LABELS, PAYMENT_SCHEDULE_LABELS } from "../domain/sales-feed/contract.ts";
import { SELLERS } from "../domain/sales-feed/reference-data.ts";
import type { BusinessUnit, PaymentSchedule } from "../domain/sales-import/types.ts";
import { formatBrlCents } from "../domain/sales-report/format.ts";
import { reportFilterOptions } from "../domain/sales-report/report.ts";
import { replayDeliveries, type SyntheticFeed } from "../synthetic-data/generate.ts";
import { expandSnapshotLines, snapshotTotals, type SnapshotData, type SnapshotInvoice } from "./data.ts";
import { renderFilterForm, renderResults } from "./render.ts";

/** What the snapshot is built from: the seed and its deliveries. Deliberately not the answer key. */
export type SnapshotSource = Pick<SyntheticFeed, "seed" | "deliveries" | "pendingDelivery">;

export const SNAPSHOT_FILE_NAME = "biomix-report-snapshot.html";

function invert<T extends string>(labels: Readonly<Record<T, string>>): Map<string, T> {
  return new Map((Object.entries(labels) as [T, string][]).map(([code, label]) => [label, code]));
}
const UNIT_BY_LABEL = invert<BusinessUnit>(BUSINESS_UNIT_LABELS);
const SCHEDULE_BY_LABEL = invert<PaymentSchedule>(PAYMENT_SCHEDULE_LABELS);

function code<T>(codes: Map<string, T>, label: string): T {
  const value = codes.get(label);
  if (value === undefined) throw new Error("Generated invoice has an unknown label");
  return value;
}

const byId = <T extends [string, ...string[]]>(a: T, b: T) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** The invoices as stored after replaying every delivery (closed months, then the pending one). */
export function buildSnapshotData(source: SnapshotSource): SnapshotData {
  const deliveries = [...source.deliveries, source.pendingDelivery];
  const invoices = [...replayDeliveries(deliveries).values()].sort(
    (a, b) => (a.billingDate < b.billingDate ? -1 : a.billingDate > b.billingDate ? 1 : 0) || (a.invoiceNumber < b.invoiceNumber ? -1 : 1),
  );

  // Latest details win, as in the database's upserts.
  const customerNames = new Map<string, string>();
  const productDetails = new Map<string, [string, string]>();
  for (const { payload } of deliveries) {
    for (const invoice of payload.invoices) {
      customerNames.set(invoice.customer.id, invoice.customer.name);
      for (const line of invoice.lines) productDetails.set(line.productId, [line.productName, line.productCategory]);
    }
  }
  const customers = [...customerNames].sort(byId);
  const sellers = SELLERS.map((seller): [string, string] => [seller.sellerId, seller.name]).sort(byId);
  const products = [...productDetails].map(([id, [name, category]]): [string, string, string] => [id, name, category]).sort(byId);
  const index = (list: readonly [string, ...string[]][]) => new Map(list.map(([id], position) => [id, position]));
  const customerIndex = index(customers);
  const sellerIndex = index(sellers);
  const productIndex = index(products);

  const compact = invoices.map(
    (invoice): SnapshotInvoice => [
      invoice.invoiceNumber,
      invoice.billingDate,
      customerIndex.get(invoice.customer.id)!,
      sellerIndex.get(invoice.sellerId)!,
      code(UNIT_BY_LABEL, invoice.businessUnit),
      code(SCHEDULE_BY_LABEL, invoice.paymentSchedule),
      invoice.lines.map((line) => [
        productIndex.get(line.productId)!,
        line.packageQuantity,
        line.unitPriceCents,
        line.lineAmountCents,
        line.commissionAmountCents,
      ]),
    ],
  );
  const data: SnapshotData = {
    format: 1,
    seed: source.seed,
    asOf: compact.at(-1)![1],
    closedMonthDeliveries: source.deliveries.length,
    pendingDeliveryMonth: source.pendingDelivery.month,
    customers,
    sellers,
    products,
    invoices: compact,
    totals: { invoices: 0, lines: 0, salesCents: 0 },
  };
  data.totals = snapshotTotals(expandSnapshotLines(data));
  return data;
}

const hash = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

/** The browser script: `app.ts` and the report modules it imports, as one minified script. */
export async function bundleSnapshotScript(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(import.meta.dirname, "app.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
    charset: "utf8",
    logLevel: "silent",
  });
  const script = result.outputFiles[0]!.text;
  // Inline scripts end at the first "</script"; "<!--" changes how the HTML parser reads them.
  if (/<\/script|<!--/i.test(script)) throw new Error("The bundled script cannot be inlined safely");
  return script;
}

export async function buildSnapshotHtml(source: SnapshotSource): Promise<string> {
  const data = buildSnapshotData(source);
  const lines = expandSnapshotLines(data);
  const script = await bundleSnapshotScript();
  const style = readFileSync(path.join(import.meta.dirname, "snapshot.css"), "utf8");
  // "<" never appears unescaped, so the data cannot end its script element.
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  const { totals } = data;
  const count = new Intl.NumberFormat("pt-BR");
  const deliveries = `${data.closedMonthDeliveries} closed-month deliveries and the pending ${data.pendingDeliveryMonth} delivery`;
  const csp = `default-src 'none'; script-src ${hash(script)}; style-src ${hash(style)}; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Biomix report snapshot (synthetic data)</title>
<style>${style}</style>
</head>
<body>
<main>
<header>
<p class="eyebrow">BIOMIX SALES WORKBENCH · REPORT SNAPSHOT</p>
<h1>Invoiced sales and scheduled collections</h1>
<p class="notice"><strong>Synthetic, fictional data</strong>, as of ${data.asOf}: seed ${data.seed}, the invoices stored after replaying ${deliveries}. Read-only; nothing is sent anywhere. ${count.format(totals.invoices)} invoices, ${count.format(totals.lines)} lines, ${formatBrlCents(totals.salesCents)} invoiced.</p>
<noscript><p class="notice">Filters need JavaScript. The unfiltered report below is complete without it.</p></noscript>
</header>
<form class="panel filters" id="filters">${renderFilterForm(reportFilterOptions(lines))}</form>
<div id="results">${renderResults(lines, {})}</div>
<footer>Built by <code>npm run snapshot:build</code> from the seeded generator, with the same report and collections modules as the application. Amounts are exact integer cents. All customer, seller and product names are fictional.</footer>
</main>
<script type="application/json" id="snapshot-data">${json}</script>
<script>${script}</script>
</body>
</html>
`;
}
