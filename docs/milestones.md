# Delivery milestones

Foundation (prepared by Codex): runnable Next.js shell, VS Code/Codespaces configuration, dependency lockfile, foundation CI, business context, and review guidance. See `docs/setup-verification.md` for actual checks and limitations.

## 1. Import contract and validation — Claude's first task

Implement the XLSX adapter, typed domain input, strict date/money parsing, invoice consistency validation, and structured row issues. Add behavior tests using tiny fictional in-memory workbooks. Include valid multi-line invoices, repeated products, invalid dates, mismatched components, missing IDs, inconsistent invoice attributes, and Brazilian numeric formatting. Add tests to the required checks/CI. Finish with a review summary before moving to the UI.

## 2. One usable reporting path

Build upload → issues or accepted dataset → sales totals and invoice count. Add customer/product/seller/unit/period filters. Show source row counts and reconciliation evidence. Use one format and one dataset per session. Demonstrate that invalid data does not produce a misleading partial report. Add a small public development fixture only with the maintainer's approval; full dataset generation remains separately scoped.

Milestones 3–5 follow [decision 002](architecture-002-clean-data-platform.md). They start only after the milestone 2 review and browser checks are complete.

## 3. JSON contract and synthetic generator

Specify the clean invoice-delivery JSON contract (with an OpenAPI description) and build the seeded generator: one delivery per closed month from January 2023 to August 2026, plus September 1–25, 2026 as the pending next delivery; annual totals within 1% of the maintainer's targets with a 60/40 Agro/Home & Garden split; fictional identities, both business units, seasonality, city-based seller territories with every sale inside its seller's territory, a few corrected invoices resent in later deliveries, and planted scenarios recorded in a separate answer key. Test that the same seed produces identical output and that generated data satisfies the contract rules (exact line amounts, 5% commission, known payment schedules, unique invoice numbers, every customer city inside its seller's territory). Do not commit generated output.

## 4. Postgres and delivery ingestion

Add Postgres to the dev container, versioned SQL migrations and the proposed tables. Build the delivery endpoint: contract checks with located errors, whole-delivery rejection, and record-level updates in one transaction (new invoice numbers added, existing ones replaced with their full line set, nothing deleted). A repeated `deliveryId` returns its original result. Move the report to read from the database. Test that SQL totals match the existing pure report module on the same data, that a rejected delivery leaves stored data unchanged, that a replaced invoice leaves no stale lines, that an invoice outside its seller's territory or for another seller's customer is rejected, and that invoices absent from a delivery are untouched.

## 5. Scheduled collections

Store installments in `scheduled_installments`, generated in TypeScript when an invoice is added or replaced. Aggregate invoice lines once, build equal installments for all four terms, and allocate cent remainders explicitly. Show invoiced sales and scheduled collections separately. Test multiline invoices, non-divisible totals, month/year boundaries, and timezone independence. Check filtered views do not accidentally recalculate contractual invoices using partial product lines; document whether collections filters select whole invoices or intentionally allocated line shares.

## 6. Verify and package Project 1

Reconcile representative source totals manually, run the behavior suite, verify the feed → database → report flow in a browser, and create a short demo with one accepted delivery and one meaningful rejected delivery. Build the downloadable report snapshot ([decision 002](architecture-002-clean-data-platform.md), item 7): a single HTML file generated from the seed, published by CI as a GitHub Release asset and linked from the README. Test that the snapshot's totals equal the application's report on the same data, that it opens from disk without network access, and that it contains no answer-key data. Verify a fresh Codespace, update setup/limitations/contribution sections, and obtain reviewer feedback. Record actual evidence and unresolved risks. Only then begin Project 2 in a separate repository.

Deferred: Project 2 bounded-tool copilot with deterministic evaluations, reaching the database through an MCP server with fixed read-only tools; Project 3 n8n agent with approval, rejection, tool-failure, and duplicate-trigger tests and a fixed-workflow baseline. Neither should be scaffolded here.
