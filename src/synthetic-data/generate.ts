/**
 * Seeded synthetic feed (decision 002): one delivery per closed month from January 2023 to
 * August 2026, plus 1–25 September 2026 as the pending next delivery. The same seed always
 * produces the same output. Planted scenarios are reported only in the separate answer key; the
 * deliveries carry nothing but contract fields.
 */
import {
  BUSINESS_UNIT_LABELS,
  commissionCents,
  toDeliveryPayload,
  type DeliveryPayload,
  type FeedInvoice,
  type InvoicePayload,
} from "../domain/sales-feed/contract.ts";
import type { CalendarDate } from "../domain/sales-import/dates.ts";
import type { BusinessUnit, PaymentSchedule } from "../domain/sales-import/types.ts";
import {
  billingDaysBetween,
  blackFriday,
  calendarDate,
  christmas,
  dayNumber,
  monthOf,
  mothersDay,
  yearOf,
} from "./calendar.ts";
import { PRODUCTS, priceCents, type Product } from "./catalogue.ts";
import {
  AGRO_MONTH_WEIGHTS,
  ANNUAL_TARGET_CENTS,
  CALIBRATION_TOLERANCE,
  CORRECTIONS_IN_CLOSED_MONTHS,
  CORRECTIONS_IN_PENDING_DELIVERY,
  FIRST_BILLING_DATE,
  HOME_GARDEN_BASE_WEIGHT,
  HOME_GARDEN_PROMOTION_WEIGHT,
  LAST_BILLING_DATE,
  PENDING_MONTH,
  PREFERRED_SCHEDULE_SHARE,
  PROMOTION_LEAD_DAYS,
  REDUCED_PURCHASE_FACTOR,
  REDUCED_PURCHASE_TOLERANCE,
  REPEATED_PRODUCT_CHANCE,
  TARGET_TOLERANCE,
  TIERS,
  unitTargetCents,
} from "./config.ts";
import { createCustomers, type SyntheticCustomer } from "./customers.ts";
import { Random } from "./random.ts";

export { DEFAULT_SEED } from "./config.ts";

const UNITS: readonly BusinessUnit[] = ["AGRO", "HOME_GARDEN"];
const SCHEDULES: readonly PaymentSchedule[] = ["UPFRONT", "NET_30", "INSTALLMENTS_30_60_90", "INSTALLMENTS_0_30_60_90"];
const YEARS = [...ANNUAL_TARGET_CENTS.keys()];
const PERIOD_START = dayNumber(FIRST_BILLING_DATE);
const PERIOD_END = dayNumber(LAST_BILLING_DATE);
const CURRENT_YEAR = yearOf(PERIOD_END);
/** Reduced purchases compare 1 January – as-of date with the same dates a year earlier. */
const PREVIOUS_PERIOD: [number, number] = [
  dayNumber(`${CURRENT_YEAR - 1}-01-01`),
  dayNumber(`${CURRENT_YEAR - 1}${LAST_BILLING_DATE.slice(4)}`),
];
const CURRENT_PERIOD: [number, number] = [dayNumber(`${CURRENT_YEAR}-01-01`), PERIOD_END];

export interface GeneratedDelivery {
  /** Billing month the delivery carries (`YYYY-MM`); corrections of earlier invoices ride along. */
  month: string;
  payload: DeliveryPayload;
}

export interface UnitYearTotal {
  year: number;
  businessUnit: string;
  targetCents: number;
  actualCents: number;
  /** (actual − target) / target, in percent with two decimals. */
  deviationPercent: number;
}

export interface YearTotal {
  year: number;
  targetCents: number;
  actualCents: number;
  deviationPercent: number;
  agroSharePercent: number;
}

export interface DeliveryFigures {
  month: string;
  deliveryId: string;
  pending: boolean;
  invoices: number;
  resentInvoices: number;
  lines: number;
  salesCents: number;
}

/** Figures anyone can recompute from the deliveries; not an answer key. */
export interface GenerationSummary {
  seed: number;
  firstBillingDate: CalendarDate;
  lastBillingDate: CalendarDate;
  closedMonthDeliveries: number;
  pendingDeliveryMonth: string;
  /** After replaying every delivery, pending one included: resent invoices counted once. */
  invoices: number;
  lines: number;
  customers: number;
  products: number;
  byUnitAndYear: UnitYearTotal[];
  byYear: YearTotal[];
  /** Revenue share of the top 10% of customers by revenue, in percent. */
  topTenPercentCustomersSharePercent: number;
  deliveries: DeliveryFigures[];
}

