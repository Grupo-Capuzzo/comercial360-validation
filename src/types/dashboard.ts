import type {
  DashboardExecutiveRow,
  ProductSummaryRow,
} from "@/types/database";

export type DashboardData = {
  executive: DashboardExecutiveRow;
  products: ProductSummaryRow[];
  leadsTotal: number;
};

export type DashboardLoadResult =
  | {
      ok: true;
      data: DashboardData;
    }
  | {
      ok: false;
      error: {
        code?: string;
        message: string;
        hint?: string | null;
        source:
          | "configuration"
          | "dashboard_executivo"
          | "produtos_resumo"
          | "leads_central";
      };
    };