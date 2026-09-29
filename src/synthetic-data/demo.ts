/**
 * A meaningful rejected delivery for the demo: the pending September delivery with two mistakes a
 * sender could plausibly make. The endpoint must reject it whole, with located errors, and store
 * nothing; the correct pending delivery is then applied.
 *
 * 1. The first Zona da Mata (S04) invoice whose customer has no other invoice in the delivery sends
 *    that customer with a city in Guaxupé's territory
 *    (S05): `CITY_OUTSIDE_TERRITORY`, since a seller never sells outside their own territory.
 * 2. The last invoice's first line has a unit price one cent higher, no longer matching its line
 *    amount: `LINE_AMOUNT_MISMATCH`.
 *
 * Deterministic: the same pending delivery gives the same file, with its own delivery ID.
 *
 * Reachable from Node scripts through built-in type stripping, so relative imports keep their
 * `.ts` extension and type-only imports use `import type`.
 */
import { createHash } from "node:crypto";
import type { DeliveryPayload } from "../domain/sales-feed/contract.ts";

export const DEMO_OUTSIDE_CITY = { city: "Guaxupé", state: "MG" } as const;

/** A version-4-shaped UUID derived from `text`, so the demo file is reproducible. */
function derivedUuid(text: string): string {
  const hex = createHash("sha256").update(text).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function rejectedDemoDelivery(pending: DeliveryPayload): DeliveryPayload {
  const delivery = structuredClone(pending);
  delivery.deliveryId = derivedUuid(`${pending.deliveryId}:demo-rejected`);
  // A customer with one invoice in the delivery, so moving it creates no attribute conflict too.
  const invoicesPerCustomer = new Map<string, number>();
  for (const invoice of delivery.invoices) {
    invoicesPerCustomer.set(invoice.customer.id, (invoicesPerCustomer.get(invoice.customer.id) ?? 0) + 1);
  }
  const moved = delivery.invoices.find((invoice) => invoice.sellerId === "S04" && invoicesPerCustomer.get(invoice.customer.id) === 1);
  const mispriced = delivery.invoices.at(-1);
  if (!moved || !mispriced || moved === mispriced) throw new Error("The pending delivery cannot carry both demo mistakes");
  moved.customer = { ...moved.customer, ...DEMO_OUTSIDE_CITY };
  mispriced.lines[0]!.unitPriceCents += 1;
  return delivery;
}
