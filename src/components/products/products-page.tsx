"use client";

import { useEffect, useMemo, useState } from "react";

import { loadProducts } from "@/services/products.service";
import type { ProductSummaryRow } from "@/types/database";

export function ProductsPage() {
  const [products, setProducts] = useState<ProductSummaryRow[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("todas");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchProducts() {
      const result = await loadProducts();

      if (!active) return;

      setProducts(result.data);
      setError(result.error);
      setLoading(false);
    }

    fetchProducts();

    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          products
            .map((product) => product.categoria_nome)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const search = query.trim().toLowerCase();

    return products.filter((product) => {
      const matchesSearch =
        !search ||
        product.produto_nome.toLowerCase().includes(search) ||
        product.produto_codigo.toLowerCase().includes(search) ||
        product.categoria_nome.toLowerCase().includes(search);

      const matchesCategory =
        category === "todas" || product.categoria_nome === category;

      return matchesSearch && matchesCategory;
    });
  }, [products, query, category]);

  const totalLinks = products.reduce(
    (sum, product) => sum + Number(product.vinculos_total ?? 0),
    0,
  );

  const activeLinks = products.reduce(
    (sum, product) => sum + Number(product.vinculos_ativos ?? 0),
    0,
  );

  const distinctClients = products.reduce(
    (sum, product) => sum + Number(product.clientes_distintos ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
          Comercial 360
        </p>

        <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
          Produtos
        </h1>

        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Visão consolidada do portfólio comercial e dos vínculos existentes
          entre clientes e produtos.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Produtos" value={products.length} />
        <Metric label="Vínculos totais" value={totalLinks} />
        <Metric label="Vínculos ativos" value={activeLinks} />
        <Metric label="Clientes vinculados" value={distinctClients} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row">
          <input
            className="h-11 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-[var(--gold)] focus:bg-white focus:ring-4 focus:ring-amber-100/50"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar produto, código ou categoria..."
            type="search"
            value={query}
          />

          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-600 outline-none focus:border-[var(--gold)]"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            <option value="todas">Todas as categorias</option>

            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Carregando produtos...
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="font-semibold text-rose-700">
              Não foi possível carregar os produtos.
            </p>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50/80">
                  <tr>
                    <Header>Produto</Header>
                    <Header>Categoria</Header>
                    <Header align="center">Clientes</Header>
                    <Header align="center">Vínculos</Header>
                    <Header align="center">Ativos</Header>
                    <Header align="center">Em validação</Header>
                    <Header align="center">Inativos</Header>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((product) => (
                    <tr
                      className="transition hover:bg-slate-50/70"
                      key={product.produto_id}
                    >
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-slate-800">
                          {product.produto_nome}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">
                          {product.produto_codigo}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {product.categoria_nome}
                        </span>
                      </td>

                      <NumberCell value={product.clientes_distintos} />
                      <NumberCell value={product.vinculos_total} />
                      <NumberCell
                        className="text-emerald-700"
                        value={product.vinculos_ativos}
                      />
                      <NumberCell
                        className="text-amber-700"
                        value={product.vinculos_em_validacao}
                      />
                      <NumberCell
                        className="text-slate-500"
                        value={product.vinculos_inativos}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
              Exibindo {filteredProducts.length.toLocaleString("pt-BR")} de{" "}
              {products.length.toLocaleString("pt-BR")} produtos.
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-[var(--navy)]">
        {Number(value ?? 0).toLocaleString("pt-BR")}
      </p>
    </div>
  );
}

function Header({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <th
      className={`px-5 py-3 text-${align} text-[11px] font-semibold uppercase tracking-wider text-slate-500`}
    >
      {children}
    </th>
  );
}

function NumberCell({
  value,
  className = "text-slate-700",
}: {
  value: number;
  className?: string;
}) {
  return (
    <td
      className={`px-5 py-4 text-center text-sm font-semibold ${className}`}
    >
      {Number(value ?? 0).toLocaleString("pt-BR")}
    </td>
  );
}
