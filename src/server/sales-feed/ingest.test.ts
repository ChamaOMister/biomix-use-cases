import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeliveryPayload } from "@/domain/sales-feed/contract";
import { SELLERS } from "@/domain/sales-feed/reference-data";
import { migrate } from "../db/migrate";
import { createTestDatabase, hasDatabase, snapshotSalesData, type TestDatabase } from "../db/testing";
import { FEED_LOCK_KEY, ingestDelivery, type IngestOutcome } from "./ingest";
import { delivery, homeGardenInvoice, invoice, line } from "./testing/fixtures";

let db: TestDatabase;

async function ingest(payload: unknown): Promise<IngestOutcome> {
  return ingestDelivery(db.pool, payload);
}

async function apply(payload: DeliveryPayload): Promise<void> {
  const outcome = await ingest(payload);
  if (outcome.kind !== "applied") throw new Error(`expected the delivery to apply, got ${JSON.stringify(outcome)}`);
}

function errorCodes(outcome: IngestOutcome): string[] {
  if (outcome.kind !== "rejected") throw new Error(`expected a rejection, got ${outcome.kind}`);
  return outcome.body.errors.map((error) => `${error.code} ${error.path}`);
}

async function storedLines(invoiceNumber: string) {
  const { rows } = await db.pool.query(
    `SELECT line_number, product_id, package_quantity, unit_price_cents, line_amount_cents, commission_amount_cents
     FROM invoice_lines WHERE invoice_number = $1 ORDER BY line_number`,
    [invoiceNumber],
  );
  return rows;
}

async function deliveryRows() {
  return (await db.pool.query("SELECT delivery_id, status FROM feed_deliveries ORDER BY received_at, delivery_id")).rows;
}

/**
 * Holds the feed lock from another connection while `start` sends deliveries, waits until they
 * are all queued behind it, then releases it. Proves deliveries wait for each other: without the
 * lock they would never queue and this would time out.
 */
