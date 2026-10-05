import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  CrmOpportunityRow,
  CrmPipelineRow,
  CrmTaskRow,
  Json,
} from "@/types/database";

export type CrmLoadResult =
  | {
      ok: true;
      data: {
        pipeline: CrmPipelineRow[];
        opportunities: CrmOpportunityRow[];
        tasks: CrmTaskRow[];
      };
    }
  | {
      ok: false;
      error: {
        source:
          | "crm_pipeline"
          | "crm_oportunidades"
          | "crm_tarefas";
        message: string;
        code?: string;
        hint?: string | null;
      };
    };

export async function loadCrm(): Promise<CrmLoadResult> {
  const supabase = getSupabaseBrowserClient();

  const [
    pipelineResult,
    opportunitiesResult,
    tasksResult,
  ] = await Promise.all([
    supabase
      .schema("api_comercial")
      .from("crm_pipeline")
      .select("*")
      .eq("ativo", true)
      .order("ordem", { ascending: true }),

    supabase
      .schema("api_comercial")
      .from("crm_oportunidades")
      .select("*")
      .order("etapa_ordem", { ascending: true })
      .order("atualizado_em", { ascending: false }),

    supabase
      .schema("api_comercial")
      .from("crm_tarefas")
      .select("*")
      .order("prazo_em", {
        ascending: true,
        nullsFirst: false,
      }),
  ]);

  if (pipelineResult.error) {
    return {
      ok: false,
      error: {
        source: "crm_pipeline",
        code: pipelineResult.error.code,
        message: pipelineResult.error.message,
        hint: pipelineResult.error.hint,
      },
    };
  }

  if (opportunitiesResult.error) {
    return {
      ok: false,
      error: {
        source: "crm_oportunidades",
        code: opportunitiesResult.error.code,
        message: opportunitiesResult.error.message,
        hint: opportunitiesResult.error.hint,
      },
    };
  }

  if (tasksResult.error) {
    return {
      ok: false,
      error: {
        source: "crm_tarefas",
        code: tasksResult.error.code,
        message: tasksResult.error.message,
        hint: tasksResult.error.hint,
      },
    };
  }

  return {
    ok: true,
    data: {
      pipeline: pipelineResult.data ?? [],
      opportunities: opportunitiesResult.data ?? [],
      tasks: tasksResult.data ?? [],
    },
  };
}

async function callCrmRpc(
  functionName:
    | "crm_mover_oportunidade"
    | "crm_atualizar_oportunidade"
    | "crm_criar_tarefa"
    | "crm_concluir_tarefa",
  payload: Json,
): Promise<{
  ok: boolean;
  id: string | null;
  error: string | null;
}> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .schema("api_comercial")
    .rpc(functionName, {
      p_dados: payload,
    });

  if (error) {
    return {
      ok: false,
      id: null,
      error: error.message,
    };
  }

  return {
    ok: true,
    id: typeof data === "string" ? data : null,
    error: null,
  };
}

export async function moveOpportunity(input: {
  oportunidadeId: string;
  etapaCodigo: string;
  motivoPerda?: string;
}) {
  if (input.etapaCodigo.toUpperCase() === "FECHADO") {
    return { ok: false, oportunidadeId: null, error: "Conclua a formalização contratual para fechar e disponibilizar o output comercial." };
  }
  const payload: Record<string, Json> = {
    oportunidade_id: input.oportunidadeId,
    etapa_codigo: input.etapaCodigo,
  };

  if (input.motivoPerda?.trim()) {
    payload.motivo_perda = input.motivoPerda.trim();
  }

  const result = await callCrmRpc(
    "crm_mover_oportunidade",
    payload,
  );

  return {
    ok: result.ok,
    oportunidadeId: result.id,
    error: result.error,
  };
}

export async function updateOpportunity(input: {
  oportunidadeId: string;
  proximaAcao?: string;
  proximaAcaoEm?: string;
  previsaoFechamento?: string;
}) {
  const payload: Record<string, Json> = {
    oportunidade_id: input.oportunidadeId,
  };

  if (input.proximaAcao !== undefined) {
    payload.proxima_acao =
      input.proximaAcao.trim();
  }

  if (input.proximaAcaoEm !== undefined) {
    payload.proxima_acao_em =
      input.proximaAcaoEm;
  }

  if (
    input.previsaoFechamento !== undefined
  ) {
    payload.previsao_fechamento =
      input.previsaoFechamento;
  }

  const result = await callCrmRpc(
    "crm_atualizar_oportunidade",
    payload,
  );

  return {
    ok: result.ok,
    oportunidadeId: result.id,
    error: result.error,
  };
}

export async function createCrmTask(input: {
  oportunidadeId: string;
  titulo: string;
  descricao?: string;
  tipo?: string;
  prioridade?: string;
  prazoEm?: string;
}) {
  const payload: Record<string, Json> = {
    oportunidade_id: input.oportunidadeId,
    titulo: input.titulo.trim(),
  };

  if (input.descricao?.trim()) {
    payload.descricao =
      input.descricao.trim();
  }

  if (input.tipo) {
    payload.tipo = input.tipo;
  }

  if (input.prioridade) {
    payload.prioridade =
      input.prioridade;
  }

  if (input.prazoEm) {
    payload.prazo_em = input.prazoEm;
  }

  const result = await callCrmRpc(
    "crm_criar_tarefa",
    payload,
  );

  return {
    ok: result.ok,
    tarefaId: result.id,
    error: result.error,
  };
}

export async function completeCrmTask(
  tarefaId: string,
) {
  const result = await callCrmRpc(
    "crm_concluir_tarefa",
    {
      tarefa_id: tarefaId,
    },
  );

  return {
    ok: result.ok,
    tarefaId: result.id,
    error: result.error,
  };
}
