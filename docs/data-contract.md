# Import contract: reference facts and proposed defaults

Status: implemented for XLSX in `src/domain/sales-import/` (milestone 1); see "Milestone 1 implementation choices" below. The proposed defaults remain reversible. The CSV attachments are reference exports; the application will support XLSX first. The reference sample has 7 lines, 5 distinct invoice numbers, and 24 columns. The structure tab is explanatory and has a different layout; never import it as transactions.

## Column mapping

Preserve misspellings at the import boundary, then normalize names:

| Source | Internal name |
| --- | --- |
| Billing Date | billingDate |
| Billing Day | billingDay |
| Billing Month | billingMonth |
| Billing Year | billingYear |
| Invoince Number | invoiceNumber |
| Customer Business Name | customerName |
| Customer State | customerState |
| City | customerCity |
| Produtc Line | productCategory |
| Product Usage | productUsage |
| Product ID | productId |
| Product Name | productName |
| Type | productType |
| Seller | sellerName |
| Business Unity | businessUnit |
| Payment Schedule | paymentSchedule |
| Quantity | packageQuantity |
| Amount (R$) | lineAmountCents |
| Comission Fee | commissionAmountCents |
| Weight (kg) | sourceWeight |
| Amount per unity (R$) | unitPriceCents |
| Measurement Unity | sourceMeasurementUnit |
| TAX ID | taxId |
| Customer ID | customerId |

`Customer Segment` is a future synthetic-data extension. It is not a required field in the 24-column source. Seller IDs should be introduced explicitly in fictional reference data if needed; the source contains only seller names.

## Confirmed reference facts

- Grain: one invoice product line. Repeated invoice numbers and repeated products within an invoice must remain valid. Generate line identity from import ID + sheet + row, not invoice/product alone.
- Customer/product IDs are stable join keys; invoice number and tax ID are strings. Preserve leading zeroes. Customer/seller names and tax IDs must not be assumed fictional.
- The first reference invoice is intended as **2023-01-02**, despite contradictory date fields. This is a documented reference correction, not permission to hard-code an exception or swap every date.
- Mixed date representations and day/month disagreements require actionable issues. Synthetic dates should be authoritative with derived components.
- Quantity is packages; line amount = packages × unit price. The sample commission is a currency amount calculated at 5%, not a percentage column.
- Business unit is explicit: `Agro` or `Home & Garden`. Do not infer it from fertilizer category or product name.
- Liquid volume is not mass. The source has ambiguous weight/unit labels. Preserve raw information and warn/omit unsupported weight aggregates; never convert ml to kg without density.
- Payment options and billing-relative day offsets: `Upfront` → [0]; `30 Days` → [30]; `3 installments (30, 60 and 90 days)` → [30,60,90]; `4 installments (Upfront, 30, 60 and 90 days)` → [0,30,60,90]. These are calendar-day offsets, not calendar-month arithmetic.

## Proposed implementation defaults (change with a recorded reason)

1. The BI/ERP raw export is a single-sheet workbook (requirement confirmed 2026-09-27). Multi-tab reference workbooks describing structure, products, prices and weights are not the import format. Users never type a sheet name. The upload uses the only sheet automatically. If a workbook has several sheets, the response lists their names and the user picks one. Other sheets are never merged in. The API still accepts an explicit `sheet=` name. Report missing or duplicate columns before row validation.
2. Normalize money to integer BRL cents, using decimal string parsing and safe-integer checks. Accept documented Excel numeric cells and Brazilian currency strings; do not use permissive `parseFloat` on `R$ 1.220,40`. Reject unsupported precision/non-finite values and guard accumulated totals against overflow.
3. Use strict ISO calendar dates internally, independent of the machine timezone. Support Excel dates with the workbook's date system accounted for. Text-date locale must be explicit; reject contradictions with the day/month/year columns and never silently infer mixed formats. Reject invalid calendar dates, formulas, and error cells in required fields.
4. Require nonempty invoice/customer/product IDs and explicit invoice attributes. Define required vs optional descriptive fields in the schema; an unavailable tax ID should not block analysis if a valid customer ID exists. Report missing fields instead of inventing values.
5. Require positive integer package quantities for the initial demo; credit notes, returns, and fractional packages are outside the agreed cleaned-invoice input. Validate line amount against quantity × price. Treat 5% commission as a documented demo convention, with a stated half-up rounding policy.
6. Invoice grouping is within one import. Proposed key: invoice number, **only under an explicit uniqueness restriction for that import**. Require customer, billing date, seller, business unit, and payment schedule to agree across lines. If invoice numbers can be reused by series/issuer/year, require an explicit invoice identity field before grouping; do not silently combine them or invent a series.
7. Ignore fully blank rows with a count; retain row references. Reject partial imports containing blocking issues so reports cannot appear complete after dropping bad rows. Distinguish blocking errors from unsupported optional mass/volume warnings. Return sheet, row, field, code, and suggested correction; avoid raw identity values in server logs.
8. Aggregate each invoice once for installments. Allocate the remainder one cent at a time to the earliest installments. Example: 100 cents / 3 → [34,33,33]. The schedule must sum exactly to its invoice total. Implemented for the clean feed in milestone 5 ([scheduled collections](collections.md)).
9. Upload file size/row caps, duplicate-import policy, and persistence must be documented before public upload functionality. Persistence and the record-level update policy for the planned JSON feed are in [decision 002](architecture-002-clean-data-platform.md). No global mutable shared dataset. No evaluation answer keys as application evidence.