async function whileFeedLocked<T>(start: () => Promise<T>[]): Promise<T[]> {
  const blocker = await db.pool.connect();
  let pending: Promise<T>[] = [];
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1)", [FEED_LOCK_KEY]);
    pending = start();
    for (let attempt = 0; ; attempt += 1) {
      const { rows } = await db.pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objid::text::bigint = $1 AND a.application_name = $2`,
        [FEED_LOCK_KEY, db.schema],
      );
      if (rows[0]!.waiting === pending.length) break;
      if (attempt >= 250) throw new Error("the deliveries did not wait for the feed lock");
      await sleep(20);
    }
  } finally {
    await blocker.query("COMMIT");
    blocker.release();
  }
  return Promise.all(pending);
}

describe.skipIf(!hasDatabase)("delivery ingestion into Postgres", () => {
  beforeEach(async () => {
    db = await createTestDatabase();
  });
  afterEach(async () => {
    await db.drop();
  });

  it("migrates once and syncs the sellers and their territories", async () => {
    expect(await migrate(db.pool)).toEqual({ applied: [], alreadyApplied: ["0001_sales_feed.sql"] });
    const sellers = await db.pool.query("SELECT seller_id, business_unit FROM sellers ORDER BY seller_id");
    expect(sellers.rows).toEqual(SELLERS.map((seller) => ({ seller_id: seller.sellerId, business_unit: seller.businessUnit })));
    const cities = await db.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM territory_cities");
    expect(cities.rows[0]!.count).toBe(SELLERS.reduce((sum, seller) => sum + seller.cities.length, 0));
  });

  it("adds new invoices with their lines, customers and products", async () => {
    const payload = delivery([
      invoice("000001", { lines: [line("PA1", 10, 1250), line("PA2", 3, 999), line("PA1", 1, 1250)] }),
      homeGardenInvoice("000002", { billingDate: "2025-06-30" }),
    ]);
    const outcome = await ingest(payload);
    expect(outcome).toEqual({
      kind: "applied",
      replayed: false,
      body: {
        deliveryId: payload.deliveryId,
        status: "applied",
        invoicesAdded: 2,
        invoicesReplaced: 0,
        lineCount: 4,
        salesCents: 12500 + 2997 + 1250 + 9960,
        commissionCents: 625 + 150 + 63 + 498,
        firstBillingDate: "2025-06-12",
        lastBillingDate: "2025-06-30",
      },
    });
    // The repeated product keeps its own line.
    expect(await storedLines("000001")).toEqual([
      { line_number: 1, product_id: "PA1", package_quantity: "10", unit_price_cents: "1250", line_amount_cents: "12500", commission_amount_cents: "625" },
      { line_number: 2, product_id: "PA2", package_quantity: "3", unit_price_cents: "999", line_amount_cents: "2997", commission_amount_cents: "150" },
      { line_number: 3, product_id: "PA1", package_quantity: "1", unit_price_cents: "1250", line_amount_cents: "1250", commission_amount_cents: "63" },
    ]);
    const invoices = await db.pool.query("SELECT * FROM invoices ORDER BY invoice_number");
    expect(invoices.rows).toEqual([
      {
        invoice_number: "000001",
        billing_date: "2025-06-12",
        customer_id: "C0001",
        seller_id: "S04",
        business_unit: "AGRO",
        payment_schedule: "NET_30",
        last_delivery_id: payload.deliveryId,
      },
      {
        invoice_number: "000002",
        billing_date: "2025-06-30",
        customer_id: "C0100",
        seller_id: "S01",
        business_unit: "HOME_GARDEN",
        payment_schedule: "UPFRONT",
        last_delivery_id: payload.deliveryId,
      },
    ]);
    const customers = await db.pool.query("SELECT customer_id, seller_id, city FROM customers ORDER BY customer_id");
    expect(customers.rows).toEqual([
      { customer_id: "C0001", seller_id: "S04", city: "Viçosa" },
      { customer_id: "C0100", seller_id: "S01", city: "Osasco" },
    ]);
    const products = await db.pool.query("SELECT product_id, business_unit FROM products ORDER BY product_id");
    expect(products.rows).toEqual([
      { product_id: "PA1", business_unit: "AGRO" },
      { product_id: "PA2", business_unit: "AGRO" },
      { product_id: "PH1", business_unit: "HOME_GARDEN" },
    ]);
  });

  it("replaces a stored invoice with its full new line set, leaving no stale lines", async () => {
    await apply(delivery([invoice("000001", { lines: [line("PA1", 10, 1250), line("PA2", 3, 999), line("PA3", 7, 500)] })]));
    const correction = delivery([
      invoice("000001", {
        billingDate: "2025-06-13",
        paymentSchedule: "4 installments (Upfront, 30, 60 and 90 days)",
        lines: [line("PA2", 5, 999)],
      }),
    ]);
    const outcome = await ingest(correction);
    expect(outcome).toMatchObject({ kind: "applied", body: { invoicesAdded: 0, invoicesReplaced: 1, lineCount: 1 } });
    expect(await storedLines("000001")).toEqual([
      { line_number: 1, product_id: "PA2", package_quantity: "5", unit_price_cents: "999", line_amount_cents: "4995", commission_amount_cents: "250" },
    ]);
    const stored = await db.pool.query("SELECT billing_date, payment_schedule, last_delivery_id FROM invoices");
    expect(stored.rows).toEqual([
      { billing_date: "2025-06-13", payment_schedule: "INSTALLMENTS_0_30_60_90", last_delivery_id: correction.deliveryId },
    ]);
    // Products are reference data: no longer used on a line, still stored.
    const products = await db.pool.query("SELECT product_id FROM products ORDER BY product_id");
    expect(products.rows.map((row) => row.product_id)).toEqual(["PA1", "PA2", "PA3"]);
  });

  it("replaces an invoice even when it moves to another business unit", async () => {
    await apply(delivery([invoice("000001")]));
    await apply(delivery([homeGardenInvoice("000001")]));
    expect(await storedLines("000001")).toMatchObject([{ line_number: 1, product_id: "PH1" }]);
    const stored = await db.pool.query("SELECT customer_id, seller_id, business_unit FROM invoices");
    expect(stored.rows).toEqual([{ customer_id: "C0100", seller_id: "S01", business_unit: "HOME_GARDEN" }]);
  });

  it("leaves invoices absent from a delivery untouched", async () => {
    await apply(delivery([invoice("000001"), invoice("000002", { lines: [line("PA2", 2, 700)] })]));
    const before = await snapshotSalesData(db.pool);
    await apply(delivery([invoice("000002", { lines: [line("PA2", 9, 700)] }), invoice("000003")]));
    const after = await snapshotSalesData(db.pool);
    const only = (rows: unknown[], number: string) =>
      rows.filter((row) => (row as { invoice_number: string }).invoice_number === number);
    expect(only(after.invoices!, "000001")).toEqual(only(before.invoices!, "000001"));
    expect(only(after.invoice_lines!, "000001")).toEqual(only(before.invoice_lines!, "000001"));
    expect(after.invoices!.map((row) => (row as { invoice_number: string }).invoice_number)).toEqual(["000001", "000002", "000003"]);
  });

  it("updates a stored customer's details but never its owning seller", async () => {
    await apply(delivery([invoice("000001")]));
    const moved = { id: "C0001", name: "Fictional Agro Renamed", segment: "agricultural reseller", city: "Ubá", state: "MG" };
    await apply(delivery([invoice("000002", { customer: moved })]));
    const customers = await db.pool.query("SELECT name, segment, city, seller_id FROM customers");
    expect(customers.rows).toEqual([{ name: "Fictional Agro Renamed", segment: "agricultural reseller", city: "Ubá", seller_id: "S04" }]);
  });

  describe("rejection leaves stored data unchanged", () => {
    beforeEach(async () => {
      await apply(delivery([invoice("000001"), homeGardenInvoice("000002")]));
    });

    async function expectRejectedWithoutChanges(payload: DeliveryPayload, expected: string[]) {
      const before = await snapshotSalesData(db.pool);
      const outcome = await ingest(payload);
      expect(errorCodes(outcome)).toEqual(expected);
      expect(outcome).toMatchObject({ replayed: false, body: { deliveryId: payload.deliveryId, status: "rejected" } });
      expect(await snapshotSalesData(db.pool)).toEqual(before);
      const recorded = await db.pool.query("SELECT status FROM feed_deliveries WHERE delivery_id = $1", [payload.deliveryId]);
      expect(recorded.rows).toEqual([{ status: "rejected" }]);
    }

    it("rejects a whole delivery for one bad line among valid additions and replacements", async () => {
      const bad = { ...line("PA2", 2, 700), lineAmountCents: 1399 };
      await expectRejectedWithoutChanges(
        delivery([
          invoice("000001", { lines: [line("PA1", 99, 1250)] }),
          invoice("000003"),
          invoice("000004", { lines: [line("PA1", 1, 1250), bad] }),
        ]),
        ["LINE_AMOUNT_MISMATCH /invoices/2/lines/1/lineAmountCents"],
      );
    });

    it("rejects an invoice outside its seller's territory", async () => {
      const guaxupe = { id: "C0002", name: "Fictional Farm", segment: "farmer", city: "Guaxupé", state: "MG" };
      await expectRejectedWithoutChanges(delivery([invoice("000003"), invoice("000004", { customer: guaxupe })]), [
        "CITY_OUTSIDE_TERRITORY /invoices/1/customer/city",
      ]);
    });

    it("rejects an invoice for another seller's stored customer", async () => {
      // C0001 is stored as S04's customer; S05's territory includes Guaxupé.
      const sameCustomer = { id: "C0001", name: "Fictional Agro Ltda", segment: "farmer", city: "Guaxupé", state: "MG" };
      await expectRejectedWithoutChanges(
        delivery([
          invoice("000003", { customer: { id: "C0003", name: "Fictional New", segment: "farmer", city: "Ubá", state: "MG" } }),
          invoice("000004", { sellerId: "S05", customer: sameCustomer }),
        ]),
        ["CUSTOMER_SELLER_MISMATCH /invoices/1/sellerId"],
      );
    });

    it("rejects a stored product sent under the other business unit", async () => {
      await expectRejectedWithoutChanges(delivery([homeGardenInvoice("000003", { lines: [line("PA1", 1, 1250)] })]), [
        "PRODUCT_ATTRIBUTE_CONFLICT /invoices/0/lines/0/productId",
      ]);
    });

    it("rolls back everything when the database fails mid-delivery, and records nothing", async () => {
      await db.pool.query(`
        CREATE FUNCTION fail_on_product() RETURNS trigger AS $$
        BEGIN
          IF NEW.product_id = 'PFAIL' THEN RAISE EXCEPTION 'simulated failure'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_on_product BEFORE INSERT ON invoice_lines FOR EACH ROW EXECUTE FUNCTION fail_on_product();`);
      const payload = delivery([
        invoice("000001", { lines: [line("PA1", 99, 1250)] }),
        invoice("000003", { customer: { id: "C0003", name: "Fictional New", segment: "farmer", city: "Ubá", state: "MG" } }),
        invoice("000004", { lines: [line("PFAIL", 1, 100)] }),
      ]);
      const before = await snapshotSalesData(db.pool);
      const deliveriesBefore = await deliveryRows();
      await expect(ingest(payload)).rejects.toThrow();
      expect(await snapshotSalesData(db.pool)).toEqual(before);
      expect(await deliveryRows()).toEqual(deliveriesBefore);

      // Nothing was recorded, so the sender can retry under the same deliveryId.
      await db.pool.query("DROP TRIGGER fail_on_product ON invoice_lines");
      expect(await ingest(payload)).toMatchObject({ kind: "applied", replayed: false, body: { invoicesAdded: 2, invoicesReplaced: 1 } });
    });
  });

  describe("idempotent deliveryId", () => {
    it("returns the original result for a repeated delivery without writing again", async () => {
      const first = delivery([invoice("000001"), invoice("000002")]);
      const original = await ingest(first);
      // A later delivery corrects 000001; resending the first must not undo that.
      await apply(delivery([invoice("000001", { lines: [line("PA1", 1, 1250)] })]));
      const before = await snapshotSalesData(db.pool);

      const repeated = await ingest(JSON.parse(JSON.stringify(first, null, 2)));
      expect(repeated).toEqual({ ...original, replayed: true });
      expect(await snapshotSalesData(db.pool)).toEqual(before);
      expect(await deliveryRows()).toHaveLength(2);
    });

    it("returns the original rejection for a repeated rejected delivery", async () => {
      const rejected = delivery([invoice("000001", { sellerId: "S99" })]);
      const original = await ingest(rejected);
      expect(errorCodes(original)).toEqual(["SELLER_UNKNOWN /invoices/0/sellerId"]);
      expect(await ingest(rejected)).toEqual({ ...original, replayed: true });
      expect(await deliveryRows()).toEqual([{ delivery_id: rejected.deliveryId, status: "rejected" }]);
    });

    it("refuses a known deliveryId sent with different content, writing nothing", async () => {
      const first = delivery([invoice("000001")]);
      await apply(first);
      const before = await snapshotSalesData(db.pool);
      const changed = delivery([invoice("000001", { lines: [line("PA1", 2, 1250)] })], first.deliveryId);
      expect(await ingest(changed)).toEqual({ kind: "delivery-id-reused", deliveryId: first.deliveryId });
      expect(await snapshotSalesData(db.pool)).toEqual(before);
      expect(await deliveryRows()).toHaveLength(1);
    });

    it("applies simultaneous copies of one delivery exactly once", async () => {
      const payload = delivery([invoice("000001"), invoice("000002")]);
      const outcomes = await whileFeedLocked(() => [ingest(payload), ingest(payload), ingest(payload)]);
      expect(outcomes.map((outcome) => outcome.kind)).toEqual(["applied", "applied", "applied"]);
      expect(outcomes.filter((outcome) => "replayed" in outcome && !outcome.replayed)).toHaveLength(1);
      expect(await deliveryRows()).toHaveLength(1);
      const lines = await db.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM invoice_lines");
      expect(lines.rows[0]!.count).toBe(2);
    });

    it("validates simultaneous deliveries against each other's stored customers", async () => {
      // Both claim the same new customer for different sellers; whichever runs second must see the first.
      const agro = { id: "C0500", name: "Fictional Shared", segment: "farmer", city: "Guaxupé", state: "MG" };
      const outcomes = await whileFeedLocked(() => [
        ingest(delivery([invoice("000001", { sellerId: "S05", customer: agro })])),
        ingest(delivery([invoice("000002", { customer: { ...agro, city: "Viçosa" } })])),
      ]);
      expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["applied", "rejected"]);
      const rejected = outcomes.find((outcome) => outcome.kind === "rejected")!;
      expect(errorCodes(rejected)).toEqual(["CUSTOMER_SELLER_MISMATCH /invoices/0/sellerId"]);
    });

    it("rejects a payload without a valid deliveryId and records nothing", async () => {
      const outcome = await ingest({ deliveryId: "not-a-uuid", invoices: [invoice("000001")] });
      expect(errorCodes(outcome)).toEqual(["DELIVERY_ID_INVALID /deliveryId"]);
      expect(outcome).toMatchObject({ body: { deliveryId: null } });
      expect(await deliveryRows()).toEqual([]);
    });
  });
});
