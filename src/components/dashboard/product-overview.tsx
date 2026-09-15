import type { ProductSummaryRow } from "@/types/database";

const formatter = new Intl.NumberFormat("pt-BR");

const categoryTone: Record<string, string> = {
  INVESTIMENTOS: "bg-blue-50 text-blue-700",
  ACOES: "bg-indigo-50 text-indigo-700",
  CONSORCIOS: "bg-emerald-50 text-emerald-700",
  SERVICOS_FINANCEIROS: "bg-amber-50 text-amber-700",
  CONSULTORIAS: "bg-violet-50 text-violet-700",
  MENTORIAS: "bg-fuchsia-50 text-fuchsia-700",
  EMPRESTIMOS: "bg-slate-100 text-slate-700",
};

export function ProductOverview({ products }: { products: ProductSummaryRow[] }) {
  const visibleProducts = products.slice(0, 6);
  const maxValue = Math.max(...visibleProducts.map((item) => item.vinculos_total), 1);

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.03)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-serif text-lg font-semibold text-slate-900">Produtos em destaque</h2>
          <p className="mt-1 text-xs text-slate-400">Vínculos consolidados por produto</p>
        </div>
        <span className="rounded-lg bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          api_comercial
        </span>
      </div>

      {visibleProducts.length ? (
        <div className="divide-y divide-slate-100 px-5 sm:px-6">
          {visibleProducts.map((product) => (
            <div className="grid grid-cols-[1fr_auto] gap-4 py-4" key={product.produto_codigo}>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <p className="truncate text-sm font-semibold text-slate-700">{product.produto_nome}</p>
                  <span className={`hidden rounded-md px-2 py-0.5 text-[9px] font-bold tracking-wide sm:inline ${categoryTone[product.categoria_codigo] ?? "bg-slate-50 text-slate-500"}`}>
                    {product.categoria_nome}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--navy)] to-[var(--gold)]"
                    style={{ width: `${Math.max((product.vinculos_total / maxValue) * 100, 2)}%` }}
                  />
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-slate-800">{formatter.format(product.vinculos_total)}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{formatter.format(product.vinculos_ativos)} ativos</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-h-72 place-items-center px-6 text-center">
          <div>
            <div className="mx-auto mb-3 h-10 w-10 rounded-xl bg-slate-100" />
            <p className="text-sm font-medium text-slate-600">Dados aguardando permissão</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-400">
              A estrutura está pronta para exibir a view produtos_resumo.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
