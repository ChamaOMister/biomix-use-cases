import { describe, expect, it } from "vitest";
import { blackFriday, calendarDate, christmas, dayNumber, isBillingDay, mothersDay } from "./calendar";
import { Random } from "./random";

describe("Random", () => {
  it("repeats its sequence for a seed, and forks are independent but repeatable", () => {
    const draw = (random: Random) => Array.from({ length: 5 }, () => random.uint32());
    expect(draw(new Random(42))).toEqual(draw(new Random(42)));
    expect(draw(new Random(42))).not.toEqual(draw(new Random(43)));
    expect(draw(new Random(42).fork("a"))).toEqual(draw(new Random(42).fork("a")));
    expect(draw(new Random(42).fork("a"))).not.toEqual(draw(new Random(42).fork("b")));
  });

  it("stays inside requested ranges", () => {
    const random = new Random(1);
    for (let i = 0; i < 1000; i += 1) {
      const value = random.int(3, 5);
      expect(value >= 3 && value <= 5 && Number.isInteger(value)).toBe(true);
      const float = random.float();
      expect(float >= 0 && float < 1).toBe(true);
    }
  });

  it("formats identifiers like version-4 UUIDs", () => {
    const random = new Random(9);
    for (let i = 0; i < 50; i += 1) {
      expect(random.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

describe("calendar", () => {
  it("finds Mother's Day (second Sunday of May), Black Friday and Christmas", () => {
    expect([2023, 2024, 2025, 2026].map((year) => calendarDate(mothersDay(year)))).toEqual([
      "2023-05-14",
      "2024-05-12",
      "2025-05-11",
      "2026-05-10",
    ]);
    expect([2023, 2024, 2025].map((year) => calendarDate(blackFriday(year)))).toEqual(["2023-11-24", "2024-11-29", "2025-11-28"]);
    expect(calendarDate(christmas(2025))).toBe("2025-12-25");
  });

  it("bills on weekdays that are not fixed national holidays", () => {
    const billing = (date: string) => isBillingDay(dayNumber(date));
    expect(billing("2025-06-12")).toBe(true); // Thursday
    expect(billing("2025-06-14")).toBe(false); // Saturday
    expect(billing("2025-09-07")).toBe(false); // Sunday and Independence Day
    expect(billing("2026-04-21")).toBe(false); // Tiradentes, Tuesday
    expect(billing("2023-11-20")).toBe(true); // before it became a national holiday
    expect(billing("2025-11-20")).toBe(false);
  });

  it("round-trips dates across month and year boundaries", () => {
    for (const date of ["2023-01-01", "2024-02-29", "2025-12-31", "2026-09-25"]) {
      expect(calendarDate(dayNumber(date))).toBe(date);
    }
    expect(calendarDate(dayNumber("2024-12-31") + 1)).toBe("2025-01-01");
  });
});
