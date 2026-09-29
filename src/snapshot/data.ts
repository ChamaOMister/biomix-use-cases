/**
 * Data embedded in the downloadable report snapshot (decision 002, item 7): the synthetic invoices
 * as stored after replaying every delivery, in a compact form. Customers, sellers and products are
 * listed once and referenced by position. `expandSnapshotLines` turns it back into the report's
 * input lines in the browser. It never contains the evaluation answer key.
 *
 * Safe for the browser. Reachable from Node scripts through built-in type stripping, so relative
 * imports keep their `.ts` extension and type-only imports use `import type`.
 */
import type { CalendarDate } from "../domain/sales-import/dates.ts";
import type { BusinessUnit, PaymentSchedule, SalesLine } from "../domain/sales-import/types.ts";

/** Product index, package quantity, unit price, line amount, commission (cents). */
export type SnapshotLine = [number, number, number, number, number];

/** Invoice number, billing date, customer index, seller index, unit, schedule, lines. */
export type SnapshotInvoice = [string, CalendarDate, number, number, BusinessUnit, PaymentSchedule, SnapshotLine[]];

export interface SnapshotData {
  format: 1;
  seed: number;
  /** Last billing date in the data. */
  asOf: CalendarDate;
  closedMonthDeliveries: number;
  pendingDeliveryMonth: string;
  /** [id, name] */
  customers: [string, string][];
  /** [id, name] */
  sellers: [string, string][];
  /** [id, name, category] */
  products: [string, string, string][];
  /** Sorted by billing date, then invoice number. */
  invoices: SnapshotInvoice[];
  /** Computed when the file was built, so the page can show that it read the same data. */
  totals: { invoices: number; lines: number; salesCents: number };
}

/** The report's input lines, one per stored invoice line. */
export function expandSnapshotLines(data: SnapshotData): SalesLine[] {
  const lines: SalesLine[] = [];
  for (const [invoiceNumber, billingDate, customerIndex, sellerIndex, businessUnit, paymentSchedule, invoiceLines] of data.invoices) {
    const [customerId, customerName] = data.customers[customerIndex]!;
    const [, sellerName] = data.sellers[sellerIndex]!;
    invoiceLines.forEach(([productIndex, packageQuantity, unitPriceCents, lineAmountCents, commissionAmountCents], index) => {
      const [productId, productName, productCategory] = data.products[productIndex]!;
      lines.push({
        lineId: `${invoiceNumber}/${index + 1}`,
        source: { importId: "snapshot", sheet: "feed", row: lines.length + 1 },
        billingDate,
        invoiceNumber,
        customerId,
        customerName,
        taxId: null,
        customerState: null,
        customerCity: null,
        productId,
        productName,
        productCategory,
        productUsage: null,
        productType: null,
        sellerName,
        businessUnit,
        paymentSchedule,
        packageQuantity,
        unitPriceCents,
        lineAmountCents,
        commissionAmountCents,
        sourceWeight: null,
        sourceMeasurementUnit: null,
      });
    });
  }
  return lines;
}

/** Invoice count, line count and sales of the embedded data, recomputed from the lines. */
export function snapshotTotals(lines: readonly SalesLine[]): SnapshotData["totals"] {
  let salesCents = 0;
  for (const line of lines) salesCents += line.lineAmountCents;
  return { invoices: new Set(lines.map((line) => line.invoiceNumber)).size, lines: lines.length, salesCents };
}
