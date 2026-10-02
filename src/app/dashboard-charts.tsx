// No "use client": plain server-rendered markup. Hover tooltips are CSS only. Bar lengths and
// shares are for display; every amount shown as text is exact, formatted from integer cents.
import Link from "next/link";
import { formatBrlCents } from "@/domain/sales-report/format";
import { integer } from "./sales-report-view";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep 2026", without going through a time zone. */
export function formatMonth(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

const compactBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

/** Axis label only: rounded, never used for a value the reader is meant to trust exactly. */
function axisLabel(cents: number): string {
  return compactBrl.format(cents / 100);
}

/** A rounded scale top just above `max`: a round step times a power of ten. */
function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

function share(value: number, total: number): string {
  if (total <= 0) return "";
  const tenths = Math.round((value * 1000) / total);
  return `${(tenths / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%`;
}

export interface ColumnDatum {
  key: string;
  valueCents: number;
  /** Extra tooltip line, e.g. the invoice count. */
  note: string;
}

/** Vertical columns over time, one per month, with a recessive scale and a tooltip per column. */
export function ColumnChart({ data, label }: { data: ColumnDatum[]; label: string }) {
  if (data.length === 0) return <p className="empty">Nothing matches the selected filters.</p>;
  const top = niceCeiling(Math.max(...data.map((datum) => datum.valueCents)));
  return (
    <div className="column-chart" role="img" aria-label={label}>
      <div className="column-scale" aria-hidden="true">
        <span>{axisLabel(top)}</span>
        <span>{axisLabel(top / 2)}</span>
        <span>R$ 0</span>
      </div>
      <div className="column-plot" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
        {data.map((datum, index) => {
          const [year, month] = datum.key.split("-");
          const showYear = month === "01" || index === 0;
          return (
            <div className="column" key={datum.key} tabIndex={0} aria-label={`${formatMonth(datum.key)}: ${formatBrlCents(datum.valueCents)}`}>
              <span className="column-bar" style={{ height: `${(datum.valueCents / top) * 100}%` }} />
              <span className="tip" role="tooltip">
                <b>{formatMonth(datum.key)}</b>
                {formatBrlCents(datum.valueCents)}
                <small>{datum.note}</small>
              </span>
              {showYear ? <span className="column-year">{year}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  detail?: string | null;
  valueCents: number;
  note?: string;
  /** Adds or removes this row as a filter. */
  href?: string;
  active?: boolean;
}

/** Horizontal bars with the exact amount and share of the total at the end of each row. */
export function BarList({ data, totalCents }: { data: BarDatum[]; totalCents: number }) {
  if (data.length === 0) return <p className="empty">Nothing matches the selected filters.</p>;
  const max = Math.max(...data.map((datum) => datum.valueCents), 1);
  return (
    <ul className="bar-list">
      {data.map((datum) => (
        <li key={datum.key} className={datum.active ? "active" : undefined}>
          <span className="bar-name">
            {datum.href ? (
              <Link href={datum.href} scroll={false} title={datum.active ? "Remove this filter" : "Filter by this"}>{datum.label}</Link>
            ) : (
              datum.label
            )}
            {datum.detail ? <small>{datum.detail}</small> : null}
          </span>
          <span className="bar-track" title={`${datum.label}: ${formatBrlCents(datum.valueCents)}${datum.note ? ` · ${datum.note}` : ""}`}>
            <span className="bar-fill" style={{ width: `${(datum.valueCents / max) * 100}%` }} />
          </span>
          <span className="bar-value">
            {formatBrlCents(datum.valueCents)}
            <small>{share(datum.valueCents, totalCents)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface RankDatum {
  key: string;
  label: string;
  detail: string | null;
  valueCents: number;
  invoiceCount: number;
  href: string;
  active: boolean;
}

/** Numbered ranking, largest first. */
export function RankList({ data }: { data: RankDatum[] }) {
  if (data.length === 0) return <p className="empty">Nothing matches the selected filters.</p>;
  return (
    <ol className="rank-list">
      {data.map((datum, index) => (
        <li key={datum.key} className={datum.active ? "active" : undefined}>
          <span className="rank-num">{String(index + 1).padStart(2, "0")}</span>
          <span className="rank-main">
            <Link href={datum.href} scroll={false} title={datum.active ? "Remove this filter" : "Filter by this"}>{datum.label}</Link>
            {datum.detail ? <small>{datum.detail}</small> : null}
          </span>
          <span className="rank-value">
            {formatBrlCents(datum.valueCents)}
            <small>{integer.format(datum.invoiceCount)} {datum.invoiceCount === 1 ? "invoice" : "invoices"}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Initials for a name's avatar tile. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^\p{Lu}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}
