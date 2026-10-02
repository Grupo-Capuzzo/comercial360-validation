"use client";

import { useEffect, useMemo, useState } from "react";

import { loadProducts } from "@/services/products.service";
import type { ProductSummaryRow } from "@/types/database";

const formatter = new Intl.NumberFormat("pt-BR");

export function ServicesPage() {
  const [products, setProducts] = useState<ProductSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const result = await loadProducts();

      if (!active) {
        return;
      }

      if (result.error) {
        setError(result.error);
        setProducts([]);
      } else {
        setProducts(
          result.data.filter(
            (item) =>
              item.categoria_codigo ===
              "SERVICOS_FINANCEIROS",
          ),
        );
      }

      setLoading(false);
    }

    void fetchData();

    return () => {
      active = false;
    };
  }, []);

  const filteredProducts = useMemo(() => {
    const search = query.trim().toLowerCase();

    if (!search) {
      return products;
    }

    return products.filter(
      (item) =>
        item.produto_nome
          .toLowerCase()
          .includes(search) ||
        item.produto_codigo
          .toLowerCase()
          .includes(search),
    );
  }, [products, query]);

  const totalLinks = useMemo(
    () =>
      products.reduce(
        (total, item) =>
          total + item.vinculos_total,
        0,
      ),
    [products],
  );

  const activeLinks = useMemo(
    () =>
      products.reduce(
        (total, item) =>
          total + item.vinculos_ativos,
        0,
      ),
    [products],
  );

  const distinctClients = useMemo(
    () =>
      products.reduce(
        (total, item) =>
          total + item.clientes_distintos,
        0,
      ),
    [products],
  );

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
          Comercial 360
        </p>

        <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
          Serviços
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Visão consolidada dos serviços financeiros
          oferecidos pelo Grupo Capuzzo e seus vínculos
          comerciais.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Serviços"
          value={products.length}
        />

        <Metric
          label="Vínculos totais"
          value={totalLinks}
        />

        <Metric
          label="Vínculos ativos"
          value={activeLinks}
        />

        <Metric
          label="Clientes vinculados"
          value={distinctClients}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <input
            className="input max-w-xl"
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Buscar serviço..."
            type="search"
            value={query}
          />
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Carregando serviços...
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="font-semibold text-rose-700">
              Não foi possível carregar os serviços.
            </p>

            <p className="mt-2 text-sm text-slate-500">
              {error}
            </p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Nenhum serviço encontrado.
          </div>
        ) : (
          <>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              {filteredProducts.map((item) => (
                <article
                  className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5 transition hover:border-slate-300 hover:bg-white"
                  key={item.produto_id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--gold-dark)]">
                        Serviços Financeiros
                      </p>

                      <h2 className="mt-2 text-lg font-semibold text-[var(--navy)]">
                        {item.produto_nome}
                      </h2>

                      <p className="mt-1 font-mono text-[10px] text-slate-400">
                        {item.produto_codigo}
                      </p>
                    </div>

                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      Ativo
                    </span>
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-3">
                    <DataBox
                      label="Vínculos"
                      value={item.vinculos_total}
                    />

                    <DataBox
                      label="Ativos"
                      value={item.vinculos_ativos}
                    />

                    <DataBox
                      label="Clientes"
                      value={item.clientes_distintos}
                    />

                    <DataBox
                      label="Em validação"
                      value={
                        item.vinculos_em_validacao
                      }
                    />
                  </dl>

                  <p className="mt-4 text-xs text-slate-400">
                    Última atualização:{" "}
                    {item.ultima_atualizacao_origem_em
                      ? new Intl.DateTimeFormat(
                          "pt-BR",
                          {
                            dateStyle: "short",
                            timeStyle: "short",
                          },
                        ).format(
                          new Date(
                            item.ultima_atualizacao_origem_em,
                          ),
                        )
                      : "Não informada"}
                  </p>
                </article>
              ))}
            </div>

            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
              Exibindo{" "}
              {filteredProducts.length.toLocaleString(
                "pt-BR",
              )}{" "}
              de{" "}
              {products.length.toLocaleString(
                "pt-BR",
              )}{" "}
              serviços financeiros.
            </div>
          </>
        )}

        <style jsx>{`
          .input {
            width: 100%;
            height: 44px;
            border: 1px solid rgb(226 232 240);
            border-radius: 0.75rem;
            background: white;
            padding: 0 0.9rem;
            font-size: 0.875rem;
            color: rgb(71 85 105);
            outline: none;
          }

          .input:focus {
            border-color: var(--gold);
            box-shadow: 0 0 0 4px
              rgb(254 243 199 / 0.5);
          }
        `}</style>
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
      <p className="text-xs font-medium text-slate-500">
        {label}
      </p>

      <p className="mt-3 text-3xl font-semibold text-[var(--navy)]">
        {formatter.format(value)}
      </p>
    </div>
  );
}

function DataBox({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/70">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>

      <dd className="mt-1 text-xl font-semibold text-slate-800">
        {formatter.format(value)}
      </dd>
    </div>
  );
}