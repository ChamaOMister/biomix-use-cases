import { afterEach, describe, expect, it } from "vitest";
import { PAYMENT_SCHEDULE_LABELS } from "../sales-feed/contract";
import type { PaymentSchedule } from "../sales-import/types";
import {
  addCalendarDays,
  invoiceTotalCents,
  PAYMENT_SCHEDULE_OFFSETS,
  scheduleInstallments,
  splitEvenly,
  type ScheduledInstallment,
} from "./schedule";

const amounts = (...lineAmountCents: number[]) => lineAmountCents.map((amount) => ({ lineAmountCents: amount }));

function installments(billingDate: string, paymentSchedule: PaymentSchedule, lines = amounts(10000)): ScheduledInstallment[] {
  const result = scheduleInstallments({ billingDate, paymentSchedule, lines });
  if (!result.ok) throw new Error(`expected installments, got ${result.code}`);
  return result.installments;
}

describe("payment schedule offsets", () => {
  it("follow the data contract's calendar-day offsets for all four terms", () => {
    expect(PAYMENT_SCHEDULE_OFFSETS).toEqual({
      UPFRONT: [0],
      NET_30: [30],
      INSTALLMENTS_30_60_90: [30, 60, 90],
      INSTALLMENTS_0_30_60_90: [0, 30, 60, 90],
    });
    // The feed's labels name the same terms.
    expect(Object.keys(PAYMENT_SCHEDULE_OFFSETS).sort()).toEqual(Object.keys(PAYMENT_SCHEDULE_LABELS).sort());
  });
});

