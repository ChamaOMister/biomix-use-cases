/**
 * Source headers are kept exactly as the ERP spells them (including misspellings) and mapped
 * explicitly to internal field names. See docs/data-contract.md.
 */
export const SOURCE_COLUMNS = [
  { header: "Billing Date", field: "billingDate" },
  { header: "Billing Day", field: "billingDay" },
  { header: "Billing Month", field: "billingMonth" },
  { header: "Billing Year", field: "billingYear" },
  { header: "Invoince Number", field: "invoiceNumber" },
  { header: "Customer Business Name", field: "customerName" },
  { header: "Customer State", field: "customerState" },
  { header: "City", field: "customerCity" },
  { header: "Produtc Line", field: "productCategory" },
  { header: "Product Usage", field: "productUsage" },
  { header: "Product ID", field: "productId" },
  { header: "Product Name", field: "productName" },
  { header: "Type", field: "productType" },
  { header: "Seller", field: "sellerName" },
  { header: "Business Unity", field: "businessUnit" },
  { header: "Payment Schedule", field: "paymentSchedule" },
  { header: "Quantity", field: "packageQuantity" },
  { header: "Amount (R$)", field: "lineAmountCents" },
  { header: "Comission Fee", field: "commissionAmountCents" },
  { header: "Weight (kg)", field: "sourceWeight" },
  { header: "Amount per unity (R$)", field: "unitPriceCents" },
  { header: "Measurement Unity", field: "sourceMeasurementUnit" },
  { header: "TAX ID", field: "taxId" },
  { header: "Customer ID", field: "customerId" },
] as const;

export type SourceHeader = (typeof SOURCE_COLUMNS)[number]["header"];
export type SalesField = (typeof SOURCE_COLUMNS)[number]["field"];

export const HEADER_BY_FIELD = Object.fromEntries(
  SOURCE_COLUMNS.map(({ header, field }) => [field, header]),
) as Record<SalesField, SourceHeader>;

/** Header matching ignores case and surrounding/repeated whitespace, never spelling. */
export function normalizeHeader(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
