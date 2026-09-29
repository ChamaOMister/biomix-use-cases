# Postgres and delivery ingestion

Status: implemented in milestone 4, following [decision 002](architecture-002-clean-data-platform.md). The endpoint `POST /api/sales-feed/deliveries` stores clean-feed deliveries in Postgres, and the report page reads from the database. Milestone 5 added `scheduled_installments` and the collections report ([scheduled collections](collections.md)).

## Setup

**Codespaces / dev container.** The dev container runs two services from `.devcontainer/docker-compose.yml`: the workspace and Postgres 17. The workspace reaches Postgres at `localhost:5432`, and `DATABASE_URL` is set in the container environment. The fixed credentials (`biomix`/`biomix`) are development values for a database that is not exposed; they are not secrets. On creation the container runs `npm ci`, `npm run setup:env` (writes a random `SALES_FEED_API_KEY` to the Git-ignored `.env.local`) and `npm run db:migrate`. **An existing Codespace needs Codespaces: Rebuild Container** to get the database. Data lives in a Docker volume and survives rebuilds.

**Elsewhere.** Run Postgres 17 yourself, then put `DATABASE_URL` in the environment or in `.env.local` (see `.env.example`), and run `npm run setup:env` and `npm run db:migrate`.

| Command | Effect |
| --- | --- |
| `npm run db:migrate` | Applies new files in `db/migrations/`, syncs sellers and territory cities from `src/domain/sales-feed/reference-data.ts`, and schedules the installments of stored invoices that have none (data stored before milestone 5). Safe to repeat |
| `npm run db:reset -- --yes` | Deletes all stored feed data and re-migrates. Development only |
| `npm run setup:env` | Adds a random `SALES_FEED_API_KEY` to `.env.local` if it has none; never prints it. Restart `npm run dev` afterwards |
| `npm run feed:send -- <files or directories>` | Posts delivery files in name order to the running app; stops at the first delivery that is not applied. `--url` changes the target (default `http://localhost:3000`) |

## Demo flow

```sh
npm run generate:data                                       # data/generated/ (Git-ignored)
npm run dev                                                 # in one terminal
npm run feed:send -- data/generated/feed/deliveries         # in another: 44 closed months, in order
npm run feed:send -- data/generated/feed/pending/2026-09.json
```

[The demo](demo.md) adds a rejected delivery before the pending one. Open the app: the report shows the stored invoices, with filters in the URL. Sending the same files again returns their original results (`already received`). If the generator changed since the last send, the regenerated files carry the same delivery IDs with different content and are refused with `409 DELIVERY_ID_REUSED`. Run `npm run db:reset -- --yes` first.

## Tables

The schema is in [`db/migrations/0001_sales_feed.sql`](../db/migrations/0001_sales_feed.sql) and [`0002_scheduled_installments.sql`](../db/migrations/0002_scheduled_installments.sql). It follows the tables proposed in decision 002, with these details:

- `feed_deliveries` has one row per received delivery ID: status `applied` with the counts, totals and billing-date range, or status `rejected` with the located errors. It also stores a SHA-256 of the payload to detect a reused ID. The payload is parsed and re-serialized with the fields of every object sorted, so neither whitespace nor object field order matters; array order and every value do (the order of lines sets their line numbers).
- **Receipts recorded before field order was ignored** (review R2, 2026-09-29) hold the hash of the payload in the sender's field order. The payload itself is not stored, so they cannot be converted. Ingestion therefore accepts either hash as the same content: such a receipt still replays when resent in its original field order, exactly as before, and `npm run feed:send` resends the same files in the same order. Only a resend of an old receipt with a different field order is still refused (`409`). No migration or reset is needed; after `npm run db:reset -- --yes` every receipt uses the new hash.
- `invoice_lines` is keyed by invoice number and `line_number`, the line's 1-based position in the delivered invoice. So repeated lines of the same product stay distinct. The line also repeats the invoice's business unit, only so that a foreign key can require the product to belong to that unit.
- Codes, not labels: business units are stored as `AGRO`/`HOME_GARDEN`, payment schedules as `UPFRONT`, `NET_30`, `INSTALLMENTS_30_60_90`, `INSTALLMENTS_0_30_60_90`. Money is `bigint` cents and dates are `date`.
- Constraints repeat the key contract rules as a second line of defence: line amount = quantity × unit price, positive amounts, the invoice's seller is the customer's owner, the invoice's unit is the seller's, the product's unit is the line's, and the customer's city is in the owner's territory.

