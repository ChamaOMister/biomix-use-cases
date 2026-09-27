import { describe, expect, it } from "vitest";
import { calendarDateFromExcelDate, isValidCalendarDate, parseTextDate } from "./dates";

describe("isValidCalendarDate", () => {
  it("accepts leap days only in leap years", () => {
    expect(isValidCalendarDate(2024, 2, 29)).toBe(true);
    expect(isValidCalendarDate(2000, 2, 29)).toBe(true);
    expect(isValidCalendarDate(2023, 2, 29)).toBe(false);
    expect(isValidCalendarDate(2100, 2, 29)).toBe(false);
  });

  it("rejects out-of-range months and days", () => {
    expect(isValidCalendarDate(2023, 13, 1)).toBe(false);
    expect(isValidCalendarDate(2023, 0, 1)).toBe(false);
    expect(isValidCalendarDate(2023, 4, 31)).toBe(false);
    expect(isValidCalendarDate(2023, 1, 0)).toBe(false);
  });
});

describe("parseTextDate", () => {
  it("parses ISO text when ISO is the declared format", () => {
    expect(parseTextDate("2023-01-02", "YYYY-MM-DD")).toEqual({ ok: true, date: "2023-01-02" });
  });

  it("parses DD/MM/YYYY text only when that format is declared", () => {
    expect(parseTextDate("02/01/2023", "DD/MM/YYYY")).toEqual({ ok: true, date: "2023-01-02" });
    expect(parseTextDate("02/01/2023", "YYYY-MM-DD")).toMatchObject({
      ok: false,
      code: "DATE_TEXT_FORMAT",
    });
  });

  it("does not accept a second format alongside the declared one", () => {
    expect(parseTextDate("2023-01-02", "DD/MM/YYYY")).toMatchObject({
      ok: false,
      code: "DATE_TEXT_FORMAT",
    });
  });

  it("rejects impossible calendar dates rather than rolling them over", () => {
    expect(parseTextDate("2023-02-29", "YYYY-MM-DD")).toMatchObject({
      ok: false,
      code: "DATE_INVALID",
    });
    expect(parseTextDate("31/04/2023", "DD/MM/YYYY")).toMatchObject({
      ok: false,
      code: "DATE_INVALID",
    });
    expect(parseTextDate("2024-02-29", "YYYY-MM-DD")).toEqual({ ok: true, date: "2024-02-29" });
  });

  it("rejects single-digit or padded variants", () => {
    expect(parseTextDate("2/1/2023", "DD/MM/YYYY").ok).toBe(false);
    expect(parseTextDate("2023-1-2", "YYYY-MM-DD").ok).toBe(false);
  });
});

describe("calendarDateFromExcelDate", () => {
  it("reads the calendar date from UTC components", () => {
    expect(calendarDateFromExcelDate(new Date(Date.UTC(2023, 0, 2)))).toEqual({
      ok: true,
      date: "2023-01-02",
    });
  });

  it("rejects a date that carries a time of day", () => {
    expect(calendarDateFromExcelDate(new Date(Date.UTC(2023, 0, 2, 13, 30)))).toMatchObject({
      ok: false,
      code: "DATE_HAS_TIME",
    });
  });

  it("rejects dates affected by the Excel 1900 leap-year bug", () => {
    expect(calendarDateFromExcelDate(new Date(Date.UTC(1900, 1, 28)))).toMatchObject({
      ok: false,
      code: "DATE_OUT_OF_RANGE",
    });
  });

  it("rejects invalid Date objects", () => {
    expect(calendarDateFromExcelDate(new Date(Number.NaN))).toMatchObject({
      ok: false,
      code: "DATE_INVALID",
    });
  });
});
