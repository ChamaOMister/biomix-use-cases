/**
 * Cell → typed field parsers. Each returns a value or a problem that the sheet validator turns
 * into a located issue. Messages never quote identity values from the cell.
 */
import {
  calendarDateFromExcelDate,
  MIN_BILLING_DATE,
  parseTextDate,
  type CalendarDate,
  type DateErrorCode,
  type TextDateFormat,
} from "./dates";
import { excelNumberToCents, parseBrlTextToCents, type MoneyErrorCode } from "./money";
import type { SheetCell } from "./sheet";
import type { BusinessUnit, IssueCode, PaymentSchedule } from "./types";

export interface FieldProblem {
  code: IssueCode;
  message: string;
  suggestion: string;
}

export type FieldResult<T> = { ok: true; value: T } | { ok: false; problem: FieldProblem };

const ok = <T>(value: T): FieldResult<T> => ({ ok: true, value });
const fail = <T>(code: IssueCode, message: string, suggestion: string): FieldResult<T> => ({
  ok: false,
  problem: { code, message, suggestion },
});

/** Cell kinds that are never accepted in any mapped field. */
function structuralProblem<T>(cell: SheetCell, header: string): FieldResult<T> | null {
  switch (cell.kind) {
    case "formula":
      return fail(
        "CELL_FORMULA",
        `${header} contains a formula. Cached formula results are not trusted.`,
        "Replace the formula with its value (paste as values) and re-export.",
      );
    case "error":
      return fail(
        "CELL_ERROR_VALUE",
        `${header} contains the spreadsheet error ${cell.value}.`,
        "Fix the source of the error and enter a plain value.",
      );
    case "merged":
      return fail(
        "CELL_MERGED",
        `${header} is part of a merged range started at ${cell.master}; its value would be copied, not read.`,
        "Unmerge the cells and enter the value on every row.",
      );
    case "unsupported":
      return fail(
        "CELL_UNSUPPORTED_TYPE",
        `${header} contains an unsupported kind of cell value.`,
        "Enter plain text or a number.",
      );
    default:
      return null;
  }
}

function unsupportedType<T>(header: string, expected: string): FieldResult<T> {
  return fail("CELL_UNSUPPORTED_TYPE", `${header} must be ${expected}.`, `Enter ${expected}.`);
}

function required<T>(header: string): FieldResult<T> {
  return fail(
    "FIELD_REQUIRED",
    `${header} is required but blank.`,
    `Fill in ${header} in the source; the importer does not invent missing values.`,
  );
}

/** Text fields accept text or numbers (as written); dates and booleans are rejected. */
function textValue(cell: SheetCell, header: string): FieldResult<string | null> {
  const problem = structuralProblem<string | null>(cell, header);
  if (problem) return problem;
  if (cell.kind === "empty") return ok(null);
  if (cell.kind === "text") return ok(cell.text.trim() === "" ? null : cell.text.trim());
  if (cell.kind === "number" && Number.isFinite(cell.value)) return ok(String(cell.value));
  return unsupportedType(header, "text");
}

export function parseOptionalText(cell: SheetCell, header: string): FieldResult<string | null> {
  return textValue(cell, header);
}

export function parseRequiredText(cell: SheetCell, header: string): FieldResult<string> {
  const result = textValue(cell, header);
  if (!result.ok) return result;
  return result.value === null ? required(header) : ok(result.value);
}

/**
 * Identifiers are strings. Text keeps leading zeroes; integer number cells are accepted as
 * written (leading zeroes, if any existed, were already lost by the spreadsheet).
 */
