import Link from "next/link";
import { SalesWorkbench } from "./sales-workbench";

export default function Home() {
  return (
    <main>
      <header><Link className="brand" href="/">biomix<span> / workbench</span></Link><span className="status">Project 1 · Milestone 2</span></header>
      <section className="intro compact" aria-labelledby="title">
        <p className="eyebrow">ERP SALES WORKBENCH</p>
        <h1 id="title">Trust the numbers.<br /><span>Understand the business.</span></h1>
        <p className="description">Upload an ERP sales export (.xlsx). Every row is validated; a report appears only when the whole file is valid.</p>
        <p className="notice"><strong>Nothing is stored.</strong> The workbook is validated on the server and discarded. An accepted dataset lives only in this browser tab and disappears when you reload. Scheduled collections are not part of this view.</p>
      </section>
      <SalesWorkbench />
      <footer><span>Portfolio demo · Agro + Home &amp; Garden · invoiced sales only</span><span>Amounts are exact integer cents</span></footer>
    </main>
  );
}