export interface PeriodSales {
  from: CalendarDate;
  to: CalendarDate;
  salesCents: number;
}

export type Scenario =
  | {
      kind: "missed-season";
      customerId: string;
      sellerId: string;
      businessUnit: string;
      description: string;
      /** May–October each year; the current season is cut at the as-of date. */
      seasons: PeriodSales[];
    }
  | {
      kind: "missed-promotion-window";
      customerId: string;
      sellerId: string;
      businessUnit: string;
      description: string;
      /** The three weeks before Mother's Day each year. */
      windows: PeriodSales[];
    }
  | {
      kind: "reduced-purchases";
      customerId: string;
      sellerId: string;
      businessUnit: string;
      description: string;
      previous: PeriodSales;
      current: PeriodSales;
      changePercent: number;
    }
  | {
      kind: "split-invoice";
      customerId: string;
      sellerId: string;
      businessUnit: string;
      description: string;
      billingDate: CalendarDate;
      invoiceNumbers: [string, string];
    }
  | {
      kind: "new-customer";
      customerId: string;
      sellerId: string;
      businessUnit: string;
      description: string;
      firstBillingDate: CalendarDate;
      invoices: number;
      salesCents: number;
    }
  | {
      kind: "corrected-invoice";
      invoiceNumber: string;
      customerId: string;
      businessUnit: string;
      description: string;
      billingDate: CalendarDate;
      originalDeliveryMonth: string;
      correctedDeliveryMonth: string;
      change: CorrectionKind;
      originalSalesCents: number;
      correctedSalesCents: number;
    };

/** Evaluation only: the application, MCP tools and agents must never read it. */
export interface AnswerKey {
  purpose: string;
  seed: number;
  asOf: CalendarDate;
  scenarios: Scenario[];
}

export interface SyntheticFeed {
  seed: number;
  /** Closed months in order, January 2023 – August 2026. */
  deliveries: GeneratedDelivery[];
  /** 1–25 September 2026, for sending live in a demo. */
  pendingDelivery: GeneratedDelivery;
  summary: GenerationSummary;
  answerKey: AnswerKey;
}

type CorrectionKind = "package quantity" | "line removed" | "payment schedule";
const CORRECTION_KINDS: readonly CorrectionKind[] = ["package quantity", "line removed", "payment schedule"];

interface Order {
  customer: SyntheticCustomer;
  day: number;
  weight: number;
}

interface DraftLine {
  product: Product;
  unitPriceCents: number;
  packageQuantity: number;
}

interface DraftInvoice {
  orderId: number;
  part: number;
  customer: SyntheticCustomer;
  day: number;
  paymentSchedule: PaymentSchedule;
  lines: DraftLine[];
  invoiceNumber: string;
  /** Planted scenarios and corrected invoices keep their drawn quantities during calibration. */
  locked: boolean;
}

interface Correction {
  original: DraftInvoice;
  corrected: DraftInvoice;
  deliveryMonth: string;
  kind: CorrectionKind;
}

interface ScenarioCustomers {
  missedSeason: SyntheticCustomer;
  missedWindow: SyntheticCustomer;
  reduced: SyntheticCustomer[];
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Code-unit order; unlike `localeCompare`, independent of the machine's locale data. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function percent(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function firstDayOfYear(year: number): number {
  return dayNumber(`${year}-01-01`);
}

function lastDayOfYear(year: number): number {
  return dayNumber(`${year}-12-31`);
}

function promotionWindow(event: number): [number, number] {
  return [event - PROMOTION_LEAD_DAYS, event - 1];
}

function seasonalWeights(unit: BusinessUnit): (day: number) => number {
  const cache = new Map<number, number>();
  return (day) => {
    let weight = cache.get(day);
    if (weight === undefined) {
      if (unit === "AGRO") {
        weight = AGRO_MONTH_WEIGHTS[Number(calendarDate(day).slice(5, 7)) - 1]!;
      } else {
        const year = yearOf(day);
        const inWindow = [mothersDay(year), blackFriday(year), christmas(year)].some((event) => {
          const [from, to] = promotionWindow(event);
          return day >= from && day <= to;
        });
        weight = HOME_GARDEN_BASE_WEIGHT + (inWindow ? HOME_GARDEN_PROMOTION_WEIGHT : 0);
      }
      cache.set(day, weight);
    }
    return weight;
  };
}