export function parseIdentifier(cell: SheetCell, header: string, isRequired: true): FieldResult<string>;
export function parseIdentifier(cell: SheetCell, header: string, isRequired: false): FieldResult<string | null>;
export function parseIdentifier(
  cell: SheetCell,
  header: string,
  isRequired: boolean,
): FieldResult<string | null> {
  const problem = structuralProblem<string | null>(cell, header);
  if (problem) return problem;
  if (cell.kind === "number") {
    return Number.isSafeInteger(cell.value) && cell.value >= 0
      ? ok(String(cell.value))
      : fail(
          "ID_INVALID",
          `${header} is a number that is not a whole, non-negative identifier.`,
          `Store ${header} as text exactly as issued.`,
        );
  }
  if (cell.kind === "empty" || cell.kind === "text") {
    const text = cell.kind === "text" ? cell.text.trim() : "";
    if (text !== "") return ok(text);
    return isRequired ? required(header) : ok(null);
  }
  return unsupportedType(header, "text");
}

function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// Maps, not object literals: an object lookup would also "find" inherited keys like "constructor".
const BUSINESS_UNITS = new Map<string, BusinessUnit>([
  ["agro", "AGRO"],
  ["home & garden", "HOME_GARDEN"],
]);

export function parseBusinessUnit(cell: SheetCell, header: string): FieldResult<BusinessUnit> {
  const text = parseRequiredText(cell, header);
  if (!text.ok) return text;
  const unit = BUSINESS_UNITS.get(normalizeLabel(text.value));
  return unit
    ? ok(unit)
    : fail(
        "BUSINESS_UNIT_UNKNOWN",
        `${header} must be "Agro" or "Home & Garden".`,
        "Use the explicit business unit; it is not inferred from the product or category.",
      );
}

const PAYMENT_SCHEDULES = new Map<string, PaymentSchedule>([
  ["upfront", "UPFRONT"],
  ["30 days", "NET_30"],
  ["3 installments (30, 60 and 90 days)", "INSTALLMENTS_30_60_90"],
  ["4 installments (upfront, 30, 60 and 90 days)", "INSTALLMENTS_0_30_60_90"],
]);

export function parsePaymentSchedule(cell: SheetCell, header: string): FieldResult<PaymentSchedule> {
  const text = parseRequiredText(cell, header);
  if (!text.ok) return text;
  const schedule = PAYMENT_SCHEDULES.get(normalizeLabel(text.value));
  return schedule
    ? ok(schedule)
    : fail(
        "PAYMENT_TERM_UNKNOWN",
        `${header} is not one of the supported payment terms.`,
        'Use "Upfront", "30 Days", "3 installments (30, 60 and 90 days)" or "4 installments (Upfront, 30, 60 and 90 days)".',
      );
}

export function parsePackageQuantity(cell: SheetCell, header: string): FieldResult<number> {
  const problem = structuralProblem<number>(cell, header);
  if (problem) return problem;
  if (cell.kind === "empty" || (cell.kind === "text" && cell.text.trim() === "")) return required(header);
  let value = Number.NaN;
  if (cell.kind === "number") value = cell.value;
  else if (cell.kind === "text" && /^\d+$/.test(cell.text.trim())) value = Number(cell.text.trim());
  return Number.isSafeInteger(value) && value >= 1
    ? ok(value)
    : fail(
        "QUANTITY_INVALID",
        `${header} must be a whole number of packages of at least 1.`,
        "Enter the package count. Returns, credit notes and fractional packages are outside this import.",
      );
}

const MONEY_MESSAGES: Record<MoneyErrorCode, [string, string]> = {
  MONEY_FORMAT: [
    "is not a Brazilian currency amount.",
    'Use a number cell or pt-BR text such as "R$ 1.220,40" (dot for thousands, comma for decimals).',
  ],
  MONEY_PRECISION: ["has more than two decimal places.", "Round the amount to cents in the source."],
  MONEY_OUT_OF_RANGE: ["is too large to represent exactly in cents.", "Check the amount in the source."],
  MONEY_NOT_FINITE: ["is not a finite number.", "Enter a valid amount."],
};

export type MoneySign = "positive" | "non-negative";

