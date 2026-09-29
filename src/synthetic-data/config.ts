/**
 * Synthetic-data parameters. The period, revenue targets and 60/40 split are the maintainer's
 * (decision 002). Everything marked "tuning" is a generator default chosen to look plausible;
 * see `docs/synthetic-data.md`.
 */
import type { BusinessUnit, PaymentSchedule } from "../domain/sales-import/types.ts";

export const DEFAULT_SEED = 2026;

export const FIRST_BILLING_DATE = "2023-01-01";
/** Last generated billing date, and the as-of date of the dataset. */
export const LAST_BILLING_DATE = "2026-09-25";
/** Closed months are replayed as deliveries; this month is the pending next delivery. */
export const PENDING_MONTH = "2026-09";

/** Invoiced sales (sum of line amounts before commission), in cents. 2026 runs to 25 September. */
export const ANNUAL_TARGET_CENTS: ReadonlyMap<number, number> = new Map([
  [2023, 1_900_000_000],
  [2024, 2_200_000_000],
  [2025, 2_600_000_000],
  [2026, 2_100_000_000],
]);
export const AGRO_SHARE_PERCENT = 60;
/** Required closeness of every generated annual total to its target. */
export const TARGET_TOLERANCE = 0.01;
/** Tuning: calibration stops once a unit-year is this close to its target. */
export const CALIBRATION_TOLERANCE = 0.001;

export function unitTargetCents(year: number, unit: BusinessUnit): number {
  const total = ANNUAL_TARGET_CENTS.get(year);
  if (total === undefined) throw new RangeError(`No revenue target for ${year}`);
  const agro = (total * AGRO_SHARE_PERCENT) / 100;
  return unit === "AGRO" ? agro : total - agro;
}

export type Tier = "large" | "medium" | "small";

export interface TierProfile {
  /** Share of each seller's customers. */
  share: number;
  /** Relative purchasing size, drawn uniformly from this range. */
  weight: readonly [number, number];
  ordersPerYear: readonly [number, number];
  linesPerInvoice: readonly [number, number];
  preferredSchedules: readonly (readonly [PaymentSchedule, number])[];
}

/** Tuning: a few large accounts carry most of the revenue. */
export const TIERS: Readonly<Record<Tier, TierProfile>> = {
  large: {
    share: 0.07,
    weight: [10, 16],
    ordersPerYear: [14, 24],
    linesPerInvoice: [3, 6],
    preferredSchedules: [
      ["INSTALLMENTS_30_60_90", 6],
      ["INSTALLMENTS_0_30_60_90", 3],
      ["NET_30", 1],
    ],
  },
  medium: {
    share: 0.25,
    weight: [3, 5],
    ordersPerYear: [6, 12],
    linesPerInvoice: [2, 4],
    preferredSchedules: [
      ["NET_30", 5],
      ["INSTALLMENTS_30_60_90", 4],
      ["UPFRONT", 1],
    ],
  },
  small: {
    share: 0.68,
    weight: [0.7, 1.3],
    ordersPerYear: [2, 5],
    linesPerInvoice: [1, 3],
    preferredSchedules: [
      ["UPFRONT", 5],
      ["NET_30", 5],
    ],
  },
};

/** Tuning. */
export const CUSTOMERS_PER_SELLER: ReadonlyMap<string, number> = new Map([
  ["S01", 70],
  ["S02", 55],
  ["S03", 70],
  ["S04", 70],
  ["S05", 40],
]);
/** Tuning: share of customers whose first purchase comes after January 2023. */
export const NEW_CUSTOMER_SHARE = 0.15;
export const NEW_CUSTOMERS_FROM = "2023-07-01";
export const NEW_CUSTOMERS_UNTIL = "2026-08-31";
/** Tuning: an invoice uses the customer's usual payment schedule this often. */
export const PREFERRED_SCHEDULE_SHARE = 0.85;
/** Tuning: chance that an invoice repeats a product on a second line (allowed by the contract). */
export const REPEATED_PRODUCT_CHANCE = 0.02;

/**
 * Tuning (segment mix per business unit and account size). A generator weight, not a business
 * rule: the contract accepts any segment on either unit.
 */
export const SEGMENT_WEIGHTS: Readonly<Record<BusinessUnit, Readonly<Record<Tier, readonly (readonly [string, number])[]>>>> = {
  AGRO: {
    large: [
      ["agricultural reseller", 7],
      ["retail chain", 3],
    ],
    medium: [
      ["agricultural reseller", 5],
      ["farmer", 5],
    ],
    small: [
      ["farmer", 8],
      ["agricultural reseller", 2],
    ],
  },
  HOME_GARDEN: {
    large: [["retail chain", 1]],
    medium: [
      ["garden store", 6],
      ["retail chain", 2],
      ["landscaping professional", 2],
    ],
    small: [
      ["garden store", 5],
      ["landscaping professional", 5],
    ],
  },
};

/** Tuning: Agro buys roughly May–October, peaking June–August. Index 0 is January. */
export const AGRO_MONTH_WEIGHTS = [0.25, 0.25, 0.35, 0.5, 1.1, 1.9, 2.1, 1.9, 1.2, 1.0, 0.4, 0.25] as const;
/** Tuning: Home & Garden base demand, plus this much in the three weeks before each promotion. */
export const HOME_GARDEN_BASE_WEIGHT = 1;
export const HOME_GARDEN_PROMOTION_WEIGHT = 3;
export const PROMOTION_LEAD_DAYS = 21;

/** Tuning: customers are placed in these cities this many times more often than elsewhere. */
export const HUB_CITY_WEIGHT = 6;
export const HUB_CITIES: ReadonlyMap<string, readonly string[]> = new Map([
  ["S01", ["São Paulo", "Guarulhos", "Santo André", "São Bernardo do Campo", "Osasco", "Mogi das Cruzes"]],
  ["S02", ["São José dos Campos", "Campinas", "Holambra", "Jacareí", "Indaiatuba"]],
  ["S03", ["Santa Maria de Jetibá", "Venda Nova do Imigrante", "Domingos Martins", "Linhares", "Colatina", "Nova Friburgo", "Teresópolis"]],
  ["S04", ["Juiz de Fora", "Viçosa", "Muriaé", "Ubá", "Manhuaçu", "Ponte Nova", "Cataguases"]],
  ["S05", ["Guaxupé", "Muzambinho", "Guaranésia"]],
]);

/** Tuning: yearly list-price adjustment applied to the catalogue's base prices. */
export const PRICE_FACTORS: ReadonlyMap<number, number> = new Map([
  [2023, 1],
  [2024, 1.045],
  [2025, 1.09],
  [2026, 1.13],
]);

/** Tuning: invoices resent with a correction in a later closed month, plus one in the pending delivery. */
export const CORRECTIONS_IN_CLOSED_MONTHS = 6;
export const CORRECTIONS_IN_PENDING_DELIVERY = 1;
/**
 * Tuning: planted reduced-purchases customers buy this fraction of their sales in the equivalent
 * 2025 period (1 January – 25 September) in 2026.
 */
export const REDUCED_PURCHASE_FACTOR = 0.4;
/** Tuning: the generator fails if a reduced account's realized 2026/2025 ratio is further than this from the factor. */
export const REDUCED_PURCHASE_TOLERANCE = 0.02;
