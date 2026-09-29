/**
 * Scheduled collections: the contractual installments of an invoice (decision 002, milestone 5).
 * They are what the payment schedule says the customer owes and when, not payments received.
 *
 * - The invoice total is aggregated once from its lines, never per line or per product.
 * - Every term splits the total into equal installments; the cents that do not divide evenly go
 *   one each to the earliest installments (data contract, default 8): 100 / 3 → [34, 33, 33].
 * - Due dates are the billing date plus calendar-day offsets (not calendar months), computed with
 *   integer arithmetic on ISO dates. No `Date` object is involved, so no time zone can shift them.
 *
 * Pure and safe for the browser. Reachable from Node scripts through built-in type stripping, so
 * relative imports keep their `.ts` extension and type-only imports use `import type`.
 */
import { formatCalendarDate, isValidCalendarDate, type CalendarDate } from "../sales-import/dates.ts";
import type { PaymentSchedule } from "../sales-import/types.ts";

/** Calendar days after the billing date on which each installment falls due (data contract). */
export const PAYMENT_SCHEDULE_OFFSETS: Readonly<Record<PaymentSchedule, readonly number[]>> = {
  UPFRONT: [0],
  NET_30: [30],
  INSTALLMENTS_30_60_90: [30, 60, 90],
  INSTALLMENTS_0_30_60_90: [0, 30, 60, 90],
};

/** Latest date written `YYYY-MM-DD`; a later due date cannot be represented. */
export const MAX_CALENDAR_DATE: CalendarDate = "9999-12-31";

export interface ScheduledInstallment {
  /** 1-based, in due-date order. */
  installmentNumber: number;
  dueDate: CalendarDate;
  amountCents: number;
}

// Days since 1970-01-01 in the proleptic Gregorian calendar (H. Hinnant's civil-date algorithm).
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

/**
 * The calendar date `days` days after `date` (ISO `YYYY-MM-DD`). Returns null for an invalid
 * input or a result outside years 1–9999.
 */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !Number.isSafeInteger(days)) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isValidCalendarDate(year, month, day)) return null;
  const [y, m, d] = civilFromDays(daysFromCivil(year, month, day) + days);
  return isValidCalendarDate(y, m, d) ? formatCalendarDate(y, m, d) : null;
}

/** Sum of the invoice's line amounts; null if it cannot be represented exactly. */
export function invoiceTotalCents(lines: readonly { lineAmountCents: number }[]): number | null {
  let total = 0;
  for (const line of lines) {
    total += line.lineAmountCents;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

/**
 * Splits `amountCents` into `count` equal parts, the remainder going one cent each to the
 * earliest parts. The parts always sum exactly to `amountCents`.
 */
export function splitEvenly(amountCents: number, count: number): number[] {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new RangeError("amountCents must be a non-negative safe integer");
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("count must be a positive integer");
  const base = Math.floor(amountCents / count);
  const remainder = amountCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export type InstallmentsResult =
  | { ok: true; installments: ScheduledInstallment[] }
  | { ok: false; code: "DUE_DATE_OUT_OF_RANGE" | "TOTAL_OUT_OF_RANGE" };

/**
 * The installments of one invoice, from its whole line set. Every term has a fixed number of
 * installments, so a total smaller than that count yields zero-cent installments (1 cent over
 * four installments → [1, 0, 0, 0]) rather than a shorter schedule.
 */
export function scheduleInstallments(invoice: {
  billingDate: CalendarDate;
  paymentSchedule: PaymentSchedule;
  lines: readonly { lineAmountCents: number }[];
}): InstallmentsResult {
  const totalCents = invoiceTotalCents(invoice.lines);
  if (totalCents === null || totalCents < 0) return { ok: false, code: "TOTAL_OUT_OF_RANGE" };
  const offsets = PAYMENT_SCHEDULE_OFFSETS[invoice.paymentSchedule];
  const amounts = splitEvenly(totalCents, offsets.length);
  const installments: ScheduledInstallment[] = [];
  for (const [index, offset] of offsets.entries()) {
    const dueDate = addCalendarDays(invoice.billingDate, offset);
    if (dueDate === null) return { ok: false, code: "DUE_DATE_OUT_OF_RANGE" };
    installments.push({ installmentNumber: index + 1, dueDate, amountCents: amounts[index]! });
  }
  return { ok: true, installments };
}

/** Whether every installment of `paymentSchedule` billed on `billingDate` has a representable due date. */
export function dueDatesRepresentable(billingDate: CalendarDate, paymentSchedule: PaymentSchedule): boolean {
  return PAYMENT_SCHEDULE_OFFSETS[paymentSchedule].every((offset) => addCalendarDays(billingDate, offset) !== null);
}
