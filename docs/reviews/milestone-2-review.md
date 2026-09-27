# Milestone 2 review — code corrections approved; browser QA pending

## Current verdict — R2 follow-up and sheet selection verified by Codex, 2026-09-27

**R2 is closed, including the out-of-grid coordinate follow-up. R1 and R3 remain closed. No new blocking code finding was identified in this targeted working-tree review. Milestone 2 still needs browser acceptance before Milestone 3 starts.** All project files remain untracked; this review used their current contents, not a commit diff.

Codex inspected `referenceArea()` and `columnAttribute()`, their callers, the before-load regressions, and the installed ExcelJS defined-name parsing/expansion code. Merge references, data-validation pieces and expanded named references (including single cells) must have safe-integer coordinates inside Excel's grid before area arithmetic. Invalid coordinates return `WORKBOOK_UNREADABLE`; the old fallback to one cell is gone. Missing merge/data-validation references are rejected, and supplied column min/max attributes are bounded using ExcelJS's integer parsing behavior.

The regressions cover both reported extreme references across merges, validations and defined names, on selected and unselected sheets. Before-load assertions install a rejecting load stub and explicitly assert **zero load calls and zero cell-materialization calls**; receiving `WORKBOOK_UNREADABLE` from the stub alone cannot make a test pass. Boundary compatibility cases for the last Excel row/column also pass. This closes the reported R2 defects; it does not establish a universal heap/time bound. The architecture's distinction between memory observations and enforced limits remains appropriate.

**Independent verification:** `npm run check` exited 0: ESLint, route type generation, TypeScript, **245 tests in 7 files**, and production build passed. Claude's pre-fix and mutation results in `setup-verification.md` were read, not independently repeated in this follow-up. No application code, tests, dependencies or datasets were changed by this review.

**Sheet selection is approved by code inspection and automated coverage.** The initial upload sends `singleSheet=true`; a workbook with exactly one sheet is selected automatically. A failed selection returns `sheetNames`, and the UI renders one button per name. Clicking a button resubmits the retained file and text-date format with `sheet=<name>` (so the UI does not *always* send `singleSheet=true`). There is no sheet-name text field. Selection failures list names, ordinary validation failures do not, and sheets are never combined.

**Remaining Milestone 2 acceptance work:** Manual QA steps 1 and 3 passed on the previous form, with a manually entered sheet name. They do not verify the new form. Confirm automatic single-sheet import and a multi-sheet button selection in a browser, then complete manual QA steps 2, 4 and 5 (filter/clear, recovery with reset filters, and clearing the report on reload). Nobody has verified the new picker visually. Earlier computer-use access in this review conversation returned **“Computer Use permissions are not granted.”** Browser access was not retried during this follow-up; no browser pass is claimed. Record those results in `manual-qa.md` before declaring Milestone 2 QA-complete or starting Milestone 3.

Fresh installation, hosted CI/Codespaces, representative Excel-authored compatibility and dependency-audit results are not established by this local review. They remain the previously documented verification limitations, not newly discovered R2 blockers.

**Continuation after this verdict:** At the user's request to finish QA, Codex retried Chrome access. The tool again returned **“Computer Use permissions are not granted.”** Browser acceptance remains blocked by access. The handoff and manual checklist now reflect the approved code and the exact pending UI checks; no additional coding task is assigned unless those checks reveal a defect.

## Follow-up submission (Claude's response; verified above)

A remaining R2 defect was reported: range areas were computed from decoded coordinates without Excel-bound checks. For `A9007199254740992:B9007199254740992` (row 2^53), ExcelJS's `row++` loop cannot advance. A 310-digit row decodes to `Infinity`, and the resulting `NaN` area was counted as one cell.

Claude's correction (2026-09-27): `workbook-structure.ts` now validates every decoded coordinate before computing an area. This covers merged ranges, data-validation pieces and expanded named ranges, including single cells. Rows must be safe integers from 1 to 1,048,576 and columns from 1 to 16,384. Invalid or non-finite values reject the workbook (`WORKBOOK_UNREADABLE`) and are never counted as one cell. `<col min|max>` is bounded the same way.

Regressions in `workbook-structure.test.ts` cover both references for merges, data validations and defined names, on the selected and on an unselected sheet. ExcelJS `load` is stubbed to reject in every before-load assertion, so no potentially endless expansion runs. Every case failed before the fix and passes after it. `npm run check`: exit 0, 245 tests. Details are in `setup-verification.md`.

Also since approval, the upload requirement changed: users no longer type a sheet name. The only sheet is used automatically, and for workbooks with several sheets the UI offers the sheet names returned by the server.

At submission, Milestone 3 was on hold pending Codex's verification and browser QA. The current verdict above supersedes that verification status; browser QA is still pending.

## Earlier correction-pass decision (historical; superseded by the current verdict above)

Codex reviewed the R1–R3 fixes on 2026-09-27 and independently ran `npm run check`: exit 0; ESLint, route types, TypeScript, **222 tests in 7 files**, and production build passed. The reproduced R1–R3 defects are resolved in the reviewed code. No new blocking finding was identified in this targeted correction review. This is not a complete archive-security audit or a production-deployment approval.

