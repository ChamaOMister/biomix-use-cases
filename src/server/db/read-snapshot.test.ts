import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSyntheticFeed } from "@/synthetic-data/generate";
import { buildStoredCollectionsReport } from "../collections/stored-collections";
import { ingestDelivery } from "../sales-feed/ingest";
import { buildStoredRankings } from "../sales-report/stored-rankings";
import { buildStoredSalesReport, storedFilterOptions } from "../sales-report/stored-report";
import { withReadSnapshot } from "./pool";
import { createTestDatabase, hasDatabase, type TestDatabase } from "./testing";

describe.skipIf(!hasDatabase)("withReadSnapshot", () => {
  let db: TestDatabase;
  let feed: ReturnType<typeof generateSyntheticFeed>;

  beforeAll(async () => {
    db = await createTestDatabase();
    feed = generateSyntheticFeed({ seed: 2026 });
    const outcome = await ingestDelivery(db.pool, feed.deliveries[0]!.payload);
    if (outcome.kind !== "applied") throw new Error(`first delivery was not applied: ${outcome.kind}`);
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  const readAll = async (queryable: Parameters<typeof storedFilterOptions>[0]) => ({
    options: await storedFilterOptions(queryable),
    report: await buildStoredSalesReport(queryable, {}),
    collections: await buildStoredCollectionsReport(queryable, {}),
    rankings: await buildStoredRankings(queryable, {}),
  });

  it("keeps every read on the data committed before a delivery applied mid-read", async () => {
    const before = await readAll(db.pool);
    const inside = await withReadSnapshot(db.pool, async (snapshot) => {
      const report = await buildStoredSalesReport(snapshot, {});
      // Applied on another connection after the snapshot's first query.
      const outcome = await ingestDelivery(db.pool, feed.deliveries[1]!.payload);
      expect(outcome.kind).toBe("applied");
      return { report, rest: await readAll(snapshot) };
    });
    expect(inside.report).toEqual(before.report);
    expect(inside.rest).toEqual(before);
    expect(inside.rest.options.appliedDeliveries).toBe(1);

    const after = await readAll(db.pool);
    expect(after.options.appliedDeliveries).toBe(2);
    expect(after.report).not.toEqual(before.report);
  });

  it("refuses writes, rolls back, and returns the connection to the pool", async () => {
    await expect(
      withReadSnapshot(db.pool, (snapshot) => snapshot.query("DELETE FROM invoice_lines")),
    ).rejects.toMatchObject({ code: "25006" }); // read_only_sql_transaction
    await expect(withReadSnapshot(db.pool, () => Promise.reject(new Error("read failed")))).rejects.toThrow("read failed");

    const { rows } = await db.pool.query<{ lines: number }>("SELECT count(*)::int AS lines FROM invoice_lines");
    expect(rows[0]!.lines).toBeGreaterThan(0);
    expect(db.pool.totalCount).toBe(db.pool.idleCount);
  });
});
