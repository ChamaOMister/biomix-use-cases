# Scheduled collections

Status: implemented in milestone 5, following [decision 002](architecture-002-clean-data-platform.md). Awaiting review.

Scheduled collections are the contractual installments of each stored invoice: what its payment schedule says the customer owes, and when. They are **not** actual payments, receipts or open balances; nothing in the feed records payments.

## Rules

`src/domain/collections/schedule.ts` computes them. It is pure TypeScript, safe for the browser, and does not use AI.

- **One total per invoice.** The invoice total is the sum of all its line amounts, computed once. Installments are never computed per line or per product, since that moves cents between installments. For example, lines of 12,500, 2,997 and 1,250 cents over 3 installments give [5,583, 5,582, 5,582]. Split line by line, they would give [5,583, 5,583, 5,581].
- **Equal installments, remainder first.** The total is split into equal parts. The cents that do not divide evenly go one each to the earliest installments ([data contract](data-contract.md), default 8): 100 → [34, 33, 33], 101 over four → [26, 25, 25, 25]. The installments always sum exactly to the invoice total.
- **All four terms**, with calendar-day offsets from the billing date ([data contract](data-contract.md)):

  | Payment schedule | Installments due (days after billing) |
  | --- | --- |
  | Upfront | 0 |
  | 30 Days | 30 |
  | 3 installments (30, 60 and 90 days) | 30, 60, 90 |
  | 4 installments (Upfront, 30, 60 and 90 days) | 0, 30, 60, 90 |

  Offsets are days, not months: billed 2024-01-30 on 30 days is due 2024-02-29, and billed 2023-01-30 is due 2023-03-01.
- **No time zones.** Due dates are computed with integer arithmetic on ISO `YYYY-MM-DD` dates, with no `Date` object. The tests run under several `TZ` settings, including days that had no local midnight. Postgres stores them as `date`, and the driver returns them as strings (see `src/server/db/pool.ts`).
- **Fixed count.** Each term always has its full number of installments. A total with fewer cents than installments gives zero-cent installments (3 cents over four → [1, 1, 1, 0]). Real invoices are far larger.
- **Representable dates.** The contract rejects a billing date whose last installment would fall after 9999-12-31 (`DATE_INVALID`), so ingestion never meets a due date it cannot store or display.

## Storage

`scheduled_installments` (migration `0002`) has one row per invoice and installment number, with the due date and amount in cents. Ingestion computes the installments in TypeScript and stores them in the same transaction as the invoice ([database guide](database.md)). A replaced invoice's old installments are deleted with its old lines, and the new ones are inserted. Invoices absent from a delivery keep theirs. `npm run db:migrate` also schedules any stored invoice that has no installments yet, such as invoices stored by milestone 4, with the same code.

## Report and filters

The page shows invoiced sales and scheduled collections in separate sections. They use the same filters, taken from the URL. The collections report (`src/domain/collections/report.ts`, with the SQL twin `src/server/collections/stored-collections.ts`) shows the scheduled total, the number of installments and invoices, a breakdown by due month and a breakdown by payment schedule.

**Filters select whole invoices.** Customer, seller, business unit and period are invoice attributes, so a selected invoice brings all its installments.

- **The period selects invoices by billing date**, the same invoices as the sales report. Their installments may fall due after the period. For example, December invoices on 90 days fall due in March. A view of installments *due* in a period is a different question and is deferred (see [due-date filtering](#due-date-filtering-deferred) below).
- **The product filter is not applied to collections.** A product selects individual lines, but installments belong to the whole invoice. Showing them would mean either the whole invoices, which would not match the product's sales, or line shares allocated from each schedule. Neither is chosen, so with a product filter the collections section explains that it is not shown (`FILTER_SELECTS_LINES`). The invoiced-sales section still shows the product's lines.

**Reconciliation.** The page checks that the installments of the selected invoices sum exactly to the invoiced sales of those same invoices. It also checks that both breakdowns sum to the totals. The stored report reads the sales from `invoice_lines`, independently of `scheduled_installments`, so a missing or stale installment shows as a failed check. In the due-month breakdown, an invoice counts in each month where it has an installment due. Only the installment counts and amounts in that breakdown add up to the totals.

## Due-date filtering: deferred

Decided by the maintainer on 2026-09-29 ([Project 1 business decisions](sales-feed-contract.md#project-1-business-decisions)): due-date filtering is **deferred from Project 1**. The existing period filter keeps selecting invoices by billing date, in both sections. Collections include every contractual installment of the selected invoices, even when its due date falls outside that billing period. So the installments always reconcile with the selected invoices' full sales.

A future due-date view ("what falls due in October") should have its own, explicitly labeled controls, separate from the billing period. Those controls select existing installments without recalculating their schedules. The installments due in a period are not expected to equal the full sales of any set of invoices.
