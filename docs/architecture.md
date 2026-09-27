# Architecture decision 001: one TypeScript application

Status: foundation selected; import/storage details remain reversible proposals. This is a setup decision for the current request, not a claim that the attached handoff dictated a finalized stack.

Use Node 24.21.0, Next.js App Router, React, npm, and strict TypeScript. Keep import adapters on the Node server and business calculations in framework-independent modules. Use basic CSS until the report warrants reusable UI components. No paid API is required for Project 1.

ESLint is pinned to 9.39.5 for compatibility with the React plugin bundled by eslint-config-next 16.3.6. npm marks ESLint 9 deprecated; ESLint 10.11.0 was attempted and failed at `react/display-name` (`getFilename` API removal). Upgrade the Next/React lint configuration together before moving to ESLint 10; do not suppress lint checks to hide this incompatibility.

Current layout:

```text
src/app/                        page, client workbench, thin route (api/sales-imports)
src/server/                     HTTP upload handler (body cap, query parsing, diagnostic logging)
src/domain/sales-import/        limits, archive pre-flight, structure pre-scan, XLSX adapter, validation, invoices
src/types/                      declarations for the ExcelJS internal used by the pre-scan
src/domain/sales-report/        filters, totals, breakdowns, reconciliation, BRL formatting
data/fixtures/                  reviewed synthetic demo inputs (not created)
```

ExcelJS (4.4.0) is the XLSX reader. saxes (5.0.1, ExcelJS's own XML parser) is a direct dependency for the structure pre-scan. jszip (3.10.2, ExcelJS's ZIP reader) is a dev dependency for differential tests. Both were already installed as ExcelJS dependencies, and pinning them adds no packages. The XLSX adapter is isolated in `src/domain/sales-import/xlsx.ts`, which converts cells to a library-independent model before validation. Zod was not added: each field needs a custom strict parser with its own issue code, so a schema library would add a dependency without adding checks. Read identifiers as strings, inspect typed cell values, handle workbook date systems explicitly, and reject unsupported formulas rather than trusting stale cached calculations.
## Milestone 2: input limits and the stateless reporting path

**Limits** (`src/domain/sales-import/limits.ts`, overridable per call). The 25,000-row limit is provisional: no dataset size has been specified, and the compressed, expanded and structure limits apply independently, so not every 25,000-row workbook is guaranteed to fit. Re-measure with representative data if the real dataset exceeds any limit. Do not split by year or drop rows to fit. A split must keep invoices whole and state the reduced period.

| Limit | Default | Enforced |
| --- | --- | --- |
| Compressed file | 4 MiB | From `Content-Length` before reading, then while streaming the body, then again in the archive check |
| Archive layout | canonical only | Before ExcelJS; see below |
| Archive entries | 100 | ZIP central directory, before ExcelJS |
| Inflated size per entry / total | 24 MiB / 32 MiB | Declared sizes first; each entry is then inflated with `maxOutputLength` capped at its declared size, so a lying header cannot expand past the cap |
| Merged cells, all sheets | 1,000 | XML pre-scan, before ExcelJS |
| Workbook cells, all sheets | 1,500,000 | XML pre-scan, before ExcelJS: rows, cells and column objects on every sheet, plus cells covered by data validations and expanded named ranges |
| Data rows (blank rows included) | 25,000 | Selected sheet's extent after load, before any cell is converted |
| Columns | 40 | Same |

**Archive layout** (`archive-limits.ts`). ExcelJS reads the archive through JSZip, which tolerates prefixed, concatenated and gapped archives by shifting its offsets. So the pre-flight check could verify one archive while JSZip read another (review R1). The check now accepts only a layout with a single interpretation. Entries are packed from byte 0 without gaps or overlaps. The central directory follows them, the end record follows the directory, and its comment ends exactly at the end of the file. Local and central names must match, and local and central sizes must match (or the data descriptor must). Names must be valid UTF-8 plain paths that JSZip does not rewrite. Duplicate parts are rejected, including a name that appears both with and without a leading `/`. Unicode-path extra fields, ZIP64, encryption and multi-part archives are also rejected. Differential tests compare the parts the check verified with what the installed JSZip extracts, over explicit hostile layouts and 600 deterministic byte mutations. This is a targeted consistency check for this importer, not a complete ZIP security audit.

