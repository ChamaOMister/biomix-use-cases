# Data

No transaction dataset has been generated or copied into this repository.

Use `data/private/` for local reference exports; its contents are ignored by Git. Codespaces cannot read files on your Mac: manually transfer only necessary private references to that ignored folder. Git ignore is a convenience, not anonymization; never force-add those files.

The supplied CSV files are reference tabs exported from a workbook. The first application import format will be XLSX. Do not silently substitute CSV support or treat the structure tab as transactions.

Create `data/fixtures/` only for explicitly synthetic, reviewed public fixtures. The full dataset comes from the seeded generator planned in [decision 002](../docs/architecture-002-clean-data-platform.md); its output is reproducible and is not committed. Publishing any generated file requires the maintainer's review. Analytical tests may use minimal inline fictional values. Spreadsheet and document attachments are ignored by default. Do not force-add them; review any intended public fixture and add a narrow ignore exception only after approval. Keep future evaluation answer keys outside operational data and prompts.
