import type { CrmScope, ReadKind } from "@/lib/crm/scope";
type Failure = { message: string; code?: string; hint?: string | null };
export async function scopedRows<T>(scope: CrmScope, kind: ReadKind): Promise<{ data: T[]; error: Failure | null }> {
  const rows: T[] = [];
  try {
    let page: number | null = 0;
    while (page !== null) {
      const response: Response = await fetch(`/api/crm/${encodeURIComponent(scope)}?kind=${kind}&page=${page}`, { cache: "no-store" });
      const result: { rows?: T[]; next?: number | null; code?: string } = await response.json();
      if (!response.ok || !Array.isArray(result.rows)) return { data: [], error: { message: result.code ?? "crm_query_failed" } };
      rows.push(...result.rows);
      page = result.next ?? null;
    }
    return { data: rows, error: null };
  } catch {
    return { data: [], error: { message: "Não foi possível consultar este escopo." } };
  }
}
export async function scopedMutation(scope: CrmScope, action: string, payload: unknown) {
  try {
    const response = await fetch(`/api/crm/${encodeURIComponent(scope)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const result = await response.json() as { id?: string; code?: string };
    return { ok: response.ok, id: result.id ?? null, error: response.ok ? null : result.code ?? "crm_mutation_failed" };
  } catch {
    return { ok: false, id: null, error: "Não foi possível salvar neste escopo." };
  }
}
