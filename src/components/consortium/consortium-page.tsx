"use client";

import { useEffect, useMemo, useState } from "react";

import { loadLeads } from "@/services/leads.service";
import type { LeadCentralRow } from "@/types/database";

function statusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function isYes(value: string | null) {
  if (!value) return false;

  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return ["sim", "s", "yes", "true"].includes(normalized);
}

export function ConsortiumPage() {
  const [leads, setLeads] = useState<LeadCentralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const [simulation, setSimulation] = useState("todos");

  useEffect(() => {
    let active = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      const result = await loadLeads();

      if (!active) return;

      if (result.error) {
        setError(result.error);
        setLeads([]);
      } else {
        setLeads(
          result.data.filter(
            (lead) => lead.produto_codigo === "CONSORCIO",
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

  const statuses = useMemo(
    () =>
      Array.from(
        new Set(
          leads
            .map((lead) => lead.status)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [leads],
  );

  const simulationLeads = useMemo(
    () =>
      leads.filter((lead) =>
        isYes(lead.interesse_simulacao),
      ).length,
    [leads],
  );

  const withMonthlyInvestment = useMemo(
    () =>
      leads.filter(
        (lead) =>
          Boolean(
            lead.investimento_mensal &&
              lead.investimento_mensal.trim(),
          ),
      ).length,
    [leads],
  );

  const converted = useMemo(
    () =>
      leads.filter(
        (lead) => lead.status === "convertido",
      ).length,
    [leads],
  );

  const filteredLeads = useMemo(() => {
    const search = query.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesSearch =
        !search ||
        lead.nome.toLowerCase().includes(search) ||
        lead.email?.toLowerCase().includes(search) ||
        lead.telefone?.toLowerCase().includes(search) ||
        lead.objetivo?.toLowerCase().includes(search) ||
        lead.faixa_valor?.toLowerCase().includes(search);

      const matchesStatus =
        status === "todos" || lead.status === status;

      const hasSimulation = isYes(
        lead.interesse_simulacao,
      );

      const matchesSimulation =
        simulation === "todos" ||
        (simulation === "sim" && hasSimulation) ||
        (simulation === "nao" && !hasSimulation);

      return (
        matchesSearch &&
        matchesStatus &&
        matchesSimulation
      );
    });
  }, [leads, query, status, simulation]);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
          Comercial 360
        </p>

        <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
          Consórcio
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Visão comercial dos leads de Consórcio,
          interesse em simulação, perfil financeiro
          e estágio de atendimento.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Leads de Consórcio"
          value={leads.length}
        />

        <Metric
          label="Interesse em simulação"
          value={simulationLeads}
        />

        <Metric
          label="Investimento informado"
          value={withMonthlyInvestment}
        />

        <Metric
          label="Convertidos"
          value={converted}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-3">
          <input
            className="input"
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Buscar nome, contato, objetivo ou faixa..."
            type="search"
            value={query}
          />

          <select
            className="input"
            onChange={(event) =>
              setStatus(event.target.value)
            }
            value={status}
          >
            <option value="todos">
              Todos os status
            </option>

            {statuses.map((item) => (
              <option
                key={item}
                value={item}
              >
                {statusLabel(item)}
              </option>
            ))}
          </select>

          <select
            className="input"
            onChange={(event) =>
              setSimulation(event.target.value)
            }
            value={simulation}
          >
            <option value="todos">
              Todos sobre simulação
            </option>
            <option value="sim">
              Interessados em simulação
            </option>
            <option value="nao">
              Sem interesse informado
            </option>
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Carregando dados de Consórcio...
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="font-semibold text-rose-700">
              Não foi possível carregar os dados.
            </p>

            <p className="mt-2 text-sm text-slate-500">
              {error}
            </p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Nenhum lead encontrado para os filtros
            selecionados.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50/80">
                  <tr>
                    <Th>Lead</Th>
                    <Th>Objetivo</Th>
                    <Th>Faixa de carta</Th>
                    <Th>Investimento mensal</Th>
                    <Th>Simulação</Th>
                    <Th>Status</Th>
                    <Th>Entrada</Th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredLeads.map((lead) => (
                    <tr
                      className="transition hover:bg-slate-50/70"
                      key={lead.lead_id}
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-800">
                          {lead.nome}
                        </p>

                        <p className="mt-1 text-xs text-slate-400">
                          {lead.email || "Sem e-mail"}
                        </p>

                        <p className="text-xs text-slate-400">
                          {lead.telefone || "Sem telefone"}
                        </p>
                      </td>

                      <td className="max-w-[260px] px-5 py-4 text-sm text-slate-600">
                        {lead.objetivo ||
                          "Não informado"}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {lead.faixa_valor ||
                          "Não informado"}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {lead.investimento_mensal ||
                          "Não informado"}
                      </td>

                      <td className="px-5 py-4">
                        {isYes(
                          lead.interesse_simulacao,
                        ) ? (
                          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                            Sim
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                            Não informado
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          {statusLabel(
                            lead.status,
                          )}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">
                        {formatDate(
                          lead.data_entrada,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
              Exibindo{" "}
              {filteredLeads.length.toLocaleString(
                "pt-BR",
              )}{" "}
              de{" "}
              {leads.length.toLocaleString(
                "pt-BR",
              )}{" "}
              leads de Consórcio.
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
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium text-slate-500">
        {label}
      </p>

      <p className="mt-3 text-3xl font-semibold text-[var(--navy)]">
        {value.toLocaleString("pt-BR")}
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