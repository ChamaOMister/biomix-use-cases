/**
 * Applies one clean-feed delivery to Postgres (decision 002, item 4). Everything happens in one
 * transaction under a single advisory lock, so deliveries are applied one at a time:
 *
 * - a `deliveryId` already received returns its original result and writes nothing;
 * - the payload is validated against the contract with the stored customer owners and product
 *   business units; any error rejects it whole and only the rejection itself is recorded;
 * - otherwise new invoice numbers are added and stored ones replaced whole (attributes, full line
 *   set and scheduled installments, computed in TypeScript from the whole line set); invoices
 *   absent from the delivery are untouched and nothing is deleted.
 *
 * If anything fails, the transaction rolls back and nothing is recorded, so the sender can retry
 * with the same `deliveryId`.
 *
 * Reachable from Node scripts through built-in type stripping, so relative imports keep their
 * `.ts` extension and type-only imports use `import type`.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import {
  peekDeliveryId,
  validateDelivery,
  type DeliveryError,
  type DeliverySummary,
  type FeedDelivery,
} from "../../domain/sales-feed/contract.ts";
import { scheduleInstallments } from "../../domain/collections/schedule.ts";
import type { FeedReference } from "../../domain/sales-feed/reference-data.ts";
import type { CalendarDate } from "../../domain/sales-import/dates.ts";
import type { BusinessUnit, PaymentSchedule } from "../../domain/sales-import/types.ts";
import { toSafeInteger } from "../db/pool.ts";

/** Arbitrary constant naming the lock that serializes deliveries. */
export const FEED_LOCK_KEY = 2_023_092_026;

export interface DeliveryAppliedBody {
  deliveryId: string;
  status: "applied";
  invoicesAdded: number;
  invoicesReplaced: number;
  lineCount: number;
  salesCents: number;
  commissionCents: number;
  firstBillingDate: CalendarDate;
  lastBillingDate: CalendarDate;
}

export interface DeliveryRejectedBody {
  /** Null when the payload has no valid `deliveryId`; such a rejection is not recorded. */
  deliveryId: string | null;
  status: "rejected";
  errors: DeliveryError[];
  truncated: boolean;
}

export type IngestOutcome =
  | { kind: "applied"; body: DeliveryAppliedBody; replayed: boolean }
  | { kind: "rejected"; body: DeliveryRejectedBody; replayed: boolean }
  /** The `deliveryId` was already received with different content; nothing was written. */
  | { kind: "delivery-id-reused"; deliveryId: string };

export interface IngestOptions {
  reference?: FeedReference;
}

/**
 * Identifies the content sent under a `deliveryId`. The parsed payload is re-serialized, so
 * whitespace does not matter but key order and values do.
 */
export function payloadHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Customer and product IDs the payload mentions, read leniently before validation. */
function referencedIds(input: unknown): { customerIds: string[]; productIds: string[] } {
  const customerIds = new Set<string>();
  const productIds = new Set<string>();
  const invoices = isRecord(input) && Array.isArray(input.invoices) ? input.invoices : [];
  for (const invoice of invoices) {
    if (!isRecord(invoice)) continue;
    if (isRecord(invoice.customer) && typeof invoice.customer.id === "string") customerIds.add(invoice.customer.id);
    if (!Array.isArray(invoice.lines)) continue;
    for (const line of invoice.lines) {
      if (isRecord(line) && typeof line.productId === "string") productIds.add(line.productId);
    }
  }
  return { customerIds: [...customerIds], productIds: [...productIds] };
}

interface DeliveryRow {
  payload_sha256: string;
  status: "applied" | "rejected";
  invoices_added: number | null;
  invoices_replaced: number | null;
  line_count: number | null;
  sales_cents: string | null;
  commission_cents: string | null;
  first_billing_date: CalendarDate | null;
  last_billing_date: CalendarDate | null;
  errors: DeliveryError[] | null;
  errors_truncated: boolean | null;
}

function storedInteger(value: string | number | null): number {
  const number = toSafeInteger(value);
  if (number === null) throw new Error("Stored delivery figure is not a safe integer");
  return number;
}