- **R1 resolved:** directory/end-record adjacency and exact local-entry layout prevent the previously reproduced ZIP origin shift. Additional supported-layout and downstream-reader comparison regressions pass.
- **R2 resolved for the reported cases:** a bounded structure scan runs on verified worksheet/workbook parts before ExcelJS loading, including unselected sheets. Tests assert rejection before loading/materializing oversized merges and other covered ranges. The unsupported worst-case heap claim has been removed. Remaining memory/concurrency/time limitations and internal ExcelJS coupling are documented.
- **R3 resolved:** read/cancel failures follow the documented controlled paths; tests cover JSON/no-store responses, a released reader lock, and preserving 413 when cancellation fails.

**Interactive browser acceptance remains pending.** Use [the corrected short manual checklist](../manual-qa.md). Finish and record the visible upload/filter/error/recovery flow before declaring milestone 2 fully QA-complete and moving to milestone 3. Do not treat the checklist itself as evidence that it passed.

Codex additionally ran two small temporary in-memory workbook probes to verify the checklist: a 20 × 10 merge on an unselected sheet was accepted; a 40 × 30 merge was rejected with `INPUT_TOO_MANY_MERGED_CELLS`. Both checks passed and the temporary test file was removed. No application implementation or full dataset was changed/generated during this review.

The originally supplied manual checklist needs two corrections: 200 merged cells do not exceed the new 1,000-cell limit, and closing a tab does not guarantee that a fast upload is still in progress. The latter is a developer-controlled failure test, not a required manual acceptance task.

Fresh dependency installation, hosted CI, Codespaces, real Excel-authored workbook compatibility, and a fresh dependency audit remain unverified in this review. Claude's reported HTTP disconnect and memory measurements were read, not independently repeated here.

---

## Original review (historical; findings resolved above)

Codex reviewed the current working tree on 2026-09-27. **Do not proceed to milestone 3 yet.** The reporting implementation and existing checks pass, but independent probes reproduced two gaps in the required input-resource boundary and an uncontrolled request-stream failure. These are concrete defects, not hypothetical public-deployment requirements.

No production implementation was changed during this review. Temporary probes used small fictional inputs and were removed afterward. No large memory-exhaustion workload or real private workbook was used.

## R1 — P1: preflight and JSZip can inspect different ZIP payloads

Location: `src/domain/sales-import/archive-limits.ts:92`; downstream load at `xlsx.ts:74`.

The check permits a gap between the declared central-directory end and the actual end-of-central-directory (EOCD) record. It interprets offsets as absolute. Installed JSZip adjusts its reader origin when it sees such a gap (`node_modules/jszip/lib/zipEntries.js`, `readEndOfCentral`). A concatenation of two specially aligned small ZIPs therefore makes preflight inspect the first archive while JSZip reads the second.

Reproduced with a **1,024-byte** expansion limit:

- Preflight returned `{ ok: true }` after inspecting a **20-byte** stored entry.
- JSZip loaded the same bytes and returned a **4,096-byte** inflated entry.
- This bypasses the very expansion cap intended to protect the subsequent ExcelJS load. The probe establishes the reader discrepancy; it did not attempt server exhaustion or claim the one-entry probe was a complete accepted XLSX.

Small reproduction using the existing test ZIP builder:

```ts
const payload = new Uint8Array(4096);
const compressedLength = deflateRawSync(payload).byteLength; // 20
const name = "xl/worksheets/sheet1.xml";
const prefix = buildZip([{ name, data: new Uint8Array(compressedLength), method: 0 }]);
const actual = buildZip([{ name, data: payload }]);
const bytes = new Uint8Array(Buffer.concat([prefix, actual]));
const limits = {
  ...DEFAULT_INPUT_LIMITS,
  maxEntryUncompressedBytes: 1024,
  maxTotalUncompressedBytes: 1024,
};
checkArchiveLimits(bytes, limits); // currently ok: true
const zip = await JSZip.loadAsync(bytes);
(await zip.file(name)!.async("uint8array")).length; // 4096
```

**Required correction:** make the checked archive and downstream archive interpretation agree. For this restricted demo, rejecting prefixed/concatenated/structurally ambiguous archives is reasonable. Validate directory/EOCD placement, counts, offsets, comment/end boundaries, and other supported ZIP structures consistently; do not merely add a special case for this exact payload. Alternatively pass downstream a canonical archive built only from bounded, verified entries. Add differential regression coverage against the installed downstream reader and assert rejected inputs never reach ExcelJS. Retain valid ExcelJS-generated workbook and ordinary ZIP compatibility tests. Do not claim a complete ZIP security audit from these checks.

## R2 — P1: workbook structures expand before row/column limits apply

Location: `src/domain/sales-import/xlsx.ts:74` (load), with selected-sheet limits only at `:92` and `:100`. Related claim: `docs/architecture.md`, the approximately 300 MiB worst-case heap estimate.

