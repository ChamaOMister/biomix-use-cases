/** Exact pt-BR currency text from integer cents (no floating-point division). */
export function formatBrlCents(cents: number): string {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  const integer = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}R$ ${integer},${digits.slice(-2)}`;
}
