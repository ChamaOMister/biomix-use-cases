# Foundation verification

Recorded during the initial setup on 2026-09-27, on macOS with Node 24.21.0 and npm 11.19.0.

| Check | Result |
| --- | --- |
| Clean `npm ci` | Passed from the supplied lockfile |
| `npm run check` | Passed: ESLint, route type generation, TypeScript, production build |
| `npm run dev` | Started successfully on port 3000 |
| HTTP homepage smoke check | HTTP 200; foundation status and no-data notice present |
| Project JSON | Parsed successfully |
| Manifest/lockfile versions | Match |
| Git ignore rules | Private inputs, local env files, build output, and dependencies are ignored |
| npm installation audit | Reported zero vulnerabilities at installation time; not an ongoing guarantee |
| `npm test` | Expected exit 1: no business tests exist yet; not counted as a pass |

Not verified: visual browser rendering (no connected browser available), fresh GitHub Codespace/container creation (Docker daemon unavailable), GitHub-hosted Actions execution, and all unimplemented business behavior. Git was initialized locally on `main`; no remote repository, commit, push, or Codespace was created.

ESLint 9.39.5 is deprecated but pinned because ESLint 10 failed with the current Next React rules. See the architecture decision. npm also reported optional install-script approval notices for fsevents and unrs-resolver; no broad script-approval policy was added. The clean install and build succeeded with the current policy.

The development server initially required permission to bind a local port in the agent sandbox. This is an agent execution restriction, not an application setup requirement for a normal terminal or Codespace.

## Milestone 1 (import contract), 2026-09-27

| Check | Result |
| --- | --- |
| `npm install --save-exact exceljs@4.4.0` | Lockfile updated. `npm audit --omit=dev` reports 2 moderate issues: `uuid` < 11.1.1 via ExcelJS (GHSA-w5hq-g745-h8pq, buffer bounds in v3/v5/v6 with a caller-supplied `buf`). The import path does not call those functions. The only offered fix downgrades ExcelJS to 3.4.0, so it was not applied |
| `npm test` | Exit 0: 3 files, 99 tests |
| `npm run check` | Exit 0: ESLint, typegen + TypeScript, 99 tests, production build |
| Mutation spot-check | 11 deliberate breakages of import guards (formula cache, merges, swap detection, invoice conflicts, partial import, half-up rounding, numeric dates, sub-cent money, line reconciliation, line identity, contradicted date cascade); each made at least one test fail |

Not run for milestone 1: clean `npm ci` (would have replaced `node_modules` under a running dev server), GitHub-hosted CI, a fresh Codespace, and a real Excel-authored 1904 workbook (the 1904 test uses an ExcelJS-written workbook with a raw serial).

### Milestone 1 correction pass (review R1–R3), 2026-09-27

| Check | Result |
| --- | --- |
| New regression tests before fixes | 13 failed as expected: 8 enum-bypass cases, 3 pre-minimum text dates, 2 diagnostics (function missing) |
| `npm test` after fixes | Exit 0: 3 files, 119 tests |
| `npm run check` after fixes | Exit 0: ESLint (no findings), typegen + TypeScript, 119 tests, production build |

## Milestone 2 (limits, upload, report), 2026-09-27

