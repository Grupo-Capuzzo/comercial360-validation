import { commercialRpc } from "@/services/commercial-journey.service";
import { PortalError } from "@/services/portal.service";
import { noStore } from "@/lib/commercial/http";
export async function GET(_request:Request,{params}:{params:Promise<{empresa:string}>}) {
  try { const {empresa}=await params; return Response.json(await commercialRpc("commercial_consume_outputs",{p_company:empresa}),{headers:noStore}); }
  catch(error) { return Response.json({code:error instanceof PortalError ? error.code:"query_failed"},{status:error instanceof PortalError ? error.status:503,headers:noStore}); }
}
