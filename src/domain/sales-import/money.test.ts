import { describe, expect, it } from "vitest";
import { excelNumberToCents, parseBrlTextToCents } from "./money";

describe("parseBrlTextToCents (strict pt-BR)", () => {
  it.each([
    ["R$ 1.220,40", 122040],
    ["R$ 1.220,40", 122040],
    ["1.220,40", 122040],
    ["1220,40", 122040],
    ["1220,4", 122040],
    ["1220", 122000],
    ["0,05", 5],
    ["1.234.567,89", 123456789],
    ["  R$ 61,02  ", 6102],
    ["-10,00", -1000],
  ])("parses %j as %i cents", (text, cents) => {
    expect(parseBrlTextToCents(text)).toEqual({ ok: true, cents });
  });

  it.each([
    "1,220.40", // US grouping
    "1220.40", // dot decimal
    "12.40", // dot is only a thousands separator in pt-BR
    "1.22,00", // malformed group
    "1,234", // more than two decimals
    ",50",
    "1,",
    "R$",
    "abc",
    "1e3",
    "US$ 10,00",
    "",
  ])("rejects %j", (text) => {
    const result = parseBrlTextToCents(text);
    expect(result.ok).toBe(false);
  });

  it("reports excess decimals as a precision problem", () => {
    expect(parseBrlTextToCents("1,234")).toMatchObject({ ok: false, code: "MONEY_PRECISION" });
  });

  it("rejects values beyond the safe-integer cent range", () => {
    expect(parseBrlTextToCents("90.071.992.547.409,93")).toMatchObject({
      ok: false,
      code: "MONEY_OUT_OF_RANGE",
    });
  });
});

describe("excelNumberToCents", () => {
  it.each([
    [1220.4, 122040],
    [61.02, 6102],
    [0.1, 10],
    [1000, 100000],
    [-5.5, -550],
  ])("converts %d to %i cents without float drift", (value, cents) => {
    expect(excelNumberToCents(value)).toEqual({ ok: true, cents });
  });

  it("rejects values with more than two decimals instead of rounding", () => {
    expect(excelNumberToCents(1220.405)).toMatchObject({ ok: false, code: "MONEY_PRECISION" });
    expect(excelNumberToCents(0.1 + 0.2)).toMatchObject({ ok: false, code: "MONEY_PRECISION" });
  });

  it("rejects non-finite and out-of-range values", () => {
    expect(excelNumberToCents(Number.NaN)).toMatchObject({ ok: false, code: "MONEY_NOT_FINITE" });
    expect(excelNumberToCents(Infinity)).toMatchObject({ ok: false, code: "MONEY_NOT_FINITE" });
    expect(excelNumberToCents(1e21)).toMatchObject({ ok: false, code: "MONEY_OUT_OF_RANGE" });
    expect(excelNumberToCents(1e-7)).toMatchObject({ ok: false, code: "MONEY_PRECISION" });
  });
});