| Check | Result |
| --- | --- |
| Size calibration (throwaway fictional workbook, not saved) | 5k / 25k / 50k rows → 0.49 / 2.49 / 5.03 MiB file; 3.8 / 19.5 / 39.3 MiB sheet XML; 166 / 778 / 1,863 ms load; +36 / +178 / +353 MiB heap |
| Tests before implementation | Limit, report and handler tests each failed first (missing modules or wrong codes). Before the pre-flight check existed, the bomb took about 200 ms to fail as `WORKBOOK_UNREADABLE` |
| Handler mutation check | Removing the Content-Length precheck, the streaming cap, diagnostics-only logging, or `singleSheet` parsing each made a test fail |
| Client bundle inspection | `.next/static/chunks` contains no `exceljs`, `jszip`, `node:zlib` or `inflateRawSync`; the report module is present |
| HTTP smoke test against the running dev server (fictional workbooks in the scratchpad) | Valid → 200, 5 lines / 3 invoices / 259,243 cents, matching a hand calculation. Invalid → 422, `FIELD_REQUIRED` X2 + `INVOICE_ATTRIBUTE_CONFLICT` N3 (related row 2), no lines. Single-sheet mode on 2 sheets → 422 `SHEET_SELECTION_AMBIGUOUS`. Bomb (64 MiB declared as 1 KiB) → 422 `INPUT_EXPANSION_TOO_LARGE` in 3 ms. 5 MiB file → 413, with and without Content-Length. text/csv → 415. No sheet → 400. GET → 405. `GET /` → 200 with the upload form |
| `npm run check` | Exit 0: ESLint, typegen + TypeScript, 183 tests in 6 files, production build (adds dynamic route `/api/sales-imports`) |

Not run: interactive browser use of the upload form and filters (no browser automation available), a fresh `npm ci`, hosted CI, Codespaces, and server-log inspection on the dev server (logging is verified by a unit test with a sentinel).

The milestone 2 heap figures above were retained heap after load, not peak. See the correction pass below and `architecture.md`.

### Milestone 2 correction pass (review R1–R3), 2026-09-27

| Check | Result |
| --- | --- |
| `npm install --save-exact saxes@5.0.1`, `npm install --save-dev --save-exact jszip@3.10.2` | Both were already installed as ExcelJS dependencies. No packages were added, and the lockfile changed only in its root manifest entries |
| New regression tests before fixes | 22 failed as expected (14 archive-layout/differential, 3 body-stream). `workbook-structure.test.ts` could not finish: the vitest worker aborted with SIGABRT (heap exhausted by the unguarded merge, validation and column fixtures) |
| Layout-guard mutation check | Loosening the four new layout equalities (directory/end-record adjacency, end of file, entry tiling, trailing data) made 4 explicit layout tests fail. The differential fuzz accepts 50 of 600 mutants, and JSZip reads the same parts for each of them |
| `npm run check` after fixes | Exit 0: ESLint, typegen + TypeScript, 222 tests in 7 files, production build |
| HTTP smoke test on `next start` (fictional workbooks in the scratchpad) | Valid → 200, 2 lines / 1 invoice, `no-store`. Review merge workbook → 422 `INPUT_TOO_MANY_MERGED_CELLS`. Concatenated ZIP → 422 `WORKBOOK_UNREADABLE`. A client that aborted mid-upload was logged as `sales-import-failed {stage: "read-body", error: "Error"}`, and the next valid upload returned 200 |
| Memory and timing observations (temporary harness, removed) | See the table in `architecture.md`. Pre-scan: about 0.3 s for 25,000 rows. The previous "about 300 MiB worst case" claim was withdrawn |

Not run: interactive browser use of the upload form and filters (no browser or computer-use tool in this session), a fresh `npm ci`, hosted CI, Codespaces, a real Excel-authored workbook (including a 1904 one), a dependency audit rerun, and parsing in an isolated worker with an enforced heap limit.

### Automatic sheet selection requirement, 2026-09-27

Users no longer type a sheet name. The UI always sends `singleSheet=true`. For a workbook with several sheets, the rejected result lists `sheetNames`, and the UI shows one button per sheet.

| Check | Result |
| --- | --- |
| New tests before implementation | 2 failed as expected (`sheetNames` missing) |
| `npm run check` | Exit 0: 223 tests in 7 files |
| HTTP smoke test against the running dev server | The page no longer contains the sheet-name field. `qa-valid.xlsx` with automatic selection → accepted, 3 lines. A two-sheet workbook → `SHEET_SELECTION_AMBIGUOUS` with `sheetNames: ["Sales","Other"]`. The same workbook with `sheet=Sales` → accepted |
| Manual QA (maintainer-reported) | Step 1 pass and step 3 pass on the previous form, with a manually entered sheet name. Steps 2, 4 and 5 were not run. Nobody has viewed the new sheet picker in a browser |