export function parseMoneyCents(cell: SheetCell, header: string, sign: MoneySign): FieldResult<number> {
  const problem = structuralProblem<number>(cell, header);
  if (problem) return problem;
  if (cell.kind === "empty" || (cell.kind === "text" && cell.text.trim() === "")) return required(header);
  let parsed;
  if (cell.kind === "number") parsed = excelNumberToCents(cell.value);
  else if (cell.kind === "text") parsed = parseBrlTextToCents(cell.text);
  else return unsupportedType(header, "a currency amount");
  if (!parsed.ok) {
    const [message, suggestion] = MONEY_MESSAGES[parsed.code];
    return fail(parsed.code, `${header} ${message}`, suggestion);
  }
  if (sign === "positive" && parsed.cents <= 0) {
    return fail("MONEY_NOT_POSITIVE", `${header} must be greater than zero.`, "Check the amount in the source.");
  }
  if (sign === "non-negative" && parsed.cents < 0) {
    return fail("MONEY_NEGATIVE", `${header} must not be negative.`, "Check the amount in the source.");
  }
  return ok(parsed.cents);
}

const DATE_MESSAGES: Record<DateErrorCode, (header: string, format: TextDateFormat) => [string, string]> = {
  DATE_TEXT_FORMAT: (header, format) => [
    `${header} is text that does not match the declared date format ${format}.`,
    `Use a date cell, or text in ${format}. Other text formats are not guessed.`,
  ],
  DATE_INVALID: (header) => [`${header} is not a real calendar date.`, "Correct the date in the source."],
  DATE_HAS_TIME: (header) => [
    `${header} includes a time of day.`,
    "Store the billing date as a date without time.",
  ],
  DATE_OUT_OF_RANGE: (header) => [
    `${header} is before the earliest supported billing date, ${MIN_BILLING_DATE}.`,
    "Correct the date in the source.",
  ],
};

export function parseBillingDate(
  cell: SheetCell,
  header: string,
  format: TextDateFormat,
): FieldResult<CalendarDate> {
  const problem = structuralProblem<CalendarDate>(cell, header);
  if (problem) return problem;
  if (cell.kind === "empty" || (cell.kind === "text" && cell.text.trim() === "")) return required(header);
  let parsed;
  if (cell.kind === "date") parsed = calendarDateFromExcelDate(cell.value);
  else if (cell.kind === "text") parsed = parseTextDate(cell.text, format);
  else if (cell.kind === "number") {
    return fail(
      "DATE_NOT_A_DATE_CELL",
      `${header} is a plain number, not a date-formatted cell.`,
      "Format the column as a date in the spreadsheet so its date system can be applied.",
    );
  } else return unsupportedType(header, "a date");
  if (parsed.ok && parsed.date < MIN_BILLING_DATE) parsed = { ok: false, code: "DATE_OUT_OF_RANGE" } as const;
  if (!parsed.ok) {
    const [message, suggestion] = DATE_MESSAGES[parsed.code](header, format);
    return fail(parsed.code, message, suggestion);
  }
  return ok(parsed.date);
}

export type DateComponent = "day" | "month" | "year";

const COMPONENT_RANGES: Record<DateComponent, [number, number]> = {
  day: [1, 31],
  month: [1, 12],
  year: [1900, 9999],
};

/** Optional derived components; the billing date stays authoritative. */
export function parseDateComponent(
  cell: SheetCell,
  header: string,
  component: DateComponent,
): FieldResult<number | null> {
  const problem = structuralProblem<number | null>(cell, header);
  if (problem) return problem;
  if (cell.kind === "empty" || (cell.kind === "text" && cell.text.trim() === "")) return ok(null);
  let value = Number.NaN;
  if (cell.kind === "number") value = cell.value;
  else if (cell.kind === "text" && /^\d+$/.test(cell.text.trim())) value = Number(cell.text.trim());
  const [min, max] = COMPONENT_RANGES[component];
  return Number.isInteger(value) && value >= min && value <= max
    ? ok(value)
    : fail(
        "DATE_COMPONENT_INVALID",
        `${header} must be a whole number from ${min} to ${max}.`,
        `Correct ${header} or leave it blank; it is derived from the billing date.`,
      );
}
