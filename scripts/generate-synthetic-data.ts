/**
 * Writes the seeded synthetic feed to disk (Node 24 runs this TypeScript file directly):
 *
 *   npm run generate:data -- [--seed <0–4294967295>] [--out <directory>]
 *
 * Output (Git-ignored under the default `data/generated/`):
 *   feed/deliveries/YYYY-MM.json   one delivery per closed month
 *   feed/pending/2026-09.json      the pending next delivery
 *   feed/demo/2026-09-rejected.json   the pending delivery with two mistakes, for the rejection demo
 *   feed/summary.json              targets vs. actual totals, delivery figures
 *   evaluation/answer-key.json     planted scenarios, kept apart from operational data
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { rejectedDemoDelivery } from "../src/synthetic-data/demo.ts";
import { DEFAULT_SEED, generateSyntheticFeed } from "../src/synthetic-data/generate.ts";

function parseSeed(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SEED;
  const seed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(seed) || seed > 0xffffffff) {
    throw new Error("--seed must be a whole number from 0 to 4294967295");
  }
  return seed;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const { values } = parseArgs({
  options: { seed: { type: "string" }, out: { type: "string", default: path.join("data", "generated") } },
  strict: true,
});
const seed = parseSeed(values.seed);
const out = path.resolve(values.out);
const feed = generateSyntheticFeed({ seed });

for (const delivery of feed.deliveries) {
  writeJson(path.join(out, "feed", "deliveries", `${delivery.month}.json`), delivery.payload);
}
writeJson(path.join(out, "feed", "pending", `${feed.pendingDelivery.month}.json`), feed.pendingDelivery.payload);
writeJson(
  path.join(out, "feed", "demo", `${feed.pendingDelivery.month}-rejected.json`),
  rejectedDemoDelivery(feed.pendingDelivery.payload),
);
writeJson(path.join(out, "feed", "summary.json"), feed.summary);
writeJson(path.join(out, "evaluation", "answer-key.json"), feed.answerKey);

const { summary } = feed;
console.log(`Synthetic feed, seed ${seed} → ${out}`);
console.log(
  `${summary.closedMonthDeliveries} closed-month deliveries + pending ${summary.pendingDeliveryMonth}; ` +
    `${summary.invoices} invoices, ${summary.lines} lines, ${summary.customers} customers (after replay)`,
);
for (const year of summary.byYear) {
  console.log(
    `${year.year}: ${brl(year.actualCents)} (target ${brl(year.targetCents)}, ${year.deviationPercent}%), Agro ${year.agroSharePercent}%`,
  );
}
console.log(`Top 10% of customers: ${summary.topTenPercentCustomersSharePercent}% of revenue`);
console.log(`Answer key: ${feed.answerKey.scenarios.length} planted scenarios (evaluation only)`);