### Milestone 2 R2 follow-up: coordinates outside Excel's grid, 2026-09-27

Reported finding: the pre-scan computed areas from decoded coordinates without checking them against Excel's grid. `A9007199254740992:B9007199254740992` decodes to row 2^53, where ExcelJS's `row++` loop never ends. A 310-digit row decodes to `Infinity`, which gives a `NaN` area that was counted as one cell.

Fix: `workbook-structure.ts` decodes every merged range, data-validation piece and expanded named range, including single cells, with ExcelJS's decoder. It then requires safe-integer rows from 1 to 1,048,576 and columns from 1 to 16,384 before any arithmetic, so the area is at most about 1.7e10 and always finite. Anything else rejects the workbook as `WORKBOOK_UNREADABLE`. A merge without `ref` and a data validation without `sqref` are rejected too. `<col min|max>` values must be in 1–16,384.

| Check | Result |
| --- | --- |
| New regressions before the fix | 12 required cases (2 references × merge, data validation and defined name × selected and unselected sheet) failed because ExcelJS `load` was reached. So did 5 column-bound cases and 4 extra merge cases (single out-of-grid cell, row 0, missing row, row 1,048,577). ExcelJS `load` is replaced by a rejecting stub in every before-load assertion, so no endless expansion ran. The runs finished in milliseconds |
| Grid-guard mutation check | Loosening the guard to "any positive number" made 17 tests fail. Restored |
| Compatibility | A 2 × 2 merge at `XFC1048575:XFD1048576` and `<col min="2" max="16384" hidden="1"/>` are accepted |
| `npm run check` | Exit 0: ESLint, typegen + TypeScript, 245 tests in 7 files, production build |

Before calling the environment Codespaces-verified, create a fresh Codespace using the README steps, run the app/checks there, and replace that limitation with the actual result. Before calling Project 1 complete, collect the business evidence in `review.md`.

## Milestone 3 (delivery contract + synthetic generator), 2026-09-29

