/**
 * Fictional product catalogue. Names are generic descriptions, not brands. Base prices are
 * 2023 package prices in cents; later years apply `PRICE_FACTORS`.
 */
import type { BusinessUnit } from "../domain/sales-import/types.ts";
import { PRICE_FACTORS } from "./config.ts";

export interface Product {
  productId: string;
  productName: string;
  productCategory: string;
  businessUnit: BusinessUnit;
  basePriceCents: number;
  /** Relative popularity when an order picks its products. */
  popularity: number;
}

function agro(productId: string, productName: string, productCategory: string, basePriceCents: number, popularity: number): Product {
  return { productId, productName, productCategory, businessUnit: "AGRO", basePriceCents, popularity };
}

function homeGarden(productId: string, productName: string, productCategory: string, basePriceCents: number, popularity: number): Product {
  return { productId, productName, productCategory, businessUnit: "HOME_GARDEN", basePriceCents, popularity };
}

export const PRODUCTS: readonly Product[] = [
  agro("P001", "Foliar Nutrient 1 L", "Foliar fertilizer", 8_990, 6),
  agro("P002", "Foliar Nutrient 5 L", "Foliar fertilizer", 39_900, 5),
  agro("P003", "Foliar Nutrient 20 L", "Foliar fertilizer", 149_000, 3),
  agro("P004", "Liquid Calcium-Boron 5 L", "Foliar fertilizer", 32_900, 4),
  agro("P005", "Organic Soil Conditioner 25 kg", "Soil conditioner", 11_900, 5),
  agro("P006", "Organic Soil Conditioner 1 t big bag", "Soil conditioner", 390_000, 2),
  agro("P007", "Humic Acid Concentrate 20 L", "Soil conditioner", 119_000, 3),
  agro("P008", "Root Biostimulant 1 L", "Biostimulant", 14_900, 4),
  agro("P009", "Root Biostimulant 5 L", "Biostimulant", 69_000, 3),
  agro("P010", "Granulated Organomineral 50 kg", "Organomineral fertilizer", 18_900, 5),
  agro("P011", "Granulated Organomineral 1 t big bag", "Organomineral fertilizer", 345_000, 2),
  agro("P012", "Seed Coating Inoculant 1 L", "Seed treatment", 9_900, 3),
  homeGarden("P101", "Garden Plant Food 500 g", "Garden fertilizer", 2_490, 6),
  homeGarden("P102", "Garden Plant Food 2 kg", "Garden fertilizer", 7_990, 4),
  homeGarden("P103", "Liquid Plant Food 1 L", "Garden fertilizer", 3_690, 5),
  homeGarden("P104", "Orchid Food Spray 500 ml", "Garden fertilizer", 1_990, 4),
  homeGarden("P105", "Vegetable Garden Fertilizer 1 kg", "Garden fertilizer", 3_290, 3),
  homeGarden("P106", "Lawn Fertilizer 10 kg", "Lawn care", 11_900, 2),
  homeGarden("P107", "Potting Soil 20 kg", "Substrate", 2_990, 6),
  homeGarden("P108", "Potting Soil 50 L", "Substrate", 3_990, 4),
  homeGarden("P109", "Succulent and Cactus Substrate 5 kg", "Substrate", 1_890, 3),
  homeGarden("P110", "Organic Compost 25 kg", "Compost", 4_990, 4),
  homeGarden("P111", "Earthworm Humus 10 kg", "Compost", 3_490, 4),
  homeGarden("P112", "Pine Bark Mulch 50 L", "Mulch", 4_490, 2),
];

/** Package price for a year, rounded to 10 cents. */
export function priceCents(product: Product, year: number): number {
  const factor = PRICE_FACTORS.get(year);
  if (factor === undefined) throw new RangeError(`No price factor for ${year}`);
  return Math.round((product.basePriceCents * factor) / 10) * 10;
}
