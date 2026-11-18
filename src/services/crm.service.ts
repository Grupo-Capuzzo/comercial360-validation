import { scopedRows, scopedMutation } from "./crm-scope.client";
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

export async function loadCrm(scope = "geral"): Promise<CrmLoadResult> {
  const [pipeline, opportunities, tasks] = await Promise.all([
    scopedRows<CrmPipelineRow>(scope, "pipeline"),
    scopedRows<CrmOpportunityRow>(scope, "opportunities"),
    scopedRows<CrmTaskRow>(scope, "tasks"),
  ]);
  for (const [source, result] of [["crm_pipeline", pipeline], ["crm_oportunidades", opportunities], ["crm_tarefas", tasks]] as const) {
    if (result.error) return { ok: false, error: { source, ...result.error } };
  }
  pipeline.data.sort((a, b) => a.ordem - b.ordem);
  opportunities.data.sort((a, b) => a.etapa_ordem - b.etapa_ordem || b.atualizado_em.localeCompare(a.atualizado_em));
  tasks.data.sort((a, b) => a.prazo_em === b.prazo_em ? a.tarefa_id.localeCompare(b.tarefa_id) : !a.prazo_em ? 1 : !b.prazo_em ? -1 : a.prazo_em.localeCompare(b.prazo_em));
  return { ok: true, data: { pipeline: pipeline.data, opportunities: opportunities.data, tasks: tasks.data } };
}

async function callCrmRpc(
  functionName:
    | "crm_mover_oportunidade"
    | "crm_atualizar_oportunidade"
    | "crm_criar_tarefa"
    | "crm_concluir_tarefa",
  payload: Json,
  scope = "geral",
): Promise<{
  ok: boolean;
  id: string | null;
  error: string | null;
}> {
  return scopedMutation(scope, functionName, payload);
}

export async function moveOpportunity(input: {
  oportunidadeId: string;
  etapaCodigo: string;
  motivoPerda?: string;
}, scope = "geral") {
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
    scope,
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
}, scope = "geral") {
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
    scope,
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
}, scope = "geral") {
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
    scope,
  );

  return {
    ok: result.ok,
    tarefaId: result.id,
    error: result.error,
  };
}

export async function completeCrmTask(
  tarefaId: string,
  scope = "geral",
) {
  const result = await callCrmRpc(
    "crm_concluir_tarefa",
    {
      tarefa_id: tarefaId,
    },
    scope,
  );

  return {
    ok: result.ok,
    tarefaId: result.id,
    error: result.error,
  };
}