/** Order days follow the unit's seasonality; a customer never gets two orders on one day. */
function planOrders(customers: readonly SyntheticCustomer[], random: Random): Order[] {
  const orders: Order[] = [];
  for (const unit of UNITS) {
    const weightOf = seasonalWeights(unit);
    for (const year of YEARS) {
      const fullYear = billingDaysBetween(firstDayOfYear(year), lastDayOfYear(year));
      const fullYearWeight = sum(fullYear.map(weightOf));
      const inPeriod = fullYear.filter((day) => day >= PERIOD_START && day <= PERIOD_END);
      for (const customer of customers) {
        if (customer.businessUnit !== unit) continue;
        const days = inPeriod.filter((day) => day >= customer.firstDay);
        if (days.length === 0) continue;
        const [min, max] = TIERS[customer.tier].ordersPerYear;
        const expected = (random.int(min, max) * sum(days.map(weightOf))) / fullYearWeight;
        const whole = Math.floor(expected);
        const count = Math.min(days.length, whole + (random.chance(expected - whole) ? 1 : 0));
        const chosen = new Set<number>();
        for (let attempt = 0; chosen.size < count && attempt < count * 20; attempt += 1) {
          chosen.add(random.weighted(days, weightOf));
        }
        for (const day of [...chosen].sort((a, b) => a - b)) {
          orders.push({ customer, day, weight: customer.weight * random.between(0.6, 1.4) });
        }
      }
    }
  }
  // Every customer appears in the data at least once.
  const buying = new Set(orders.map((order) => order.customer.id));
  for (const customer of customers) {
    if (buying.has(customer.id)) continue;
    const days = billingDaysBetween(customer.firstDay, PERIOD_END);
    orders.push({ customer, day: random.weighted(days, seasonalWeights(customer.businessUnit)), weight: customer.weight });
  }
  return orders;
}

function chooseScenarioCustomers(customers: readonly SyntheticCustomer[], random: Random): ScenarioCustomers {
  const established = customers.filter((customer) => customer.firstDay === PERIOD_START);
  const pick = (unit: BusinessUnit, tier: SyntheticCustomer["tier"], exclude: readonly SyntheticCustomer[] = []) =>
    random.pick(
      established.filter(
        (customer) => customer.businessUnit === unit && customer.tier === tier && !exclude.includes(customer),
      ),
    );
  const missedSeason = pick("AGRO", "medium");
  const missedWindow = pick("HOME_GARDEN", "large");
  const reducedAgro = pick("AGRO", "large");
  const reducedHomeGarden = pick("HOME_GARDEN", "large", [missedWindow]);
  return { missedSeason, missedWindow, reduced: [reducedAgro, reducedHomeGarden] };
}

function agroSeason(year: number): [number, number] {
  return [dayNumber(`${year}-05-01`), Math.min(dayNumber(`${year}-10-31`), PERIOD_END)];
}

/**
 * Guarantees the history a scenario needs, then removes the planted 2026 purchases. Reduced
 * accounts keep their 2026 orders at a smaller weight so the unit-year split anticipates the
 * reduction; `draftInvoices` sets their actual amounts.
 */
function plantScenarios(orders: Order[], plan: ScenarioCustomers, random: Random): Order[] {
  const ensureOrderBetween = (customer: SyntheticCustomer, from: number, to: number) => {
    if (orders.some((order) => order.customer === customer && order.day >= from && order.day <= to)) return;
    orders.push({ customer, day: random.pick(billingDaysBetween(from, to)), weight: customer.weight });
  };
  for (const year of [2023, 2024, 2025]) {
    ensureOrderBetween(plan.missedSeason, dayNumber(`${year}-06-01`), dayNumber(`${year}-08-31`));
    ensureOrderBetween(plan.missedWindow, ...promotionWindow(mothersDay(year)));
  }
  for (const customer of plan.reduced) {
    ensureOrderBetween(customer, ...PREVIOUS_PERIOD);
    ensureOrderBetween(customer, ...CURRENT_PERIOD);
  }
  const [seasonStart] = agroSeason(2026);
  const [windowStart, windowEnd] = promotionWindow(mothersDay(2026));
  const reduced = new Set(plan.reduced);
  return orders
    .filter(
      (order) =>
        !(order.customer === plan.missedSeason && order.day >= seasonStart) &&
        !(order.customer === plan.missedWindow && order.day >= windowStart && order.day <= windowEnd),
    )
    .map((order) =>
      reduced.has(order.customer) && yearOf(order.day) === 2026
        ? { ...order, weight: order.weight * REDUCED_PURCHASE_FACTOR }
        : order,
    );
}

