/**
 * Runs once before the test files. Makes skipped database tests visible, and fails the run in CI,
 * where the database tests must never be skipped silently.
 */
export default function checkTestDatabase(): void {
  if (process.env.DATABASE_URL) return;
  if (process.env.CI) throw new Error("DATABASE_URL must be set in CI: the database tests may not be skipped.");
  console.warn("\n⚠ DATABASE_URL is not set: the Postgres tests are SKIPPED. See docs/database.md.\n");
}
