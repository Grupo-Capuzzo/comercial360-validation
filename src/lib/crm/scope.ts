export const companySlugs = ["assessoria", "cred", "ethernexus", "grao", "hortstufas", "terceiriza", "worldgym"] as const;
export type CrmScope = string;
export type CrmScopeContext = {
  scope: string; nome: string; empresa_id: string | null;
  mapped: boolean; can_write: boolean; general: boolean; can_general?: boolean;
};
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validScope(value: string) {
  return value === "geral" || companySlugs.some(slug => slug === value) || uuidPattern.test(value);
}
export const readKinds = ["pipeline", "opportunities", "tasks", "interactions", "clients", "products", "leads", "dashboard"] as const;
export type ReadKind = typeof readKinds[number];
export const actions = ["crm_mover_oportunidade", "crm_atualizar_oportunidade", "crm_criar_tarefa", "crm_concluir_tarefa", "lead_create", "lead_status", "lead_criar_oportunidade"] as const;
export function parsePage(value: string | null) {
  if (value === null) return 0;
  if (!/^\d{1,6}$/.test(value)) throw new Error("invalid_page");
  return Number(value);
}
