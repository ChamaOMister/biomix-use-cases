/**
 * Fictional customers. Each is owned by exactly one seller and sits in a city of that seller's
 * territory. Names combine generic nature and place words; they contain no personal names.
 */
import type { FeedCustomer } from "../domain/sales-feed/contract.ts";
import { SELLERS, type SellerReference } from "../domain/sales-feed/reference-data.ts";
import type { BusinessUnit, PaymentSchedule } from "../domain/sales-import/types.ts";
import { billingDaysBetween, dayNumber } from "./calendar.ts";
import {
  CUSTOMERS_PER_SELLER,
  FIRST_BILLING_DATE,
  HUB_CITIES,
  HUB_CITY_WEIGHT,
  NEW_CUSTOMER_SHARE,
  NEW_CUSTOMERS_FROM,
  NEW_CUSTOMERS_UNTIL,
  SEGMENT_WEIGHTS,
  TIERS,
  type Tier,
} from "./config.ts";
import type { Random } from "./random.ts";

export interface SyntheticCustomer extends FeedCustomer {
  sellerId: string;
  businessUnit: BusinessUnit;
  tier: Tier;
  /** Relative purchasing size. */
  weight: number;
  /** First day the customer may buy (day number). */
  firstDay: number;
  preferredSchedule: PaymentSchedule;
}

const NAME_WORDS = [
  "Aroeira", "Jatobá", "Ipê", "Jequitibá", "Buriti", "Pequi", "Sabiá", "Seriema", "Quaresmeira",
  "Manacá", "Cambará", "Angico", "Araçá", "Pitanga", "Gabiroba", "Juçara", "Canela", "Cedro",
  "Imbuia", "Guapuruvu", "Sibipiruna", "Tarumã", "Uvaia", "Jabuticaba", "Macaúba", "Bacupari",
  "Embaúba",
];
const PLACE_WORDS = [
  "do Vale", "da Serra", "do Campo", "do Rio", "da Mata", "das Águas", "do Sol", "da Colina",
  "do Horizonte", "da Várzea", "do Cerrado", "da Lagoa", "do Mirante", "da Estrada", "do Planalto",
  "das Pedras",
];

function customerName(segment: string, stem: string, random: Random): string {
  switch (segment) {
    case "farmer":
      return `Fazenda ${stem}`;
    case "agricultural reseller":
      return `Agropecuária ${stem} Ltda`;
    case "retail chain":
      return `Lojas ${stem}`;
    case "garden store":
      return random.chance(0.5) ? `Garden ${stem}` : `Floricultura ${stem}`;
    case "landscaping professional":
      return `${stem} Paisagismo`;
    default:
      throw new RangeError(`No name pattern for segment ${segment}`);
  }
}

function tierCounts(total: number, newCustomers: number): Tier[] {
  const large = Math.max(2, Math.round(total * TIERS.large.share));
  const medium = Math.round(total * TIERS.medium.share);
  const small = total - large - medium;
  if (small < newCustomers) throw new RangeError("Not enough small customers to start later");
  return [
    ...Array<Tier>(large).fill("large"),
    ...Array<Tier>(medium).fill("medium"),
    ...Array<Tier>(small).fill("small"),
  ];
}

function sellerCustomers(
  seller: SellerReference,
  random: Random,
  stems: string[],
  laterStartDays: readonly number[],
): Omit<SyntheticCustomer, "id">[] {
  const total = CUSTOMERS_PER_SELLER.get(seller.sellerId);
  if (total === undefined) throw new RangeError(`No customer count for ${seller.sellerId}`);
  const newCount = Math.round(total * NEW_CUSTOMER_SHARE);
  // Large and medium accounts are established; later starters come from the small tier.
  const tiers = tierCounts(total, newCount);
  const hubs = new Set(HUB_CITIES.get(seller.sellerId) ?? []);
  const periodStart = dayNumber(FIRST_BILLING_DATE);
  const in2026 = laterStartDays.filter((day) => day >= dayNumber("2026-01-01"));

  return tiers.map((tier, index) => {
    const profile = TIERS[tier];
    const segment = random.weighted(SEGMENT_WEIGHTS[seller.businessUnit][tier], ([, weight]) => weight)[0];
    const location = random.weighted(seller.cities, ({ city }) => (hubs.has(city) ? HUB_CITY_WEIGHT : 1));
    const stem = stems.pop();
    if (stem === undefined) throw new RangeError("Ran out of fictional customer names");
    const laterIndex = index - (total - newCount);
    // Every seller gets at least one customer who first buys in 2026.
    const firstDay =
      laterIndex < 0 ? periodStart : laterIndex === 0 ? random.pick(in2026) : random.pick(laterStartDays);
    return {
      name: customerName(segment, stem, random),
      segment,
      city: location.city,
      state: location.state,
      sellerId: seller.sellerId,
      businessUnit: seller.businessUnit,
      tier,
      weight: random.between(profile.weight[0], profile.weight[1]),
      firstDay,
      preferredSchedule: random.weighted(profile.preferredSchedules, ([, weight]) => weight)[0],
    };
  });
}

/**
 * Customer IDs follow arrival order: established customers first (in shuffled order), then later
 * starters by their first possible purchase day.
 */
export function createCustomers(random: Random): SyntheticCustomer[] {
  const stems = random.shuffle(NAME_WORDS.flatMap((word) => PLACE_WORDS.map((place) => `${word} ${place}`)));
  const laterStartDays = billingDaysBetween(dayNumber(NEW_CUSTOMERS_FROM), dayNumber(NEW_CUSTOMERS_UNTIL));
  const drafts = SELLERS.flatMap((seller) => sellerCustomers(seller, random, stems, laterStartDays));
  const ordered = random
    .shuffle(drafts)
    .map((draft, order) => ({ draft, order }))
    .sort((a, b) => a.draft.firstDay - b.draft.firstDay || a.order - b.order);
  return ordered.map(({ draft }, index) => ({ id: `C${String(index + 1).padStart(4, "0")}`, ...draft }));
}
