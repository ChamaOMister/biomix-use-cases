/**
 * Builds the downloadable report snapshot: one HTML file that opens from disk, offline, with the
 * seeded synthetic invoices and the application's report and collections modules (Node 24 runs
 * this TypeScript file directly):
 *
 *   npm run snapshot:build -- [--seed <0–4294967295>] [--out <file>]
 *
 * Default output: data/generated/snapshot/biomix-report-snapshot.html (Git-ignored). The evaluation
 * answer key is never passed to the builder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildSnapshotHtml, SNAPSHOT_FILE_NAME } from "../src/snapshot/build.ts";
import { DEFAULT_SEED, generateSyntheticFeed } from "../src/synthetic-data/generate.ts";

const { values } = parseArgs({
  options: {
    seed: { type: "string" },
    out: { type: "string", default: path.join("data", "generated", "snapshot", SNAPSHOT_FILE_NAME) },
  },
  strict: true,
});
const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
if (!/^\d+$/.test(values.seed ?? "0") || !Number.isSafeInteger(seed) || seed > 0xffffffff) {
  console.error("--seed must be a whole number from 0 to 4294967295");
  process.exit(1);
}

const { deliveries, pendingDelivery } = generateSyntheticFeed({ seed });
const html = await buildSnapshotHtml({ seed, deliveries, pendingDelivery });
const out = path.resolve(values.out);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Report snapshot, seed ${seed} → ${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB)`);
