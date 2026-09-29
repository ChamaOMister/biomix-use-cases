/** Tiny fictional deliveries for ingestion tests. Cities come from the sellers' real territory lists. */
import { randomUUID } from "node:crypto";
import { commissionCents, type DeliveryPayload, type FeedLine, type InvoicePayload } from "@/domain/sales-feed/contract";

export function line(productId: string, packageQuantity: number, unitPriceCents: number, name = `Fictional ${productId}`): FeedLine {
  const lineAmountCents = packageQuantity * unitPriceCents;
  return {
    productId,
    productName: name,
    productCategory: "Fictional category",
    packageQuantity,
    unitPriceCents,
    lineAmountCents,
    commissionAmountCents: commissionCents(lineAmountCents),
  };
}

/** A customer of S04 (Agro, Zona da Mata Mineira) unless overridden. */
export function invoice(invoiceNumber: string, overrides: Partial<InvoicePayload> = {}): InvoicePayload {
  return {
    invoiceNumber,
    billingDate: "2025-06-12",
    customer: { id: "C0001", name: "Fictional Agro Ltda", segment: "farmer", city: "Viçosa", state: "MG" },
    sellerId: "S04",
    businessUnit: "Agro",
    paymentSchedule: "30 Days",
    lines: [line("PA1", 10, 1250)],
    ...overrides,
  };
}

/** A customer of S01 (Home & Garden, Grande São Paulo) unless overridden. */
export function homeGardenInvoice(invoiceNumber: string, overrides: Partial<InvoicePayload> = {}): InvoicePayload {
  return invoice(invoiceNumber, {
    customer: { id: "C0100", name: "Fictional Garden Store", segment: "garden store", city: "Osasco", state: "SP" },
    sellerId: "S01",
    businessUnit: "Home & Garden",
    paymentSchedule: "Upfront",
    lines: [line("PH1", 4, 2490)],
    ...overrides,
  });
}

export function delivery(invoices: InvoicePayload[], deliveryId: string = randomUUID()): DeliveryPayload {
  return { deliveryId, invoices };
}
