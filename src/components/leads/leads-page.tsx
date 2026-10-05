"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createLead,
  loadLeads,
  sendLeadToCrm,
  updateLeadStatus,
} from "@/services/leads.service";
import { loadProducts } from "@/services/products.service";
import type {
  Json,
  LeadCentralRow,
  ProductSummaryRow,
} from "@/types/database";

const CRM_STATUSES = [
  "novo",
  "em_contato",
  "qualificado",
  "proposta",
  "negociacao",
  "convertido",
  "perdido",
];

function statusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function getCrmOpportunityId(
  details: Json,
): string | null {
  if (
    !details ||
    typeof details !== "object" ||
    Array.isArray(details)
  ) {
    return null;
  }

  const value = details.crm_oportunidade_id;

  return typeof value === "string" && value.trim()
    ? value
    : null;
}

export function LeadsPage() {
  const [leads, setLeads] = useState<LeadCentralRow[]>([]);
  const [products, setProducts] = useState<ProductSummaryRow[]>([]);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("todas");
  const [product, setProduct] = useState("todos");
  const [status, setStatus] = useState("todos");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] =
    useState<string | null>(null);

  const [sendingLeadId, setSendingLeadId] =
    useState<string | null>(null);

  const [crmMessage, setCrmMessage] =
    useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);

    const [leadResult, productResult] =
      await Promise.all([
        loadLeads(),
        loadProducts(),
      ]);

    setLeads(leadResult.data);
    setProducts(productResult.data);

    setError(
      leadResult.error ||
        productResult.error,
    );

    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([loadLeads(), loadProducts()]).then(([leadResult, productResult]) => {
      if (!active) return;
      setLeads(leadResult.data);
      setProducts(productResult.data);
      setError(leadResult.error || productResult.error);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          leads
            .map(
              (lead) =>
                lead.categoria_nome,
            )
            .filter(
              (
                value,
              ): value is string =>
                Boolean(value),
            ),
        ),
      ).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [leads],
  );

  const statuses = useMemo(
    () =>
      Array.from(
        new Set(
          leads
            .map((lead) => lead.status)
            .filter(
              (
                value,
              ): value is string =>
                Boolean(value),
            ),
        ),
      ).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [leads],
  );

  const filteredProducts = useMemo(() => {
    if (category === "todas") {
      return products;
    }

    return products.filter(
      (item) =>
        item.categoria_nome ===
        category,
    );
  }, [products, category]);

  const filteredLeads = useMemo(() => {
    const search =
      query.trim().toLowerCase();

    return leads.filter((lead) => {
      const matchesSearch =
        !search ||
        lead.nome
          .toLowerCase()
          .includes(search) ||
        lead.email
          ?.toLowerCase()
          .includes(search) ||
        lead.telefone
          ?.toLowerCase()
          .includes(search) ||
        lead.produto_nome
          .toLowerCase()
          .includes(search);

      const matchesCategory =
        category === "todas" ||
        lead.categoria_nome ===
          category;

      const matchesProduct =
        product === "todos" ||
        lead.produto_codigo ===
          product;

      const matchesStatus =
        status === "todos" ||
        lead.status === status;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesProduct &&
        matchesStatus
      );
    });
  }, [
    leads,
    query,
    category,
    product,
    status,
  ]);

  const converted = useMemo(
    () =>
      leads.filter(
        (lead) =>
          lead.status ===
          "convertido",
      ).length,
    [leads],
  );

  const newLeads = useMemo(
    () =>
      leads.filter(
        (lead) =>
          lead.status === "novo",
      ).length,
    [leads],
  );

  const productsWithLeads =
    useMemo(
      () =>
        new Set(
          leads.map(
            (lead) =>
              lead.produto_id,
          ),
        ).size,
      [leads],
    );

  const leadsInCrm = useMemo(
    () =>
      leads.filter((lead) =>
        Boolean(
          getCrmOpportunityId(
            lead.detalhes,
          ),
        ),
      ).length,
    [leads],
  );

  async function handleCreate(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form =
      new FormData(formElement);

    const produtoId = String(
      form.get("produto_id") ?? "",
    );

    const nome = String(
      form.get("nome") ?? "",
    );

    if (
      !produtoId ||
      !nome.trim()
    ) {
      setFormMessage(
        "Produto e nome são obrigatórios.",
      );
      return;
    }

    setSaving(true);
    setFormMessage(null);
    setError(null);

    try {
      const result =
        await createLead({
          produto_id: produtoId,
          nome,

          email: String(
            form.get("email") ?? "",
          ),

          telefone: String(
            form.get("telefone") ??
              "",
          ),

          origem: String(
            form.get("origem") ?? "",
          ),

          objetivo: String(
            form.get("objetivo") ??
              "",
          ),

          faixa_valor: String(
            form.get("faixa_valor") ??
              "",
          ),

          investimento_mensal:
            String(
              form.get(
                "investimento_mensal",
              ) ?? "",
            ),

          interesse_simulacao:
            String(
              form.get(
                "interesse_simulacao",
              ) ?? "",
            ),
        });

      if (!result.ok) {
        setFormMessage(
          result.error ||
            "Não foi possível criar o lead.",
        );

        return;
      }

      formElement.reset();

      setFormMessage(
        "Lead criado com sucesso.",
      );

      await refresh();

      window.setTimeout(() => {
        setShowForm(false);
        setFormMessage(null);
      }, 700);
    } catch (err) {
      setFormMessage(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao criar o lead.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(
    leadId: string,
    newStatus: string,
  ) {
    setError(null);

    const previousStatus =
      leads.find(
        (lead) =>
          lead.lead_id === leadId,
      )?.status ?? "";

    setLeads((current) =>
      current.map((lead) =>
        lead.lead_id === leadId
          ? {
              ...lead,
              status: newStatus,
            }
          : lead,
      ),
    );

    const result =
      await updateLeadStatus(
        leadId,
        newStatus,
      );

    if (!result.ok) {
      setLeads((current) =>
        current.map((lead) =>
          lead.lead_id === leadId
            ? {
                ...lead,
                status:
                  previousStatus,
              }
            : lead,
        ),
      );

      setError(
        result.error ||
          "Não foi possível atualizar o status do lead.",
      );
    }
  }

  async function handleSendToCrm(
    lead: LeadCentralRow,
  ) {
    if (
      sendingLeadId ||
      getCrmOpportunityId(
        lead.detalhes,
      )
    ) {
      return;
    }

    setSendingLeadId(
      lead.lead_id,
    );

    setCrmMessage(null);
    setError(null);

    try {
      const result =
        await sendLeadToCrm(
          lead.lead_id,
        );

      if (!result.ok) {
        setCrmMessage(
          `Não foi possível enviar ${lead.nome} ao CRM: ${
            result.error ||
            "erro não identificado"
          }`,
        );

        return;
      }

      setCrmMessage(
        `${lead.nome} foi enviado ao CRM com sucesso.`,
      );

      await refresh();
    } catch (err) {
      setCrmMessage(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao enviar o lead para o CRM.",
      );
    } finally {
      setSendingLeadId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
            Comercial 360
          </p>

          <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
            Leads
          </h1>
          <a href="/contato" className="text-sm underline">Abrir formulário simples de entrada</a>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Central multproduto para
            captação, qualificação e
            acompanhamento das
            oportunidades comerciais.
          </p>
        </div>

        <button
          className="rounded-xl bg-[var(--navy)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
          onClick={() => {
            setShowForm(
              (value) => !value,
            );

            setFormMessage(null);
          }}
          type="button"
        >
          {showForm
            ? "Fechar formulário"
            : "+ Novo lead"}
        </button>
      </section>

      {crmMessage ? (
        <section className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-medium text-emerald-800">
            {crmMessage}
          </p>

          <button
            className="shrink-0 text-xs font-semibold text-emerald-700"
            onClick={() =>
              setCrmMessage(null)
            }
            type="button"
          >
            Fechar
          </button>
        </section>
      ) : null}

      {showForm ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-[var(--navy)]">
              Novo lead
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Cadastre uma nova
              oportunidade diretamente
              no Comercial 360.
            </p>
          </div>

          <form
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            onSubmit={handleCreate}
          >
            <Field label="Produto">
              <select
                className="input"
                name="produto_id"
                required
              >
                <option value="">
                  Selecione...
                </option>

                {products.map(
                  (item) => (
                    <option
                      key={
                        item.produto_id
                      }
                      value={
                        item.produto_id
                      }
                    >
                      {
                        item.categoria_nome
                      }{" "}
                      —{" "}
                      {
                        item.produto_nome
                      }
                    </option>
                  ),
                )}
              </select>
            </Field>

            <Field label="Nome">
              <input
                className="input"
                name="nome"
                required
              />
            </Field>

            <Field label="E-mail">
              <input
                className="input"
                name="email"
                type="email"
              />
            </Field>

            <Field label="Telefone">
              <input
                className="input"
                name="telefone"
              />
            </Field>

            <Field label="Origem">
              <input
                className="input"
                defaultValue="CRM Comercial 360"
                name="origem"
              />
            </Field>

            <Field label="Objetivo">
              <input
                className="input"
                name="objetivo"
              />
            </Field>

            <Field label="Faixa de valor">
              <input
                className="input"
                name="faixa_valor"
              />
            </Field>

            <Field label="Investimento mensal">
              <input
                className="input"
                name="investimento_mensal"
              />
            </Field>

            <Field label="Interesse em simulação">
              <select
                className="input"
                name="interesse_simulacao"
              >
                <option value="">
                  Não informado
                </option>

                <option value="sim">
                  Sim
                </option>

                <option value="nao">
                  Não
                </option>
              </select>
            </Field>

            <div className="flex items-center gap-4 pt-2 md:col-span-2 xl:col-span-3">
              <button
                className="rounded-xl bg-[var(--gold)] px-5 py-3 text-sm font-bold text-[var(--navy)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? "Salvando..."
                  : "Criar lead"}
              </button>

              {formMessage ? (
                <span className="text-sm text-slate-600">
                  {formMessage}
                </span>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Leads totais"
          value={leads.length}
        />

        <Metric
          label="Novos"
          value={newLeads}
        />

        <Metric
          label="Convertidos"
          value={converted}
        />

        <Metric
          label="Produtos com leads"
          value={productsWithLeads}
        />

        <Metric
          label="No CRM"
          value={leadsInCrm}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-2 xl:grid-cols-4">
          <input
            className="input"
            onChange={(event) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="Buscar nome, e-mail, telefone ou produto..."
            type="search"
            value={query}
          />

          <select
            className="input"
            onChange={(event) => {
              setCategory(
                event.target.value,
              );

              setProduct("todos");
            }}
            value={category}
          >
            <option value="todas">
              Todas as categorias
            </option>

            {categories.map(
              (item) => (
                <option
                  key={item}
                  value={item}
                >
                  {item}
                </option>
              ),
            )}
          </select>

          <select
            className="input"
            onChange={(event) =>
              setProduct(
                event.target.value,
              )
            }
            value={product}
          >
            <option value="todos">
              Todos os produtos
            </option>

            {filteredProducts.map(
              (item) => (
                <option
                  key={
                    item.produto_id
                  }
                  value={
                    item.produto_codigo
                  }
                >
                  {
                    item.produto_nome
                  }
                </option>
              ),
            )}
          </select>

          <select
            className="input"
            onChange={(event) =>
              setStatus(
                event.target.value,
              )
            }
            value={status}
          >
            <option value="todos">
              Todos os status
            </option>

            {statuses.map(
              (item) => (
                <option
                  key={item}
                  value={item}
                >
                  {statusLabel(
                    item,
                  )}
                </option>
              ),
            )}
          </select>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Carregando leads...
          </div>
        ) : error ? (
          <div className="p-10 text-center">
            <p className="font-semibold text-rose-700">
              Não foi possível carregar
              os leads.
            </p>

            <p className="mt-2 text-sm text-slate-500">
              {error}
            </p>
          </div>
        ) : filteredLeads.length ===
          0 ? (
          <div className="p-10 text-center">
            <p className="font-semibold text-slate-700">
              Nenhum lead encontrado.
            </p>

            <p className="mt-2 text-sm text-slate-500">
              Ajuste os filtros ou
              cadastre uma nova
              oportunidade.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50/80">
                  <tr>
                    <Th>Lead</Th>
                    <Th>Produto</Th>
                    <Th>Origem</Th>
                    <Th>Entrada</Th>
                    <Th>Status</Th>
                    <Th>Objetivo</Th>
                    <Th>CRM</Th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {filteredLeads.map(
                    (lead) => {
                      const opportunityId =
                        getCrmOpportunityId(
                          lead.detalhes,
                        );

                      const isSending =
                        sendingLeadId ===
                        lead.lead_id;

                      return (
                        <tr
                          className="transition hover:bg-slate-50/70"
                          key={
                            lead.lead_id
                          }
                        >
                          <td className="px-5 py-4">
                            <p className="font-semibold text-slate-800">
                              {
                                lead.nome
                              }
                            </p>

                            <p className="mt-1 text-xs text-slate-400">
                              {lead.email ||
                                "Sem e-mail"}
                            </p>

                            <p className="text-xs text-slate-400">
                              {lead.telefone ||
                                "Sem telefone"}
                            </p>
                          </td>

                          <td className="px-5 py-4">
                            <p className="text-sm font-medium text-slate-700">
                              {
                                lead.produto_nome
                              }
                            </p>

                            <p className="mt-1 text-xs text-slate-400">
                              {
                                lead.categoria_nome
                              }
                            </p>
                          </td>

                          <td className="px-5 py-4 text-sm text-slate-600">
                            {lead.origem ||
                              lead.origem_tipo}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                            {formatDate(
                              lead.data_entrada,
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <select
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none"
                              onChange={(
                                event,
                              ) =>
                                void handleStatusChange(
                                  lead.lead_id,
                                  event
                                    .target
                                    .value,
                                )
                              }
                              value={
                                lead.status
                              }
                            >
                              {Array.from(
                                new Set([
                                  ...CRM_STATUSES,
                                  lead.status,
                                ]),
                              ).map(
                                (item) => (
                                  <option
                                    key={
                                      item
                                    }
                                    value={
                                      item
                                    }
                                  >
                                    {statusLabel(
                                      item,
                                    )}
                                  </option>
                                ),
                              )}
                            </select>
                          </td>

                          <td className="max-w-[260px] px-5 py-4 text-sm text-slate-600">
                            {lead.objetivo ||
                              "Não informado"}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4">
                            {opportunityId ? (
                              <div>
                                <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                                  No CRM
                                </span>

                                <p
                                  className="mt-1 max-w-[130px] truncate font-mono text-[9px] text-slate-400"
                                  title={
                                    opportunityId
                                  }
                                >
                                  {
                                    opportunityId
                                  }
                                </p>
                              </div>
                            ) : (
                              <button
                                className="rounded-lg bg-[var(--navy)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={
                                  Boolean(
                                    sendingLeadId,
                                  )
                                }
                                onClick={() =>
                                  void handleSendToCrm(
                                    lead,
                                  )
                                }
                                type="button"
                              >
                                {isSending
                                  ? "Enviando..."
                                  : "Enviar para CRM"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    },
                  )}
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
              leads.
            </div>
          </>
        )}
      </section>

      <style jsx>{`
        .input {
          width: 100%;
          height: 44px;
          border: 1px solid
            rgb(226 232 240);
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
        {value.toLocaleString(
          "pt-BR",
        )}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-slate-600">
        {label}
      </span>

      {children}
    </label>
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
