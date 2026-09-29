# Manual browser check

A **workbook** is an entire Excel file (`.xlsx`). A **worksheet** or **sheet** is one tab inside it. For example, `qa-valid.xlsx` could contain a tab called `Sales`.

The automated tests check calculations and failure handling. This short manual check verifies what you see when using the upload form and filters. Code review and a passing build do not establish that the browser flow was exercised; see the recorded results below.

## Preparation

Ask Claude to provide two tiny fictional QA files, with the same layout and known expected totals:

- `qa-valid.xlsx`: two invoices, three lines, two products/customers, with all required columns. Have Claude list expected totals for the complete file and for a product/customer filter.
- `qa-invalid.xlsx`: the same workbook with one Customer ID blank; all other values remain valid.

These are small QA inputs, not the full synthetic dataset. Keep them in an ignored local QA folder such as `data/private/qa/`; do not use real customer information. Claude generated both on 2026-09-27 in `data/private/qa/`. The expected results were computed with the app's own upload and report code.

Expected results for `qa-valid.xlsx`:

| View | Invoiced sales | Invoices | Lines | Commission |
| --- | --- | --- | --- | --- |
| No filter | R$ 2.830,60 | 2 | 3 | R$ 141,53 |
| Product P-QA-A | R$ 1.830,60 | 2 | 2 | R$ 91,53 |
| Product P-QA-A + customer C-QA-01 | R$ 1.220,40 | 1 | 1 | R$ 61,02 |
| Customer C-QA-01 | R$ 2.220,40 | 1 | 2 | R$ 111,02 |
| Customer C-QA-02 | R$ 610,20 | 1 | 1 | R$ 30,51 |

`qa-invalid.xlsx` is rejected with one issue: `FIELD_REQUIRED` at Sales · X4, Customer ID.

Results so far (maintainer-reported, 2026-09-27): step 1 **pass** and step 3 **pass**, both on the previous form where a sheet name was typed. After approving the R2 follow-up, Codex retried browser access and received **“Computer Use permissions are not granted.”** This was an access blocker, not a failed application test.

Automated browser run (Claude, 2026-09-29), on the current form: **all steps pass, including the sheet picker.** A throwaway headless Chromium (Playwright 1.63.0, `chrome-headless-shell` 153) ran inside the Codespace against `npm run dev`. It did not use the maintainer's own browser. The script, browser and system libraries were kept in a temporary session folder and deleted afterwards; no project dependency was added. The script made 22 assertions against the rendered page, all passing:

| Step | Checked | Result |
| --- | --- | --- |
| Form | No sheet-name text field | pass |
| 1 | `qa-valid.xlsx` with no sheet name: R$ 2.830,60 · 2 · 3 · R$ 141,53; source reconciliation shows “(match)” | pass |
| 2 | P-QA-A; P-QA-A + C-QA-01; **Clear filters** restores totals and resets both selects; C-QA-01 alone; C-QA-02 alone — all five rows of the table above | pass |
| 3 | `qa-invalid.xlsx` (uploaded while a filter was set): “Import rejected: no report produced”, one issue `FIELD_REQUIRED` at Sales · X4, Customer ID; totals and report heading gone | pass |
| 4 | `qa-valid.xlsx` again: original totals, customer and product filters start empty | pass |
| 5 | Reload: upload form shown, no totals or report heading | pass |
| Sheet picker | `qa-multi-sheet.xlsx`: buttons **Sales** and **Other**, no text field; clicking **Sales** gives the three-line totals | pass |

The browser console showed no errors other than the two expected HTTP 422 responses, which the dev server log identifies as the `FIELD_REQUIRED` and `SHEET_SELECTION_AMBIGUOUS` rejections. Screenshots were inspected for steps 3 and the picker. This is automated evidence from a headless browser. The maintainer accepted it as Milestone 2 browser QA on 2026-09-29.

If needed, relay this task to Claude:

```text
Prepare the two tiny fictional .xlsx QA files described in docs/manual-qa.md in
data/private/qa/, plus exact expected totals and filter results. This is permission
to create those small local QA fixtures, not the full three-year dataset or public
fixtures. Use a Sales sheet in each. Do not implement milestone 3 yet.
```

From the project terminal, run `npm run dev` if the app is not already running. Open the localhost link printed in that terminal (normally `http://localhost:3000`); in Codespaces open the forwarded app port. Keep the terminal running.

## Your short checklist

1. Upload `qa-valid.xlsx` (no sheet name is needed; the app uses the file's only sheet). Confirm the sales total, invoice count, and line count match the expected results above.
2. Choose a product, then a customer filter. Confirm the numbers match the expected filtered results. Click **Clear filters** and confirm the original totals return.
3. Upload `qa-invalid.xlsx`. Confirm an issue identifies the missing Customer ID and its row/cell. The old report/totals must disappear; no partial report should replace them.
4. Upload `qa-valid.xlsx` again. Confirm it works and the filters start cleared.
5. Reload the page. Confirm the uploaded report disappears, as the application promises.

Also verify the new sheet picker with a tiny fictional workbook containing the valid `Sales` sheet and an unrelated `Other` sheet. The upload should show one button for each sheet and no sheet-name text field. Click **Sales** and confirm the same three-line totals shown above. This check passed in the 2026-09-29 automated browser run above. Claude generated `qa-multi-sheet.xlsx` for it in `data/private/qa/` (a `Sales` sheet identical to `qa-valid.xlsx` plus an `Other` sheet with one fictional note). The app's own import code rejects it with `SHEET_SELECTION_AMBIGUOUS`, lists `Sales` and `Other`, and accepts the three `Sales` lines once `Sales` is selected.

Record pass/fail for each step. If something differs, report the step, expected result, and actual result; a screenshot of these fictional test results can help.

## Technical checks you do not need to perform manually

- **Merged ranges:** the earlier checklist's 20 × 10 block is only 200 cells, below the current 1,000-cell workbook-wide limit. It should not be rejected solely for merge size on another sheet. Codex independently verified that a 200-cell merge on an unselected sheet is accepted, while a 40 × 30 merge (1,200 cells) is rejected. Merges inside mapped sales fields are a separate validation rule. For an optional UI check, let Claude prepare an oversized-merge file; do not manually construct one.
- **Over-4-MiB file:** the automated handler tests cover server-side size rejection. Claude can provide a prepared file if the visible browser size message also needs checking; you do not need to create a large spreadsheet.
- **Closing a tab mid-upload:** not a reliable manual assertion. A small local upload can finish before the tab closes, so absence of a `read-body` error log does not prove a defect. Claude reported a controlled client-abort test, and the automated stream-failure tests pass. Leave this test and log inspection to the developer/reviewer.

The 1,000 merged-cell limit and 25,000 sales-line limit are provisional demo defaults, not facts about Biomix's actual exports. Confirm compatibility when a representative export is available; no business decision about these limits is needed to perform the UI check.