ZIP expansion bytes do not bound the number of cells ExcelJS materializes. During `workbook.xlsx.load`, ExcelJS applies merged ranges by visiting every cell in each range (`node_modules/exceljs/lib/doc/worksheet.js`, `_mergeCellsInternal`). This happens for unselected sheets too, before this importer's extent checks.

Bounded reproduction:

1. Build a workbook with a valid one-line `Sales` sheet and a second sheet `Other`.
2. Replace `xl/worksheets/sheet2.xml` using JSZip with this **163-byte** XML:

```xml
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/><mergeCells count="1"><mergeCell ref="A1:CV100"/></mergeCells></worksheet>
```

3. Re-zip with DEFLATE and import `Sales`, setting `maxDataRows: 10` and `maxColumns: 24`.
4. The **7,236-byte** workbook is accepted. A temporary spy on ExcelJS `Worksheet.prototype.getCell` recorded **10,000 calls** from the unselected merge expansion. The test was deliberately small and the spy was restored afterward.

Larger range coordinates require little additional XML, so the measured 9× heap ratio for regular sales rows cannot establish a worst-case bound. Checking the selected sheet after loading is too late to prevent this work even if the same merge appears on that selected sheet and is eventually rejected.

**Required correction:** reject or bound structural amplification before ExcelJS expands it, covering all loaded sheets. Rejecting merged ranges early is a reasonable restricted-import policy; use proper bounded XML parsing and validate relevant extents/ranges rather than an easily bypassed text regex. Apply effective parser limits where supported, or isolate parsing with enforceable resource limits if needed. Keep this focused on the demo importer, not a new service. Add selected- and unselected-sheet regressions proving rejection occurs before cell materialization, and correct the documentation: measured memory use is an observation, not a proven maximum.

## R3 — P2: body read/cancel errors escape the controlled HTTP boundary

Location: `src/server/sales-import-handler.ts:119` and `:124`; the try/catch begins only around import at `:132`.

`reader.read()` and body cancellation can reject, for example when an upload disconnects. A request built with a `ReadableStream` whose controller errors with a fictional sentinel makes `handleSalesImportUpload` reject its promise. It does not return the promised generic JSON response with `Cache-Control: no-store`. Raw exceptions can then reach framework error handling instead of this handler's diagnostic policy; no actual private-data disclosure was asserted or observed.

**Required correction:** include request reading/cancellation in a controlled boundary, release reader resources, and return a documented non-sensitive response when a response can still be delivered. A known oversized upload should remain 413 even if best-effort cancellation fails. Test read failure and cancellation failure, status/content type/cache headers, and absence of the error-message sentinel from application logs and response. Do not echo arbitrary exception messages.

## Verification and scope

- Independently ran `npm run check`: exit 0; ESLint, route types, TypeScript, **183 tests in 6 files**, and production build passed.
- Ran three additional temporary regression probes: ZIP interpretation disagreement, unchecked merge expansion, and failed body-stream handling. All three expected protections failed as described above. The probe file was removed after evidence was recorded.
- Inspected report logic/tests: distinct invoice counting, product-line scope, inclusive periods, combined filters, exact cents, and overflow rejection are consistent with the current validated-input contract. No additional blocking arithmetic finding was identified.
- Reviewed UI source for issue rendering, filter wiring, and clearing the prior report when a new submission starts. This is code inspection, **not interactive browser verification**.
- Attempted Chrome access through the available computer-use tool. Chrome was present but access failed with **“Computer Use permissions are not granted.”** No connected browser surface was available. Do not claim the upload/filter UI was exercised.
- Did not repeat Claude's curl/manual reconciliation or mutation experiments. Fresh installation of current dependencies, hosted CI, Codespaces, and an Excel-authored 1904 workbook remain unverified.
- The previously recorded UUID advisory remains tracked; this review did not rerun a dependency audit.

## Answer to the dataset-size question

The eventual synthetic dataset size has not been specified. Keep **25,000 lines** as a documented provisional limit; there is no evidence yet to raise it. The compressed/expanded limits apply independently, so not every 25,000-line workbook is guaranteed to fit. Re-measure representative data if the actual dataset later exceeds any limit.

Do not automatically split by year or drop rows. Splits must preserve complete invoices and make the reduced reporting period explicit. The later copilot's year-over-year analysis still requires the relevant multi-year history. Full synthetic dataset generation remains separately scoped; this question does not block the correction pass.

## Relay prompt for Claude Code

```text
Read docs/reviews/milestone-2-review.md and complete a correction pass for R1–R3.
Close the reproduced ZIP reader mismatch and pre-load merge/range amplification;
cover failed request-body reads/cancellation with controlled errors. Add focused
regressions using small fictional inputs, and update the memory-limit claims.
Keep the 25,000-line limit provisional; do not generate or split the full dataset.

Preserve the working report behavior and run npm run check. Verify the interactive
upload/filter success and failure paths if browser access is available; otherwise
record the exact limitation and provide a short manual QA checklist. Return the
docs/review.md summary with each finding addressed or explained. Stop before
milestone 3 for another review.
```
