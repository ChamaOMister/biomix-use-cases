# Downloadable report snapshot

Status: implemented in milestone 6 ([decision 002](architecture-002-clean-data-platform.md), item 7), [review approved](reviews/milestone-4-6-review.md) on 2026-09-29. First published in [v1.0.0](https://github.com/ChamaOMister/biomix-use-cases/releases/tag/v1.0.0). Brought up to the dashboard redesign for v1.1.0 ([v1.1 review](reviews/v1.1-review.md)).

**Download:** [biomix-report-snapshot.html from the latest release](https://github.com/ChamaOMister/biomix-use-cases/releases/latest/download/biomix-report-snapshot.html). Open the file in a browser. It needs no installation, server or network.

The snapshot is a single HTML file of about 1.0 MiB, laid out like the application's dashboard, in light or dark to match the system. It holds, for the synthetic data:

- the same filters as the application (customer, product, seller, customer state, business unit, billing period), each applied as soon as it changes and shown by name
- indicator cards and monthly column charts
- sales by seller, state and business unit, top products and customers, and every customer
- scheduled collections by due month and payment schedule
- the exact breakdown tables and their reconciliation checks

It is read-only and labeled as synthetic data, with its seed and as-of date. Unlike the live page, it has no clickable names, removable filter chips or sidebar navigation.

## What is inside

- **Data:** the invoices as stored after replaying every delivery of the seed: the 44 closed months, then the pending September 2026 delivery, with corrections applied. They are embedded as compact JSON (`src/snapshot/data.ts`). Format 2, used from v1.1.0, adds each customer's state and city.
- **Arithmetic:** the application's own pure modules, `buildSalesReport`, `buildSalesRankings` and `buildCollectionsReport`, bundled by esbuild (`src/snapshot/app.ts`). There is no second implementation of the arithmetic. `src/snapshot/render.ts` only formats their results. Chart scales and shares are rounded for reading; every amount shown as text is exact.
- **No answer key.** The builder takes the seed and the deliveries only (`SnapshotSource`), never the evaluation answer key.
- **No network.** A Content-Security-Policy allows only the file's own script and style, by hash, and forbids every other request. There are no external fonts, images or links. The policy also forbids inline `style` attributes, so chart geometry uses SVG attributes and hover details use SVG titles.
- The unfiltered report is already in the HTML, so it can be read with JavaScript disabled. Filters need JavaScript.

## Build

```sh
npm run snapshot:build                      # data/generated/snapshot/biomix-report-snapshot.html
npm run snapshot:build -- --seed 8 --out /tmp/snapshot.html
```

The same seed and code build the same bytes. Like all generated output, the file is not committed.

## Release

CI builds the snapshot on every push, after `npm run check` passes, and keeps it with the run as the `report-snapshot` artifact for 30 days. When a version tag is pushed, for example `v1.0.0`, the `release-snapshot` job attaches the file to that tag's GitHub Release. The download link above then serves it (`.github/workflows/ci.yml`). Creating a tag is the maintainer's decision. Never move an existing tag: publish a new version instead.

v1.0.0 was published on 2026-09-29 from `af486a5`. Its asset's SHA-256 is `b7409bd341c147087f4d2b535d3eb3ba4a36b9fcf613a5eb1d868f4c23c5514f` (942,242 bytes). The file served by the download link is byte-identical to the CI build artifact and to a local rebuild. For the checks, see [setup verification](setup-verification.md#release-v100-2026-09-29) and the [release audit](reviews/project-1-release-review.md).

The v1.0.0 known issue, due-month labels wrapping at mobile width, is fixed for v1.1.0: months read "Jan 2025" and never wrap, and wide tables scroll inside their card.

## Tests

`src/snapshot/snapshot.test.ts`:

- The build is deterministic.
- The embedded data equals the replayed invoices.
- The file shows the report modules' totals and the ranking module's order, and lists every customer.
- The filters offer every state, seller and unit by name.
- Months are labeled "Jan 2025" and do not wrap.
- The bundled script runs against a small stand-in for the DOM and recomputes the dashboard when filters change, including the state filter.
- The file contains no URL, external resource, inline style attribute or answer-key text, and its policy hashes match its script and style.

`src/server/sales-report/stored-report.test.ts` replays the same seed into Postgres and requires the snapshot's data to give exactly the application's stored sales report, collections report and rankings for every filter case, including the customer-state cases.
