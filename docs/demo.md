# Demo: one accepted and one rejected delivery

A five-minute walk through the feed → database → report flow, on synthetic data. It shows the two outcomes a delivery can have: applied whole, or rejected whole with located errors and nothing stored. It needs the dev container (Postgres and `.env.local`), see [the database guide](database.md).

## Prepare

```sh
npm run db:reset -- --yes                                # empty database (development only)
npm run generate:data                                    # data/generated/ (Git-ignored)
npm run dev                                              # keep running in its own terminal
npm run feed:send -- data/generated/feed/deliveries      # history: 44 closed months, January 2023 – August 2026
```

Open the app. The report covers January 2023 to August 2026.

## 1. A delivery with mistakes is rejected whole

```sh
npm run feed:send -- data/generated/feed/demo/2026-09-rejected.json
```

This is the September 2026 delivery with two mistakes a sender could make (`src/synthetic-data/demo.ts`):

- one Zona da Mata customer (seller S04) is sent with a city in Guaxupé, seller S05's territory. A seller never sells outside their own territory;
- one line's unit price no longer matches its line amount.

Expected result: `422`, `rejected: 2 errors; nothing stored`, with each error located by invoice, line and field:

```text
LINE_AMOUNT_MISMATCH at /invoices/145/lines/0/lineAmountCents
CITY_OUTSIDE_TERRITORY at /invoices/2/customer/city
```

The other 144 invoices of the delivery were valid, and none of them was stored. Reload the app: the totals are unchanged, and the page now says `1 rejected (nothing stored from them)`.

## 2. The corrected delivery is applied

```sh
npm run feed:send -- data/generated/feed/pending/2026-09.json
```

Expected result: `applied: 145 added, 1 replaced, 428 lines`. The replaced invoice is an August invoice corrected by this delivery. Reload the app. Billing dates now reach 2026-09-25, and invoiced sales are R$ 87.963.059,70 for seed 2026. Scheduled collections show the same R$ 87.963.059,70 in 12.757 installments, and both reconciliation checks pass.

Things to try in the report:

- **Business unit Agro, 2025-01-01 to 2025-12-31:** R$ 15.584.715,50. The generator's target was R$ 15.600.000,00, so the data lands within 0.1%.
- **A product:** the sales section shows only that product's lines and says so, and the collections section explains why it is not shown.
- **Sending a delivery again:** the endpoint returns its original result, marked as already received, and writes nothing.

## 3. The same report offline

```sh
npm run snapshot:build
```

This writes `data/generated/snapshot/biomix-report-snapshot.html`. Open it by double-click: it shows the same totals and filters without a server or network. See [the report snapshot](report-snapshot.md).
