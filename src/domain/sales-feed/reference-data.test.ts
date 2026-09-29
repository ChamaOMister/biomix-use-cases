import { describe, expect, it } from "vitest";
import { cityKey, SELLERS } from "./reference-data";

describe("seller reference data", () => {
  it("has the five sellers with their business units", () => {
    expect(SELLERS.map(({ sellerId, businessUnit }) => [sellerId, businessUnit])).toEqual([
      ["S01", "HOME_GARDEN"],
      ["S02", "HOME_GARDEN"],
      ["S03", "AGRO"],
      ["S04", "AGRO"],
      ["S05", "AGRO"],
    ]);
  });

  it("lists every territory's cities explicitly", () => {
    const counts = Object.fromEntries(SELLERS.map((seller) => [seller.sellerId, seller.cities.length]));
    // Grande São Paulo 39; SJC/Campinas/Holambra + 23 bordering; Região Serrana 15 + Espírito Santo 78;
    // Zona da Mata 142; Guaxupé + 5 bordering.
    expect(counts).toEqual({ S01: 39, S02: 26, S03: 93, S04: 142, S05: 6 });
    const has = (sellerId: string, city: string, state: string) =>
      SELLERS.find((seller) => seller.sellerId === sellerId)!.cities.some((c) => c.city === city && c.state === state);
    expect(has("S01", "São Paulo", "SP")).toBe(true);
    expect(has("S02", "São José dos Campos", "SP")).toBe(true);
    expect(has("S02", "Camanducaia", "MG")).toBe(true);
    expect(has("S03", "Petrópolis", "RJ")).toBe(true);
    expect(has("S03", "Miguel Pereira", "RJ")).toBe(true);
    expect(has("S03", "Trajano de Morais", "RJ")).toBe(true);
    expect(has("S03", "Vitória", "ES")).toBe(true);
    expect(has("S04", "Juiz de Fora", "MG")).toBe(true);
    expect(has("S05", "Tapiratiba", "SP")).toBe(true);
  });

  it("gives each city at most one seller per business unit", () => {
    for (const unit of ["AGRO", "HOME_GARDEN"]) {
      const keys = SELLERS.filter((seller) => seller.businessUnit === unit).flatMap((seller) =>
        seller.cities.map(({ city, state }) => cityKey(city, state)),
      );
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("stores city names in clean NFC form with two-letter states", () => {
    for (const { city, state } of SELLERS.flatMap((seller) => seller.cities)) {
      expect(city).toBe(city.normalize("NFC").trim());
      expect(state).toMatch(/^[A-Z]{2}$/);
    }
  });
});
