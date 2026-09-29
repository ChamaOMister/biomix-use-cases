import Link from "next/link";
import { SalesWorkbench } from "./sales-workbench";
import { filtersFromSearchParams, StoredSalesReport, type SearchParams } from "./stored-sales-report";

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = filtersFromSearchParams(await searchParams);
  return (
    <main>
      <header><Link className="brand" href="/">biomix<span> / workbench</span></Link><span className="status">Project 1 · Milestone 5</span></header>
      <section className="intro compact" aria-labelledby="title">
        <p className="eyebrow">SALES WORKBENCH</p>
        <h1 id="title">Trust the numbers.<br /><span>Understand the business.</span></h1>
        <p className="description">Invoiced sales and scheduled collections from the clean sales feed, stored in Postgres. Each delivery is checked against the contract and applied whole or not at all.</p>
        <p className="notice"><strong>Synthetic data.</strong> The reports below read the invoices stored from feed deliveries: invoiced sales, then the scheduled collections their payment schedules imply (contractual installments, not payments received). The XLSX check further down is separate: it validates an uploaded export and stores nothing.</p>
      </section>
      <StoredSalesReport filters={filters} />
      <section className="intro compact" aria-labelledby="xlsx-title">
        <h2 id="xlsx-title">Check an XLSX export (not stored)</h2>
        <p className="description">The workbook is validated on the server and discarded. An accepted dataset lives only in this browser tab and disappears when you reload.</p>
      </section>
      <SalesWorkbench />
      <footer><span>Portfolio demo · Agro + Home &amp; Garden · invoiced sales and scheduled collections</span><span>Amounts are exact integer cents</span></footer>
    </main>
  );
}
