# Clean sales feed: JSON delivery contract

Status: the validator (`src/domain/sales-feed/contract.ts`) and the [OpenAPI 3.1 description](api/sales-feed.openapi.json) were implemented in milestone 3. Milestone 4 added the endpoint `POST /api/sales-feed/deliveries`, Postgres storage, idempotent resending and the development API key ([database guide](database.md), [decision 002](architecture-002-clean-data-platform.md)). Milestone 5 added the billing-date bound for installment due dates. Choices marked *default* are reversible and should change only with a recorded reason.

The feed carries clean, already validated data. These checks are ordinary API-boundary validation, not ERP-export repair.

## Shape

One delivery is `{ deliveryId, invoices[] }`. Each invoice has `invoiceNumber`, `billingDate`, `customer { id, name, segment, city, state }`, `sellerId`, `businessUnit`, `paymentSchedule` and `lines[]`. Each line has `productId`, `productName`, `productCategory`, `packageQuantity`, `unitPriceCents`, `lineAmountCents` and `commissionAmountCents`. Money is integer BRL cents and dates are ISO calendar dates. Invoices and invoice lines stay distinct: lines are nested in their invoice. The OpenAPI file has a complete example.

The validator returns either the typed delivery plus a summary (invoice and line counts, sales and commission totals, billing-date range: the figures `feed_deliveries` will record) or every located error. A delivery with any error is rejected whole.

## Rules

| Scope | Rule | Error code |
| --- | --- | --- |
| Every object | All listed fields are required; `null` counts as missing | `FIELD_REQUIRED` |
| Every object | Any other field is rejected, so misspelled fields are never silently dropped | `FIELD_UNKNOWN` |
| Every value | JSON type as specified (numbers are not strings, and so on) | `TYPE_INVALID` |
| `deliveryId` | Lowercase canonical UUID, chosen by the sender | `DELIVERY_ID_INVALID` |
| Text and IDs | Non-empty, no surrounding spaces or control characters, well-formed Unicode in NFC; IDs ≤ 64 characters, other text ≤ 200 (UTF-16 code units, so a supplementary character counts as two). NFC matters because territory matching compares accented city names exactly. Well-formed means no unpaired surrogate (a JSON escape such as `\ud800` without its partner): Postgres cannot store one and would substitute U+FFFD, so two different invoice numbers could name one stored invoice. Such text is rejected, never repaired | `TEXT_INVALID` |
| `billingDate` | A real calendar date written `YYYY-MM-DD`, early enough that every installment of its payment schedule falls due by 9999-12-31 ([scheduled collections](collections.md)) | `DATE_INVALID` |
| Lists | At least 1 invoice per delivery and 1 line per invoice; at most 5,000 invoices and 200 lines per invoice | `LIST_EMPTY`, `LIST_TOO_LONG` |
| `businessUnit` | Exactly `Agro` or `Home & Garden` | `BUSINESS_UNIT_UNKNOWN` |
| `paymentSchedule` | Exactly one of the four [data contract](data-contract.md) labels | `PAYMENT_SCHEDULE_UNKNOWN` |
| `packageQuantity` | Whole number of packages ≥ 1 | `QUANTITY_INVALID` |
| Money | Safe integers; unit price and line amount > 0, commission ≥ 0 | `MONEY_INVALID` |
| Line | `lineAmountCents = packageQuantity × unitPriceCents` exactly | `LINE_AMOUNT_MISMATCH` |
| Line | `commissionAmountCents` = 5% of the line amount, rounded half-up | `COMMISSION_MISMATCH` |
| Invoice | `sellerId` is a known seller | `SELLER_UNKNOWN` |
| Invoice | `businessUnit` is the seller's business unit | `BUSINESS_UNIT_SELLER_MISMATCH` |
| Invoice | The customer's city and state are in the seller's territory | `CITY_OUTSIDE_TERRITORY` |
| Invoice | A stored customer keeps its owning seller; within one delivery a customer has one seller | `CUSTOMER_SELLER_MISMATCH` |
| Delivery | One customer ID carries the same name, segment, city and state throughout the delivery | `CUSTOMER_ATTRIBUTE_CONFLICT` |
| Delivery | One product ID carries the same name and category and belongs to one business unit; a stored product keeps its business unit | `PRODUCT_ATTRIBUTE_CONFLICT` |
| Delivery | Each invoice number appears once | `INVOICE_DUPLICATE` |
| Delivery | Totals stay exactly representable | `TOTAL_OUT_OF_RANGE` |

