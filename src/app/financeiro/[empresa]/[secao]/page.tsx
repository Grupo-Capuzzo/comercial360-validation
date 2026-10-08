import { notFound } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { AccessResult } from "@/components/portal/access-result";
import { FinanceAreaPage } from "@/components/financeiro/finance-module";
import { getFinanceArea } from "@/lib/finance/navigation";
import { financialRecords, attempt } from "@/services/portal.service";
export default async function Finance({ params, searchParams }: { params: Promise<{ empresa: string; secao: string }>; searchParams: Promise<{ q?: string }> }) {
  const { empresa, secao } = await params;
  const area = getFinanceArea(secao);
  if (!area) notFound();
  const { q } = await searchParams;
  const responses = await Promise.all(area.sources.map(source => attempt(() => financialRecords(empresa, source, q))));
  const failed = responses.find(response => !response.ok);
  if (failed && !failed.ok) return <PortalShell><AccessResult error={failed.error} /></PortalShell>;
  const data = responses.flatMap((response, index) => response.ok ? [{ label: area.sources[index], ...response.data }] : []);
  return <PortalShell><FinanceAreaPage empresa={empresa} area={area} results={data}/></PortalShell>;
}
