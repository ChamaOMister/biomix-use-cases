# Milestone 1 review — approved after correction pass

## Current decision: milestone 1 approved

Codex independently reviewed the R1–R3 correction pass on 2026-09-27 and reran `npm run check`: exit 0, with ESLint, route type generation, TypeScript, **119 tests in 3 files**, and the production build passing. No remaining blocking findings were identified in this correction pass. This closes the import-contract milestone; it does not certify the future upload/reporting UI, Codespaces setup, or production readiness.

- **R1 resolved:** both workbook-controlled label lookups use `Map.get`. Integration regressions cover inherited property names, case/whitespace variants, the correct issue code, rejection, and absence of partial lines. Existing supported-label tests remain passing.
- **R2 resolved:** the billing-date parser enforces the shared 1900-03-01 minimum for text as well as native dates. Tests cover below/at-boundary ISO, DD/MM/YYYY, and native date inputs. The generic calendar-validity helper remains unchanged.
- **R3 resolved:** issues are documented as user-facing and potentially sensitive. `issueDiagnostics` explicitly copies only severity, code, row, cell, and canonical field. Regression tests show that fictional identity text in unknown headers/sheet names stays out of that projection. No logger was added. This projection is for importer-produced issues, not validation of arbitrary client-supplied objects.

No application code was changed by Codex in this re-review. The reported pre-fix red-test run was not recreated; the current implementation and regression results were inspected directly. Clean milestone-1 installation, hosted CI, a fresh Codespace, and an Excel-authored 1904 workbook remain unverified. The previously recorded dependency advisory and data limitations remain open, without becoming new blockers for this bounded milestone.

### Next task for Claude: milestone 2

```text
Milestone 1 is approved; read the current decision at the top of
docs/reviews/milestone-1-review.md and implement milestone 2 from docs/milestones.md.

First implement and test input resource limits before exposing an upload endpoint.
Bound the compressed request/file and actual workbook expansion/processing, as well
as rows/columns, with controlled errors. Row checks after a full ExcelJS load alone
do not bound decompression memory. Choose modest documented demo limits.

Then build one usable XLSX upload → actionable issues OR accepted dataset → invoiced
sales totals and distinct invoice count, with customer/product/seller/business-unit/
period filters. Preserve whole-import rejection and exact-cent reconciliation.
Keep data scoped to the user's current upload/session; no global mutable dataset.
Use issueDiagnostics for any diagnostic logging, never raw issues or sales rows.

Use tiny fictional in-memory workbooks for tests. Do not generate the full dataset or
publish a new fixture without the maintainer's approval. Include limit/failure cases, multiline
invoice counts, filter reconciliation, and safe accumulated report totals. Verify the
UI success/error paths where tooling permits and report any unrun checks honestly.
Do not implement installment schedules, persistence infrastructure, the copilot, or
n8n. Return docs/review.md's milestone summary and stop for review.
```

---

## Original review (historical; findings resolved above)

Reviewed by Codex on 2026-09-27 against the current working tree. There are no commits, so this review identifies files and reproduced behavior rather than a commit hash. Claude remains the implementation assistant; no application code was changed during this review.

**Decision:** fix R1 before proceeding to milestone 2. Resolve the smaller R2/R3 contract/documentation discrepancies in the same correction pass. The import structure, whole-import rejection policy, invoice-line grain, integer-cent arithmetic, and bounded scope are appropriate for this milestone.

## Findings

### R1 — P2: inherited object properties bypass enum validation

Locations: `src/domain/sales-import/fields.ts:136` and `:156`.

`BUSINESS_UNITS` and `PAYMENT_SCHEDULES` are ordinary objects. Looking up an arbitrary normalized string and testing its truthiness also accepts inherited properties. In a valid one-line XLSX, setting either `Business Unity` or `Payment Schedule` to `constructor` or `__proto__` produces an **accepted** import with no corresponding unknown-label error. The supposed enum field becomes a function or object. This violates the accepted-result contract and can break serialization, unit filters, or future installment selection.

Independent XLSX probes produced:

| Field | Source value | Result | Runtime type of accepted field |
| --- | --- | --- | --- |
| Business Unity | constructor | accepted | function |
| Business Unity | __proto__ | accepted | object |
| Payment Schedule | constructor | accepted | function |
| Payment Schedule | __proto__ | accepted | object |

Use `Map`, an explicit switch, or an own-property guard before accepting lookup results. Add integration regressions for both strings in both fields, including normalization variants. Require the appropriate `BUSINESS_UNIT_UNKNOWN` / `PAYMENT_TERM_UNKNOWN` issue and a rejected result with no partial lines. Retain tests for supported labels.

This is a validation bypass, not evidence of prototype mutation or remote code execution.

### R2 — P3: text dates bypass the documented lower date bound

Location: `src/domain/sales-import/dates.ts:48`; compare `:66` and the milestone choices in `docs/data-contract.md`.

The contract says dates before 1900-03-01 are rejected. The lower-bound check applies only to Date cells. A valid workbook with `Billing Date = "1800-01-01"` and blank day/month/year components is accepted. The same date represented as a Date cell is rejected. Text dates also permit years below the optional year component's lower bound.