Each error has a `code`, a JSON Pointer `path` (for example `/invoices/3/lines/0/lineAmountCents`), the `invoiceNumber` when it could be read, a `message`, and a `relatedPath` when another location is involved (such as the first occurrence of a repeated invoice number). Messages explain the rule and never quote payload values. Only the first 200 errors are returned; `truncated` says whether more exist. Unknown field names appear in paths, cut to 64 characters, so logs should record codes and counts rather than whole errors.

The stored checks take lookups (`customerOwner`, `productBusinessUnit`). The endpoint passes the database's customer owners and product business units, read inside the delivery's transaction. The generator tests replay every delivery through the owner check with the owners seen so far.

## Defaults and reasons

- **Strict fields:** clean data has a fixed shape. Rejecting unknown fields catches misspellings such as `sellerID` that would otherwise be dropped.
- **Commission is blocking here.** The XLSX importer treats a 5% mismatch as a warning, because it reads exports whose rate was not a confirmed company rule. The clean feed states the convention as a contract rule, and milestone 3 requires generated data to satisfy it.
- **Empty deliveries are rejected** to catch an accidental empty send. A genuinely empty month would need this relaxed.
- **Segment is free text.** The generator uses the five listed segments, but the contract does not turn them into an enumeration.
- **Invoice identity:** invoice numbers are unique across all deliveries (clean-data guarantee). Within one delivery this is checked; across deliveries a repeated number means replacement.
- The endpoint adds the checks outside the payload rules: the API key, content type, 16 MiB body limit and JSON syntax, a reused `deliveryId` with different content, and the stored product business unit. Its responses are in the [OpenAPI description](api/sales-feed.openapi.json) and the [database guide](database.md).

## Seller territories

`src/domain/sales-feed/reference-data.ts` lists every territory city explicitly, identified by city name and state. At most one seller covers a city within a business unit. Agro and Home & Garden territories do not currently share a city.

| Seller | Territory | Cities | Source |
| --- | --- | --- | --- |
| S01 | Grande São Paulo (Região Metropolitana de São Paulo) | 39 | pt.wikipedia "Região Metropolitana de São Paulo", municipality table |
| S02 | São José dos Campos, Campinas, Holambra and their bordering cities | 26, incl. Camanducaia and Sapucaí-Mirim (MG) | Each seat city's pt.wikipedia article (bordering municipalities) |
| S03 | Região Serrana (RJ) and all of Espírito Santo | 15 + 78 | ES: pt.wikipedia "Lista de municípios do Espírito Santo" (78, with IBGE codes). Região Serrana: the RJ state government region, official list supplied by the maintainer (see note) |
| S04 | Zona da Mata Mineira | 142 | IBGE 1989 mesoregion, from the microregion table on pt.wikipedia "Lista de mesorregiões e microrregiões de Minas Gerais" (18 + 20 + 20 + 20 + 17 + 33 + 14) |
| S05 | Guaxupé and its bordering cities | 6, incl. Tapiratiba (SP) | pt.wikipedia "Guaxupé" |

The lists were prepared on 2026-09-29. The IBGE localities API and the RJ government sites were not reachable from the Codespace, so Wikipedia was the source. Spellings follow the canonical article titles, for example *Amparo do Serra*, *Silveirânia* and *Dona Euzébia*. The Zona da Mata "Cidades" list on Wikipedia has 143 entries: it also includes Diogo de Vasconcelos, which the IBGE microregion table does not. The microregion table was used. **Região Serrana:** the 15 municipalities follow the official list supplied by the maintainer: Bom Jardim, Cantagalo, Carmo, Cordeiro, Duas Barras, Macuco, Miguel Pereira, Nova Friburgo, Petrópolis, Santa Maria Madalena, São José do Vale do Rio Preto, São Sebastião do Alto, Sumidouro, Teresópolis, Trajano de Morais. Territories are demo reference data; correct any list here, and the tests pin the counts.
