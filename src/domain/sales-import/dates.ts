/**
 * Calendar dates are ISO `YYYY-MM-DD` strings with no time zone. Nothing here reads the
 * machine's local time zone.
 */

export type CalendarDate = string;

export type TextDateFormat = "YYYY-MM-DD" | "DD/MM/YYYY";

export type DateErrorCode =
  | "DATE_TEXT_FORMAT"
  | "DATE_INVALID"
  | "DATE_HAS_TIME"
  | "DATE_OUT_OF_RANGE";

export type DateResult = { ok: true; date: CalendarDate } | { ok: false; code: DateErrorCode };

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (![year, month, day].every(Number.isInteger)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= maxDay;
}

export function formatCalendarDate(year: number, month: number, day: number): CalendarDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fromComponents(year: number, month: number, day: number): DateResult {
  return isValidCalendarDate(year, month, day)
    ? { ok: true, date: formatCalendarDate(year, month, day) }
    : { ok: false, code: "DATE_INVALID" };
}

const TEXT_PATTERNS: Record<TextDateFormat, { pattern: RegExp; order: [number, number, number] }> = {
  // order gives the capture-group index of [year, month, day]
  "YYYY-MM-DD": { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, order: [1, 2, 3] },
  "DD/MM/YYYY": { pattern: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: [3, 2, 1] },
};

/** Only the declared format is accepted; mixed formats in one column are never inferred. */
export function parseTextDate(text: string, format: TextDateFormat): DateResult {
  const { pattern, order } = TEXT_PATTERNS[format];
  const match = pattern.exec(text.trim());
  if (!match) return { ok: false, code: "DATE_TEXT_FORMAT" };
  const [year, month, day] = order.map((group) => Number(match[group]));
  return fromComponents(year ?? NaN, month ?? NaN, day ?? NaN);
}

/**
 * Earliest billing date accepted from any representation (date cell or text). Excel's 1900 date
 * system treats 1900 as a leap year, so earlier serials are off by one; pre-1900 sales are not
 * needed, so the same bound applies to text dates for one consistent rule.
 */
export const MIN_BILLING_DATE: CalendarDate = "1900-03-01";

const FIRST_UNAMBIGUOUS_EXCEL_DATE = Date.UTC(1900, 2, 1);

/**
 * The XLSX adapter yields date cells as instants whose UTC components are the workbook's
 * wall-clock date (after applying the workbook's 1900/1904 date system).
 */
export function calendarDateFromExcelDate(value: Date): DateResult {
  const time = value.getTime();
  if (Number.isNaN(time)) return { ok: false, code: "DATE_INVALID" };
  if (time < FIRST_UNAMBIGUOUS_EXCEL_DATE) return { ok: false, code: "DATE_OUT_OF_RANGE" };
  if (
    value.getUTCHours() !== 0 ||
    value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 ||
    value.getUTCMilliseconds() !== 0
  ) {
    return { ok: false, code: "DATE_HAS_TIME" };
  }
  return fromComponents(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}
