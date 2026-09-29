import { describe, expect, it } from "vitest";
import { peekDeliveryId, validateDelivery } from "@/domain/sales-feed/contract";
import { rejectedDemoDelivery } from "./demo";
import { DEFAULT_SEED, generateSyntheticFeed } from "./generate";

describe("demo rejected delivery", () => {
  const feed = generateSyntheticFeed({ seed: DEFAULT_SEED });
  const pending = feed.pendingDelivery.payload;
  // The customer owners stored after the 44 closed months, as the endpoint would read them.
  const owners = new Map<string, string>();
  for (const { payload } of feed.deliveries) for (const invoice of payload.invoices) owners.set(invoice.customer.id, invoice.sellerId);
  const validate = (input: unknown) => validateDelivery(input, { customerOwner: (id) => owners.get(id) });

  it("is rejected with exactly the two planted mistakes, located, while the real delivery is accepted", () => {
    expect(validate(pending).ok).toBe(true);
    const demo = rejectedDemoDelivery(pending);
    const result = validate(demo);
    if (result.ok) throw new Error("expected a rejection");
    const moved = demo.invoices.findIndex((invoice, index) => invoice.customer.city !== pending.invoices[index]!.customer.city);
    const last = demo.invoices.length - 1;
    expect(result.errors.map(({ code, path, invoiceNumber }) => ({ code, path, invoiceNumber }))).toEqual([
      { code: "LINE_AMOUNT_MISMATCH", path: `/invoices/${last}/lines/0/lineAmountCents`, invoiceNumber: demo.invoices[last]!.invoiceNumber },
      { code: "CITY_OUTSIDE_TERRITORY", path: `/invoices/${moved}/customer/city`, invoiceNumber: demo.invoices[moved]!.invoiceNumber },
    ]);
    expect(demo.invoices[moved]!.sellerId).toBe("S04");
  });

  it("has its own reproducible delivery ID and leaves the pending delivery unchanged", () => {
    const before = JSON.stringify(pending);
    const demo = rejectedDemoDelivery(pending);
    expect(JSON.stringify(pending)).toBe(before);
    expect(peekDeliveryId(demo)).toBe(demo.deliveryId);
    expect(demo.deliveryId).not.toBe(pending.deliveryId);
    expect(rejectedDemoDelivery(pending)).toEqual(demo);
  });
});
