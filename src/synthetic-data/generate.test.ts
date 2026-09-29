import { beforeAll, describe, expect, it } from "vitest";
import {
  commissionCents,
  PAYMENT_SCHEDULE_LABELS,
  validateDelivery,
  type InvoicePayload,
} from "../domain/sales-feed/contract";
import { cityKey, SELLERS } from "../domain/sales-feed/reference-data";
import { ANNUAL_TARGET_CENTS, REDUCED_PURCHASE_FACTOR, REDUCED_PURCHASE_TOLERANCE, unitTargetCents } from "./config";
import { DEFAULT_SEED, generateSyntheticFeed, replayDeliveries, type Scenario, type SyntheticFeed } from "./generate";

let feed: SyntheticFeed;
let all: SyntheticFeed["deliveries"];
let stored: InvoicePayload[];

beforeAll(() => {
  feed = generateSyntheticFeed({ seed: DEFAULT_SEED });
  all = [...feed.deliveries, feed.pendingDelivery];
  stored = [...replayDeliveries(all).values()];
});

function sales(invoices: readonly InvoicePayload[]): number {
  return invoices.reduce((total, invoice) => total + invoice.lines.reduce((sum, line) => sum + line.lineAmountCents, 0), 0);
}

function between(customerId: string, from: string, to: string): number {
  return sales(stored.filter((i) => i.customer.id === customerId && i.billingDate >= from && i.billingDate <= to));
}

function scenarios<K extends Scenario["kind"]>(kind: K): Extract<Scenario, { kind: K }>[] {
  return feed.answerKey.scenarios.filter((scenario): scenario is Extract<Scenario, { kind: K }> => scenario.kind === kind);
}

/** Replays deliveries through the contract the way the feed endpoint will, remembering owners. */
function replayThroughContract(deliveries: SyntheticFeed["deliveries"]) {
  const owners = new Map<string, string>();
  return deliveries.map(({ month, payload }) => {
    const result = validateDelivery(JSON.parse(JSON.stringify(payload)), { customerOwner: (id) => owners.get(id) });
    if (result.ok) for (const invoice of result.delivery.invoices) owners.set(invoice.customer.id, invoice.sellerId);
    return { month, result };
  });
}

describe("synthetic feed: determinism", () => {
  it("produces identical output for the same seed", () => {
    expect(JSON.stringify(generateSyntheticFeed({ seed: DEFAULT_SEED }))).toBe(JSON.stringify(feed));
  });

  it("produces different data for a different seed", () => {
    const other = generateSyntheticFeed({ seed: DEFAULT_SEED + 1 });
    expect(JSON.stringify(other.deliveries)).not.toBe(JSON.stringify(feed.deliveries));
  });

  it("rejects seeds outside the 32-bit range", () => {
    for (const seed of [-1, 1.5, 2 ** 32]) expect(() => generateSyntheticFeed({ seed })).toThrow(RangeError);
  });
});

describe("synthetic feed: deliveries over time", () => {
  it("has one delivery per closed month from January 2023 to August 2026, then September 2026 pending", () => {
    expect(feed.deliveries).toHaveLength(44);
    expect(feed.deliveries[0]?.month).toBe("2023-01");
    expect(feed.deliveries.at(-1)?.month).toBe("2026-08");
    expect(feed.pendingDelivery.month).toBe("2026-09");
    expect(new Set(all.map((delivery) => delivery.payload.deliveryId)).size).toBe(45);
  });

  it("carries each month's invoices; only resent invoices are from earlier months", () => {
    const seen = new Set<string>();
    for (const { month, payload } of all) {
      for (const invoice of payload.invoices) {
        const resent = seen.has(invoice.invoiceNumber);
        if (resent) expect(invoice.billingDate.slice(0, 7) < month).toBe(true);
        else expect(invoice.billingDate.slice(0, 7)).toBe(month);
        seen.add(invoice.invoiceNumber);
      }
    }
    const pendingDates = feed.pendingDelivery.payload.invoices.filter((i) => i.billingDate >= "2026-09-01").map((i) => i.billingDate);
    expect(pendingDates.length).toBeGreaterThan(0);
    expect(pendingDates.every((date) => date <= "2026-09-25")).toBe(true);
  });
});

