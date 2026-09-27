import { handleSalesImportUpload } from "@/server/sales-import-handler";

// Raw .xlsx request body; see src/server/sales-import-handler.ts for limits and response shape.
export async function POST(request: Request): Promise<Response> {
  return handleSalesImportUpload(request);
}