Recommended correction: apply the documented minimum consistently at the billing-date validation boundary, with tests just before and at 1900-03-01 for both supported text formats and native dates. If the lower bound is deliberately only an Excel-serial restriction, instead document and test that distinction explicitly; do not claim a universal rejection rule. Historical pre-1900 sales are not needed for this portfolio, so consistent rejection is the simpler default. Do not broaden the generic calendar-validity helper unnecessarily.

### R3 — P3: issue objects are not generally safe to log

Locations: `src/domain/sales-import/types.ts` (ImportIssue comment); `validate-sheet.ts:170` and `:87`.

The code describes issues as safe to log and the handoff says messages never echo identities. Unknown-header messages interpolate arbitrary cell text; sheet-selection messages include arbitrary sheet names, and issue metadata also carries raw sheet/header names. A probe with a fictional identity sentinel in Y1 reproduced that sentinel inside an issue message. A workbook can contain identity information in those places even if ordinary customer-name field errors do not echo their values.

No current logger or actual disclosure was found. Correct the blanket safe-to-log claim now. Keep useful source context in user-facing validation results if desired, but document them as potentially sensitive. Before adding logging in milestone 2, use only an allowlisted diagnostic projection (e.g. issue code, severity, row/cell, canonical field), excluding raw names, messages, headers, values, and caller-controlled identifiers. If a sanitizer is introduced, test it with fictional identity sentinels. Do not add an observability system for this task.

## Checks and review evidence

- Independently ran `npm run check`: exit 0; lint, route type generation, TypeScript, **99 tests in 3 files**, and production build passed.
- Ran 3 temporary reviewer probes through real XLSX serialization/import: enum bypass (four combinations), text-date lower bound, and header identity echo. All three expected protections failed, reproducing the findings above.
- Removed the temporary probe file afterward. Claude's existing source/tests remain unchanged; add permanent regression tests as part of the fixes.
- Inspected the actual supplied reference CSV's date/component columns for the business-question response below. No private identity data was copied into the repository.
- Did not rerun Claude's mutation experiments, clean installation, hosted CI, Codespaces, or an Excel-authored 1904 workbook. Those remain unverified here. A clean install can later be checked in a separate temporary checkout without replacing dependencies under the running server.

## Answers to Claude's two business questions

### 1. Date-cell type, text locale, and numeric months

The supplied context already establishes mixed date representations and contradictions. The CSV export cannot prove whether the original XLSX cells were native dates or text. It contains `03/25/2025` and numeric month `3`, so **do not set DD/MM/YYYY as a blanket assumption for the historical reference**. The first invoice's intended 2023-01-02 correction is a specific confirmed fact, not a general locale rule.

For development, keep native Excel dates and strict explicitly configured text formats. Prefer the existing ISO default for newly generated text dates; keep Billing Month numeric (1–12), with components derived from the authoritative date. These are recommended synthetic-data conventions, not claims about an uninspected ERP export. Do not add month-name support or another text locale without evidence of a requirement. Reject contradictory reference rows and explain the needed source correction. This question does not block the current milestone.

### 2. One-cent differences from quantity × unit price

Keep exact reconciliation for this demo. The supplied scenario defines line amount as package quantity × unit price and provides no evidence authorizing a tolerance. This does not establish that every real ERP behaves that way. If future genuine input demonstrates rounded unit prices, discounts, or taxes, model and document that rule explicitly before relaxing validation. Do not silently allow a cent now.

## Dependency and next-milestone notes

The reported UUID advisory concerns v3/v5/v6 with caller-supplied buffers. Inspection of installed ExcelJS source found UUID v4 usage in its conditional-formatting code; no affected v3/v5/v6 calls were found there. This supports Claude's narrow reachability assessment, not a blanket claim that the dependency is secure. Keep the advisory recorded; do not force-downgrade ExcelJS as part of this correction pass. Source: [GitHub advisory GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

Before introducing an upload endpoint, enforce/document input resource limits, including compressed file size, workbook expansion/processing limits, row/column counts, and controlled failure behavior. Checking row counts only after loading the entire workbook does not bound XLSX decompression memory. This is a milestone 2 prerequisite, not an unimplemented milestone 1 feature being retroactively requested.

Skipping Zod is reasonable given the existing field-specific runtime checks. No requirement mandates that dependency. Unchecked customer/product label consistency across invoices and numeric-ID leading-zero limitations should remain documented and be considered when designing report grouping; they do not justify adding master-data infrastructure now.

## Relay prompt for Claude Code

```text
Read docs/reviews/milestone-1-review.md. Complete a focused milestone 1 correction
pass before starting milestone 2. Fix R1 using own-key-safe enum lookup and add
XLSX regression tests. Resolve R2 by making the documented billing-date range
consistent, and resolve R3 by correcting the safe-to-log contract (no new logging
system). Follow the review's recommended date/month conventions and keep exact
line-amount reconciliation; do not infer a DD/MM/YYYY locale for the old reference.
Update affected docs, run npm run check, and return docs/review.md's summary with
each finding marked addressed or explained. Stop for review before milestone 2.
```