describe("synthetic feed: contract rules", () => {
  it("passes the delivery contract when replayed in order, including stored-customer ownership", () => {
    for (const { month, result } of replayThroughContract(all)) {
      expect(result.ok ? month : [month, result.errors.slice(0, 3)]).toBe(month);
    }
  });

  it("uses exact line amounts, 5% half-up commission and known payment schedules", () => {
    const labels = new Set(Object.values(PAYMENT_SCHEDULE_LABELS));
    for (const { payload } of all) {
      for (const invoice of payload.invoices) {
        expect(labels.has(invoice.paymentSchedule)).toBe(true);
        for (const line of invoice.lines) {
          expect(line.lineAmountCents).toBe(line.packageQuantity * line.unitPriceCents);
          expect(line.commissionAmountCents).toBe(commissionCents(line.lineAmountCents));
        }
      }
    }
  });

  it("keeps invoice numbers unique: a number repeats only when a corrected invoice is resent", () => {
    const deliveriesByNumber = new Map<string, string[]>();
    for (const { month, payload } of all) {
      for (const { invoiceNumber } of payload.invoices) {
        expect(invoiceNumber).toMatch(/^\d{6}$/);
        deliveriesByNumber.set(invoiceNumber, [...(deliveriesByNumber.get(invoiceNumber) ?? []), month]);
      }
    }
    const repeated = [...deliveriesByNumber].filter(([, months]) => months.length > 1);
    const corrections = scenarios("corrected-invoice");
    expect(repeated.map(([number, months]) => [number, months]).sort()).toEqual(
      corrections.map((c) => [c.invoiceNumber, [c.originalDeliveryMonth, c.correctedDeliveryMonth]]).sort(),
    );
    expect(corrections.length).toBeGreaterThanOrEqual(3);
    expect(corrections.some((c) => c.correctedDeliveryMonth === "2026-09")).toBe(true);
  });

  it("sells every customer inside its seller's territory, always through the same seller", () => {
    const territory = new Map(SELLERS.map((s) => [s.sellerId, new Set(s.cities.map((c) => cityKey(c.city, c.state)))]));
    const unit = new Map(SELLERS.map((s) => [s.sellerId, s.businessUnit === "AGRO" ? "Agro" : "Home & Garden"]));
    const customers = new Map<string, string>();
    for (const { payload } of all) {
      for (const invoice of payload.invoices) {
        const { customer } = invoice;
        expect(territory.get(invoice.sellerId)?.has(cityKey(customer.city, customer.state))).toBe(true);
        expect(invoice.businessUnit).toBe(unit.get(invoice.sellerId));
        const identity = JSON.stringify([invoice.sellerId, customer]);
        expect(customers.get(customer.id) ?? identity).toBe(identity);
        customers.set(customer.id, identity);
      }
    }
    expect(new Set([...customers.values()].map((identity) => JSON.parse(identity)[0])).size).toBe(5);
  });
});

