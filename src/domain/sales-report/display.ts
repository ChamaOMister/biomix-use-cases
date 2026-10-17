/**
 * Display helpers shared by the dashboard and the report snapshot. Shares, scales and compact
 * amounts are for reading charts only; every amount meant to be trusted exactly is formatted from
 * integer cents by `formatBrlCents`.
 *
 * Safe for the browser. Reachable from Node scripts through built-in type stripping.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "Sep 2026", without going through a time zone. */
export function formatMonth(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

const compactBrl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

/** Axis label only: rounded, never used for a value the reader is meant to trust exactly. */
export function axisLabel(cents: number): string {
  return compactBrl.format(cents / 100);
}

/** A rounded scale top just above `max`: a round step times a power of ten. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

/** A value's share of a total to one decimal, e.g. "12,5%"; empty when the total is not positive. */
export function share(value: number, total: number): string {
  if (total <= 0) return "";
  const tenths = Math.round((value * 1000) / total);
  return `${(tenths / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1 })}%`;
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

/** Choice labels by ID: the name alone, or "name · ID" when two choices share a name. */
export function optionLabels(options: readonly { id: string; label: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  return new Map(options.map((option) => [option.id, counts.get(option.label)! > 1 ? `${option.label} · ${option.id}` : option.label]));
}

/** Brazilian states (UF) by code, for readable labels. */
export const STATE_NAMES: Readonly<Record<string, string>> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
  PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

export function stateLabel(code: string): string {
  return STATE_NAMES[code] ?? code;
}
