# Delivery milestones

Foundation (prepared by Codex): runnable Next.js shell, VS Code/Codespaces configuration, dependency lockfile, foundation CI, business context, and review guidance. See `docs/setup-verification.md` for actual checks and limitations.

## 1. Import contract and validation — Claude's first task

Implement the XLSX adapter, typed domain input, strict date/money parsing, invoice consistency validation, and structured row issues. Add behavior tests using tiny fictional in-memory workbooks. Include valid multi-line invoices, repeated products, invalid dates, mismatched components, missing IDs, inconsistent invoice attributes, and Brazilian numeric formatting. Add tests to the required checks/CI. Finish with a review summary before moving to the UI.

## 2. One usable reporting path

Build upload → issues or accepted dataset → sales totals and invoice count. Add customer/product/seller/unit/period filters. Show source row counts and reconciliation evidence. Use one format and one dataset per session. Demonstrate that invalid data does not produce a misleading partial report. Add a small public development fixture only with the maintainer's approval; full dataset generation remains separately scoped.

## 3. Scheduled collections

Aggregate invoice lines once, build equal installments for all four terms, and allocate cent remainders explicitly. Show invoiced sales and scheduled collections separately. Test multiline invoices, non-divisible totals, month/year boundaries, and timezone independence. Check filtered views do not accidentally recalculate contractual invoices using partial product lines; document whether collections filters select whole invoices or intentionally allocated line shares.

## 4. Verify and package Project 1

Reconcile representative source totals manually, run the behavior suite, verify the upload/report flow in a browser, and create a short demo with one success and one meaningful validation failure. Verify a fresh Codespace, update setup/limitations/contribution sections, and obtain reviewer feedback. Record actual evidence and unresolved risks. Only then begin Project 2 in a separate repository.

Deferred: Project 2 bounded-tool copilot with deterministic evaluations; Project 3 n8n agent with approval, rejection, tool-failure, and duplicate-trigger tests and a fixed-workflow baseline. Neither should be scaffolded here.
