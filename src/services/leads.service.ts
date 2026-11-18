import { scopedRows, scopedMutation } from "./crm-scope.client";
import type { LeadCentralRow } from "@/types/database";
export async function loadLeads(scope = "geral"): Promise<{ data: LeadCentralRow[]; error: string | null }> {
  const result = await scopedRows<LeadCentralRow>(scope, "leads");
  return { data: result.data, error: result.error?.message ?? null };
}
export async function createLead(input: {
  produto_id: string; nome: string; email?: string; telefone?: string; origem?: string;
  objetivo?: string; faixa_valor?: string; investimento_mensal?: string; interesse_simulacao?: string;
}, scope = "geral") {
  return scopedMutation(scope, "lead_create", input);
}
export async function updateLeadStatus(leadId: string, status: string, scope = "geral") {
  return scopedMutation(scope, "lead_status", { lead_id: leadId, status });
}
export async function sendLeadToCrm(leadId: string, scope = "geral"): Promise<{ ok: boolean; oportunidadeId: string | null; error: string | null }> {
  const result = await scopedMutation(scope, "lead_criar_oportunidade", { lead_id: leadId });
  return { ok: result.ok, oportunidadeId: result.id, error: result.error };
}
