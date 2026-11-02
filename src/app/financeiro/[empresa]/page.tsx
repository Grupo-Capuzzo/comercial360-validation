import { PortalShell } from "@/components/portal/portal-shell";
import { AccessResult } from "@/components/portal/access-result";
import { FinanceDashboard } from "@/components/financeiro/finance-module";
import { attempt, financialRecords } from "@/services/portal.service";

const queries = ["clientes", "cotas", "apuracoes", "titulos", "parcelas"] as const;
export default async function FinanceDashboardPage({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const results = await Promise.all(queries.map(section => attempt(() => financialRecords(empresa, section))));
  const failed = results.find(result => !result.ok);
  if (failed && !failed.ok) return <PortalShell><AccessResult error={failed.error}/></PortalShell>;
  const data = results.flatMap((result, index) => result.ok ? [{ label: queries[index], ...result.data }] : []);
  return <PortalShell><FinanceDashboard empresa={empresa} results={data}/></PortalShell>;
}
