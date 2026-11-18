import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CrmWorkspace } from "@/components/crm/crm-workspace";
import { requireCrmScope } from "@/services/crm-scope.server";
export default async function Commercial({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  // Compatibility redirect for the old CRM Geral URL; never a company mapping.
  if (empresa === "40ca9f00-a17c-4605-9323-a15974c52817") {
    await requireCrmScope("geral");
    redirect("/crm");
  }
  const { context } = await requireCrmScope(empresa);
  return <AppShell crm={context}><CrmWorkspace key={context.scope} context={context} /></AppShell>;
}