/** Splits each unit-year target across its orders in proportion to their weights. */
function orderTargets(orders: readonly Order[]): number[] {
  const totals = new Map<string, number>();
  const key = (order: Order) => `${order.customer.businessUnit}/${yearOf(order.day)}`;
  for (const order of orders) totals.set(key(order), (totals.get(key(order)) ?? 0) + order.weight);
  return orders.map(
    (order) => (unitTargetCents(yearOf(order.day), order.customer.businessUnit) * order.weight) / totals.get(key(order))!,
  );
}

function drawLines(order: Order, targetCents: number, random: Random): DraftLine[] {
  const year = yearOf(order.day);
  const catalogue = PRODUCTS.filter((product) => product.businessUnit === order.customer.businessUnit);
  const [min, max] = TIERS[order.customer.tier].linesPerInvoice;
  const count = Math.min(random.int(min, max), catalogue.length);
  const perLine = targetCents / count;
  const available = [...catalogue];
  const chosen: Product[] = [];
  while (chosen.length < count) {
    // Products priced above the line's budget are rarely picked.
    const product = random.weighted(
      available,
      (candidate) => candidate.popularity * (priceCents(candidate, year) <= perLine ? 1 : 0.02),
    );
    chosen.push(product);
    available.splice(available.indexOf(product), 1);
  }
  if (count >= 2 && random.chance(REPEATED_PRODUCT_CHANCE)) chosen[count - 1] = chosen[0]!;
  const shares = chosen.map(() => random.between(0.5, 1.5));
  const shareTotal = sum(shares);
  return chosen.map((product, index) => {
    const unitPriceCents = priceCents(product, year);
    const lineTarget = (targetCents * shares[index]!) / shareTotal;
    return { product, unitPriceCents, packageQuantity: Math.max(1, Math.round(lineTarget / unitPriceCents)) };
  });
}

const inPeriod = (day: number, [from, to]: readonly [number, number]) => day >= from && day <= to;

/**
 * Draws every order's lines against its share of the unit-year target, except the reduced
 * accounts' 2026 orders: those are drawn afterwards against `REDUCED_PURCHASE_FACTOR` × the
 * account's drawn sales in the equivalent 2025 period. Planted invoices are locked, so later
 * steps (splits, corrections, calibration) never change these amounts.
 */
function draftInvoices(
  orders: readonly Order[],
  plan: ScenarioCustomers,
  random: Random,
): DraftInvoice[] {
  const targets = orderTargets(orders);
  const planted = new Set([plan.missedSeason, plan.missedWindow, ...plan.reduced]);
  const reduced = new Set(plan.reduced);
  const deferred = (order: Order) => reduced.has(order.customer) && inPeriod(order.day, CURRENT_PERIOD);
  const invoices = orders.map((order, orderId): DraftInvoice => ({
    orderId,
    part: 1,
    customer: order.customer,
    day: order.day,
    paymentSchedule: random.chance(PREFERRED_SCHEDULE_SHARE) ? order.customer.preferredSchedule : random.pick(SCHEDULES),
    lines: deferred(order) ? [] : drawLines(order, targets[orderId]!, random),
    invoiceNumber: "",
    locked: planted.has(order.customer),
  }));
  for (const customer of plan.reduced) {
    const own = invoices.filter((invoice) => invoice.customer === customer);
    const previous = sum(own.filter((invoice) => inPeriod(invoice.day, PREVIOUS_PERIOD)).map(invoiceSales));
    const current = own.filter((invoice) => inPeriod(invoice.day, CURRENT_PERIOD));
    const target = previous * REDUCED_PURCHASE_FACTOR;
    const weights = current.map((invoice) => orders[invoice.orderId]!.weight);
    current.forEach((invoice, index) => {
      invoice.lines = drawLines(orders[invoice.orderId]!, (target * weights[index]!) / sum(weights), random);
    });
    const gap = nudgeQuantities(
      current.flatMap((invoice) => invoice.lines),
      target - sum(current.map(invoiceSales)),
      target * CALIBRATION_TOLERANCE,
    );
    if (Math.abs(gap) > target * REDUCED_PURCHASE_TOLERANCE) {
      throw new Error(`Reduced purchases for ${customer.id} missed ${REDUCED_PURCHASE_FACTOR * 100}% of the previous period`);
    }
  }
  return invoices;
}

