/**
 * Deletes ALL stored feed data (deliveries, invoices, lines, installments, customers, products)
 * and re-applies the migrations, for starting a demo or a replay from scratch (Node 24 runs this
 * TypeScript file directly):
 *
 *   npm run db:reset -- --yes
 *
 * Development only. Uses DATABASE_URL, like npm run db:migrate.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { migrate } from "../src/server/db/migrate.ts";
import { createPool, databaseErrorDiagnostics } from "../src/server/db/pool.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { values } = parseArgs({ options: { yes: { type: "boolean", default: false } }, strict: true });
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See docs/database.md.");
  process.exit(1);
}
if (!values.yes) {
  console.error("This deletes all stored feed data. Run again with --yes to confirm: npm run db:reset -- --yes");
  process.exit(1);
}

const pool = createPool(url, { max: 1 });
try {
  await pool.query(`
    DROP TABLE IF EXISTS scheduled_installments, invoice_lines, invoices, products, customers, feed_deliveries,
      territory_cities, sellers, schema_migrations`);
  const result = await migrate(pool);
  console.log(`Database reset: ${result.applied.length} migrations applied, seller reference data synced, no deliveries.`);
} catch (error) {
  console.error("Reset failed", JSON.stringify(databaseErrorDiagnostics(error)));
  process.exitCode = 1;
} finally {
  await pool.end();
}
