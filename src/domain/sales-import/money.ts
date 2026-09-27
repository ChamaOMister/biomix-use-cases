/**
 * Strict BRL parsing into integer cents. No `parseFloat` on formatted text and no rounding:
 * anything that cannot be represented exactly in cents is rejected.
 */

export type MoneyErrorCode =
  | "MONEY_FORMAT"
  | "MONEY_PRECISION"
  | "MONEY_OUT_OF_RANGE"
  | "MONEY_NOT_FINITE";

export type MoneyResult = { ok: true; cents: number } | { ok: false; code: MoneyErrorCode };

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

// pt-BR: optional sign, optional "R$", "." only as a thousands separator in groups of three,
// "," as the decimal separator. \s also covers the non-breaking space Excel uses after "R$".
const BRL_TEXT = /^(-)?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;

function toCents(negative: boolean, integerDigits: string, fractionDigits: string): MoneyResult {
  if (fractionDigits.length > 2) return { ok: false, code: "MONEY_PRECISION" };
  const cents = BigInt(integerDigits + fractionDigits.padEnd(2, "0"));
  if (cents > MAX_SAFE) return { ok: false, code: "MONEY_OUT_OF_RANGE" };
  const value = Number(cents);
  return { ok: true, cents: negative && value !== 0 ? -value : value };
}

export function parseBrlTextToCents(text: string): MoneyResult {
  const match = BRL_TEXT.exec(text.trim());
  if (!match) return { ok: false, code: "MONEY_FORMAT" };
  const [, sign, integerPart = "", fraction = ""] = match;
  return toCents(sign === "-", integerPart.replaceAll(".", ""), fraction);
}

/**
 * Excel numeric cells are IEEE doubles. JavaScript's shortest round-trip representation
 * recovers the typed decimal (1220.4 → "1220.4"); values that need more than two decimals
 * to round-trip are rejected rather than rounded.
 */
export function excelNumberToCents(value: number): MoneyResult {
  if (!Number.isFinite(value)) return { ok: false, code: "MONEY_NOT_FINITE" };
  const text = Math.abs(value).toString();
  if (text.includes("e")) {
    return { ok: false, code: Math.abs(value) >= 1 ? "MONEY_OUT_OF_RANGE" : "MONEY_PRECISION" };
  }
  const [integerPart = "", fraction = ""] = text.split(".");
  return toCents(value < 0, integerPart, fraction);
}
