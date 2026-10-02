import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  InvestmentCurrentBalanceRow,
  InvestmentPositionCurrentRow,
} from "@/types/database";

export type InvestmentsLoadResult =
  | {
      ok: true;
      data: {
        positions: InvestmentPositionCurrentRow[];
        balances: InvestmentCurrentBalanceRow[];
      };
    }
  | {
      ok: false;
      error: {
        source:
          | "investimentos_posicoes_atuais"
          | "investimentos_saldos_atuais";
        message: string;
        code?: string;
        hint?: string | null;
      };
    };

export async function loadInvestments(): Promise<InvestmentsLoadResult> {
  const supabase = getSupabaseBrowserClient();

  const [positionsResult, balancesResult] = await Promise.all([
    supabase
      .schema("api_comercial")
      .from("investimentos_posicoes_atuais")
      .select("*")
      .order("data_referencia", { ascending: false }),

    supabase
      .schema("api_comercial")
      .from("investimentos_saldos_atuais")
      .select("*")
      .order("valor_total_atual", { ascending: false }),
  ]);

  if (positionsResult.error) {
    return {
      ok: false,
      error: {
        source: "investimentos_posicoes_atuais",
        code: positionsResult.error.code,
        message: positionsResult.error.message,
        hint: positionsResult.error.hint,
      },
    };
  }

  if (balancesResult.error) {
    return {
      ok: false,
      error: {
        source: "investimentos_saldos_atuais",
        code: balancesResult.error.code,
        message: balancesResult.error.message,
        hint: balancesResult.error.hint,
      },
    };
  }

  return {
    ok: true,
    data: {
      positions: positionsResult.data ?? [],
      balances: balancesResult.data ?? [],
    },
  };
}