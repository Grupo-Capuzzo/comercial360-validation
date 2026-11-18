import { AppShell } from "@/components/layout/app-shell";
import { CrmWorkspace } from "@/components/crm/crm-workspace";
import { requireCrmScope } from "@/services/crm-scope.server";
export default async function CRMPage() {
  const { context } = await requireCrmScope("geral");
  return <AppShell crm={context}><CrmWorkspace key={context.scope} context={context} /></AppShell>;
}
