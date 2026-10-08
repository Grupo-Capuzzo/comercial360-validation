import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Client360Row } from "@/types/database";

export type ClientsLoadResult =
  | {
      ok: true;
      data: Client360Row[];
    }
  | {
      ok: false;
      error: {
        message: string;
        code?: string;
        hint?: string | null;
      };
    };

export async function loadClients(): Promise<ClientsLoadResult> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: {
        message: "As variáveis públicas do Supabase não foram configuradas.",
      },
    };
  }

  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .schema("api_comercial")
    .from("cliente_360")
    .select("*")
    .order("nome_preferencial", { ascending: true });

  if (error) {
    return {
      ok: false,
      error: {
        message: error.message,
        code: error.code,
        hint: error.hint,
      },
    };
  }

  return {
    ok: true,
    data: data ?? [],
  };
}
