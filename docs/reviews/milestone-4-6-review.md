# Milestones 4–6 review — changes requested

## Verdict — 2026-09-29

**Two confirmed P2 findings require correction before approval: R1 (invoice identity changes during storage) and R2 (unchanged JSON retries conflict).** R3 is a confirmed P3 layout defect. Milestones 4–6 remain awaiting approval; Project 1 is not complete and Project 2 must not start.

Reviewed branch `milestones-3-6` at `53f68e3f30178574174f132f0451dce2f787be50`, after fetching and confirming an identical remote head and a clean workspace. Scope: `git diff f3f281e..53f68e3`, concentrating on the milestone 4 portion of `49adadb`, `d39a497`, `9fe741e`, `aff1bbe` and `53f68e3`. Milestone 3 was revisited only where its contract feeds the new storage boundary.

The required checks pass: **462 tests in 20 files, zero skipped**, with Postgres enabled, plus lint, type checking and the production build. Independent HTTP, SQL, migration and browser probes substantiate the normal demo and calculation claims. Passing checks do not cover the two P2 cases below.

## Confirmed defects

### R1 — P2: reject ill-formed Unicode before invoice identities reach Postgres

Location: [`contract.ts:223`](../../src/domain/sales-feed/contract.ts#L223), with the storage lookup/replacement in [`ingest.ts:219`](../../src/server/sales-feed/ingest.ts#L219).

`isCleanText()` accepts unpaired UTF-16 surrogates. They survive JSON parsing and NFC normalization, but encoding the database parameters replaces them with U+FFFD. Consequently two distinct accepted invoice numbers can identify the same stored invoice. This violates invoice identity and the requirement to preserve invoices absent from a delivery.

**Minimal reproduction:** start with two otherwise valid single-invoice deliveries, each with a fresh UUID. Set their invoice numbers to the JavaScript strings `"REVIEW-\ud800"` and `"REVIEW-\ud801"`. Use line totals of 100 and 200 cents respectively, with quantity 1, matching unit price, and commissions 5 and 10. Apply them consecutively to an isolated migrated schema.

Observed independently:

| Step | Validator | Ingestion | Stored result |
| --- | --- | --- | --- |
| `REVIEW-\ud800`, 100 cents | accepted | 1 added | `REVIEW-\ufffd`, 100 cents |
| `REVIEW-\ud801`, 200 cents | accepted | 1 replaced | one invoice, `REVIEW-\ufffd`, 200 cents |

The second delivery silently replaces the first although the submitted identifiers differ. A separate HTTP probe also returned `200` for a customer name containing `\ud800` and stored U+FFFD instead. This is a confirmed storage-boundary defect, not a request to extend ERP repair.

**Required correction, one change:** reject ill-formed Unicode in the shared feed text validator, returning located `TEXT_INVALID` errors before applying the delivery. Reject rather than replace characters. Add regressions for high and low unpaired surrogates in invoice/customer/product IDs and text, including whole-delivery rejection without changing existing invoices. Preserve valid supplementary characters and existing NFC rules. Align the contract description if needed.

### R2 — P2: recognize retries whose JSON object fields were reordered

Location: [`ingest.ts:70`](../../src/server/sales-feed/ingest.ts#L70), with the replay decision at [`ingest.ts:158`](../../src/server/sales-feed/ingest.ts#L158). Promised behavior: [`sales-feed.openapi.json:19`](../api/sales-feed.openapi.json#L19).

The receipt hash uses `JSON.stringify(input)`, so object insertion order changes the hash. An unchanged delivery reconstructed by a sender with a different field order is refused as different content. The API promises that the same delivery ID and content return the original result; object field order does not change that content.

**Minimal reproduction**, using any valid payload `p` and an isolated migrated pool:

```ts
await ingestDelivery(pool, p); // applied
await ingestDelivery(pool, { invoices: p.invoices, deliveryId: p.deliveryId });
// delivery-id-reused, if p originally listed deliveryId first
```

Reversing only `p.invoices[0].customer`'s property order also reproduces the conflict. A separate HTTP probe returned **409** for an unchanged pending delivery with reversed top-level property order. Replays with the original order still work.

This can stop an otherwise safe retry. Following the conflict response's advice to use a new delivery ID would apply the old invoice again, potentially undoing a later correction under the existing replacement policy.

**Required correction, one change:** fingerprint parsed JSON deterministically with recursively ordered object keys while preserving array order and values. Cover reordered top-level and nested fields for both applied and rejected receipts; retain 409 for actual content changes and preserve concurrent replay behavior. Account explicitly for existing receipt hashes: preserve their supported replay behavior or document a development-data reset/hash transition. Do not silently invalidate existing receipts.

### R3 — P3: keep the snapshot's collections table inside the mobile page

Location: [`snapshot.css:39`](../../src/snapshot/snapshot.css#L39), related grid and table wrapper at [`snapshot.css:32`](../../src/snapshot/snapshot.css#L32).

The mobile `1fr` grid track retains its automatic minimum width. The collections table forces its grid child wider than the panel, so `.table-wrap` does not contain the overflow. This contradicts the recorded milestone 6 claim of no horizontal scrolling at 390 px.

**Minimal reproduction:** build the default snapshot, open it from disk in Chromium with a 390 × 844 viewport and normal Arial-compatible fonts, then evaluate:

```js
({ viewport: innerWidth, page: document.documentElement.scrollWidth })
// { viewport: 390, page: 497 }
```

The due-month grid child and table wrapper extend to x = 497. Calculations, filters and offline behavior still work.

**Suggested correction, one change:** allow breakdown grid children to shrink, for example with `min-width: 0` and/or a `minmax(0, 1fr)` mobile track, so wide tables scroll inside their wrappers. Recheck the unfiltered and filtered snapshot at 390 px and desktop widths under its CSP. This P3 issue is not the reason approval is withheld.

## Suggested improvement — separate from confirmed defects

[`stored-sales-report.tsx:53`](../../src/app/stored-sales-report.tsx#L53) loads the sales report, collections report and filter context through separate pool queries. Each report's SQL is internally consistent, but concurrent ingestion can commit between those queries. If live ingestion during report viewing becomes important, read the page's reports from one read-only transaction with a consistent snapshot. No cross-section race was reproduced in this review; this is an improvement suggestion, not an additional blocking finding.

## Unresolved business choices and recommendations

These recommendations do not adopt new business policy or classify the documented scope as defective.

- **Last received wins: retain for Project 1's ordered demo.** More precisely, the last successfully applied new delivery wins; a rejected delivery changes no invoices, and a recognized retry writes nothing. The sender owns ordering, and retries should keep their delivery ID. A new ID carrying an older invoice can still undo a correction. `feed:send` stopping at the first failure was independently verified, but this is not an endpoint guarantee against multiple or out-of-order senders. Add a source revision and stale-update rejection before supporting that use case. R2 concerns recognition of an unchanged retry and is separate from this policy.
- **No cancellation: retain for Project 1.** This matches decision 002 and the clean-feed scope. Cancellation upstream only excludes invoices before their first delivery; it cannot remove an invoice already stored. Explicitly treat later cancellation as outside this demo's scope. A future cancellation/void event must define its effect on reported sales and schedules while retaining history; omission from a delivery must continue to leave invoices intact.
- **Due-date filtering: defer from Project 1 and retain billing-date selection.** All installments of the selected invoices remain included, preserving the existing invoice-to-schedule reconciliation. If added later, provide a distinct collections due-date range that selects existing installments without recalculating them. Keep billing-date semantics explicit, and do not require a subset of installments due in a period to equal the invoices' full sales totals. The open question in `docs/collections.md` still needs the maintainer's decision; this review recommends deferral rather than expanding the approval scope.

## Verification and limits

All review-generated datasets, snapshots, browser packages and probes stayed under `/tmp` or in memory. Database probes used newly created schemas and dropped them afterwards. Existing development data was not reset. No implementation, tests, dependencies or milestone status text was changed.

### Commands and outcomes

- `git fetch origin` — exit 0. `git rev-parse HEAD origin/milestones-3-6` — exit 0, both `53f68e3f30178574174f132f0451dce2f787be50`. `git status --short --branch` — exit 0, clean before review.
- `node --version` / `npm --version` — exit 0: Node **v24.21.0**, npm **11.19.0**. Database query `SELECT version()` confirmed **PostgreSQL 17.11**.
- `npm ci` — exit 0. Installed the lockfile; reported two moderate audit findings. Dependency remediation was not part of this review.
- Required check command below — exit 0: lint, route type generation, TypeScript, **462 passed / 0 skipped in 20 test files**, production build. The wrapper loads local configuration without printing secrets and refuses to run without `DATABASE_URL`:

  ```sh
  node --env-file-if-exists=.env.local --input-type=module -e 'import {spawnSync} from "node:child_process"; if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for review"); const result=spawnSync("npm",["run","check"],{stdio:"inherit"}); process.exit(result.status ?? 1);' > /tmp/milestone-4-6-check.log 2>&1
  ```

- `node /tmp/milestone-4-6-edges.mjs > /tmp/milestone-4-6-edges.log 2>&1` — exit 0. Assertions reproduced both P2 defects in a disposable schema. Also restored three invoice schedules after removing the milestone 5 table and migration receipt; a second migration backfilled zero.
- Independent end-to-end command below — final exit 0. It started `next start --hostname 127.0.0.1 --port 3106` with an isolated schema and temporary API key, then shut it down and dropped the schema:

  ```sh
  LD_LIBRARY_PATH=/tmp/milestone-4-6-browser/runtime/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/milestone-4-6-browser/fonts.conf PLAYWRIGHT_BROWSERS_PATH=/tmp/milestone-4-6-browser/browsers node /tmp/milestone-4-6-probe.mjs > /tmp/milestone-4-6-probe.log 2>&1
  ```

  The first run stopped because Chromium's runtime libraries were absent. Libraries and fonts were downloaded and extracted under `/tmp`; no project dependency changed. The next run stopped on the R3 width assertion. The final probe reports that known width failure separately and passes **17 functional browser assertions**; it does not count R3 as a pass.

### Independent evidence

- **Delivery flow:** applied the 44 closed months over HTTP; rejected the demo with exactly `LINE_AMOUNT_MISMATCH` at `/invoices/145/lines/0/lineAmountCents` and `CITY_OUTSIDE_TERRITORY` at `/invoices/2/customer/city`; compared all customer, product, invoice, line and installment rows before/after rejection with no differences. Replayed the rejection, applied the pending month (**145 added, 1 replaced, 428 lines**), replayed an old accepted delivery without undoing corrections, and verified actual changed content returns 409.
- **Sender failure order:** `npm run feed:send -- --url http://127.0.0.1:3106 /tmp/milestone-4-6-rejected.json /tmp/milestone-4-6-pending.json` — expected exit **1**; reported the rejection and left the later delivery unapplied.
- **Independent reconciliation:** replayed the raw payloads in a map keyed by invoice number and computed quantities, line amounts, half-up commission and eight unit-year totals with BigInt. Compared those totals with direct SQL and both snapshot report modules. Final state: **6,468 invoices, 19,361 lines, seven replacements, 12,757 installments; sales and schedules each 8,796,305,970 cents (R$ 87.963.059,70)**. Every invoice's schedule had the contract's offsets according to Postgres date subtraction, the exact full-invoice total, equal parts and earliest-installment remainders.
- **Populated migration:** removed only the milestone 5 table and its migration receipt in the disposable schema, retaining all milestone 4 data. Running the migrator recreated the table and backfilled **6,468** invoices; every installment row matched the previous snapshot. Repeating migration backfilled **0**. This verifies the upgrade from a populated milestone 4 schema shape, not a separately checked-out historical application.
- **Snapshot:** two builds from seed 2026 were byte-identical, SHA-256 `90ac84899f0cc368e5c9fa35541353fc16708a71292f3eb771cf347837abfd70`. An answer-key getter that throws was never accessed. Embedded data and totals matched the independently replayed feed; no answer-key/scenario text was present.
- **Browser:** temporary Playwright **1.63.0**, Chromium headless shell **153.0.8010.12**. The live page showed the correct totals, delivery counts and two passing reconciliation checks; form submission selected Agro 2025 (**R$ 15.584.715,50**) with URL filters; clearing and product suppression worked. The snapshot opened under its CSP from `file://` in an offline context; the same totals, filters, reversed-period error and clearing worked. Only the initial file request occurred, with **zero network requests, CSP violations or page errors**. Totals were also readable with JavaScript disabled. Mobile overflow is recorded as R3.
- **Logs:** the independent server log contained no temporary API key or generated customer/product names. Reviewed endpoint diagnostics restrict routine logging to IDs, counts, codes and database error diagnostics.
- **Existing behavior coverage:** inspected the database concurrency tests that queue requests behind a held advisory lock, rollback on injected failure, untouched absent invoices, stored ownership/product-unit rejection, full line/installment replacement, product line-scope SQL parity, all payment terms, calendar limits and timezone tests. These passed in the required check.

| Billing year | Agro, cents | Home & Garden, cents |
| --- | ---: | ---: |
| 2023 | 1,140,675,440 | 760,003,820 |
| 2024 | 1,319,944,200 | 879,292,110 |
| 2025 | 1,558,471,550 | 1,039,934,590 |
| 2026 through September 25 | 1,258,752,450 | 839,231,810 |

### Hosted evidence and remaining limits

- Public GitHub API reads of [run 36596471395](https://github.com/ChamaOMister/biomix-use-cases/actions/runs/36596471395) and its jobs returned exit 0 using `curl --fail --silent --show-error`. Confirmed head `9fe741e`, `check: success`, successful install/migrate/check/snapshot/artifact steps, and `release-snapshot: skipped`. Hosted job logs were not downloaded; **the hosted test count remains unverified**.
- `git ls-remote --tags origin` — exit 0, no tags. Static review of `.github/workflows/ci.yml` found the version-tag condition, successful-check dependency, matching artifact names, write permission, repository/token environment and quoted tag/upload commands consistent with the intended release. **No tag or release was created; publication and the README download link remain untested.**
- A fresh Codespace was not created independently. The earlier fresh-Codespace record remains reported evidence. Forwarded-browser use, the Ports panel, hot reload and stop/resume were waived by the maintainer and were not performed here. The browser checks above used a local headless connection to this workspace's temporary server.
- No near-limit ingestion load test, cross-Node-version determinism check, new geography verification or repeat of prior XLSX manual browser QA. The unchanged/import-adjacent behavior tests passed. No mutation tests were added or repeated.

## Correction handoff

```text
Correct R1 and R2 in separate bounded changes, with focused validator/ingestion
regressions and no generated data committed. R1 must reject malformed Unicode
without altering identities. R2 must recognize unchanged JSON retries regardless
of object field order while preserving array order, genuine conflict detection,
rejected receipts and a stated transition for existing receipt hashes.

Address R3 as a small snapshot CSS correction and repeat the 390 px browser check.
Record the maintainer's choices for ordering, cancellation and due-date filtering
separately from defect fixes. Run npm run check with DATABASE_URL set, report the
exact test/skip counts, and return for focused review. Keep milestones 4–6 awaiting
approval and do not start Project 2.
```
