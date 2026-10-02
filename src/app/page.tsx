import Link from "next/link";
import { SalesWorkbench } from "./sales-workbench";
import { filtersFromSearchParams, StoredSalesReport, type SearchParams } from "./stored-sales-report";

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = filtersFromSearchParams(await searchParams);
  return (
    <div className="layout">
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">✳</span> biomix <span className="brand-sub">insights</span></Link>
        <div className="side-label">Workspace</div>
        <nav className="nav" aria-label="Sections">
          <a href="#overview"><span className="ico" aria-hidden="true">▦</span> Overview</a>
          <a href="#distribution"><span className="ico" aria-hidden="true">◫</span> Distribution</a>
          <a href="#customers"><span className="ico" aria-hidden="true">♙</span> Customers</a>
          <a href="#collections"><span className="ico" aria-hidden="true">◷</span> Collections</a>
          <a href="#xlsx-title"><span className="ico" aria-hidden="true">⇪</span> Check an XLSX</a>
        </nav>
        <div className="side-note">
          <b>Synthetic data</b>
          Fictional customers, sellers and products from the clean sales feed, stored in Postgres. Amounts are exact integer cents.
        </div>
      </aside>
      <main>
        <div className="topbar">
          <div className="crumb">Sales &nbsp;/&nbsp; <b>Dashboard</b></div>
          <span className="date-tag">Project 1 · invoiced sales &amp; scheduled collections</span>
        </div>
        <StoredSalesReport filters={filters} />
        <section className="xlsx" aria-labelledby="xlsx-title">
          <div className="section-title">
            <h2 id="xlsx-title">Check an XLSX export (not stored)</h2>
            <p>The workbook is validated on the server and discarded. An accepted dataset lives only in this browser tab and disappears when you reload.</p>
          </div>
          <SalesWorkbench />
        </section>
        <footer>
          <span>Portfolio demo · Agro + Home &amp; Garden · invoiced sales and scheduled collections · synthetic data</span>
          <span>Amounts are exact integer cents; chart bars are drawn to scale</span>
        </footer>
      </main>
    </div>
  );
}
