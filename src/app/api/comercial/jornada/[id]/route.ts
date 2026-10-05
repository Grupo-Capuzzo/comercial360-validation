import { noStore, readJson } from "@/lib/commercial/http";
import { commercialRpc } from "@/services/commercial-journey.service";
import { PortalError } from "@/services/portal.service";
const errorResponse=(error:unknown)=>Response.json({code:error instanceof PortalError ? error.code:"invalid_command"},{status:error instanceof PortalError ? error.status:400,headers:noStore});
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try { const {id}=await params; return Response.json(await commercialRpc("commercial_get_journey",{p_opportunity:id}),{headers:noStore}); } catch(error) { return errorResponse(error); }
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  try { const {id}=await params; const body=await readJson(request); return Response.json(await commercialRpc("commercial_apply_command",{p_opportunity:id,p_command:body}),{headers:noStore}); } catch(error) { return errorResponse(error); }
}
