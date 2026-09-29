# Architecture decision 002: clean-data feed, Postgres and shared consumers

Status: accepted direction (2026-09-27). Milestone 3 implemented the JSON delivery contract ([contract](sales-feed-contract.md), [OpenAPI](api/sales-feed.openapi.json)) and the seeded generator ([synthetic data](synthetic-data.md)), [review approved](reviews/milestone-3-review.md) on 2026-09-29. Milestone 4 implemented Postgres, the delivery endpoint and the database-backed report ([database guide](database.md)). Milestone 5 implemented scheduled installments and the collections report ([scheduled collections](collections.md)). Both await review. The report snapshot (item 7) is not implemented. Details marked *proposed* are reversible until their milestone is reviewed. Supersedes the "start without a database" paragraph of [decision 001](architecture.md).

## Context

Biomix's real ERP was messy and its API was closed; the only exit was an Excel export. Agreed conventions turned that export into clean, validated sales data. **This project starts from that clean data.** Fixing the ERP export is out of scope; the existing XLSX importer stays as the already-built path and is not extended.

Several consumers need the same clean data across deliveries: the invoiced-sales report, scheduled collections, the Project 2 copilot and the Project 3 n8n follow-ups. That shared, persistent use, not the ERP's quality, is what justifies a database. It is the owned, clean model placed between the ERP and everything built on top of it (an anti-corruption layer).

## Decision

```text
seeded synthetic generator ──JSON delivery──► POST /api/sales-feed/deliveries ──► Postgres ──► report / collections
  (clean, fictional data)                     (contract checks, one transaction)           ├─► MCP server → copilot (Project 2)
                                                                                            └─► n8n follow-ups (Project 3)
existing XLSX import (unchanged) ───────────────────────────────────────────────────────────┘ (optional later)
```

1. **Simulated clean feed.** A JSON endpoint receives deliveries of clean invoices. It represents clean data arriving from an integration; it does not claim the real ERP pushes JSON. A real integration would map its source format onto this contract.
2. **Postgres** runs as a service in the dev container. Reasons: it is the database commonly used in industry, n8n has a native Postgres node, and the copilot's MCP server can query it directly. SQLite was the lower-setup alternative; it was not chosen because Postgres fits the three planned consumers better.
3. **Plain SQL with versioned migration files. No ORM.** Queries stay visible and reviewable. Domain arithmetic (cents, installments) stays in tested TypeScript or explicit SQL, never in AI.
4. **Monthly deliveries, updated record by record.** By an internal management convention, each delivery carries the invoices of the last closed month. The endpoint does not enforce that convention. The invoice is the record, identified by its invoice number:
   - an invoice number not yet stored is **added**, whatever its billing date;
   - an invoice number already stored is **replaced** as a whole: invoice attributes, its full set of lines and, from milestone 5, its installments;
   - the feed never deletes. Invoices absent from a delivery stay as they are. Cancelled orders are removed upstream, before delivery.

   A delivery is applied in one transaction. If it is rejected or anything fails, stored data does not change.
5. **Seeded synthetic generator.** A deterministic generator (same seed → same data) produces the clean, fictional dataset as one delivery per closed month. Replaying the deliveries in order simulates the feed operating over time. The generated output is reproducible and is not committed. Known planted scenarios live in a separate evaluation answer key that the app, MCP tools and agents cannot read.
6. **MCP comes later.** The Project 2 copilot will reach the database through an MCP server that offers fixed, read-only tools running deterministic queries, not free-form SQL. Nothing MCP-specific is built in Project 1; the schema only needs to answer such questions easily.
7. **Downloadable report snapshot.** Reviewers can see the finished report without installing anything: a single self-contained HTML file that opens by double-click, offline. It embeds the synthetic invoices as stored after replaying the deliveries, plus the same pure TypeScript report and collections modules the application uses, so there is no second implementation of the arithmetic. Filters, totals, breakdowns, reconciliation checks and scheduled collections work in the file. It is read-only and labeled as synthetic data with its as-of date. It never includes the evaluation answer key. Next.js does not produce a file that works from disk, so a small bundler (esbuild, a development dependency) builds the snapshot; the application is unaffected. Like all generated output, the file is not committed. CI builds it from the seed and attaches it to a GitHub Release, and the README links to the download.

## JSON delivery contract (proposed)

Specified and validated in milestone 3; the rules, error codes and defaults are in [the contract](sales-feed-contract.md). Money is integer BRL cents. Dates are ISO calendar dates. The payload is organised by invoice, with lines nested inside, preserving the difference between invoices and invoice lines.

```json
{
  "deliveryId": "8b0c4c1e-4c7a-4f43-9d8e-2a3f0e6b9a11",
  "invoices": [
    {
      "invoiceNumber": "000123",
      "billingDate": "2025-06-12",
      "customer": { "id": "C0042", "name": "Fictional Agro Ltda", "segment": "agricultural reseller", "city": "Viçosa", "state": "MG" },
      "sellerId": "S04",
      "businessUnit": "Agro",
      "paymentSchedule": "3 installments (30, 60 and 90 days)",
      "lines": [
        {
          "productId": "P007",
          "productName": "Fictional Foliar 1 L",
          "productCategory": "Foliar fertilizer",
          "packageQuantity": 12,
          "unitPriceCents": 8990,
          "lineAmountCents": 107880,
          "commissionAmountCents": 5394
        }
      ]
    }
  ]
}
```