function replay(deliveryId: string, row: DeliveryRow): IngestOutcome {
  if (row.status === "rejected") {
    return {
      kind: "rejected",
      replayed: true,
      body: { deliveryId, status: "rejected", errors: row.errors ?? [], truncated: row.errors_truncated ?? false },
    };
  }
  return {
    kind: "applied",
    replayed: true,
    body: {
      deliveryId,
      status: "applied",
      invoicesAdded: storedInteger(row.invoices_added),
      invoicesReplaced: storedInteger(row.invoices_replaced),
      lineCount: storedInteger(row.line_count),
      salesCents: storedInteger(row.sales_cents),
      commissionCents: storedInteger(row.commission_cents),
      firstBillingDate: row.first_billing_date!,
      lastBillingDate: row.last_billing_date!,
    },
  };
}

export async function ingestDelivery(pool: pg.Pool, input: unknown, options: IngestOptions = {}): Promise<IngestOutcome> {
  const deliveryId = peekDeliveryId(input);
  const hash = payloadHash(input);
  const client = await pool.connect();
  let failure: unknown;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [FEED_LOCK_KEY]);

    if (deliveryId !== null) {
      const { rows } = await client.query<DeliveryRow>(
        `SELECT payload_sha256, status, invoices_added, invoices_replaced, line_count,
                sales_cents, commission_cents, first_billing_date, last_billing_date, errors, errors_truncated
         FROM feed_deliveries WHERE delivery_id = $1`,
        [deliveryId],
      );
      const row = rows[0];
      if (row) {
        await client.query("COMMIT");
        return row.payload_sha256 === hash ? replay(deliveryId, row) : { kind: "delivery-id-reused", deliveryId };
      }
    }

    const { customerIds, productIds } = referencedIds(input);
    const owners = await client.query<{ customer_id: string; seller_id: string }>(
      "SELECT customer_id, seller_id FROM customers WHERE customer_id = ANY($1::text[])",
      [customerIds],
    );
    const units = await client.query<{ product_id: string; business_unit: BusinessUnit }>(
      "SELECT product_id, business_unit FROM products WHERE product_id = ANY($1::text[])",
      [productIds],
    );
    const ownerById = new Map(owners.rows.map((row) => [row.customer_id, row.seller_id]));
    const unitById = new Map(units.rows.map((row) => [row.product_id, row.business_unit]));
    const validation = validateDelivery(input, {
      ...(options.reference ? { reference: options.reference } : {}),
      customerOwner: (id) => ownerById.get(id),
      productBusinessUnit: (id) => unitById.get(id),
    });

    if (!validation.ok) {
      if (deliveryId !== null) {
        await client.query(
          `INSERT INTO feed_deliveries (delivery_id, payload_sha256, status, errors, errors_truncated)
           VALUES ($1, $2, 'rejected', $3::json, $4)`,
          [deliveryId, hash, JSON.stringify(validation.errors), validation.truncated],
        );
      }
      await client.query("COMMIT");
      return {
        kind: "rejected",
        replayed: false,
        body: { deliveryId, status: "rejected", errors: validation.errors, truncated: validation.truncated },
      };
    }

    const body = await applyDelivery(client, validation.delivery, validation.summary, hash);
    await client.query("COMMIT");
    return { kind: "applied", replayed: false, body };
  } catch (error) {
    failure = error;
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is unusable; it is discarded below and the transaction dies with it.
    }
    throw error;
  } finally {
    // A client whose statement failed is discarded rather than returned to the pool.
    client.release(failure !== undefined);
  }
}

