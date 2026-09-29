# Downloadable report snapshot

Status: implemented in milestone 6 ([decision 002](architecture-002-clean-data-platform.md), item 7). Awaiting review.

**Download:** [biomix-report-snapshot.html from the latest release](https://github.com/ChamaOMister/biomix-use-cases/releases/latest/download/biomix-report-snapshot.html). The link works once a version tag has been released (see below). Open the file in a browser. It needs no installation, server or network.

The snapshot is a single HTML file, about 0.9 MiB. It holds the invoiced-sales report and scheduled collections for the synthetic data, with the same filters as the application (customer, product, seller, business unit, billing period), the month, business-unit, due-month and payment-schedule breakdowns, and their reconciliation checks. It is read-only and labeled as synthetic data, with its seed and as-of date.

## What is inside

- **Data:** the invoices as stored after replaying every delivery of the seed: the 44 closed months, then the pending September 2026 delivery, with corrections applied. They are embedded as compact JSON (`src/snapshot/data.ts`).
- **Arithmetic:** the application's own pure modules, `buildSalesReport` and `buildCollectionsReport`, bundled by esbuild (`src/snapshot/app.ts`). There is no second implementation of the arithmetic. `src/snapshot/render.ts` only formats their results.
- **No answer key.** The builder takes the seed and the deliveries only (`SnapshotSource`), never the evaluation answer key.
- **No network.** A Content-Security-Policy allows only the file's own script and style, by hash, and forbids every other request. There are no external fonts, images or links.
- The unfiltered report is already in the HTML, so it can be read with JavaScript disabled. Filters need JavaScript.

## Build

```sh
npm run snapshot:build                      # data/generated/snapshot/biomix-report-snapshot.html
npm run snapshot:build -- --seed 8 --out /tmp/snapshot.html
```

The same seed and code build the same bytes. Like all generated output, the file is not committed.

## Release

CI builds the snapshot on every push, after `npm run check` passes, and keeps it with the run as the `report-snapshot` artifact for 30 days. When a version tag is pushed, for example `v1.0.0`, the `release-snapshot` job attaches the file to that tag's GitHub Release. The download link above then serves it (`.github/workflows/ci.yml`). Creating the tag is the maintainer's decision; no release exists yet.

## Tests

`src/snapshot/snapshot.test.ts`:

- The build is deterministic.
- The embedded data equals the replayed invoices.
- The file shows the report modules' totals.
- The bundled script runs against a small stand-in for the DOM and recomputes both reports when filters change.
- The file contains no URL, external resource or answer-key text, and its policy hashes match its script and style.

`src/server/sales-report/stored-report.test.ts` replays the same seed into Postgres and requires the snapshot's data to give exactly the application's stored sales and collections reports for every filter case.
