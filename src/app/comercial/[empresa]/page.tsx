import { Dashboard } from "@/components/dashboard/dashboard";
import { AppShell } from "@/components/layout/app-shell";
import { AccessResult } from "@/components/portal/access-result";
import { requireCompany, attempt } from "@/services/portal.service";
export default async function Commercial({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params;
  const result = await attempt(() => requireCompany(empresa, "comercial"));
  if (!result.ok) return <AccessResult error={result.error} />;
  return <AppShell><Dashboard /></AppShell>;
}
