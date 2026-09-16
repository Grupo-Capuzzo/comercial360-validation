import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { DashboardLoadResult } from "@/types/dashboard";

export async function loadDashboard(): Promise<DashboardLoadResult> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: {
        source: "configuration",
        message: "As variáveis públicas do Supabase não foram configuradas.",
        hint: "Crie .env.local a partir de .env.example e reinicie o servidor.",
      },
    };
  }

  const supabase = getSupabaseBrowserClient();

  const [executiveResult, productsResult] = await Promise.all([
    supabase
      .schema("api_comercial")
      .from("dashboard_executivo")
      .select("*")
      .single(),
    supabase
      .schema("api_comercial")
      .from("produtos_resumo")
      .select("*")
      .order("vinculos_total", { ascending: false }),
  ]);

  if (executiveResult.error) {
    return {
      ok: false,
      error: {
        source: "dashboard_executivo",
        code: executiveResult.error.code,
        message: executiveResult.error.message,
        hint: executiveResult.error.hint,
      },
    };
  }

  if (productsResult.error) {
    return {
      ok: false,
      error: {
        source: "produtos_resumo",
        code: productsResult.error.code,
        message: productsResult.error.message,
        hint: productsResult.error.hint,
      },
    };
  }

  return {
    ok: true,
    data: {
      executive: executiveResult.data,
      products: productsResult.data ?? [],
    },
  };
}