| Check | Result |
| --- | --- |
| Territory sources | pt.wikipedia pages fetched in the Codespace (IBGE API and RJ government sites unreachable): ES 78 (matches IBGE's count), Zona da Mata 142 (IBGE microregion table), Grande São Paulo 39, bordering lists for the named seat cities. Região Serrana (15) follows the official list supplied by the maintainer. See `sales-feed-contract.md` |
| `npm run generate:data` (default seed 2026) | 44 closed-month deliveries + pending 2026-09; 6,468 invoices, 19,361 lines, 305 customers after replay; annual deviation +0.04% / −0.03% / −0.06% / −0.10%; Agro 59.98–60.02%; about 1 s (figures after the R1 correction below) |
| Generated output | `data/generated/` confirmed Git-ignored with `git check-ignore` |
| Mutation spot-check | Half-down commission rounding, no territory check, no duplicate-invoice check, missed season not planted, customers placed in another seller's territory: each made at least one test fail. Restored |
| `npm run check` | Exit 0: ESLint, typegen + TypeScript, 313 tests in 13 files, production build |

### R1 correction (reduced purchases), 2026-09-29

Review R1 found that the planted reduced-purchases accounts were not guaranteed to buy less: seed 28 showed +10.52%. The two accounts' 2026 orders are now drawn after all other orders, against 40% of the account's drawn sales from 1 January to 25 September 2025, then nudged to within 0.1%. These invoices are locked, so splits, corrections and calibration never change them. The generator fails if the realized ratio is more than 0.02 from 0.4. The answer-key description states the measured change and periods.

| Check | Result |
| --- | --- |
| Seed probe (0–39, 2026, 4294967295), in memory | Every reduced account between −59.96% and −60.04%; every unit-year within 0.10% of target. Seed 8: C0175 Agro −60.01%, C0233 Home & Garden −60.01%. Seed 28: C0033 Agro −59.97%, C0086 Home & Garden −60.03% |
| New regressions (seeds 2026, 8, 28) | Recompute both periods from replayed invoices and match the answer key; ratio 0.4 ± 0.02; change percent and description match the measured figures; reduced accounts are never split or corrected; unit-year targets within 1% |
| Mutation check | Restoring the old weight-only reduction made the reduction test fail for all three seeds. Restored |
| `npm run check` | Exit 0: ESLint, typegen + TypeScript, 324 tests in 13 files, production build |

Not run: hosted CI, a fresh Codespace, and any endpoint or database behavior (milestone 4). The generator's determinism was checked on Node 24.21.0 only; other Node/V8 versions are expected to match, because the generator uses 32-bit integer random numbers, basic IEEE-754 arithmetic without transcendental `Math` functions, and UTC dates. That was not tested.

## Milestone 4 (Postgres and delivery ingestion), 2026-09-29

Run in the existing Codespace, which predates the Postgres dev-container service. For these checks Postgres 17.11 was installed into the running container from the PGDG apt repository, with a local `biomix` role and database matching the dev-container settings. The compose-based dev container itself was not built (no Docker in this environment).

| Check | Result |
| --- | --- |
| `npm install --save-exact pg@8.23.0`, `npm install --save-dev --save-exact @types/pg@8.23.1` | Lockfile updated |
| `npm run db:migrate` (twice) | First run applied `0001_sales_feed.sql` and synced the reference data; the second applied nothing |
| HTTP flow on `next start` against the dev database | The existing `data/generated/` (written before the Região Serrana spelling fix) was rejected at 2023-08: `CITY_OUTSIDE_TERRITORY` for "Trajano de Moraes"; nothing from it was stored. After `npm run db:reset -- --yes` and `npm run generate:data`, all 44 closed months and the pending delivery were applied: 6,468 invoices, 19,361 lines, 7 replacements. Stored yearly sales equal `summary.json` to the cent. Resending 2025-07 returned the original result with `Idempotent-Replayed`. A delivery with a changed line amount → 422 with located errors, stored data unchanged. A reused delivery ID with different content → 409. Server logs showed IDs, counts and error codes only |
| Rendered report (`GET /` with filters) | Totals R$ 87.963.059,70 / 6.468 invoices / 19.361 lines; Agro 2025 equals a direct SQL sum; the product filter shows the line-scope note; an invalid date shows the period error; an empty period shows zero totals |

| Mutation spot-check | Each of these made at least one test fail: not deleting a replaced invoice's old lines, skipping the payload-hash comparison, not recording rejections, dropping the stored product-unit or customer-owner lookup, no transaction, no advisory lock (caught only after the concurrency tests were changed to queue deliveries behind a held lock), counting lines as invoices, applying the product filter to whole invoices, an exclusive upper date bound. Restored |
| Test-database guard | Without `DATABASE_URL`: 34 database tests skipped with a visible warning. With `CI=1` and no `DATABASE_URL`: the run fails. Test schemas are dropped after each run (none left behind) |
| `npm audit --omit=dev` | The same 2 moderate findings as milestone 1 (`uuid` via ExcelJS); `pg` adds none |
| `npm run check` (with `DATABASE_URL`) | Exit 0: ESLint, typegen + TypeScript, 376 tests in 16 files, production build (adds dynamic route `/api/sales-feed/deliveries`) |

Not run: building the compose-based dev container or a fresh Codespace, hosted CI with the Postgres service, interactive browser use of the report filters (the page was checked through its HTML), and a load test with deliveries near the contract's size limits.

## Milestone 5 (scheduled collections), 2026-09-29

Implemented while milestone 4 was still awaiting review, at the maintainer's request. Both milestones are to be reviewed together. Run in the same Codespace and Postgres 17 as milestone 4, on Node 24.21.0.

| Check | Result |
| --- | --- |
| `npm run db:migrate` on the milestone 4 development database | Applied `0002_scheduled_installments.sql`; the database held no invoices, so nothing was backfilled. The backfill of existing invoices is covered by a database test |
| HTTP flow on `npm run dev` | `npm run generate:data`, then `npm run feed:send` for the 44 closed months and the pending delivery: all applied, 7 replacements |
| Independent SQL reconciliation of the stored data | 6,468 invoices, 12,757 installments. Per term: Upfront 1,456 / 1,456, 30 Days 2,279 / 2,279, 30/60/90 1,910 / 5,730, Upfront/30/60/90 823 / 3,292. Every invoice's installments sum to its lines (0 mismatches); at most 1 cent between an invoice's installments; scheduled total R$ 87.963.059,70 = invoiced sales |
| Rendered page (`GET /` with filters) | Separate collections section; unfiltered totals equal the invoiced sales with the reconciliation check passing. Agro billed 2025-12-01 to 2025-12-31: 31 invoices, 59 installments, R$ 478.157,60, due from 2025-12 to 2026-03. Product filter: the explanatory note instead of collections |
| Mutation spot-check | Remainder to the last installments: 14 tests failed. Due dates through a local-time `Date` plus 24-hour steps: the `America/New_York` time-zone test and the range test failed. Restored |
| `npm run check` (with `DATABASE_URL`) | Exit 0: ESLint, typegen + TypeScript, 441 tests in 18 files, production build |

Not run: interactive browser use (the page was checked through its HTML), a fresh Codespace, hosted CI, and the backfill on a database that actually holds milestone 4 invoices (only in the test schema).

## Milestone 6 (verification and packaging), 2026-09-29

Implemented while milestones 4 and 5 were awaiting review, at the maintainer's request. All three are to be reviewed together. Same Codespace, Postgres 17 and Node 24.21.0.

| Check | Result |
| --- | --- |
| `npm install --save-dev --save-exact esbuild@0.28.2` | Lockfile updated. npm skipped esbuild's install script; esbuild works without it, since the binary comes from its platform package. `npm audit --omit=dev` is unchanged (development dependency) |
| Demo flow on `npm run dev` ([demo](demo.md)) | After `db:reset`: 44 closed months applied. `feed/demo/2026-09-rejected.json` → rejected, 2 errors (`LINE_AMOUNT_MISMATCH` at `/invoices/145/lines/0/lineAmountCents`, `CITY_OUTSIDE_TERRITORY` at `/invoices/2/customer/city`), nothing stored. The pending 2026-09 delivery → applied, 145 added, 1 replaced, 428 lines |
| Manual reconciliation | For each of the 8 unit-years, the invoiced sales in `feed/summary.json`, a direct SQL sum over the dev database, the snapshot's embedded data through `buildSalesReport`, and its scheduled collections through `buildCollectionsReport` are equal to the cent (Agro 2025: R$ 15.584.715,50). Stored installments: 12,757 summing to R$ 87.963.059,70, equal to the snapshot's |
| Browser run | A throwaway headless Chromium (Playwright 1.63.0, `chrome-headless-shell`), with its runtime libraries and fonts unpacked into a temporary session folder, not the container or the project. 23 assertions, all passing. **App:** unfiltered totals, `45 deliveries applied · 1 rejected`, both checks passing, Agro 2025 through the form with the filters in the URL, product filter note, Clear filters, no page errors. **Snapshot from `file://` in an offline context:** same totals as the app unfiltered and for Agro 2025, product note, period error, Clear filters, no request besides the file itself, no console errors or policy violations, no horizontal scroll at 390 px (**incorrect**: the review measured a 497 px page, R3; corrected below), totals readable with JavaScript disabled. Screenshots were checked in light and dark mode and deleted with the folder |
| Mutation spot-check | Removing the script's change listener: the browser-filter test failed. Leaving the pending delivery out of the snapshot: 3 tests failed. Restored |
| `npm run check` (with `DATABASE_URL`) | Exit 0: ESLint, typegen + TypeScript, 462 tests in 20 files, production build |

**Hosted CI, 2026-09-29.** Branch `milestones-3-6` (commit `9fe741e`) pushed to GitHub. "Foundation checks" run 36596471395 succeeded: `npm ci`, `npm run db:migrate` against the Postgres 17 service, `npm run check` (lint, typecheck, the full behavior suite with the database tests, build), `npm run snapshot:build`, and the `report-snapshot` artifact upload (209,551 bytes compressed, kept until 2026-10-29). The `release-snapshot` job was skipped, as intended for a branch push. The run's logs were not read, so the hosted test count is not recorded here.

Not run: a fresh Codespace, the tag-triggered release job and the published download link (no tag has been pushed), and reviewer feedback. These remain the open items of milestone 6.

## Fresh Codespace, 2026-09-29

A new Codespace created by the maintainer from branch `milestones-3-6` (commit `aff1bbe`), built from the compose-based dev container: an Ubuntu 24.04 workspace container and a `postgres:17` service. Nothing was installed by hand. The checks below ran from its terminal.

| Check | Result |
| --- | --- |
| Toolchain | `node --version` → `v24.21.0` (matches `.nvmrc`), npm 11.19.0 |
| Creation steps | `node_modules/` present, `.env.local` written by `setup:env` (mode 600), `DATABASE_URL` set by the dev container |
| Postgres | PostgreSQL 17.11 reached at `localhost:5432` through the shared network. `npm run db:migrate` → `0 applied, 2 already applied`, so the creation step had migrated it. No invoices stored |
| `npm run check` | Exit 0: ESLint, typegen + TypeScript, 462 tests in 20 files, none skipped (the database tests ran), production build |
| `npm run generate:data` | Same figures as the earlier Codespace: 6,468 invoices, 19,361 lines, 305 customers, annual deviation +0.04% / −0.03% / −0.06% / −0.10% |
| Demo flow on `npm run dev` ([demo](demo.md)) | 44 closed months applied. `2026-09-rejected.json` → rejected, `LINE_AMOUNT_MISMATCH` at `/invoices/145/lines/0/lineAmountCents` and `CITY_OUTSIDE_TERRITORY` at `/invoices/2/customer/city`. Pending 2026-09 → applied, 145 added, 1 replaced, 428 lines. Sent again → original result, marked already received |
| SQL reconciliation | 6,468 invoices, 19,361 lines and 12,757 installments; lines and installments each sum to R$ 87.963.059,70. No test schemas left behind |
| Rendered report (`GET /`, checked through its HTML) | `45 deliveries applied · 1 rejected`, R$ 87.963.059,70 unfiltered. `AGRO`, 2025-01-01 to 2025-12-31 → R$ 15.584.715,50, equal to a direct SQL sum. An invalid date shows the period error. The dev server log for the rejection held only IDs, counts and error codes |
| `npm run snapshot:build` | Wrote the 0.90 MiB snapshot |
| Port privacy | An unauthenticated request to the forwarded port 3000 address → 302 to GitHub sign-in, so the port is not public |
| XLSX QA files | The Git-ignored `data/private/qa/` files do not carry over to a new Codespace. They were recreated to the layout in [manual QA](manual-qa.md) and posted to `/api/sales-imports`: `qa-valid.xlsx` → accepted, 3 lines, R$ 2.830,60, commission R$ 141,53. `qa-invalid.xlsx` → `FIELD_REQUIRED` at Sales · X4. `qa-multi-sheet.xlsx` → `SHEET_SELECTION_AMBIGUOUS` listing `Sales` and `Other`; with `sheet=Sales` → accepted |

Waived by the maintainer on 2026-09-29, not performed: opening the forwarded HTTPS preview in a browser, the Ports panel showing **Private**, the [manual browser QA](manual-qa.md) steps through that preview, hot reload of a temporary label edit, and stop/resume followed by a restarted dev server. The browser flows themselves passed earlier in headless Chromium (milestone 6 above and [manual QA](manual-qa.md)), but not through a Codespace's forwarded address.

## Milestones 4–6 review corrections, 2026-09-29

Corrections for the [milestones 4–6 review](reviews/milestone-4-6-review.md) (R1, R2, R3), on branch `milestones-3-6` from `53f68e3`, uncommitted. Same Codespace, Postgres 17.11 and Node 24.21.0. Probes, snapshots and logs stayed under `/tmp`; database probes used new schemas and dropped them. The development data was only read.

| Check | Result |
| --- | --- |
| R1 regressions without the fix | 5 of the new validator, ingestion and endpoint tests fail; all pass with it |
| R2 regressions with the old hash | 6 of the new hash, ingestion and endpoint tests fail; all pass with the new hash |
| `npm run check` (with `DATABASE_URL`) | Exit 0: ESLint, typegen + TypeScript, **477 passed, 0 skipped** in 20 files, production build |
| R1 reproduction | `REVIEW-\ud800` (100 cents) and `REVIEW-\ud801` (200 cents): both `TEXT_INVALID` at `/invoices/0/invoiceNumber`, directly and over HTTP (`422`). Nothing stored. A customer name with `\ud800` over HTTP → `422 TEXT_INVALID` at `/invoices/0/customer/name` |
| R2 reproduction | Reordered top-level and nested fields → original result, replayed, directly and over HTTP (`200`, and `422` for a rejected delivery). Changed content under the same ID → `409` |
| Existing development receipts | All 46 generated deliveries match their stored receipt only by the earlier field-order hash. Ingestion still accepts that hash, so `feed:send` resends replay as before ([database guide](database.md)) |
| R3 browser check | Headless Chromium, snapshot from `file://`, offline, under its policy. Before the fix: 497 px at 390 wide (unfiltered and Agro 2025), 472 px for one customer. After: 390 px in every view (unfiltered, Agro 2025, one customer, one product), wide tables scroll inside their wrappers. 768, 1280 and 1440 px unchanged and fitting. Only the file was requested; no policy violations or page errors. Totals unchanged |
| Live report page | Measured for comparison only: 390 px at 390 wide, unfiltered and Agro 2025, so R3 does not affect it |

The snapshot's bytes changed: the CSS and, through the bundled contract labels, minified names in the script. The embedded data is unchanged.

## Codespaces workflow update, 2026-09-27

Codespaces is now the primary documented environment. The existing devcontainer requests 2 CPUs / 8 GB RAM, waits for `npm ci` before setup completes, and opens the forwarded app port in the browser. Port visibility is checked in GitHub's Ports panel rather than relying on the removed, undocumented `portsAttributes.visibility` property. See [the cloud workflow](codespaces.md).

| Check | Result |
| --- | --- |
| Configuration review | Compared changed settings with the [Dev Container schema](https://github.com/devcontainers/spec/blob/main/schemas/devContainer.base.schema.json) and [GitHub port documentation](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace) |
| Local configuration assertions | Passed: JSON parsing, Node version matches `.nvmrc`, installation command/wait condition, port settings and machine requirements |
| Relative documentation links | All file targets in the changed guides resolve |
| `npm run lint` | Passed |

No application code or dependencies changed; the full behavior suite and build were not rerun for this configuration/documentation update. A GitHub remote is still absent. Creating a fresh hosted Codespace, cloud installation, forwarded HTTPS/hot reload, hosted browser QA and GitHub Actions execution remain unverified; the guide contains the checklist for collecting that evidence.

## GitHub publication preparation, 2026-09-27

The public repository was created and connected as `origin`. Before the first commit, `npm run check` passed locally: lint, route type generation, TypeScript, 245 tests in 7 files, and the production build. Checked the candidate file list and common credential patterns; no source workbooks or credential matches were found. A subsequent documentation privacy pass removed personal and conversation context from public guides and excluded local handoff notes. Git ignore rules exclude those notes, private uploads, local environment files, dependencies, build output, assistant settings, document attachments, exports, screenshots and key files.

This preparation does not establish a successful push, hosted CI run or fresh Codespace launch. Those results remain pending.
