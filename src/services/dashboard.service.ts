import { scopedRows } from "./crm-scope.client";
import type { DashboardLoadResult, DashboardData } from "@/types/dashboard";
export async function loadDashboard(scope = "geral"): Promise<DashboardLoadResult> {
  const result = await scopedRows<DashboardData>(scope, "dashboard");
  if (result.error || !result.data[0]) return { ok: false, error: { source: "dashboard_executivo", message: result.error?.message ?? "crm_dashboard_unavailable" } };
  return { ok: true, data: result.data[0] };
}
