/** Runs the real `npm run generate:data` entry point with Node's built-in type stripping. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateSyntheticFeed } from "./generate";

const script = path.join(process.cwd(), "scripts/generate-synthetic-data.ts");
const out = mkdtempSync(path.join(tmpdir(), "synthetic-feed-"));

afterAll(() => rmSync(out, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

describe("generate:data script", () => {
  it("writes deliveries, the pending delivery, a summary and a separate answer key, whatever the time zone", () => {
    const result = run(["--seed", "11", "--out", out], { TZ: "Pacific/Kiritimati" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("44 closed-month deliveries");

    const expected = generateSyntheticFeed({ seed: 11 });
    const read = (...parts: string[]) => JSON.parse(readFileSync(path.join(out, ...parts), "utf8"));
    const written = readdirSync(path.join(out, "feed", "deliveries")).sort();
    expect(written).toEqual(expected.deliveries.map((delivery) => `${delivery.month}.json`));
    for (const delivery of expected.deliveries) expect(read("feed", "deliveries", `${delivery.month}.json`)).toEqual(delivery.payload);
    expect(read("feed", "pending", "2026-09.json")).toEqual(expected.pendingDelivery.payload);
    expect(read("feed", "summary.json")).toEqual(expected.summary);
    expect(read("evaluation", "answer-key.json")).toEqual(expected.answerKey);
    expect(readdirSync(path.join(out, "feed")).sort()).toEqual(["deliveries", "pending", "summary.json"]);
  }, 30_000);

  it("rejects a seed outside the 32-bit range", () => {
    const result = run(["--seed=4294967296", "--out", out]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--seed must be a whole number");
  }, 30_000);
});