/** One order billed as two invoices on the same day. */
function plantSplitInvoices(invoices: DraftInvoice[], random: Random): [DraftInvoice, DraftInvoice][] {
  const candidates = random.shuffle(
    invoices.filter(
      (invoice) =>
        !invoice.locked &&
        invoice.customer.tier === "large" &&
        invoice.day >= dayNumber("2025-01-01") &&
        invoice.lines.length >= 3,
    ),
  );
  const pairs: [DraftInvoice, DraftInvoice][] = [];
  const used = new Set<string>();
  for (const invoice of candidates) {
    if (pairs.length === 2) break;
    if (used.has(invoice.customer.id)) continue;
    used.add(invoice.customer.id);
    const cut = Math.ceil(invoice.lines.length / 2);
    const second: DraftInvoice = { ...invoice, part: 2, lines: invoice.lines.slice(cut), locked: true };
    invoice.lines = invoice.lines.slice(0, cut);
    invoice.locked = true;
    invoices.push(second);
    pairs.push([invoice, second]);
  }
  return pairs;
}

/** Invoice numbers are sequential in billing order across both units, with leading zeroes. */
function numberInvoices(invoices: DraftInvoice[]): void {
  invoices.sort(
    (a, b) =>
      a.day - b.day ||
      UNITS.indexOf(a.customer.businessUnit) - UNITS.indexOf(b.customer.businessUnit) ||
      compareText(a.customer.id, b.customer.id) ||
      a.orderId - b.orderId ||
      a.part - b.part,
  );
  invoices.forEach((invoice, index) => {
    invoice.invoiceNumber = String(index + 1).padStart(6, "0");
  });
}