describe("synthetic feed: business shape", () => {
  it("lands every annual total within 1% of target, split 60% Agro / 40% Home & Garden", () => {
    for (const year of ANNUAL_TARGET_CENTS.keys()) {
      const inYear = stored.filter((invoice) => invoice.billingDate.startsWith(`${year}-`));
      for (const [unit, label] of [["AGRO", "Agro"], ["HOME_GARDEN", "Home & Garden"]] as const) {
        const target = unitTargetCents(year, unit);
        const actual = sales(inYear.filter((invoice) => invoice.businessUnit === label));
        expect(Math.abs(actual - target) / target).toBeLessThanOrEqual(0.01);
      }
      const total = ANNUAL_TARGET_CENTS.get(year)!;
      expect(Math.abs(sales(inYear) - total) / total).toBeLessThanOrEqual(0.01);
    }
    expect(feed.summary.byYear.map((year) => year.actualCents)).toEqual(
      [...ANNUAL_TARGET_CENTS.keys()].map((year) => sales(stored.filter((i) => i.billingDate.startsWith(`${year}-`)))),
    );
  });

  it("follows seasonality: Agro peaks June–August; Home & Garden rises before promotions", () => {
    const unitSales = (label: string, from: string, to: string) =>
      sales(stored.filter((i) => i.businessUnit === label && i.billingDate >= from && i.billingDate <= to));
    for (const year of [2023, 2024, 2025]) {
      expect(unitSales("Agro", `${year}-06-01`, `${year}-08-31`)).toBeGreaterThan(
        3 * unitSales("Agro", `${year}-01-01`, `${year}-03-31`),
      );
      // Three weeks before Black Friday vs. the same length in early September.
      const blackFridayWindow = { 2023: ["2023-11-03", "2023-11-23"], 2024: ["2024-11-08", "2024-11-28"], 2025: ["2025-11-07", "2025-11-27"] }[year]!;
      expect(unitSales("Home & Garden", blackFridayWindow[0]!, blackFridayWindow[1]!)).toBeGreaterThan(
        1.5 * unitSales("Home & Garden", `${year}-09-01`, `${year}-09-21`),
      );
    }
  });

  it("concentrates most revenue in a few large accounts", () => {
    expect(feed.summary.topTenPercentCustomersSharePercent).toBeGreaterThan(50);
    expect(feed.summary.customers).toBeGreaterThan(200);
  });
});

describe("synthetic feed: planted scenarios and the answer key", () => {
  it("keeps the answer key out of the deliveries", () => {
    const deliveriesText = JSON.stringify(all);
    for (const marker of ["scenario", "missed", "answer", "planted", "reduced", "split"]) {
      expect(deliveriesText.toLowerCase()).not.toContain(marker);
    }
    expect(feed.answerKey.purpose).toMatch(/must not read it/);
  });

  it("plants a missed Agro season and a missed Mother's Day window that the data shows", () => {
    const [season] = scenarios("missed-season");
    expect(season!.seasons.slice(0, 3).every((s) => between(season!.customerId, s.from, s.to) > 0)).toBe(true);
    expect(between(season!.customerId, "2026-05-01", "2026-09-25")).toBe(0);
    const [window] = scenarios("missed-promotion-window");
    expect(window!.windows.slice(0, 3).every((w) => between(window!.customerId, w.from, w.to) > 0)).toBe(true);
    expect(between(window!.customerId, "2026-04-19", "2026-05-09")).toBe(0);
    expect(window!.windows.map((w) => w.salesCents)).toEqual(window!.windows.map((w) => between(window!.customerId, w.from, w.to)));
  });

  it("plants split invoices: one customer, one day, consecutive invoice numbers", () => {
    const splits = scenarios("split-invoice");
    expect(splits).toHaveLength(2);
    for (const split of splits) {
      const pair = split.invoiceNumbers.map((number) => stored.find((i) => i.invoiceNumber === number)!);
      expect(pair.map((i) => [i.customer.id, i.billingDate])).toEqual([
        [split.customerId, split.billingDate],
        [split.customerId, split.billingDate],
      ]);
      expect(Number(split.invoiceNumbers[1])).toBe(Number(split.invoiceNumbers[0]) + 1);
    }
  });

  it("lists new customers whose first purchase is in 2026", () => {
    const newcomers = scenarios("new-customer");
    expect(newcomers.length).toBeGreaterThanOrEqual(5);
    for (const newcomer of newcomers) {
      const own = stored.filter((invoice) => invoice.customer.id === newcomer.customerId);
      expect(own.map((i) => i.billingDate).sort()[0]).toBe(newcomer.firstBillingDate);
      expect(newcomer.firstBillingDate >= "2026-01-01").toBe(true);
    }
  });

  it("records corrections whose resent version is what the replay keeps", () => {
    for (const correction of scenarios("corrected-invoice")) {
      const final = stored.find((invoice) => invoice.invoiceNumber === correction.invoiceNumber)!;
      expect(sales([final])).toBe(correction.correctedSalesCents);
      const original = all
        .find((d) => d.month === correction.originalDeliveryMonth)!
        .payload.invoices.find((invoice) => invoice.invoiceNumber === correction.invoiceNumber)!;
      expect(sales([original])).toBe(correction.originalSalesCents);
      expect(JSON.stringify(original)).not.toBe(JSON.stringify(final));
    }
  });
});

