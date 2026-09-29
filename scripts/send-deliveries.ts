/**
 * Sends delivery JSON files to the running app's sales-feed endpoint, in file-name order
 * (Node 24 runs this TypeScript file directly):
 *
 *   npm run feed:send -- data/generated/feed/deliveries          # all closed months, in order
 *   npm run feed:send -- data/generated/feed/pending/2026-09.json
 *   npm run feed:send -- --url http://localhost:3000 <file or directory>...
 *
 * Reads SALES_FEED_API_KEY from the environment or .env.local (npm run setup:env creates it).
 * Stops at the first delivery that is not applied, so later months are never sent out of order.
 * Prints error codes and locations only, never payload values.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { values, positionals } = parseArgs({
  options: { url: { type: "string", default: "http://localhost:3000" } },
  allowPositionals: true,
  strict: true,
});
const apiKey = process.env.SALES_FEED_API_KEY;
if (!apiKey) {
  console.error("SALES_FEED_API_KEY is not set. Run npm run setup:env and restart npm run dev.");
  process.exit(1);
}
if (positionals.length === 0) {
  console.error("Give one or more delivery files or directories.");
  process.exit(1);
}

const files = positionals.flatMap((target) =>
  statSync(target).isDirectory()
    ? readdirSync(target).filter((name) => name.endsWith(".json")).sort().map((name) => path.join(target, name))
    : [target],
);
const endpoint = new URL("/api/sales-feed/deliveries", values.url);

interface ErrorEntry {
  code: string;
  path: string;
}

for (const file of files) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: readFileSync(file),
  });
  const body = (await response.json()) as Record<string, unknown>;
  const replayed = response.headers.get("idempotent-replayed") === "true" ? " (already received: original result)" : "";
  if (response.status === 200) {
    console.log(
      `${file}: applied${replayed}: ${body.invoicesAdded} added, ${body.invoicesReplaced} replaced, ${body.lineCount} lines`,
    );
    continue;
  }
  if (response.status === 422) {
    const errors = body.errors as ErrorEntry[];
    console.error(`${file}: rejected${replayed}: ${errors.length}${body.truncated ? "+" : ""} errors; nothing stored`);
    for (const error of errors.slice(0, 10)) console.error(`  ${error.code} at ${error.path}`);
  } else {
    console.error(`${file}: HTTP ${response.status} ${String(body.code)}: ${String(body.message)}`);
  }
  process.exitCode = 1;
  break;
}
