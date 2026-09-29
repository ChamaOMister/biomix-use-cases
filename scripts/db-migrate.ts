/**
 * Applies the SQL migrations in db/migrations/ and syncs the seller reference data
 * (Node 24 runs this TypeScript file directly):
 *
 *   npm run db:migrate
 *
 * Uses DATABASE_URL (set by the dev container; otherwise from the environment or .env.local).
 * Waits up to 30 seconds for Postgres to accept connections, because the dev container's
 * database may still be starting when setup runs.
 */
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { migrate } from "../src/server/db/migrate.ts";
import { createPool, databaseErrorDiagnostics } from "../src/server/db/pool.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. See docs/database.md.");
  process.exit(1);
}

const pool = createPool(url, { max: 1 });
try {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      await sleep(1000);
    }
  }
  const result = await migrate(pool);
  console.log(
    `Migrations: ${result.applied.length} applied${result.applied.length ? ` (${result.applied.join(", ")})` : ""}, ` +
      `${result.alreadyApplied.length} already applied. Seller reference data synced.`,
  );
} catch (error) {
  // Diagnostics only: messages can include connection details.
  console.error("Migration failed", JSON.stringify(databaseErrorDiagnostics(error)));
  if (error instanceof Error && error.message.startsWith("Migration ")) console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