The endpoint checks the contract, as any API does: required fields, types, `lineAmountCents = packageQuantity × unitPriceCents`, known seller IDs, business units and payment schedules, the customer's city inside the seller's territory, the invoice's business unit equal to the seller's, the seller equal to the customer's owning seller once that customer is stored, at least one line per invoice, and each invoice number appearing once per delivery. A delivery with any error is rejected whole with located errors (invoice, line, field). Re-sending the same `deliveryId` returns the original result without writing again. The endpoint requires a development API key header. Payment-schedule labels and day offsets follow the [data contract](data-contract.md).

Invoice numbers identify invoices across all deliveries, not only within one. Clean data guarantees that uniqueness. If a source ever reuses numbers by series or year, the contract needs an explicit invoice identity field first ([data contract](data-contract.md), default 6).

## Tables (implemented in milestones 4 and 5)

| Table | Grain | Notes |
| --- | --- | --- |
| `sellers` | seller | ID, name, business unit, territory |
| `territory_cities` | city per business unit | city, state, business unit, seller; at most one seller per city and business unit |
| `customers` | customer | ID, name, segment, city, state, owning seller; upserted, owner never changes through the feed |
| `products` | product | ID, name, category, business unit; upserted |
| `feed_deliveries` | delivery | delivery ID, payload hash, received time, status (applied or rejected); applied: invoices added/replaced, line count, totals, billing-date range; rejected: the located errors |
| `invoices` | invoice | number (unique), billing date, customer, seller, unit, payment schedule, last delivery that wrote it |
| `invoice_lines` | invoice product line | line number within the invoice, product, quantity, unit price, amount, commission (cents) |
| `scheduled_installments` | contractual installment | installment number, due date, amount in cents; computed in TypeScript on add or replace (milestone 5); not actual payments |

Replacing an invoice deletes its lines and installments and inserts the delivered ones. Sellers, customers and products are reference data and are upserted, never deleted by the feed.

## Synthetic data (proposed defaults)

- **Period:** 1 January 2023 to 25 September 2026. The feed replays one delivery per closed month, January 2023 – August 2026 (44 deliveries). The invoices for September 1–25, 2026 are generated as the pending next delivery, so a demo can send it live. Three full years plus 2026 to date allow year-over-year comparisons for both business units.
- **Revenue:** revenue means invoiced sales, the sum of line amounts before commission. Annual totals follow the maintainer's fictional targets, split 60% Agro / 40% Home & Garden every year:

  | Year | Target | Agro (60%) | Home & Garden (40%) |
  | --- | --- | --- | --- |
  | 2023 | R$ 19,000,000 | R$ 11,400,000 | R$ 7,600,000 |
  | 2024 | R$ 22,000,000 | R$ 13,200,000 | R$ 8,800,000 |
  | 2025 | R$ 26,000,000 | R$ 15,600,000 | R$ 10,400,000 |
  | 2026 (to September 25) | R$ 21,000,000 | R$ 12,600,000 | R$ 8,400,000 |
  Generated annual totals land within 1% of the targets, and the generator reports the actual figures.
- **Seasonality:** as in [project context](project-context.md). Agro buys roughly May–October, peaking June–August. Home & Garden buys ahead of Mother's Day, Black Friday and Christmas, up to three weeks before each.
- **Customers:** a few large accounts make up most revenue. Segments: farmer, agricultural reseller, retail chain, garden store, landscaping professional.
- **Sellers and territories:** territories are city-based regions, not states. **Each customer is owned by exactly one seller**, and all of that customer's invoices carry that seller and business unit. **A seller never sells in another seller's territory:** 100% of a seller's invoices go to their own customers, never to a distant city. An Agro and a Home & Garden territory may share a city; each customer there still belongs to only one seller. Each territory has an explicit city list, prepared from public geography. The names come from the maintainer's fictional sample data.

| Seller ID | Name | Business unit | Territory |
| --- | --- | --- | --- |
| S01 | Marcelo Oda | Home & Garden | Grande São Paulo |
| S02 | Sergio Albuquerque | Home & Garden | São José dos Campos, Campinas, Holambra and their bordering cities |
| S03 | Thiago Cruvinel | Agro | Região Serrana (Rio de Janeiro) and the whole state of Espírito Santo |
| S04 | Luis Marcello | Agro | Zona da Mata Mineira |
| S05 | Ricardo Gustavo | Agro | Guaxupé and its bordering cities |

- **Products:** a fictional catalogue per business unit. Invoice rules follow the data contract: package quantities, exact line amounts, 5% commission with half-up rounding, the four payment schedules.
- **Identities:** all customer, seller and product names, and any tax IDs, are fictional.
- **Corrections:** a small number of deliveries may resend an earlier invoice with changes, to exercise replacement.

## Open points

- Project 2 and 3 are separate repositories. How they reach this database (shared container, exported schema, or re-running the generator) is decided when Project 2 starts.
