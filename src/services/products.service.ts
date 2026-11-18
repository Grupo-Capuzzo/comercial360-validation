import { scopedRows } from "./crm-scope.client";
import type { ProductSummaryRow } from "@/types/database";
export async function loadProducts(scope = "geral"): Promise<{ data: ProductSummaryRow[]; error: string | null }> {
  const result = await scopedRows<ProductSummaryRow>(scope, "products");
  return { data: result.data, error: result.error?.message ?? null };
}
