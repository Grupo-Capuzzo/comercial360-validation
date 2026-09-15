import { Icon } from "@/components/ui/icon";
import type { DashboardLoadResult } from "@/types/dashboard";

type ConnectionStatusProps = {
  result: DashboardLoadResult | null;
  loading: boolean;
  onRetry: () => void;
};

export function ConnectionStatus({ result, loading, onRetry }: ConnectionStatusProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        Validando Supabase
      </div>
    );
  }

  if (result?.ok) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Dados atualizados
      </div>
    );
  }

  return (
    <button
      className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
      onClick={onRetry}
      title="Tentar consultar novamente"
      type="button"
    >
      <span className="h-2 w-2 rounded-full bg-amber-500" />
      Acesso pendente
      <Icon className="h-3 w-3" name="refresh" />
    </button>
  );
}
