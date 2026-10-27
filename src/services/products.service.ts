import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProductSummaryRow } from "@/types/database";

export async function loadProducts(): Promise<{
  data: ProductSummaryRow[];
  error: string | null;
}> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .schema("api_comercial")
    .from("produtos_resumo")
    .select("*")
    .order("vinculos_total", { ascending: false });

  if (error) {
    return {
      data: [],
      error: error.message,
    };
  }

  return {
    data: data ?? [],
    error: null,
  };
}
