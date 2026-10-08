"use client";

import { useEffect, useMemo, useState } from "react";

import { loadClients } from "@/services/clients.service";
import type { Client360Row } from "@/types/database";

function formatDocument(value: string | null) {
  if (!value) return "Não informado";

  const digits = value.replace(/\D/g, "");

  if (digits.length === 11) {
    return digits.replace(
      /(\d{3})(\d{3})(\d{3})(\d{2})/,
      "$1.$2.$3-$4",
    );
  }

  if (digits.length === 14) {
    return digits.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5",
    );
  }

  return value;
}

function statusClasses(status: string | null) {
  const normalized = status?.toLowerCase() ?? "";

  if (normalized.includes("ativ")) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  }

  if (
    normalized.includes("valida") ||
    normalized.includes("pend") ||
    normalized.includes("análise")
  ) {
    return "bg-amber-50 text-amber-700 ring-amber-600/20";
  }

  if (normalized.includes("inativ")) {
    return "bg-slate-100 text-slate-600 ring-slate-500/20";
  }

  return "bg-slate-100 text-slate-600 ring-slate-500/20";
}

function qualityClasses(quality: string | null) {
  const normalized = quality?.toLowerCase() ?? "";

  if (
    normalized.includes("bom") ||
    normalized.includes("ok") ||
    normalized.includes("complet")
  ) {
    return "text-emerald-700";
  }

  if (
    normalized.includes("pend") ||
    normalized.includes("incomplet") ||
    normalized.includes("baixa")
  ) {
    return "text-amber-700";
  }

  return "text-slate-500";
}

export function ClientsPage() {
  const [clients, setClients] = useState<Client360Row[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchClients() {
      setLoading(true);
      setError(null);

      const result = await loadClients();

      if (!active) return;

      if (!result.ok) {
        setError(result.error.message);
        setClients([]);
      } else {
        setClients(result.data);
      }

      setLoading(false);
    }

    fetchClients();

    return () => {
      active = false;
    };
  }, []);

  const statuses = useMemo(() => {
    return Array.from(
      new Set(
        clients
          .map((client) => client.status_cliente)
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [clients]);

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return clients.filter((client) => {
      const matchesQuery =
        !normalizedQuery ||
        client.nome_preferencial?.toLowerCase().includes(normalizedQuery) ||
        client.cpf_cnpj_normalizado?.toLowerCase().includes(normalizedQuery) ||
        client.email_preferencial?.toLowerCase().includes(normalizedQuery) ||
        client.telefone_preferencial?.toLowerCase().includes(normalizedQuery);

      const matchesStatus =
        statusFilter === "todos" ||
        client.status_cliente === statusFilter;

      return matchesQuery && matchesStatus;
    });
  }, [clients, query, statusFilter]);

  const activeClients = useMemo(
    () =>
      clients.filter((client) =>
        client.status_cliente?.toLowerCase().includes("ativ"),
      ).length,
    [clients],
  );

  const conflictClients = useMemo(
    () => clients.filter((client) => client.tem_conflito).length,
    [clients],
  );

  const activeProducts = useMemo(
    () =>
      clients.reduce(
        (total, client) => total + Number(client.total_produtos_ativos ?? 0),
        0,
      ),
    [clients],
  );

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
          Comercial 360
        </p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
              Clientes
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Visão consolidada da base comercial, vínculos de produtos e
              qualidade cadastral.
            </p>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700">
            Dados sincronizados com Supabase
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Clientes cadastrados</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--navy)]">
            {clients.length.toLocaleString("pt-BR")}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Clientes ativos</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--navy)]">
            {activeClients.toLocaleString("pt-BR")}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Produtos ativos</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--navy)]">
            {activeProducts.toLocaleString("pt-BR")}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Cadastros com conflito</p>
          <p
            className={`mt-3 text-3xl font-semibold ${
              conflictClients > 0 ? "text-amber-600" : "text-[var(--navy)]"
            }`}
          >
            {conflictClients.toLocaleString("pt-BR")}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <input
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[var(--gold)] focus:bg-white focus:ring-4 focus:ring-amber-100/50"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, CPF/CNPJ, e-mail ou telefone..."
              type="search"
              value={query}
            />
          </div>

          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-600 outline-none focus:border-[var(--gold)]"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option value="todos">Todos os status</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Carregando clientes...
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="font-semibold text-rose-700">
              Não foi possível carregar os clientes.
            </p>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Nenhum cliente encontrado para os filtros informados.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Cliente
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Documento
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Contato
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Status
                    </th>
                    <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Vínculos
                    </th>
                    <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Ativos
                    </th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Qualidade
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredClients.map((client) => (
                    <tr
                      className="transition hover:bg-slate-50/70"
                      key={client.cliente_id_global}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--navy)]/5 text-xs font-bold text-[var(--navy)]">
                            {(client.nome_preferencial || "C")
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>

                          <div>
                            <p className="max-w-[280px] truncate text-sm font-semibold text-slate-800">
                              {client.nome_preferencial || "Nome não informado"}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {client.tipo_pessoa || "Tipo não informado"}
                              {client.tem_conflito ? (
                                <span className="ml-2 font-semibold text-amber-600">
                                  • conflito cadastral
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                        {formatDocument(client.cpf_cnpj_normalizado)}
                      </td>

                      <td className="px-5 py-4">
                        <p className="max-w-[250px] truncate text-sm text-slate-600">
                          {client.email_preferencial || "E-mail não informado"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {client.telefone_preferencial || "Telefone não informado"}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusClasses(
                            client.status_cliente,
                          )}`}
                        >
                          {client.status_cliente || "Não definido"}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-center text-sm font-semibold text-slate-700">
                        {Number(client.total_vinculos_produto ?? 0).toLocaleString(
                          "pt-BR",
                        )}
                      </td>

                      <td className="px-5 py-4 text-center text-sm font-semibold text-slate-700">
                        {Number(client.total_produtos_ativos ?? 0).toLocaleString(
                          "pt-BR",
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`text-xs font-semibold ${qualityClasses(
                            client.qualidade_cadastro,
                          )}`}
                        >
                          {client.qualidade_cadastro || "Não avaliado"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
              Exibindo {filteredClients.length.toLocaleString("pt-BR")} de{" "}
              {clients.length.toLocaleString("pt-BR")} clientes.
            </div>
          </>
        )}
      </section>
    </div>
  );
}