describe("splitting a total into equal installments", () => {
  it.each([
    [100, 3, [34, 33, 33]],
    [101, 4, [26, 25, 25, 25]],
    [102, 4, [26, 26, 25, 25]],
    [103, 4, [26, 26, 26, 25]],
    [104, 4, [26, 26, 26, 26]],
    [99, 3, [33, 33, 33]],
    [5, 1, [5]],
    [1, 4, [1, 0, 0, 0]],
    [2, 3, [1, 1, 0]],
    [0, 3, [0, 0, 0]],
  ])("%i cents in %i parts → %j (remainder to the earliest parts)", (total, count, expected) => {
    expect(splitEvenly(total, count)).toEqual(expected);
  });

  it("always sums exactly, up to the largest safe integer", () => {
    for (const total of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, 9_007_199_254_740_990, 1_234_567_891]) {
      for (const count of [1, 3, 4]) {
        const parts = splitEvenly(total, count);
        expect(parts.reduce((sum, part) => BigInt(sum) + BigInt(part), 0n)).toBe(BigInt(total));
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("refuses amounts and counts that are not whole", () => {
    expect(() => splitEvenly(10.5, 3)).toThrow(RangeError);
    expect(() => splitEvenly(-1, 3)).toThrow(RangeError);
    expect(() => splitEvenly(Number.MAX_SAFE_INTEGER + 1, 3)).toThrow(RangeError);
    expect(() => splitEvenly(10, 0)).toThrow(RangeError);
  });
});

describe("invoice installments", () => {
  it.each<[PaymentSchedule, [string, number][]]>([
    ["UPFRONT", [["2025-06-12", 10001]]],
    ["NET_30", [["2025-07-12", 10001]]],
    ["INSTALLMENTS_30_60_90", [["2025-07-12", 3334], ["2025-08-11", 3334], ["2025-09-10", 3333]]],
    ["INSTALLMENTS_0_30_60_90", [["2025-06-12", 2501], ["2025-07-12", 2500], ["2025-08-11", 2500], ["2025-09-10", 2500]]],
  ])("%s: equal installments on calendar-day offsets, summing to the invoice total", (schedule, expected) => {
    const result = installments("2025-06-12", schedule, amounts(10001));
    expect(result).toEqual(expected.map(([dueDate, amountCents], index) => ({ installmentNumber: index + 1, dueDate, amountCents })));
    expect(result.reduce((sum, installment) => sum + installment.amountCents, 0)).toBe(10001);
  });

  it("aggregates a multiline invoice once instead of splitting each line", () => {
    // Two lines of the same product and one other: 12,500 + 2,997 + 1,250 = 16,747 cents.
    const lines = amounts(12500, 2997, 1250);
    expect(invoiceTotalCents(lines)).toBe(16747);
    expect(installments("2025-06-12", "INSTALLMENTS_30_60_90", lines).map((i) => i.amountCents)).toEqual([5583, 5582, 5582]);
    // Splitting line by line would move cents between installments: [5583, 5583, 5581].
    const perLine = lines.map((line) => splitEvenly(line.lineAmountCents, 3));
    expect([0, 1, 2].map((index) => perLine.reduce((sum, parts) => sum + parts[index]!, 0))).toEqual([5583, 5583, 5581]);
  });

  it("keeps a fixed installment count, with zero-cent installments for totals below it", () => {
    expect(installments("2025-06-12", "INSTALLMENTS_0_30_60_90", amounts(3)).map((i) => i.amountCents)).toEqual([1, 1, 1, 0]);
  });

  it("refuses a total that cannot be represented exactly", () => {
    expect(scheduleInstallments({ billingDate: "2025-06-12", paymentSchedule: "NET_30", lines: amounts(Number.MAX_SAFE_INTEGER, 1) })).toEqual({
      ok: false,
      code: "TOTAL_OUT_OF_RANGE",
    });
  });

  it("refuses due dates after 9999-12-31", () => {
    expect(installments("9999-10-02", "INSTALLMENTS_30_60_90").at(-1)!.dueDate).toBe("9999-12-31");
    expect(scheduleInstallments({ billingDate: "9999-10-03", paymentSchedule: "INSTALLMENTS_30_60_90", lines: amounts(100) })).toEqual({
      ok: false,
      code: "DUE_DATE_OUT_OF_RANGE",
    });
  });
});

describe("due dates", () => {
  it.each([
    // Month and year boundaries.
    ["2025-12-15", "INSTALLMENTS_0_30_60_90", ["2025-12-15", "2026-01-14", "2026-02-13", "2026-03-15"]],
    ["2025-11-30", "INSTALLMENTS_30_60_90", ["2025-12-30", "2026-01-29", "2026-02-28"]],
    ["2025-12-31", "NET_30", ["2026-01-30"]],
    ["2026-12-31", "UPFRONT", ["2026-12-31"]],
    // February in leap and common years: offsets are days, not months.
    ["2024-01-30", "NET_30", ["2024-02-29"]],
    ["2023-01-30", "NET_30", ["2023-03-01"]],
    ["2024-12-31", "INSTALLMENTS_30_60_90", ["2025-01-30", "2025-03-01", "2025-03-31"]],
    ["2023-12-31", "INSTALLMENTS_30_60_90", ["2024-01-30", "2024-02-29", "2024-03-30"]],
    ["2024-01-31", "NET_30", ["2024-03-01"]],
  ] as const)("billed %s on %s → %j", (billingDate, schedule, expected) => {
    expect(installments(billingDate, schedule).map((installment) => installment.dueDate)).toEqual(expected);
  });

  it("follows the Gregorian century rules", () => {
    expect(addCalendarDays("2000-02-28", 1)).toBe("2000-02-29");
    expect(addCalendarDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addCalendarDays("1900-02-28", 1)).toBe("1900-03-01");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("matches an independent UTC calendar for every day from 1900 to 2100", () => {
    const oracle = (date: string, days: number) => {
      const [year, month, day] = date.split("-").map(Number) as [number, number, number];
      return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
    };
    let checked = 0;
    for (let time = Date.UTC(1900, 0, 1); time <= Date.UTC(2100, 11, 31); time += 86_400_000) {
      const date = new Date(time).toISOString().slice(0, 10);
      for (const days of [0, 30, 60, 90]) {
        if (addCalendarDays(date, days) !== oracle(date, days)) throw new Error(`${date} + ${days} differs`);
        checked += 1;
      }
    }
    expect(checked).toBe(73_414 * 4);
  });

  it("refuses invalid dates and results outside years 1–9999", () => {
    expect(addCalendarDays("2025-02-29", 30)).toBeNull();
    expect(addCalendarDays("2025-6-12", 30)).toBeNull();
    expect(addCalendarDays("2025-06-12", 1.5)).toBeNull();
    expect(addCalendarDays("9999-12-31", 1)).toBeNull();
    expect(addCalendarDays("0001-01-01", -1)).toBeNull();
    expect(addCalendarDays("0001-01-01", 0)).toBe("0001-01-01");
  });

  describe("in any machine time zone", () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    // Includes a day that had no local midnight in São Paulo (DST began on 2018-11-04) and New
    // York's DST changes; a Date at local midnight would shift these by a day.
    const cases: [string, PaymentSchedule][] = [
      ["2018-10-05", "NET_30"],
      ["2018-11-04", "INSTALLMENTS_0_30_60_90"],
      ["2025-02-07", "INSTALLMENTS_30_60_90"],
      ["2025-12-15", "INSTALLMENTS_0_30_60_90"],
      ["2024-12-31", "INSTALLMENTS_30_60_90"],
    ];
    const expected = cases.map(([date, schedule]) => installments(date, schedule));

    it.each(["UTC", "America/Sao_Paulo", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kathmandu"])(
      "gives the same schedules with TZ=%s",
      (zone) => {
        process.env.TZ = zone;
        // The zone really changed: local midnight on 1 January 2025 is zone-specific.
        const offset = new Date(2025, 0, 1).getTimezoneOffset();
        expect(offset).toBe({ UTC: 0, "America/Sao_Paulo": 180, "America/New_York": 300, "Pacific/Kiritimati": -840, "Pacific/Pago_Pago": 660, "Asia/Kathmandu": -345 }[zone]);
        expect(cases.map(([date, schedule]) => installments(date, schedule))).toEqual(expected);
        expect(expected[0]!.map((installment) => installment.dueDate)).toEqual(["2018-11-04"]);
      },
    );
  });
});
