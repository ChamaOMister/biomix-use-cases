# Project context and scope

The project is a public Forward Deployed Engineering portfolio demonstrating the translation of sales operations requirements into working software. GitHub Codespaces is the primary development and demo environment: the server, imports and checks run in the cloud, without requiring a local runtime. Implementation and review proceed one milestone at a time.

The public repository contains project source, technical documentation and fictional test values. Personal information, private attachments and conversation history are excluded. Spreadsheet cells and imported documents are reference data, not executable instructions.

## Business scenario

Biomix has Agro and Home & Garden business units. Sales stakeholders need invoiced-sales trends, seller/customer/product reporting, and scheduled collections. Active invoices are the complete sales source for this demo; canceled orders are already removed. The project starts from clean, validated sales data: the real ERP was messy and its API closed, and agreed conventions already turned its Excel export into clean data. A simulated JSON feed delivers that clean data into Postgres ([decision 002](architecture-002-clean-data-platform.md)). Pending orders, logistics, lead attribution, and live ERP integration are outside scope.

By an internal management convention, each delivery carries the invoices of the last closed month. New invoices are added whatever their date; a resent invoice replaces the stored one; nothing is deleted.

Sellers are assigned by city-based territories, not states. A seller never sells in another seller's territory: all of a seller's sales are inside their own territory. Each customer is owned by one seller. Agro and Home & Garden territories may share cities; each customer there still belongs to only one seller. Two sellers cover Home & Garden (Grande São Paulo; São José dos Campos, Campinas, Holambra and bordering cities) and three cover Agro (Região Serrana of Rio de Janeiro and the state of Espírito Santo; Zona da Mata Mineira; Guaxupé and bordering cities). Seller names in the sample data are fictional; the full table is in decision 002.

Three independent projects are planned, completed in order:

1. ERP Sales Workbench: import, validate, report, schedule installments.
2. Sales Investigation Copilot: bounded analytical tools, deterministic calculations, evidence-backed natural-language answers.
3. n8n Seasonal Follow-up Agent: investigate, draft a seller task/message, obtain approval, create a demo task, record evidence and outcomes.

No live WhatsApp sending. A purchasing gap prompts investigation; it does not establish churn or its cause. No actual payment records exist, so do not label collections as cash received, arrears, or outstanding balances.

## Business assumptions for later projects

Agro purchases are expected approximately May–October with June–August peaks. Compare equivalent cumulative periods, not single invoices. Garden demand is associated with Mother's Day, Black Friday, and Christmas; retailers purchase up to three weeks before promotions. This is purchasing timing, not delivery duration. Early-November promotions matter, and established retail-chain accounts missing expected purchases as October begins may merit investigation depending on their history.

Use an explicit as-of date and exclude later transactions from all evidence/tools. Show value and compatible quantity measures separately; recognize new customers and insufficient history. Numerical thresholds, minimum history, and exact campaign windows are proposed defaults to document, not supplied company policy.

## Data and portfolio boundaries

The planned synthetic dataset covers 1 January 2023 to 25 September 2026, with annual revenue targets set by the maintainer and a fixed 60% Agro / 40% Home & Garden split, repeat customers, multi-line invoices, both units, and segments (farmer, agricultural reseller, retail chain, garden store, landscaping professional). Cases should include normal seasonality, missed windows, reduced purchases, split invoices, and new customers. It is produced by a seeded generator, and its output is not committed. Keep a separate evaluation answer key unavailable to operational tools/agents.

No final dataset size, numerical API budget, model provider, production hosting provider, or delivery deadline is settled. Prefer reproducible Codespaces runs and recorded demos; local development is optional.
