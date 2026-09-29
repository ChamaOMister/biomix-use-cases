/**
 * Database test support. Each test file gets its own freshly migrated schema in the database
 * named by `DATABASE_URL`, and drops it afterwards, so files can run in parallel and never touch
 * the development data in the default schema.
 *
 * Without `DATABASE_URL` the database tests are skipped with a warning, except in CI, where the
 * missing database is an error so the tests cannot silently stop running (see
 * `vitest-global-setup.ts`).
 */
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { createPool } from "./pool";
import { migrate } from "./migrate";

export const TEST_DATABASE_URL = process.env.DATABASE_URL;

/** Without a database the tests are skipped; `vitest-global-setup.ts` warns, or fails in CI. */
export const hasDatabase = TEST_DATABASE_URL !== undefined && TEST_DATABASE_URL !== "";

export interface TestDatabase {
  pool: pg.Pool;
  schema: string;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const schema = `test_${randomBytes(6).toString("hex")}`;
  const admin = createPool(TEST_DATABASE_URL!, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  // The application name lets a test find this file's sessions, e.g. those waiting for a lock.
  const pool = createPool(TEST_DATABASE_URL!, { options: `-c search_path=${schema}`, application_name: schema });
  try {
    await migrate(pool);
  } catch (error) {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw error;
  }
  return {
    pool,
    schema,
    async drop() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

/** Every stored sales row, ordered, for comparing the database before and after an operation. */
export async function snapshotSalesData(pool: pg.Pool): Promise<Record<string, unknown[]>> {
  const tables: Record<string, string> = {
    customers: "SELECT * FROM customers ORDER BY customer_id",
    products: "SELECT * FROM products ORDER BY product_id",
    invoices: "SELECT * FROM invoices ORDER BY invoice_number",
    invoice_lines: "SELECT * FROM invoice_lines ORDER BY invoice_number, line_number",
    sellers: "SELECT * FROM sellers ORDER BY seller_id",
    territory_cities: "SELECT * FROM territory_cities ORDER BY business_unit, state, city",
  };
  const snapshot: Record<string, unknown[]> = {};
  for (const [table, sql] of Object.entries(tables)) snapshot[table] = (await pool.query(sql)).rows;
  return snapshot;
}
