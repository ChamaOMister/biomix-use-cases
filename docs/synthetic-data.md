# Seeded synthetic feed

Status: implemented in milestone 3 (`src/synthetic-data/`), following [decision 002](architecture-002-clean-data-platform.md). All identities are fictional and all figures are synthetic.

## Run

```sh
npm run generate:data                    # default seed 2026 into data/generated/
npm run generate:data -- --seed 7 --out /tmp/feed
```

Node 24 runs the TypeScript script directly (built-in type stripping); no TypeScript runner is installed. So modules reachable from the script use explicit `.ts` import extensions, which `allowImportingTsExtensions` permits.

| Output | Content |
| --- | --- |
| `feed/deliveries/YYYY-MM.json` | 44 deliveries, one per closed month from 2023-01 to 2026-08, in the [delivery contract](sales-feed-contract.md) |
| `feed/pending/2026-09.json` | 1–25 September 2026: the pending next delivery, for sending live in a demo |
| `feed/demo/2026-09-rejected.json` | The pending delivery with two planted mistakes and its own delivery ID, rejected whole in [the demo](demo.md) |
| `feed/summary.json` | Targets vs. actual annual totals, counts, per-delivery figures (all recomputable from the deliveries) |
| `evaluation/answer-key.json` | Planted scenarios, for evaluation only |

`data/generated/` is Git-ignored. Do not commit generated output; publishing any generated file needs the maintainer's review. The answer key sits in its own folder and is never embedded in deliveries: the application, MCP tools and agents must not read it. Milestone 6's snapshot must exclude it too.

## Determinism

The same seed produces byte-identical output. The generator uses a seeded sfc32 generator with only 32-bit integer operations. Each part (customers, orders, lines, corrections, calibration, delivery IDs) draws from its own forked stream, so tuning one part does not reshuffle the others. It never reads the clock, locale or time zone. Dates are computed in UTC, and sorting compares code units rather than using `localeCompare`. The tests run the script with `TZ=Pacific/Kiritimati` and compare its files with an in-process run.

## Parameters

Set by the maintainer: the period (1 January 2023 – 25 September 2026), annual invoiced-sales targets (R$ 19 M, 22 M, 26 M, and 21 M to 25 September 2026), the 60% Agro / 40% Home & Garden split, the five sellers and their city-based territories, one owning seller per customer, and no sales outside a seller's territory.

Generator defaults (tuning, in `src/synthetic-data/config.ts`):

| Parameter | Default |
| --- | --- |
| Customers per seller | S01 70, S02 55, S03 70, S04 70, S05 40 (305) |
| Account sizes | 7% large, 25% medium, 68% small. Order weight 10–16 / 3–5 / 0.7–1.3; orders per year 14–24 / 6–12 / 2–5; lines per invoice 3–6 / 2–4 / 1–3 |
| Later starters | 15% of each seller's customers, from the small tier, start between July 2023 and August 2026; every seller gets at least one who starts in 2026 |
| Segments | The five listed segments. The mix per business unit and account size is a generator weight, not a business rule: the contract accepts any segment |
| Locations | A city from the seller's territory; a few hub cities per seller are 6× as likely |
| Agro seasonality | Month weights Jan–Dec: 0.25, 0.25, 0.35, 0.5, 1.1, 1.9, 2.1, 1.9, 1.2, 1.0, 0.4, 0.25 |
| Home & Garden seasonality | Base weight 1, plus 3 in the 21 days before Mother's Day (second Sunday of May), Black Friday and Christmas |
| Billing days | Monday–Friday, excluding fixed-date national holidays (20 November from 2024); movable holidays are not modelled |
| Catalogue | 12 Agro and 12 Home & Garden fictional products; list prices × 1.00, 1.045, 1.09, 1.13 for 2023–2026 |
| Payment schedule | The customer's usual schedule on 85% of invoices, otherwise any of the four |
| Repeated product | 2% of multi-line invoices repeat a product on a second line (valid in the contract) |
| Corrections | 6 invoices resent 1–2 months later with a changed package quantity, a removed line or a changed payment schedule, plus 1 August invoice resent in the pending delivery |

## How the data is built

1. Create customers, each owned by one seller and placed in that seller's territory.
2. Draw order days per customer and year from the unit's seasonal weights. A customer never gets two orders on one day.
3. Plant scenarios, then split each unit-year target across its orders in proportion to their weights.
   The two reduced accounts' 2026 orders are the exception: they are drawn after the rest, against 40% of the account's drawn sales from 1 January to 25 September 2025, and nudged to within 0.1% of that amount. The generator fails if either account's 2026/2025 ratio is more than 0.02 from 0.4.
4. Draw products and package quantities per order, bill two orders as split invoices, and number all invoices sequentially in billing order (`000001` onward).
5. Plant corrections. Then nudge package quantities on ordinary invoices until each unit-year total, after corrections, is within 0.1% of its target. The generator fails if any unit-year is more than 1% off. Scenario, split and corrected invoices are not nudged.
6. Group invoices into monthly deliveries; each correction rides in its later delivery.

Line amount is always package quantity × unit price, and commission is 5% rounded half-up.

## Planted scenarios

The answer key reports figures measured from the data after replaying every delivery, not intended values.

| Kind | What was planted |
| --- | --- |
| `missed-season` | An established Agro customer that bought in each May–October season from 2023 to 2025 and has bought nothing since 1 May 2026 |
| `missed-promotion-window` | An established Home & Garden retail chain that bought in the three weeks before Mother's Day from 2023 to 2025, but not in 2026 |
| `reduced-purchases` | One large account per unit whose invoiced sales from 1 January to 25 September 2026 are 40% of the same period in 2025 (a change of about −60%). The description states the measured change |
| `split-invoice` | One order billed as two invoices on the same day with consecutive numbers (2 cases) |
| `new-customer` | Every customer whose first purchase is in 2026, with too little history for year-over-year comparison |
| `corrected-invoice` | Every resent invoice, with its original and correcting deliveries and sales before and after |

Normal seasonality is present throughout and is not listed. A purchasing gap is something to investigate; it does not establish churn or its cause.

## Default seed (2026), synthetic

After replaying all 45 deliveries: 6,468 invoices, 19,361 lines, 305 customers, 24 products. Annual totals differ from target by +0.04% (2023), −0.03% (2024), −0.06% (2025) and −0.10% (2026 to 25 September), with Agro between 59.98% and 60.02%. The top 10% of customers hold 64.5% of revenue. The answer key lists 27 scenarios, 14 of them new customers. Re-run the generator to reproduce these figures; they change whenever a generator default changes.

## Limitations

Customer names combine generic nature and place words ("Fazenda Angico do Horizonte") and contain no personal names. They may still coincide with real businesses by chance. Product names are generic descriptions, not brands. Prices move once a year for every product. Order sizes do not vary by season, only order frequency does. There are no credit notes, returns or cancelled invoices: cancellations are removed upstream by definition.
