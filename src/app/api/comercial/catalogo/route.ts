import { commercialRpc } from "@/services/commercial-journey.service";
import { noStore } from "@/lib/commercial/http";
export async function GET() {
  try { return Response.json({products:await commercialRpc("commercial_intake_catalog",{},false)},{headers:noStore}); }
  catch { return Response.json({code:"commercial_structure_unavailable"},{status:503,headers:noStore}); }
}