async function applyDelivery(
  client: pg.PoolClient,
  delivery: FeedDelivery,
  summary: DeliverySummary,
  hash: string,
): Promise<DeliveryAppliedBody> {
  const { deliveryId, invoices } = delivery;
  const numbers = invoices.map((invoice) => invoice.invoiceNumber);
  const stored = await client.query<{ invoice_number: string }>(
    "SELECT invoice_number FROM invoices WHERE invoice_number = ANY($1::text[])",
    [numbers],
  );
  const replaced = stored.rows.map((row) => row.invoice_number);
  const body: DeliveryAppliedBody = {
    deliveryId,
    status: "applied",
    invoicesAdded: invoices.length - replaced.length,
    invoicesReplaced: replaced.length,
    lineCount: summary.lineCount,
    salesCents: summary.salesCents,
    commissionCents: summary.commissionCents,
    firstBillingDate: summary.firstBillingDate,
    lastBillingDate: summary.lastBillingDate,
  };

  // Recorded first: stored rows point at the delivery that last wrote them.
  await client.query(
    `INSERT INTO feed_deliveries (delivery_id, payload_sha256, status, invoice_count, invoices_added, invoices_replaced,
       line_count, sales_cents, commission_cents, first_billing_date, last_billing_date)
     VALUES ($1, $2, 'applied', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      deliveryId,
      hash,
      invoices.length,
      body.invoicesAdded,
      body.invoicesReplaced,
      body.lineCount,
      body.salesCents,
      body.commissionCents,
      body.firstBillingDate,
      body.lastBillingDate,
    ],
  );

  // The validator guarantees one set of attributes per customer and product within a delivery.
  const customers = new Map(invoices.map((invoice) => [invoice.customer.id, invoice]));
  const customerRows = [...customers.values()];
  // The owner is never changed: a mismatch skips the update and the invoice's foreign key fails.
  await client.query(
    `INSERT INTO customers (customer_id, name, segment, city, state, seller_id, last_delivery_id)
     SELECT c.*, $7::uuid FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS c
     ON CONFLICT (customer_id) DO UPDATE
       SET name = EXCLUDED.name, segment = EXCLUDED.segment, city = EXCLUDED.city, state = EXCLUDED.state,
           last_delivery_id = EXCLUDED.last_delivery_id
       WHERE customers.seller_id = EXCLUDED.seller_id`,
    [
      customerRows.map((invoice) => invoice.customer.id),
      customerRows.map((invoice) => invoice.customer.name),
      customerRows.map((invoice) => invoice.customer.segment),
      customerRows.map((invoice) => invoice.customer.city),
      customerRows.map((invoice) => invoice.customer.state),
      customerRows.map((invoice) => invoice.sellerId),
      deliveryId,
    ],
  );

  const products = new Map<string, { name: string; category: string; businessUnit: BusinessUnit }>();
  for (const invoice of invoices) {
    for (const line of invoice.lines) {
      if (!products.has(line.productId)) {
        products.set(line.productId, {
          name: line.productName,
          category: line.productCategory,
          businessUnit: invoice.businessUnit,
        });
      }
    }
  }
  const productRows = [...products];
  // The business unit is never changed: a mismatch skips the update and the line's foreign key fails.
  await client.query(
    `INSERT INTO products (product_id, name, category, business_unit, last_delivery_id)
     SELECT p.*, $5::uuid FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS p
     ON CONFLICT (product_id) DO UPDATE
       SET name = EXCLUDED.name, category = EXCLUDED.category, last_delivery_id = EXCLUDED.last_delivery_id
       WHERE products.business_unit = EXCLUDED.business_unit`,
    [
      productRows.map(([id]) => id),
      productRows.map(([, product]) => product.name),
      productRows.map(([, product]) => product.category),
      productRows.map(([, product]) => product.businessUnit),
      deliveryId,
    ],
  );

  // A replaced invoice keeps none of its old lines or installments.
  await client.query("DELETE FROM scheduled_installments WHERE invoice_number = ANY($1::text[])", [replaced]);
  await client.query("DELETE FROM invoice_lines WHERE invoice_number = ANY($1::text[])", [replaced]);
  await client.query(
    `INSERT INTO invoices (invoice_number, billing_date, customer_id, seller_id, business_unit, payment_schedule, last_delivery_id)
     SELECT i.*, $7::uuid FROM unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::text[], $6::text[]) AS i
     ON CONFLICT (invoice_number) DO UPDATE
       SET billing_date = EXCLUDED.billing_date, customer_id = EXCLUDED.customer_id, seller_id = EXCLUDED.seller_id,
           business_unit = EXCLUDED.business_unit, payment_schedule = EXCLUDED.payment_schedule,
           last_delivery_id = EXCLUDED.last_delivery_id`,
    [
      numbers,
      invoices.map((invoice) => invoice.billingDate),
      invoices.map((invoice) => invoice.customer.id),
      invoices.map((invoice) => invoice.sellerId),
      invoices.map((invoice) => invoice.businessUnit),
      invoices.map((invoice) => invoice.paymentSchedule),
      deliveryId,
    ],
  );

  const lines = invoices.flatMap((invoice) =>
    invoice.lines.map((line, index) => ({ invoice, line, lineNumber: index + 1 })),
  );
  await client.query(
    `INSERT INTO invoice_lines (invoice_number, line_number, business_unit, product_id, package_quantity,
       unit_price_cents, line_amount_cents, commission_amount_cents)
     SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[])`,
    [
      lines.map(({ invoice }) => invoice.invoiceNumber),
      lines.map(({ lineNumber }) => lineNumber),
      lines.map(({ invoice }) => invoice.businessUnit),
      lines.map(({ line }) => line.productId),
      lines.map(({ line }) => line.packageQuantity),
      lines.map(({ line }) => line.unitPriceCents),
      lines.map(({ line }) => line.lineAmountCents),
      lines.map(({ line }) => line.commissionAmountCents),
    ],
  );
  await insertScheduledInstallments(client, invoices);
  return body;
}

/** Computes each invoice's installments from its whole line set and stores them. */
async function insertScheduledInstallments(
  client: pg.PoolClient,
  invoices: readonly (Parameters<typeof scheduleInstallments>[0] & { invoiceNumber: string })[],
): Promise<void> {
  const rows = invoices.flatMap((invoice) => {
    const scheduled = scheduleInstallments(invoice);
    // The contract rejects invoices whose total or due dates cannot be represented.
    if (!scheduled.ok) throw new Error(`Installments cannot be scheduled: ${scheduled.code}`);
    return scheduled.installments.map((installment) => ({ invoiceNumber: invoice.invoiceNumber, ...installment }));
  });
  await client.query(
    `INSERT INTO scheduled_installments (invoice_number, installment_number, due_date, amount_cents)
     SELECT * FROM unnest($1::text[], $2::int[], $3::date[], $4::bigint[])`,
    [
      rows.map((row) => row.invoiceNumber),
      rows.map((row) => row.installmentNumber),
      rows.map((row) => row.dueDate),
      rows.map((row) => row.amountCents),
    ],
  );
}

/**
 * Schedules the installments of stored invoices that have none: those stored before the
 * `scheduled_installments` table existed (milestone 4 data). Runs under the feed lock in one
 * transaction, with the same arithmetic as ingestion. Returns the number of invoices scheduled.
 */
export async function backfillScheduledInstallments(client: pg.PoolClient): Promise<number> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [FEED_LOCK_KEY]);
    const { rows } = await client.query<{
      invoice_number: string;
      billing_date: CalendarDate;
      payment_schedule: PaymentSchedule;
      amounts: string[];
    }>(
      `SELECT i.invoice_number, i.billing_date, i.payment_schedule,
              array_agg(l.line_amount_cents::text ORDER BY l.line_number) AS amounts
       FROM invoices i JOIN invoice_lines l ON l.invoice_number = i.invoice_number
       WHERE NOT EXISTS (SELECT 1 FROM scheduled_installments s WHERE s.invoice_number = i.invoice_number)
       GROUP BY i.invoice_number`,
    );
    const invoices = rows.map((row) => ({
      invoiceNumber: row.invoice_number,
      billingDate: row.billing_date,
      paymentSchedule: row.payment_schedule,
      lines: row.amounts.map((amount) => ({ lineAmountCents: storedInteger(amount) })),
    }));
    if (invoices.length > 0) await insertScheduledInstallments(client, invoices);
    await client.query("COMMIT");
    return invoices.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
