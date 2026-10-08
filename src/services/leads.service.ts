import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  LeadCentralRow,
  LeadInsert,
  LeadUpdate,
} from "@/types/database";

export async function loadLeads(): Promise<{
  data: LeadCentralRow[];
  error: string | null;
}> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .schema("api_comercial")
    .from("leads_central")
    .select("*")
    .order("data_entrada", { ascending: false });

  return {
    data: data ?? [],
    error: error?.message ?? null,
  };
}

export async function createLead(input: {
  produto_id: string;
  nome: string;
  email?: string;
  telefone?: string;
  origem?: string;
  objetivo?: string;
  faixa_valor?: string;
  investimento_mensal?: string;
  interesse_simulacao?: string;
}) {
  const supabase = getSupabaseBrowserClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      error: "Usuário autenticado não identificado.",
    };
  }

  const payload: LeadInsert = {
    produto_id: input.produto_id,
    nome: input.nome.trim(),
    email: input.email?.trim() || null,
    telefone: input.telefone?.trim() || null,
    origem: input.origem?.trim() || "CRM Comercial 360",
    origem_tipo: "manual",
    status: "novo",
    objetivo: input.objetivo?.trim() || null,
    faixa_valor: input.faixa_valor?.trim() || null,
    investimento_mensal: input.investimento_mensal?.trim() || null,
    interesse_simulacao: input.interesse_simulacao?.trim() || null,
    detalhes: {},
    criado_por: user.id,
  };

  const { error } = await supabase
    .schema("comercial_360")
    .from("leads")
    .insert(payload);

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  return {
    ok: true,
    error: null,
  };
}

export async function updateLeadStatus(
  leadId: string,
  status: string,
) {
  const supabase = getSupabaseBrowserClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      error: "Usuário autenticado não identificado.",
    };
  }

  const payload: LeadUpdate = {
    status,
    atualizado_por: user.id,
    atualizado_em: new Date().toISOString(),
  };

  const { error } = await supabase
    .schema("comercial_360")
    .from("leads")
    .update(payload)
    .eq("lead_id", leadId);

  return {
    ok: !error,
    error: error?.message ?? null,
  };
}

export async function sendLeadToCrm(
  leadId: string,
): Promise<{
  ok: boolean;
  oportunidadeId: string | null;
  error: string | null;
}> {
  const supabase = getSupabaseBrowserClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      oportunidadeId: null,
      error: "Usuário autenticado não identificado.",
    };
  }

  const { data, error } = await supabase
    .schema("api_comercial")
    .rpc("lead_criar_oportunidade", {
      p_lead_id: leadId,
    });

  if (error) {
    return {
      ok: false,
      oportunidadeId: null,
      error: error.message,
    };
  }

  return {
    ok: true,
    oportunidadeId:
      typeof data === "string" ? data : null,
    error: null,
  };
}