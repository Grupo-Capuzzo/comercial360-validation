import { requireCrmScope, crmDatabaseError } from "@/services/crm-scope.server";
import { PortalError } from "@/services/portal.service";
import { readKinds, actions, parsePage, type ReadKind } from "@/lib/crm/scope";
import { readJson } from "@/lib/commercial/http";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function failure(error: unknown) {
  const status = error instanceof PortalError ? error.status : 400;
  return Response.json({ code: error instanceof PortalError ? error.code : "invalid_request" }, { status, headers });
}
type Context = { params: Promise<{ escopo: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { escopo } = await params;
    const { db, context } = await requireCrmScope(escopo);
    if (!context.mapped) throw new PortalError(409, "company_mapping_pending");
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as ReadKind;
    if (!readKinds.includes(kind)) throw new PortalError(400, "invalid_kind");
    const page = parsePage(url.searchParams.get("page"));
    const result = await db.schema("api_comercial").rpc("crm_escopo_consultar", { p_escopo: escopo, p_tipo: kind, p_pagina: page });
    if (result.error) crmDatabaseError(result.error);
    return Response.json(result.data, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { escopo } = await params;
    const { db, context } = await requireCrmScope(escopo);
    if (!context.mapped) throw new PortalError(409, "company_mapping_pending");
    if (!context.can_write) throw new PortalError(403, "crm_write_forbidden");
    const body = await readJson(request);
    if (!actions.some(action => action === body.action) || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) throw new PortalError(400, "invalid_action");
    const result = await db.schema("api_comercial").rpc("crm_escopo_operar", { p_escopo: escopo, p_acao: body.action, p_dados: body.payload });
    if (result.error) crmDatabaseError(result.error);
    return Response.json({ id: result.data }, { headers });
  } catch (error) { return failure(error); }
}
