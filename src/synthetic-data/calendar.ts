/**
 * Calendar arithmetic on day numbers (days since 1970-01-01). Everything goes through UTC, so
 * results never depend on the machine's time zone.
 */
import type { CalendarDate } from "../domain/sales-import/dates.ts";

const MS_PER_DAY = 86_400_000;

export function dayNumber(date: CalendarDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / MS_PER_DAY;
}

export function calendarDate(day: number): CalendarDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function yearOf(day: number): number {
  return new Date(day * MS_PER_DAY).getUTCFullYear();
}

/** `YYYY-MM`. */
export function monthOf(day: number): string {
  return calendarDate(day).slice(0, 7);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** The n-th given weekday of a month, e.g. the second Sunday of May. */
function nthWeekday(year: number, month: number, targetWeekday: number, n: number): number {
  const first = Date.UTC(year, month - 1, 1) / MS_PER_DAY;
  return first + ((targetWeekday - weekday(first) + 7) % 7) + 7 * (n - 1);
}

/** Brazilian Mother's Day: second Sunday of May. */
export function mothersDay(year: number): number {
  return nthWeekday(year, 5, 0, 2);
}

/** The Friday after the fourth Thursday of November. */
export function blackFriday(year: number): number {
  return nthWeekday(year, 11, 4, 4) + 1;
}

export function christmas(year: number): number {
  return Date.UTC(year, 11, 25) / MS_PER_DAY;
}

const FIXED_NATIONAL_HOLIDAYS = new Set(["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"]);

/** Weekdays that are not fixed-date national holidays (movable holidays are not modelled). */
export function isBillingDay(day: number): boolean {
  const dow = weekday(day);
  if (dow === 0 || dow === 6) return false;
  const monthDay = calendarDate(day).slice(5);
  if (monthDay === "11-20" && yearOf(day) >= 2024) return false; // national holiday since 2024
  return !FIXED_NATIONAL_HOLIDAYS.has(monthDay);
}

export function billingDaysBetween(first: number, last: number): number[] {
  const days: number[] = [];
  for (let day = first; day <= last; day += 1) if (isBillingDay(day)) days.push(day);
  return days;
}
