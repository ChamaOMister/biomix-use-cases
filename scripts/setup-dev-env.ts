/**
 * Creates the Git-ignored .env.local with a random development API key for the sales feed,
 * unless one is already there (Node 24 runs this TypeScript file directly):
 *
 *   npm run setup:env
 *
 * The key is local to this environment; it is never committed and never printed.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const FILE = ".env.local";
const existing = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
if (/^SALES_FEED_API_KEY=.+$/m.test(existing)) {
  console.log(`${FILE} already has SALES_FEED_API_KEY; left unchanged.`);
} else {
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(FILE, `${separator}SALES_FEED_API_KEY=${randomBytes(24).toString("base64url")}\n`, { mode: 0o600 });
  console.log(`Added a random SALES_FEED_API_KEY to ${FILE}. Restart npm run dev if it is running.`);
}