**Structure pre-scan** (`workbook-structure.ts`, review R2). The inflated-size cap does not bound the work ExcelJS does per byte. For example, ExcelJS visits every cell of a merged range, including on sheets that were not selected, so a 163-byte merge creates 10,000 cells. Before the fix, test fixtures with whole-sheet merges, validations and column spans exhausted the test worker's heap (SIGABRT). The pre-scan parses the parts ExcelJS would load: worksheets matched by ExcelJS's own part-name pattern, plus `xl/workbook.xml`. It uses the same XML parser (saxes, which expands no custom entities) and counts elements by local name wherever they appear, which is a superset of what ExcelJS reads. It sizes ranges with ExcelJS's own address decoder (an internal module of the pinned exceljs 4.4.0, declared in `src/types/exceljs-internals.d.ts`), and it mirrors ExcelJS's defined-name range extraction. Every decoded coordinate, including single cells, must be a safe integer inside Excel's grid (rows 1–1,048,576, columns 1–16,384) before an area is computed. Otherwise the workbook is rejected, never counted as one cell. ExcelJS does not check rows, and its `row++` loops never end at row 2^53 or at `Infinity` (a 310-digit row). Parts that are not valid UTF-8, are not well-formed or contain a DOCTYPE are rejected. The scan adds about 0.3 s to a 25,000-row workbook.

**Memory is observed, not proven.** ExcelJS still loads the whole workbook, and no limit bounds its heap directly. The figures below are observations from fictional workbooks on Node 24, with coarse heap sampling (so the true peak can be higher). They do not show that other inputs within the limits stay below these numbers.

| Workbook (fictional) | File | Heap growth during load (sampled peak / retained after GC) |
| --- | --- | --- |
| 25,000 sales rows | 1.8 MiB | +288 / +141 MiB |
| Same, plus Excel's hidden auto-filter name over the table | 1.8 MiB | +267 / +233 MiB |
| 0.9 M valued cells on an unselected sheet | 1.0 MiB | +262 / +144 MiB |
| 1.45 M empty cells on an unselected sheet | 1.9 MiB | +265 / ~0 MiB |
| Named range covering 1.49 M cells | 10 KiB | +138 / +135 MiB |
| Data validation covering 1.49 M cells | 10 KiB | +183 / +130 MiB |

Isolating the parse in a worker with `resourceLimits` would turn memory into an enforced bound, but it has not been done. Nothing limits concurrent uploads or processing time. The current demo scope is single-user development in a Codespace with a private forwarded port. Public multi-user deployment would require revisiting these limits.

**Stateless flow.** `POST /api/sales-imports?sheet=…` takes the raw `.xlsx` bytes as the body (no multipart, so the size can be capped while streaming). The response is the `SalesImportResult`: 200 accepted, 422 rejected, 413 too large, 400/415 bad request, 400 `UPLOAD_INCOMPLETE` when the body stream fails (for example a disconnected upload), 500 unexpected failure. Every response is generic JSON with `Cache-Control: no-store`. Stream and parser errors are logged by error name only, never by message. A known oversized upload stays 413 even if cancelling the stream fails. The server keeps nothing. The accepted lines stay only in the uploading tab's React state, and the pure report module computes totals in the browser. There is no global or shared dataset, and reloading clears it. The server logs only `issueDiagnostics` plus counts and a server-generated import UUID, never workbook text or rows.

**Report semantics.** Customer, seller, business unit and period are invoice attributes, validated to agree across each invoice's lines, so those filters select whole invoices. Product is a line attribute. With a product filter, amounts cover only the matching lines, and an invoice counts if any of its lines matches; the UI states this. Invoice count is the number of distinct invoice numbers. Totals use checked integer addition and fail rather than lose precision. Month and business-unit breakdowns are checked to sum exactly to the totals. Separately, the line total is reconciled against the importer's invoice-group totals.

Start without a database. For the thin path, process one explicitly selected upload and return validated results; avoid a process-global mutable store shared by visitors. If saved imports become necessary, use an embedded SQLite adapter and SQL queries with ignored local database files. That decision needs a persistence lifecycle and duplicate-import policy. Do not add PostgreSQL, Redis, an ORM, or a second API service without a demonstrated requirement. Serverless hosting would need a different persistence decision; it is outside this setup.

Choose tools for demonstrated requirements. Show delivery, data modeling, integrations, evaluation and explicit autonomy boundaries through working behavior and evidence; do not add Python, RAG, vector storage, or multi-agent frameworks without a concrete need. SQL can be demonstrated when saved-data queries justify SQLite.

Project 2 can reuse the data specification in its own repository and add bounded analytical tools and one model provider. Provider/budget choice stays open. Project 3 will use n8n with a small task API/store and explicit approval. Its workflow/runtime dependencies belong in that later repository, not this devcontainer.

References checked during setup:

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Node release schedule](https://github.com/nodejs/Release)
- [GitHub devcontainers](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers)
- [ExcelJS](https://github.com/exceljs/exceljs)
- [Vitest](https://vitest.dev/guide/)
