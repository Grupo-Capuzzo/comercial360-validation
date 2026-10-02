import { AppShell } from "@/components/layout/app-shell";
import { LeadsPage } from "@/components/leads/leads-page";

export default function LeadsRoute() {
  return (
    <AppShell>
      <LeadsPage />
    </AppShell>
  );
}
