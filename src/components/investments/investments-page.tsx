"use client";

import { useEffect, useMemo, useState } from "react";

import { loadInvestments } from "@/services/investments.service";
import type {
  InvestmentCurrentBalanceRow,
  InvestmentPositionCurrentRow,
} from "@/types/database";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

function formatCurrency(value: number | null | undefined) {
  return currencyFormatter.format(value ?? 0);
}

function formatNumber(value: number | null | undefined) {
  return numberFormatter.format(value ?? 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(new Date(`${value}T12:00:00`));
}

function currentValue(position: InvestmentPositionCurrentRow) {
  return (
    position.valor_ativo ??
    position.montante ??
    position.saldo_final ??
    0
  );
}

export function InvestmentsPage() {
  const [positions, setPositions] = useState<
    InvestmentPositionCurrentRow[]
  >([]);

  const [balances, setBalances] = useState<
    InvestmentCurrentBalanceRow[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("todos");

  useEffect(() => {
    let active = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const result = await loadInvestments();

      if (!active) return;

      if (!result.ok) {
        setError(
          `${result.error.source}: ${result.error.message}`,
        );
        setPositions([]);
        setBalances([]);
      } else {
        setPositions(result.data.positions);
        setBalances(result.data.balances);
      }

      setLoading(false);
    }

    void fetchData();

    return () => {
      active = false;
    };
  }, []);

  const products = useMemo(
    () =>
      Array.from(
        new Map(
          positions.map((item) => [
            item.produto_codigo,
            item.produto_nome,
          ]),
        ),
      ).sort((a, b) =>
        a[1].localeCompare(b[1], "pt-BR"),
      ),
    [positions],
  );

  const filteredPositions = useMemo(() => {
    const search = query.trim().toLowerCase();

    return positions.filter((item) => {
      const matchesSearch =
        !search ||
        item.nome_preferencial
          ?.toLowerCase()
          .includes(search) ||
        item.produto_nome.toLowerCase().includes(search) ||
        item.produto_codigo.toLowerCase().includes(search);

      const matchesProduct =
        product === "todos" ||
        item.produto_codigo === product;

      return matchesSearch && matchesProduct;
    });
  }, [positions, query, product]);

  const totalPatrimony = useMemo(
    () =>
      balances.reduce(
        (total, item) =>
          total + Number(item.valor_total_atual ?? 0),
        0,
      ),
    [balances],
  );

  const totalCurrentPositions = positions.length;

  const totalClients = balances.length;

  const totalProducts = products.length;

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
          Comercial 360
        </p>

        <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
          Investimentos
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Posição financeira atual consolidada por cliente e produto,
          respeitando as permissões de visualização do usuário autenticado.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Patrimônio atual"
          value={formatCurrency(totalPatrimony)}
        />

        <Metric
          label="Clientes com posição"
          value={totalClients.toLocaleString("pt-BR")}
        />

        <Metric
          label="Posições atuais"
          value={totalCurrentPositions.toLocaleString("pt-BR")}
        />

        <Metric
          label="Produtos"
          value={totalProducts.toLocaleString("pt-BR")}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2">
          <input
            className="input"
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Buscar cliente ou produto..."
            type="search"
            value={query}
          />

          <select
            className="input"
            onChange={(event) =>
              setProduct(event.target.value)
            }
            value={product}
          >
            <option value="todos">
              Todos os produtos
            </option>

            {products.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Carregando investimentos...
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="font-semibold text-rose-700">
              Não foi possível carregar os investimentos.
            </p>

            <p className="mt-2 text-sm text-slate-500">
              {error}
            </p>
          </div>
        ) : filteredPositions.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Nenhuma posição encontrada para os filtros selecionados.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50/80">
                  <tr>
                    <Th>Cliente</Th>
                    <Th>Produto</Th>
                    <Th>Referência</Th>
                    <Th>Valor atual</Th>
                    <Th>Cotas</Th>
                    <Th>Rendimento</Th>
                    <Th>Rentabilidade</Th>
                    <Th>Vencimento</Th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredPositions.map((item) => (
                    <tr
                      className="transition hover:bg-slate-50/70"
                      key={item.posicao_id}
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">
                          {item.nome_preferencial ||
                            "Cliente sem nome"}
                        </p>

                        <p className="mt-1 font-mono text-[10px] text-slate-400">
                          {item.cliente_id_global}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <p className="text-sm font-medium text-slate-700">
                          {item.produto_nome}
                        </p>

                        <p className="mt-1 text-xs text-slate-400">
                          {item.produto_codigo}
                        </p>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {formatDate(item.data_referencia)}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold text-slate-800">
                        {formatCurrency(currentValue(item))}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {formatNumber(
                          item.numero_cotas_ativas,
                        )}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {formatCurrency(item.rendimento)}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {item.rentabilidade == null
                          ? "Não informado"
                          : `${formatNumber(
                              item.rentabilidade,
                            )}%`}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {formatDate(item.data_vencimento)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
              Exibindo{" "}
              {filteredPositions.length.toLocaleString(
                "pt-BR",
              )}{" "}
              de{" "}
              {positions.length.toLocaleString(
                "pt-BR",
              )}{" "}
              posições atuais.
            </div>
          </>
        )}
      </section>

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
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium text-slate-500">
        {label}
      </p>

      <p className="mt-3 text-2xl font-semibold text-[var(--navy)]">
        {value}
      </p>
    </div>
  );
}

function Th({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </th>
  );
}