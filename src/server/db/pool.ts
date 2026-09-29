/**
 * Postgres connection pool for the application. The connection string comes from
 * `DATABASE_URL` (set by the dev container and CI). Never log it: it contains the password.
 *
 * Reachable from Node scripts through built-in type stripping, so relative imports keep their
 * `.ts` extension and type-only imports use `import type`.
 */
import pg from "pg";

const DATE_OID = 1082;

/**
 * `date` columns stay `YYYY-MM-DD` strings. The driver's default turns them into a `Date` at local
 * midnight, which makes calendar dates depend on the server's time zone. `bigint` values and
 * sums stay strings (the driver default) and are converted with `toSafeInteger`.
 */
const types: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    oid === DATE_OID ? (value: string) => value : pg.types.getTypeParser(oid, format)) as pg.CustomTypesConfig["getTypeParser"],
};

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function createPool(connectionString: string, options: Omit<pg.PoolConfig, "connectionString" | "types"> = {}): pg.Pool {
  return new pg.Pool({ connectionString, types, max: 5, ...options });
}

// Kept on globalThis so development hot reloads reuse one pool instead of opening new ones.
const shared = globalThis as typeof globalThis & { biomixPool?: pg.Pool };

/** The application's shared pool. Throws `DatabaseNotConfiguredError` without `DATABASE_URL`. */
export function getPool(): pg.Pool {
  if (!shared.biomixPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new DatabaseNotConfiguredError();
    shared.biomixPool = createPool(url);
  }
  return shared.biomixPool;
}

/** Converts a `bigint`/`numeric` column (a string) to a number, or null if it is not a safe integer. */
export function toSafeInteger(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (!/^-?\d+$/.test(value)) return null;
  const big = BigInt(value);
  return big <= BigInt(Number.MAX_SAFE_INTEGER) && big >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(big) : null;
}

/** Name and SQLSTATE of a database error, safe to log: never the message, which can quote values. */
export function databaseErrorDiagnostics(error: unknown): { error: string; sqlState?: string } {
  const name = error instanceof Error ? error.name : "unknown";
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? { error: name, sqlState: code } : { error: name };
}