describe("synthetic feed: another seed", () => {
  it("still meets the targets and the contract", () => {
    const other = generateSyntheticFeed({ seed: 7 });
    for (const year of other.summary.byUnitAndYear) expect(Math.abs(year.deviationPercent)).toBeLessThanOrEqual(1);
    const results = replayThroughContract([...other.deliveries, other.pendingDelivery]);
    expect(results.filter(({ result }) => !result.ok).map(({ month }) => month)).toEqual([]);
  });
});

// Seeds 8 and 28 once produced a smaller reduction and an increase (milestone 3 review, R1).
describe.each([DEFAULT_SEED, 8, 28])("synthetic feed: reduced purchases, seed %i", (seed) => {
  let seedFeed: SyntheticFeed;
  let seedStored: InvoicePayload[];

  beforeAll(() => {
    seedFeed = seed === DEFAULT_SEED ? feed : generateSyntheticFeed({ seed });
    seedStored = [...replayDeliveries([...seedFeed.deliveries, seedFeed.pendingDelivery]).values()];
  });

  const seedScenarios = <K extends Scenario["kind"]>(kind: K) =>
    seedFeed.answerKey.scenarios.filter((scenario): scenario is Extract<Scenario, { kind: K }> => scenario.kind === kind);

  const replayedSales = (customerId: string, from: string, to: string) =>
    sales(seedStored.filter((i) => i.customer.id === customerId && i.billingDate >= from && i.billingDate <= to));

  it("plants one reduced account per unit, never split or corrected", () => {
    const reduced = seedScenarios("reduced-purchases");
    expect(reduced.map((r) => r.businessUnit).sort()).toEqual(["Agro", "Home & Garden"]);
    const touched = new Set([
      ...seedScenarios("split-invoice").map((s) => s.customerId),
      ...seedScenarios("corrected-invoice").map((c) => c.customerId),
    ]);
    for (const scenario of reduced) expect(touched.has(scenario.customerId)).toBe(false);
  });

  it("shows the intended reduction in replayed invoices over equivalent periods", () => {
    for (const scenario of seedScenarios("reduced-purchases")) {
      expect([scenario.previous.from, scenario.previous.to, scenario.current.from, scenario.current.to]).toEqual([
        "2025-01-01",
        "2025-09-25",
        "2026-01-01",
        "2026-09-25",
      ]);
      const previous = replayedSales(scenario.customerId, "2025-01-01", "2025-09-25");
      const current = replayedSales(scenario.customerId, "2026-01-01", "2026-09-25");
      expect([scenario.previous.salesCents, scenario.current.salesCents]).toEqual([previous, current]);
      expect(previous).toBeGreaterThan(0);
      expect(Math.abs(current / previous - REDUCED_PURCHASE_FACTOR)).toBeLessThanOrEqual(REDUCED_PURCHASE_TOLERANCE);
      expect(scenario.changePercent).toBe(Math.round(((current - previous) / previous) * 10_000) / 100);
    }
  });

  it("describes the measured change, not an intended one", () => {
    for (const scenario of seedScenarios("reduced-purchases")) {
      expect(scenario.description).toContain(`changed by ${scenario.changePercent.toFixed(2)}%`);
      expect(scenario.description).toContain("2026-01-01 to 2026-09-25");
      expect(scenario.description).toContain("2025-01-01 to 2025-09-25");
    }
  });

  it("still lands every unit-year within 1% of target after corrections and calibration", () => {
    for (const year of ANNUAL_TARGET_CENTS.keys()) {
      for (const [unit, label] of [["AGRO", "Agro"], ["HOME_GARDEN", "Home & Garden"]] as const) {
        const target = unitTargetCents(year, unit);
        const actual = sales(seedStored.filter((i) => i.businessUnit === label && i.billingDate.startsWith(`${year}-`)));
        expect(Math.abs(actual - target) / target).toBeLessThanOrEqual(0.01);
      }
    }
  });
});
