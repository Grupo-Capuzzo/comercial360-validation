import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PortalError } from "@/services/portal.service";
import { validScope, type CrmScopeContext } from "@/lib/crm/scope";

export function crmDatabaseError(error: { code?: string } | null): never {
  throw new PortalError(error?.code === "42501" ? 403 : 503,
    error?.code === "42501" ? "crm_scope_forbidden" : "crm_scope_unavailable");
}
export async function requireCrmScope(scope: string) {
  if (!validScope(scope)) throw new PortalError(403, "crm_scope_forbidden");
  const db = await createSupabaseServerClient() as unknown as SupabaseClient;
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new PortalError(401, "session_required");
  const result = await db.schema("api_comercial").rpc("crm_escopo_contexto", { p_escopo: scope });
  if (result.error || !result.data) crmDatabaseError(result.error);
  return { db, context: result.data as CrmScopeContext };
}
