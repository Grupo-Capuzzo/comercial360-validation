import { scopedRows } from "./crm-scope.client";
import type { Client360Row } from "@/types/database";
export type ClientsLoadResult = { ok: true; data: Client360Row[] } | { ok: false; error: { message: string; code?: string; hint?: string | null } };
export async function loadClients(scope = "geral"): Promise<ClientsLoadResult> {
  const result = await scopedRows<Client360Row>(scope, "clients");
  return result.error ? { ok: false, error: result.error } : { ok: true, data: result.data };
}
