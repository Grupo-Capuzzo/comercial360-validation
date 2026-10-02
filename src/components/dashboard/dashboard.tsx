"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ConnectionStatus } from "@/components/dashboard/connection-status";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ProductOverview } from "@/components/dashboard/product-overview";
import { Icon } from "@/components/ui/icon";
import { loadDashboard } from "@/services/dashboard.service";
import type { DashboardLoadResult } from "@/types/dashboard";

const formatter = new Intl.NumberFormat("pt-BR");

function formatDate(value?: string | null) {
  if (!value) {
    return "Aguardando dados";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function Dashboard() {
  const [result, setResult] =
    useState<DashboardLoadResult | null>(null);

  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);

    const dashboardResult = await loadDashboard();

    setResult(dashboardResult);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadDashboard().then((dashboardResult) => {
      if (!cancelled) {
        setResult(dashboardResult);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const data = result?.ok ? result.data : null;

  const groupedMetrics = useMemo(() => {
    const products = data?.products ?? [];

    const investmentRows = products.filter((item) =>
      ["INVESTIMENTOS", "ACOES"].includes(
        item.categoria_codigo,
      ),
    );

    const consortium = products.find(
      (item) => item.produto_codigo === "CONSORCIO",
    );

    return {
      investments: data
        ? investmentRows.reduce(
            (total, item) =>
              total + item.vinculos_ativos,
            0,
          )
        : null,

      consortium:
        consortium?.vinculos_ativos ?? null,
    };
  }, [data]);

  const cards = [
    {
      label: "Clientes",
      value: data?.executive.clientes_total ?? null,
      detail: data
        ? `${formatter.format(
            data.executive.clientes_ativos,
          )} ativos na consolidação`
        : "Identidade global no Comercial 360",
      icon: "clients" as const,
      tone: "navy" as const,
    },

    {
      label: "Produtos / Serviços",
      value: data?.executive.vinculos_ativos ?? null,
      detail: data
        ? `${formatter.format(
            data.executive.vinculos_total,
          )} vínculos no histórico`
        : "Relações comerciais consolidadas",
      icon: "products" as const,
      tone: "gold" as const,
    },

    {
      label: "Investimentos",
      value: groupedMetrics.investments,
      detail:
        "Vínculos ativos; posição financeira é outra visão",
      icon: "investments" as const,
      tone: "blue" as const,
    },

    {
      label: "Consórcio",
      value: groupedMetrics.consortium,
      detail:
        "Operação atual sob autoridade Servopa",
      icon: "consortium" as const,
      tone: "green" as const,
    },

    {
      label: "Leads",
      value: data?.leadsTotal ?? null,
      detail: data
        ? "Oportunidades na central multproduto"
        : "Central comercial de oportunidades",
      icon: "leads" as const,
      tone: "violet" as const,
    },
  ];

  return (
    <div>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--gold-dark)]">
            <Icon
              className="h-3.5 w-3.5"
              name="spark"
            />
            Visão executiva
          </div>

          <h1 className="font-serif text-3xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-[34px]">
            Dashboard Comercial 360
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Consolidação comercial do Grupo Capuzzo
            com rastreabilidade por fonte autoritativa.
          </p>
        </div>

        <ConnectionStatus
          loading={loading}
          onRetry={() => void refresh()}
          result={result}
        />
      </div>

      <section
        aria-label="Indicadores principais"
        className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        {cards.map((card) => (
          <MetricCard
            key={card.label}
            loading={loading}
            {...card}
          />
        ))}
      </section>

      {!loading && result && !result.ok ? (
        <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-amber-200/90 bg-amber-50/70 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <Icon
                className="h-4.5 w-4.5"
                name="services"
              />
            </span>

            <div>
              <p className="text-sm font-semibold text-amber-950">
                Conexão configurada; leitura ainda não autorizada
              </p>

              <p className="mt-1 max-w-3xl text-xs leading-5 text-amber-900/70">
                A consulta a{" "}
                <code className="rounded bg-amber-100 px-1 py-0.5">
                  api_comercial.{result.error.source}
                </code>{" "}
                foi recusada. O schema precisa estar exposto na Data API
                e a role aprovada precisa de USAGE, SELECT e policies RLS
                compatíveis nas dependências.
              </p>

              <p className="mt-2 font-mono text-[10px] text-amber-900/55">
                {result.error.code
                  ? `${result.error.code} · `
                  : ""}
                {result.error.message}
              </p>
            </div>
          </div>

          <button
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
            onClick={() => void refresh()}
            type="button"
          >
            <Icon
              className="h-3.5 w-3.5"
              name="refresh"
            />
            Tentar novamente
          </button>
        </section>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.8fr)]">
        <ProductOverview
          products={data?.products ?? []}
        />

        <div className="space-y-5">
          <section className="rounded-2xl bg-[var(--navy)] p-6 text-white shadow-[0_16px_40px_rgba(12,26,49,.12)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Governança dos dados
                </p>

                <h2 className="mt-2 font-serif text-xl font-semibold">
                  Fontes por domínio
                </h2>
              </div>

              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/8 text-[var(--gold-light)]">
                <Icon
                  className="h-5 w-5"
                  name="chart"
                />
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {[
                [
                  "Cadastro, origem e contratos",
                  "D4",
                ],
                [
                  "Consórcio operacional",
                  "Servopa",
                ],
                [
                  "Posição atual de investimentos",
                  "Grupo Capuzzo App",
                ],
                [
                  "Visão consolidada",
                  "Comercial 360",
                ],
              ].map(([label, source]) => (
                <div
                  className="flex items-center justify-between gap-4 border-b border-white/7 pb-3 last:border-0 last:pb-0"
                  key={label}
                >
                  <span className="text-xs text-white/55">
                    {label}
                  </span>

                  <span className="text-right text-xs font-semibold text-white/90">
                    {source}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Qualidade
                </p>

                <h2 className="mt-1 font-serif text-lg font-semibold text-slate-900">
                  Saúde da consolidação
                </h2>
              </div>

              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,.08)]" />
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3.5">
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                  Pendências
                </dt>

                <dd className="mt-1 text-xl font-semibold text-slate-800">
                  {data
                    ? formatter.format(
                        data.executive.pendencias_qualidade,
                      )
                    : "—"}
                </dd>
              </div>

              <div className="rounded-xl bg-slate-50 p-3.5">
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                  Eventos
                </dt>

                <dd className="mt-1 text-xl font-semibold text-slate-800">
                  {data
                    ? formatter.format(
                        data.executive.eventos_contratuais,
                      )
                    : "—"}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-[11px] leading-5 text-slate-400">
              Última consulta:{" "}
              {formatDate(
                data?.executive.consultado_em,
              )}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}