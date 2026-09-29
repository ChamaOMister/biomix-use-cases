import { handleDeliveryRequest } from "@/server/sales-feed/delivery-handler";

// JSON delivery of clean invoices; see src/server/sales-feed/delivery-handler.ts and
// docs/api/sales-feed.openapi.json for the contract, limits and responses.
export async function POST(request: Request): Promise<Response> {
  return handleDeliveryRequest(request);
}