function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year! * 12 + (monthNumber! - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function correct(invoice: DraftInvoice, kind: CorrectionKind, random: Random): DraftInvoice {
  const corrected: DraftInvoice = { ...invoice, lines: invoice.lines.map((line) => ({ ...line })) };
  if (kind === "line removed") {
    corrected.lines.pop();
  } else if (kind === "payment schedule") {
    corrected.paymentSchedule = random.pick(SCHEDULES.filter((schedule) => schedule !== invoice.paymentSchedule));
  } else {
    const line = random.pick(corrected.lines);
    const quantity = line.packageQuantity;
    line.packageQuantity = quantity > 1 ? quantity - random.int(1, Math.ceil(quantity * 0.3)) : 2;
  }
  return corrected;
}

/** A few invoices are resent with a correction in a later delivery; one is in the pending delivery. */
function plantCorrections(invoices: DraftInvoice[], random: Random): Correction[] {
  const eligible = (invoice: DraftInvoice) => !invoice.locked && invoice.lines.length >= 2;
  const earliest = addMonths(FIRST_BILLING_DATE.slice(0, 7), 1);
  const latestClosed = addMonths(PENDING_MONTH, -3);
  const lastClosed = addMonths(PENDING_MONTH, -1);
  const closed = random.shuffle(
    invoices.filter((invoice) => {
      const month = monthOf(invoice.day);
      return eligible(invoice) && month >= earliest && month <= latestClosed;
    }),
  );
  const chosen: { invoice: DraftInvoice; deliveryMonth: string }[] = [];
  const months = new Set<string>();
  for (const invoice of closed) {
    if (chosen.length === CORRECTIONS_IN_CLOSED_MONTHS) break;
    const month = monthOf(invoice.day);
    if (months.has(month)) continue;
    months.add(month);
    chosen.push({ invoice, deliveryMonth: addMonths(month, random.int(1, 2)) });
  }
  const pending = random.shuffle(invoices.filter((invoice) => eligible(invoice) && monthOf(invoice.day) === lastClosed));
  for (const invoice of pending.slice(0, CORRECTIONS_IN_PENDING_DELIVERY)) {
    chosen.push({ invoice, deliveryMonth: PENDING_MONTH });
  }
  return chosen.map(({ invoice, deliveryMonth }, index) => {
    const kind = CORRECTION_KINDS[index % CORRECTION_KINDS.length]!;
    invoice.locked = true;
    return { original: invoice, corrected: { ...correct(invoice, kind, random), locked: true }, deliveryMonth, kind };
  });
}

function invoiceSales(invoice: DraftInvoice): number {
  return sum(invoice.lines.map((line) => line.packageQuantity * line.unitPriceCents));
}

/**
 * Changes package quantities (by at most 20% of a line per pass, never below one package) to
 * close `gap` cents to within `tolerance`. Returns the gap left.
 */
function nudgeQuantities(lines: readonly DraftLine[], gap: number, tolerance: number): number {
  for (let pass = 0; pass < 10 && Math.abs(gap) > tolerance; pass += 1) {
    for (const line of lines) {
      if (Math.abs(gap) <= tolerance) break;
      const cap = Math.max(1, Math.floor(line.packageQuantity * 0.2));
      const steps = Math.min(cap, Math.floor(Math.abs(gap) / line.unitPriceCents));
      const change = gap > 0 ? steps : -Math.min(steps, line.packageQuantity - 1);
      line.packageQuantity += change;
      gap -= change * line.unitPriceCents;
    }
  }
  return gap;
}

/**
 * Nudges package quantities on ordinary invoices until each unit-year total (after corrections)
 * is within `CALIBRATION_TOLERANCE` of its target. Scenario, split and corrected invoices keep
 * their quantities.
 */
function calibrate(invoices: readonly DraftInvoice[], corrections: readonly Correction[], random: Random): void {
  const finalVersion = new Map(invoices.map((invoice) => [invoice.invoiceNumber, invoice]));
  for (const { corrected } of corrections) finalVersion.set(corrected.invoiceNumber, corrected);
  for (const unit of UNITS) {
    for (const year of YEARS) {
      const target = unitTargetCents(year, unit);
      const unitYear = [...finalVersion.values()].filter(
        (invoice) => invoice.customer.businessUnit === unit && yearOf(invoice.day) === year,
      );
      const lines = random.shuffle(unitYear.filter((invoice) => !invoice.locked).flatMap((invoice) => invoice.lines));
      const gap = nudgeQuantities(lines, target - sum(unitYear.map(invoiceSales)), target * CALIBRATION_TOLERANCE);
      if (Math.abs(gap) > target * TARGET_TOLERANCE) {
        throw new Error(`Calibration left ${unit} ${year} more than ${TARGET_TOLERANCE * 100}% from its target`);
      }
    }
  }
}

function toFeedInvoice(invoice: DraftInvoice): FeedInvoice {
  const { customer } = invoice;
  return {
    invoiceNumber: invoice.invoiceNumber,
    billingDate: calendarDate(invoice.day),
    customer: { id: customer.id, name: customer.name, segment: customer.segment, city: customer.city, state: customer.state },
    sellerId: customer.sellerId,
    businessUnit: customer.businessUnit,
    paymentSchedule: invoice.paymentSchedule,
    lines: invoice.lines.map(({ product, unitPriceCents, packageQuantity }) => {
      const lineAmountCents = packageQuantity * unitPriceCents;
      return {
        productId: product.productId,
        productName: product.productName,
        productCategory: product.productCategory,
        packageQuantity,
        unitPriceCents,
        lineAmountCents,
        commissionAmountCents: commissionCents(lineAmountCents),
      };
    }),
  };
}

function buildDeliveries(
  invoices: readonly DraftInvoice[],
  corrections: readonly Correction[],
  random: Random,
): GeneratedDelivery[] {
  const byMonth = new Map<string, DraftInvoice[]>();
  const add = (month: string, invoice: DraftInvoice) => byMonth.set(month, [...(byMonth.get(month) ?? []), invoice]);
  for (const invoice of invoices) add(monthOf(invoice.day), invoice);
  for (const { corrected, deliveryMonth } of corrections) add(deliveryMonth, corrected);
  const deliveries: GeneratedDelivery[] = [];
  for (let month = FIRST_BILLING_DATE.slice(0, 7); month <= PENDING_MONTH; month = addMonths(month, 1)) {
    const monthInvoices = [...(byMonth.get(month) ?? [])].sort((a, b) => compareText(a.invoiceNumber, b.invoiceNumber));
    deliveries.push({
      month,
      payload: toDeliveryPayload({ deliveryId: random.uuid(), invoices: monthInvoices.map(toFeedInvoice) }),
    });
  }
  return deliveries;
}

/** Applies deliveries in order with the feed's record rule: add or replace whole invoices, never delete. */
export function replayDeliveries(deliveries: readonly GeneratedDelivery[]): Map<string, InvoicePayload> {
  const stored = new Map<string, InvoicePayload>();
  for (const { payload } of deliveries) for (const invoice of payload.invoices) stored.set(invoice.invoiceNumber, invoice);
  return stored;
}

function payloadSales(invoice: InvoicePayload): number {
  return sum(invoice.lines.map((line) => line.lineAmountCents));
}

function summarize(seed: number, deliveries: readonly GeneratedDelivery[]): GenerationSummary {
  const stored = [...replayDeliveries(deliveries).values()];
  const byUnitAndYear: UnitYearTotal[] = [];
  const byYear: YearTotal[] = [];
  for (const year of YEARS) {
    const inYear = stored.filter((invoice) => Number(invoice.billingDate.slice(0, 4)) === year);
    const unitTotals = UNITS.map((unit) => {
      const actualCents = sum(
        inYear.filter((invoice) => invoice.businessUnit === BUSINESS_UNIT_LABELS[unit]).map(payloadSales),
      );
      const targetCents = unitTargetCents(year, unit);
      return {
        year,
        businessUnit: BUSINESS_UNIT_LABELS[unit],
        targetCents,
        actualCents,
        deviationPercent: percent(actualCents - targetCents, targetCents),
      };
    });
    byUnitAndYear.push(...unitTotals);
    const actualCents = sum(unitTotals.map((total) => total.actualCents));
    const targetCents = ANNUAL_TARGET_CENTS.get(year)!;
    byYear.push({
      year,
      targetCents,
      actualCents,
      deviationPercent: percent(actualCents - targetCents, targetCents),
      agroSharePercent: percent(unitTotals[0]!.actualCents, actualCents),
    });
  }

  const customerSales = new Map<string, number>();
  for (const invoice of stored) {
    customerSales.set(invoice.customer.id, (customerSales.get(invoice.customer.id) ?? 0) + payloadSales(invoice));
  }
  const ranked = [...customerSales.values()].sort((a, b) => b - a);
  const top = ranked.slice(0, Math.ceil(ranked.length / 10));

  const seen = new Set<string>();
  const figures = deliveries.map(({ month, payload }) => {
    const resent = payload.invoices.filter((invoice) => seen.has(invoice.invoiceNumber)).length;
    for (const invoice of payload.invoices) seen.add(invoice.invoiceNumber);
    return {
      month,
      deliveryId: payload.deliveryId,
      pending: month === PENDING_MONTH,
      invoices: payload.invoices.length,
      resentInvoices: resent,
      lines: sum(payload.invoices.map((invoice) => invoice.lines.length)),
      salesCents: sum(payload.invoices.map(payloadSales)),
    };
  });

  return {
    seed,
    firstBillingDate: FIRST_BILLING_DATE,
    lastBillingDate: LAST_BILLING_DATE,
    closedMonthDeliveries: deliveries.length - 1,
    pendingDeliveryMonth: PENDING_MONTH,
    invoices: stored.length,
    lines: sum(stored.map((invoice) => invoice.lines.length)),
    customers: customerSales.size,
    products: new Set(stored.flatMap((invoice) => invoice.lines.map((line) => line.productId))).size,
    byUnitAndYear,
    byYear,
    topTenPercentCustomersSharePercent: percent(sum(top), sum(ranked)),
    deliveries: figures,
  };
}

function salesBetween(stored: readonly InvoicePayload[], customerId: string, from: number, to: number): PeriodSales {
  const fromDate = calendarDate(from);
  const toDate = calendarDate(to);
  return {
    from: fromDate,
    to: toDate,
    salesCents: sum(
      stored
        .filter(
          (invoice) =>
            invoice.customer.id === customerId && invoice.billingDate >= fromDate && invoice.billingDate <= toDate,
        )
        .map(payloadSales),
    ),
  };
}

function buildAnswerKey(
  seed: number,
  deliveries: readonly GeneratedDelivery[],
  customers: readonly SyntheticCustomer[],
  plan: ScenarioCustomers,
  splits: readonly [DraftInvoice, DraftInvoice][],
  corrections: readonly Correction[],
): AnswerKey {
  const stored = [...replayDeliveries(deliveries).values()];
  const who = (customer: SyntheticCustomer) => ({
    customerId: customer.id,
    sellerId: customer.sellerId,
    businessUnit: BUSINESS_UNIT_LABELS[customer.businessUnit],
  });
  const scenarios: Scenario[] = [];

  scenarios.push({
    kind: "missed-season",
    ...who(plan.missedSeason),
    description:
      "Established Agro customer that bought in every May–October season from 2023 to 2025 and has bought nothing since 1 May 2026.",
    seasons: YEARS.map((year) => salesBetween(stored, plan.missedSeason.id, ...agroSeason(year))),
  });
  scenarios.push({
    kind: "missed-promotion-window",
    ...who(plan.missedWindow),
    description:
      "Established Home & Garden retail chain that bought in the three weeks before Mother's Day from 2023 to 2025 and not before Mother's Day 2026.",
    windows: YEARS.map((year) => salesBetween(stored, plan.missedWindow.id, ...promotionWindow(mothersDay(year)))),
  });
  for (const customer of plan.reduced) {
    const previous = salesBetween(stored, customer.id, ...PREVIOUS_PERIOD);
    const current = salesBetween(stored, customer.id, ...CURRENT_PERIOD);
    const changePercent = percent(current.salesCents - previous.salesCents, previous.salesCents);
    scenarios.push({
      kind: "reduced-purchases",
      ...who(customer),
      description: `Large account whose invoiced sales from ${current.from} to ${current.to} changed by ${changePercent.toFixed(2)}% against ${previous.from} to ${previous.to}.`,
      previous,
      current,
      changePercent,
    });
  }
  for (const [first, second] of splits) {
    scenarios.push({
      kind: "split-invoice",
      ...who(first.customer),
      description: "One order billed as two invoices on the same day; count invoices, not orders.",
      billingDate: calendarDate(first.day),
      invoiceNumbers: [first.invoiceNumber, second.invoiceNumber],
    });
  }
  for (const customer of customers) {
    const own = stored.filter((invoice) => invoice.customer.id === customer.id);
    const firstBillingDate = own.map((invoice) => invoice.billingDate).sort()[0];
    if (firstBillingDate === undefined || firstBillingDate < "2026-01-01") continue;
    scenarios.push({
      kind: "new-customer",
      ...who(customer),
      description: "First purchase in 2026: too little history for year-over-year comparison.",
      firstBillingDate,
      invoices: own.length,
      salesCents: sum(own.map(payloadSales)),
    });
  }
  for (const { original, corrected, deliveryMonth, kind } of corrections) {
    scenarios.push({
      kind: "corrected-invoice",
      invoiceNumber: original.invoiceNumber,
      customerId: original.customer.id,
      businessUnit: BUSINESS_UNIT_LABELS[original.customer.businessUnit],
      description: `Resent in a later delivery with a corrected ${kind === "line removed" ? "set of lines" : kind}; the resent version replaces the stored one.`,
      billingDate: calendarDate(original.day),
      originalDeliveryMonth: monthOf(original.day),
      correctedDeliveryMonth: deliveryMonth,
      change: kind,
      originalSalesCents: invoiceSales(original),
      correctedSalesCents: invoiceSales(corrected),
    });
  }

  return {
    purpose:
      "Evaluation answer key for planted synthetic scenarios. Not operational data: the application, MCP tools and agents must not read it.",
    seed,
    asOf: LAST_BILLING_DATE,
    scenarios,
  };
}

export function generateSyntheticFeed({ seed }: { seed: number }): SyntheticFeed {
  const random = new Random(seed);
  const customers = createCustomers(random.fork("customers"));
  const plan = chooseScenarioCustomers(customers, random.fork("scenarios"));
  const orders = plantScenarios(planOrders(customers, random.fork("orders")), plan, random.fork("scenario-orders"));
  const invoices = draftInvoices(orders, plan, random.fork("lines"));
  const splits = plantSplitInvoices(invoices, random.fork("splits"));
  numberInvoices(invoices);
  const corrections = plantCorrections(invoices, random.fork("corrections"));
  calibrate(invoices, corrections, random.fork("calibration"));

  const all = buildDeliveries(invoices, corrections, random.fork("delivery-ids"));
  const deliveries = all.filter((delivery) => delivery.month !== PENDING_MONTH);
  const pendingDelivery = all.find((delivery) => delivery.month === PENDING_MONTH)!;
  return {
    seed,
    deliveries,
    pendingDelivery,
    summary: summarize(seed, all),
    answerKey: buildAnswerKey(seed, all, customers, plan, splits, corrections),
  };
}
