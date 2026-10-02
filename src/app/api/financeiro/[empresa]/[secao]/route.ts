import { financeSections, financialRecords, PortalError, type FinanceSection } from "@/services/portal.service";
export async function GET(request: Request, { params }: { params: Promise<{ empresa: string; secao: string }> }) {
  const { empresa, secao } = await params;
  if (!financeSections.includes(secao as FinanceSection)) return Response.json({ code: "not_found" }, { status: 404 });
  try { return Response.json(await financialRecords(empresa, secao as FinanceSection, new URL(request.url).searchParams.get("q") ?? ""), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ code: error instanceof PortalError ? error.code : "query_failed" }, { status: error instanceof PortalError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } }); }
}