Migrations are append-only: each applied file is recorded with a checksum in `schema_migrations`, and `db:migrate` refuses to run if an applied file changed. Change the schema by adding `0002_….sql`.

## How a delivery is applied

`src/server/sales-feed/ingest.ts`, in one transaction:

1. Take a transaction-level advisory lock. Deliveries are applied one at a time, so two senders can never interleave, and a delivery sent twice at once is applied once. Monthly deliveries make this serialization cheap.
2. If the `deliveryId` was already received: same content, in any object field order → return the stored result (header `Idempotent-Replayed: true`); different content → `409`. Nothing is written.
3. Read the stored owners of the delivery's customers and the stored business units of its products. Validate the payload against the contract with them. A customer keeps its owning seller, and a product keeps its business unit (`CUSTOMER_SELLER_MISMATCH`, `PRODUCT_ATTRIBUTE_CONFLICT`).
4. Any error → record the rejection in `feed_deliveries` and change nothing else (`422`). A corrected delivery needs a new `deliveryId`. A payload without a valid `deliveryId` cannot be recorded; it is just rejected.
5. Otherwise record the delivery, upsert its customers (details update; the owner never changes) and products (name and category update; the unit never changes). Delete the old lines and installments of every invoice being replaced, upsert the invoices, insert all delivered lines, and insert each invoice's installments, computed in TypeScript from its whole line set ([scheduled collections](collections.md)). Invoices absent from the delivery are not touched; nothing is deleted.

If any statement fails, the transaction rolls back and nothing is recorded, not even the delivery ID (`500`). The same delivery can be sent again.

The last applied delivery wins and the sender is responsible for delivery order; there is no cancellation ([Project 1 business decisions](sales-feed-contract.md#project-1-business-decisions)).

The endpoint (`src/server/sales-feed/delivery-handler.ts`) checks, in order: the API key is configured (`503`), the `X-Api-Key` header matches (`401`, compared in constant time), `Content-Type: application/json` (`415`), at most 16 MiB (`413`), and UTF-8 JSON (`400`). Server logs record the delivery ID, outcome, counts and error codes only, never payload values or messages.

## Report

`src/server/sales-report/stored-report.ts` computes the totals, month and business-unit breakdowns in one SQL statement (`GROUPING SETS`). It returns the same `SalesReport` shape as the pure `buildSalesReport` and shares its filter checks and reconciliation. The seller filter uses the seller ID. The tests replay the full seeded feed into Postgres and require both implementations to return identical sales and collections reports for a set of filters.

The page is a server component: filters are a GET form, so every filtered view has its own URL. Without a database, or before `db:migrate`, the page explains what to run instead of failing.

`src/server/collections/stored-collections.ts` computes the scheduled collections of the same filters in one SQL statement: totals, due-month and payment-schedule breakdowns, and the invoiced sales of the selected invoices read from `invoice_lines`, for the reconciliation. It returns the same result as the pure `buildCollectionsReport`. Filters select whole invoices; a product filter is refused. See [scheduled collections](collections.md).

The XLSX upload is unchanged: it validates a workbook and shows an in-browser report of that file only. It stores nothing.

## Tests

The database tests (`src/server/**/*.test.ts`) use the database in `DATABASE_URL`. Each test file creates its own schema (`test_…`), migrates it and drops it afterwards. So they can run in parallel, and they never touch the development data. Without `DATABASE_URL` they are skipped with a warning. In CI (`CI` set) a missing database fails the run instead. GitHub Actions starts a Postgres 17 service for them.