## Milestone 1 implementation choices

These are reversible implementation defaults, not confirmed business rules. Each is pinned by a test in `src/domain/sales-import/import-xlsx.test.ts`.

- **Headers:** row 1; matched case-insensitively and ignoring surrounding whitespace, but only in the source spelling (`Invoice Number` does not satisfy `Invoince Number`). All 24 columns are required. Unknown columns produce a warning and are ignored.
- **Required values:** billing date, invoice number, customer ID and name, product ID, name, and line (category), seller, business unit, payment schedule, quantity, unit price, line amount, and commission. Optional values: tax ID, state, city, product usage, type, weight, measurement unit, and the billing day/month/year components.
- **Dates:** date-formatted Excel cells follow the workbook's 1900 or 1904 date system. Text dates are accepted only in the declared `textDateFormat` (default `YYYY-MM-DD`, alternative `DD/MM/YYYY`), never both. Rejected: plain numbers in the date column, times of day, dates before 1900-03-01 (the same minimum for date cells and both text formats), and any day/month/year component that contradicts the date. A likely day/month swap gets its own `DATE_DAY_MONTH_SWAPPED` issue and is not corrected.
- **Money:** a number cell is converted only when it has at most two decimals. pt-BR text is also accepted, e.g. `R$ 1.220,40`; `.` is only a thousands separator, so `1.220` means R$ 1.220,00 and `12.40` is rejected. Unit price and line amount must be > 0; commission ≥ 0. Line amount must equal quantity × unit price exactly.
- **Commission:** checked only when the caller passes `expectedCommissionBasisPoints` (500 = 5%), with half-up rounding. A mismatch is a warning, not a blocking error.
- **Cells:** formulas (cached results ignored), error values, non-master merged cells, and booleans are rejected in every mapped field. Integer number cells are accepted for IDs, but leading zeroes cannot be recovered from them.
- **Invoices:** grouping requires `invoiceIdentity: "invoice-number-unique-within-import"`. Customer ID, billing date, seller, business unit, and payment schedule must match the invoice's first line. Invoice line/commission totals are summed with safe-integer checks.
- **Labels:** business unit and payment schedule are matched only against an explicit list of supported labels (a `Map`), so names like `constructor` or `__proto__` are rejected as unknown.
- **Result:** any blocking error rejects the whole import and returns no lines. Issues carry sheet, row, cell, source column, internal field, code, message, and suggestion. Field-value messages do not quote mapped data cells, but sheet names and unknown header text are workbook-controlled and can appear in `sheet`, `column`, and `message`. Issues are user-facing and potentially sensitive: never log them whole. Log only `issueDiagnostics(issue)` (severity, code, row, cell, canonical field).

## Milestone 2 input limits

Uploads over any limit are rejected with a located issue (`INPUT_FILE_TOO_LARGE`, `INPUT_TOO_MANY_ENTRIES`, `INPUT_EXPANSION_TOO_LARGE`, `INPUT_TOO_MANY_ROWS`, `INPUT_TOO_MANY_COLUMNS`). Defaults: 4 MiB file, 100 archive entries, 24 MiB inflated per entry, 32 MiB inflated in total, 25,000 rows below the header (blank rows count), 40 columns. The rationale and enforcement order are in `docs/architecture.md`. If the full synthetic dataset needs more rows, change the limit deliberately and re-measure.

## Reviewer clarifications (milestone 1 review)

From `docs/reviews/milestone-1-review.md`. These are recommended conventions for synthetic data, not claims about an uninspected ERP export.

- **Date locale:** the reference CSV contains `03/25/2025` alongside numeric month `3`, so DD/MM/YYYY is **not** assumed for the historical reference. The first invoice's 2023-01-02 correction is a specific fact, not a locale rule. For newly generated data, prefer native Excel date cells or ISO text (the default). Month-name support and other text locales are not added without a demonstrated requirement.
- **Components:** Billing Month stays numeric (1–12); day/month/year are derived from the authoritative billing date. Contradictory reference rows are rejected with an explanation of the source correction needed.
- **Reconciliation:** line amount must equal quantity × unit price exactly; no one-cent tolerance. If real input shows rounded unit prices, discounts, or taxes, model and document that rule before relaxing validation.

Proposed choices are not blockers to creating the foundation. Claude should surface a focused question only if real input contradicts these defaults. Tiny fictional workbooks created inside tests do not stand in for the user's full synthetic dataset.
