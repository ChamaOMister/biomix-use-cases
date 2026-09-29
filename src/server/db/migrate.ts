/**
 * Applies the versioned SQL files in `db/migrations/` in name order, each in its own transaction,
 * then syncs the seller reference data. Applied files are recorded with a checksum and must not
 * be edited afterwards: add a new file instead. Safe to run repeatedly and concurrently (a
 * session advisory lock serializes runs).
 *
 * Reachable from Node scripts through built-in type stripping, so relative imports keep their
 * `.ts` extension and type-only imports use `import type`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { SELLERS, type SellerReference } from "../../domain/sales-feed/reference-data.ts";

export const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "..", "..", "db", "migrations");

/** Arbitrary constant naming the migration lock; independent of the feed's lock. */
const MIGRATION_LOCK_KEY = 4_815_162_342;
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  const seen = new Set<string>();
  return files.map((file) => {
    const match = MIGRATION_FILE.exec(file);
    if (!match) throw new Error(`Migration file name must look like 0001_name.sql: ${file}`);
    const version = match[1]!;
    if (seen.has(version)) throw new Error(`Two migrations share version ${version}`);
    seen.add(version);
    const sql = readFileSync(path.join(dir, file), "utf8");
    return { version, name: file, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function migrate(pool: pg.Pool, migrations: readonly Migration[] = readMigrations()): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    text PRIMARY KEY,
          name       text NOT NULL,
          checksum   text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      const { rows } = await client.query<{ version: string; checksum: string }>(
        "SELECT version, checksum FROM schema_migrations",
      );
      const stored = new Map(rows.map((row) => [row.version, row.checksum]));
      const result: MigrationResult = { applied: [], alreadyApplied: [] };
      for (const migration of migrations) {
        const checksum = stored.get(migration.version);
        if (checksum !== undefined) {
          if (checksum !== migration.checksum) {
            throw new Error(`Migration ${migration.name} changed after it was applied; add a new migration instead.`);
          }
          result.alreadyApplied.push(migration.name);
          continue;
        }
        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
            migration.version,
            migration.name,
            migration.checksum,
          ]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
        result.applied.push(migration.name);
      }
      await syncReferenceData(client);
      return result;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * Makes `sellers` and `territory_cities` equal to the code's reference data, in one transaction.
 * Removing a city that stored customers still use fails on its foreign key, on purpose.
 */
export async function syncReferenceData(
  client: pg.PoolClient,
  sellers: readonly SellerReference[] = SELLERS,
): Promise<void> {
  const cities = sellers.flatMap((seller) =>
    seller.cities.map((city) => ({ ...city, sellerId: seller.sellerId, businessUnit: seller.businessUnit })),
  );
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO sellers (seller_id, name, business_unit, territory)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
       ON CONFLICT (seller_id) DO UPDATE
         SET name = EXCLUDED.name, business_unit = EXCLUDED.business_unit, territory = EXCLUDED.territory`,
      [
        sellers.map((seller) => seller.sellerId),
        sellers.map((seller) => seller.name),
        sellers.map((seller) => seller.businessUnit),
        sellers.map((seller) => seller.territory),
      ],
    );
    await client.query(
      `DELETE FROM territory_cities t
       WHERE NOT EXISTS (
         SELECT 1 FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS r(business_unit, state, city, seller_id)
         WHERE r.business_unit = t.business_unit AND r.state = t.state AND r.city = t.city AND r.seller_id = t.seller_id
       )`,
      [
        cities.map((city) => city.businessUnit),
        cities.map((city) => city.state),
        cities.map((city) => city.city),
        cities.map((city) => city.sellerId),
      ],
    );
    await client.query(
      `INSERT INTO territory_cities (business_unit, state, city, seller_id)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
       ON CONFLICT DO NOTHING`,
      [
        cities.map((city) => city.businessUnit),
        cities.map((city) => city.state),
        cities.map((city) => city.city),
        cities.map((city) => city.sellerId),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
