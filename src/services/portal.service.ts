import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class PortalError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export type Company = { empresa_id: string; nome: string };
export type Module = "comercial" | "financeiro";
export const financeSections = ["clientes", "cotas", "apuracoes", "titulos", "parcelas"] as const;
export type FinanceSection = typeof financeSections[number];
export type FinancialRow = { origem_id: string; descricao: string; status: string | null; valor: string | null; data_referencia: string | null; detalhes: Record<string, unknown> };

export async function portalClient() {
  const db = await createSupabaseServerClient() as unknown as SupabaseClient;
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new PortalError(401, "session_required");
  const session = await db.schema("portal_acesso").rpc("sessao_ativa");
  if (session.error) throw new PortalError(503, "access_structure_unavailable");
  if (session.data !== true) throw new PortalError(401, "session_revoked");
  return db;
}
export async function authorizedCompanies() {
  const db = await portalClient();
  const { data, error } = await db.schema("portal_acesso").from("empresas_portal").select("empresa_id,nome").order("nome");
  if (error) throw new PortalError(503, "company_query_failed");
  return (data ?? []) as Company[];
}
export async function attempt<T>(operation: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: unknown }> {
  try { return { ok: true, data: await operation() }; } catch (error) { return { ok: false, error }; }
}
export async function requireCompany(empresa: string, module?: Module) {
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) throw new PortalError(403, "company_forbidden");
  const db = await portalClient();
  let query = db.schema("portal_acesso").from("permissoes").select("modulo").eq("empresa_id", empresa).eq("pode_ler", true);
  if (module) query = query.eq("modulo", module);
  const { data, error } = await query;
  if (error) throw new PortalError(503, "permission_query_failed");
  if (!data?.length) throw new PortalError(403, "module_forbidden");
  return { db, modules: data.map((p: { modulo: string }) => p.modulo) };
}
export async function financialRecords(empresa: string, section: FinanceSection, search = "") {
  const { db } = await requireCompany(empresa, "financeiro");
  const state = await db.schema("financeiro").from("estado_carga").select("situacao,data_referencia").eq("empresa_id", empresa).maybeSingle();
  if (state.error) throw new PortalError(503, "load_state_query_failed");
  if (!state.data || state.data.situacao === "nao_carregado") return { state: "not_loaded" as const, reference: null, rows: [] };
  let query = db.schema("financeiro").from("registros_lista").select("origem_id,descricao,status,valor,data_referencia,detalhes").eq("empresa_id", empresa).eq("tipo", section).order("origem_id").limit(500);
  if (search) query = query.ilike("descricao", `%${search.replace(/[%_]/g, "").slice(0, 80)}%`);
  const { data, error } = await query;
  if (error) throw new PortalError(503, "financial_query_failed");
  return { state: "loaded" as const, reference: state.data.data_referencia as string, rows: (data ?? []) as FinancialRow[] };
}
