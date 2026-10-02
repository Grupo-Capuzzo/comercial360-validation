"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  completeCrmTask,
  createCrmTask,
  loadCrm,
  moveOpportunity,
  updateOpportunity,
} from "@/services/crm.service";

import type {
  CrmOpportunityRow,
  CrmPipelineRow,
  CrmTaskRow,
} from "@/types/database";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatCurrency(value: number | null | undefined) {
  return currencyFormatter.format(value ?? 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Não informado";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Não informado";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${value}T12:00:00`));
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";

  const date = new Date(value);

  const pad = (number: number) =>
    String(number).padStart(2, "0");

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function CrmPage() {
  const [pipeline, setPipeline] = useState<CrmPipelineRow[]>([]);
  const [opportunities, setOpportunities] = useState<
    CrmOpportunityRow[]
  >([]);
  const [tasks, setTasks] = useState<CrmTaskRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [movingOpportunityId, setMovingOpportunityId] =
    useState<string | null>(null);

  const [savingOpportunityId, setSavingOpportunityId] =
    useState<string | null>(null);

  const [creatingTaskOpportunityId, setCreatingTaskOpportunityId] =
    useState<string | null>(null);

  const [completingTaskId, setCompletingTaskId] =
    useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("todos");
  const [responsible, setResponsible] = useState("todos");

  const refresh = useCallback(async () => {
    const result = await loadCrm();

    if (!result.ok) {
      setError(
        `${result.error.source}: ${result.error.message}`,
      );

      return false;
    }

    setPipeline(result.data.pipeline);
    setOpportunities(result.data.opportunities);
    setTasks(result.data.tasks);

    return true;
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);
      setError(null);

      const result = await loadCrm();

      if (!active) return;

      if (!result.ok) {
        setError(
          `${result.error.source}: ${result.error.message}`,
        );

        setPipeline([]);
        setOpportunities([]);
        setTasks([]);
      } else {
        setPipeline(result.data.pipeline);
        setOpportunities(result.data.opportunities);
        setTasks(result.data.tasks);
      }

      setLoading(false);
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  const products = useMemo(
    () =>
      Array.from(
        new Map(
          opportunities
            .filter(
              (item) =>
                item.produto_codigo &&
                item.produto_nome,
            )
            .map((item) => [
              item.produto_codigo as string,
              item.produto_nome as string,
            ]),
        ),
      ).sort((a, b) =>
        a[1].localeCompare(b[1], "pt-BR"),
      ),
    [opportunities],
  );

  const responsibles = useMemo(
    () =>
      Array.from(
        new Set(
          opportunities
            .map((item) => item.responsavel_nome)
            .filter(
              (value): value is string =>
                Boolean(value),
            ),
        ),
      ).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [opportunities],
  );

  const filteredOpportunities = useMemo(() => {
    const search = query.trim().toLowerCase();

    return opportunities.filter((item) => {
      const name =
        item.nome_cliente ||
        item.nome_prospect ||
        "";

      const matchesSearch =
        !search ||
        name.toLowerCase().includes(search) ||
        item.titulo.toLowerCase().includes(search) ||
        item.produto_nome
          ?.toLowerCase()
          .includes(search) ||
        item.responsavel_nome
          ?.toLowerCase()
          .includes(search);

      const matchesProduct =
        product === "todos" ||
        item.produto_codigo === product;

      const matchesResponsible =
        responsible === "todos" ||
        item.responsavel_nome === responsible;

      return (
        matchesSearch &&
        matchesProduct &&
        matchesResponsible
      );
    });
  }, [
    opportunities,
    query,
    product,
    responsible,
  ]);

  const totalPotential = useMemo(
    () =>
      opportunities.reduce(
        (total, item) =>
          total +
          Number(item.valor_potencial ?? 0),
        0,
      ),
    [opportunities],
  );

  const weightedPotential = useMemo(
    () =>
      opportunities.reduce(
        (total, item) => {
          const value = Number(
            item.valor_potencial ?? 0,
          );

          const probability = Number(
            item.probabilidade ?? 0,
          );

          return total + value * (probability / 100);
        },
        0,
      ),
    [opportunities],
  );

  const openOpportunities = useMemo(
    () =>
      opportunities.filter(
        (item) =>
          item.etapa_tipo === "aberta",
      ).length,
    [opportunities],
  );

  const pendingTasks = useMemo(
    () =>
      tasks.filter(
        (item) =>
          item.status !== "concluida" &&
          item.status !== "concluído",
      ).length,
    [tasks],
  );

  async function handleMoveOpportunity(
    opportunity: CrmOpportunityRow,
    newStageCode: string,
  ) {
    if (
      movingOpportunityId ||
      newStageCode === opportunity.etapa_codigo
    ) {
      return;
    }

    const newStage = pipeline.find(
      (stage) =>
        stage.codigo === newStageCode,
    );

    if (!newStage) {
      setError(
        "Etapa de destino não encontrada.",
      );
      return;
    }

    let lossReason: string | undefined;

    if (newStage.tipo === "perdida") {
      const reason = window.prompt(
        `Informe o motivo da perda de "${opportunity.titulo}":`,
      );

      if (reason === null) {
        return;
      }

      if (!reason.trim()) {
        setError(
          "O motivo da perda é obrigatório.",
        );
        return;
      }

      lossReason = reason.trim();
    }

    const previousOpportunities =
      opportunities;

    setMovingOpportunityId(
      opportunity.oportunidade_id,
    );

    setError(null);
    setMessage(null);

    setOpportunities((current) =>
      current.map((item) =>
        item.oportunidade_id ===
        opportunity.oportunidade_id
          ? {
              ...item,
              etapa_id: newStage.etapa_id,
              etapa_codigo: newStage.codigo,
              etapa_nome: newStage.nome,
              etapa_ordem: newStage.ordem,
              etapa_tipo: newStage.tipo,
              probabilidade:
                newStage.probabilidade_padrao ?? 0,
              motivo_perda:
                newStage.tipo === "perdida"
                  ? lossReason ?? null
                  : null,
            }
          : item,
      ),
    );

    try {
      const result =
        await moveOpportunity({
          oportunidadeId:
            opportunity.oportunidade_id,
          etapaCodigo:
            newStage.codigo,
          motivoPerda:
            lossReason,
        });

      if (!result.ok) {
        setOpportunities(
          previousOpportunities,
        );

        setError(
          result.error ||
            "Não foi possível movimentar a oportunidade.",
        );

        return;
      }

      setMessage(
        `"${opportunity.titulo}" movida para ${newStage.nome}.`,
      );

      await refresh();
    } catch (err) {
      setOpportunities(
        previousOpportunities,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao movimentar a oportunidade.",
      );
    } finally {
      setMovingOpportunityId(null);
    }
  }

  async function handleUpdateOpportunity(
    opportunity: CrmOpportunityRow,
    form: FormData,
  ) {
    setSavingOpportunityId(
      opportunity.oportunidade_id,
    );

    setError(null);
    setMessage(null);

    try {
      const action = String(
        form.get("proxima_acao") ?? "",
      );

      const actionAt = String(
        form.get("proxima_acao_em") ?? "",
      );

      const closingDate = String(
        form.get("previsao_fechamento") ?? "",
      );

      const result =
        await updateOpportunity({
          oportunidadeId:
            opportunity.oportunidade_id,

          proximaAcao: action,

          proximaAcaoEm: actionAt
            ? new Date(
                actionAt,
              ).toISOString()
            : "",

          previsaoFechamento:
            closingDate,
        });

      if (!result.ok) {
        setError(
          result.error ||
            "Não foi possível atualizar a oportunidade.",
        );

        return;
      }

      setMessage(
        `Operação de "${opportunity.titulo}" atualizada.`,
      );

      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao atualizar a oportunidade.",
      );
    } finally {
      setSavingOpportunityId(null);
    }
  }

  async function handleCreateTask(
    opportunity: CrmOpportunityRow,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const formElement =
      event.currentTarget;

    const form =
      new FormData(formElement);

    const title = String(
      form.get("titulo") ?? "",
    ).trim();

    if (!title) {
      setError(
        "O título da tarefa é obrigatório.",
      );
      return;
    }

    setCreatingTaskOpportunityId(
      opportunity.oportunidade_id,
    );

    setError(null);
    setMessage(null);

    try {
      const deadline = String(
        form.get("prazo_em") ?? "",
      );

      const result =
        await createCrmTask({
          oportunidadeId:
            opportunity.oportunidade_id,

          titulo: title,

          descricao: String(
            form.get("descricao") ?? "",
          ),

          tipo: String(
            form.get("tipo") ??
              "follow_up",
          ),

          prioridade: String(
            form.get("prioridade") ??
              "normal",
          ),

          prazoEm: deadline
            ? new Date(
                deadline,
              ).toISOString()
            : undefined,
        });

      if (!result.ok) {
        setError(
          result.error ||
            "Não foi possível criar a tarefa.",
        );

        return;
      }

      formElement.reset();

      setMessage(
        `Tarefa criada para "${opportunity.titulo}".`,
      );

      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao criar a tarefa.",
      );
    } finally {
      setCreatingTaskOpportunityId(
        null,
      );
    }
  }

  async function handleCompleteTask(
    task: CrmTaskRow,
  ) {
    if (
      completingTaskId ||
      task.status === "concluida"
    ) {
      return;
    }

    setCompletingTaskId(
      task.tarefa_id,
    );

    setError(null);
    setMessage(null);

    try {
      const result =
        await completeCrmTask(
          task.tarefa_id,
        );

      if (!result.ok) {
        setError(
          result.error ||
            "Não foi possível concluir a tarefa.",
        );

        return;
      }

      setMessage(
        `Tarefa "${task.titulo}" concluída.`,
      );

      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao concluir a tarefa.",
      );
    } finally {
      setCompletingTaskId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold)]">
          Comercial 360
        </p>

        <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--navy)] sm:text-4xl">
          CRM
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Funil comercial centralizado para
          acompanhar oportunidades, valores,
          responsáveis, próximas ações e
          tarefas.
        </p>
      </section>

      {message ? (
        <section className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-sm font-medium text-emerald-800">
            {message}
          </p>

          <button
            className="text-xs font-semibold text-emerald-700"
            onClick={() =>
              setMessage(null)
            }
            type="button"
          >
            Fechar
          </button>
        </section>
      ) : null}

      {error ? (
        <section className="flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
          <p className="text-sm font-medium text-rose-700">
            {error}
          </p>

          <button
            className="text-xs font-semibold text-rose-700"
            onClick={() =>
              setError(null)
            }
            type="button"
          >
            Fechar
          </button>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Oportunidades abertas"
          value={openOpportunities.toLocaleString(
            "pt-BR",
          )}
        />

        <Metric
          label="Potencial comercial"
          value={formatCurrency(
            totalPotential,
          )}
        />

        <Metric
          label="Potencial ponderado"
          value={formatCurrency(
            weightedPotential,
          )}
        />

        <Metric
          label="Tarefas pendentes"
          value={pendingTasks.toLocaleString(
            "pt-BR",
          )}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className="input"
            onChange={(event) =>
              setQuery(
                event.target.value,
              )
            }
            placeholder="Buscar oportunidade, cliente ou responsável..."
            type="search"
            value={query}
          />

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

            {products.map(
              ([code, name]) => (
                <option
                  key={code}
                  value={code}
                >
                  {name}
                </option>
              ),
            )}
          </select>

          <select
            className="input"
            onChange={(event) =>
              setResponsible(
                event.target.value,
              )
            }
            value={responsible}
          >
            <option value="todos">
              Todos os responsáveis
            </option>

            {responsibles.map(
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
        </div>
      </section>

      {loading ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Carregando CRM...
        </section>
      ) : (
        <section className="overflow-x-auto pb-2">
          <div className="grid min-w-[1960px] grid-cols-7 gap-4">
            {pipeline.map(
              (stage) => {
                const stageOpportunities =
                  filteredOpportunities.filter(
                    (item) =>
                      item.etapa_codigo ===
                      stage.codigo,
                  );

                const stageValue =
                  stageOpportunities.reduce(
                    (total, item) =>
                      total +
                      Number(
                        item.valor_potencial ??
                          0,
                      ),
                    0,
                  );

                return (
                  <div
                    className="min-h-[520px] rounded-2xl border border-slate-200 bg-slate-100/60 p-3"
                    key={
                      stage.etapa_id
                    }
                  >
                    <div className="mb-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold text-[var(--navy)]">
                            {
                              stage.nome
                            }
                          </h2>

                          <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                            {stage.probabilidade_padrao ??
                              0}
                            % padrão
                          </p>
                        </div>

                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                          {
                            stageOpportunities.length
                          }
                        </span>
                      </div>

                      <p className="mt-3 text-xs font-semibold text-slate-600">
                        {formatCurrency(
                          stageValue,
                        )}
                      </p>
                    </div>

                    <div className="space-y-3">
                      {stageOpportunities.length ===
                      0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-5 text-center text-xs text-slate-400">
                          Sem oportunidades
                        </div>
                      ) : (
                        stageOpportunities.map(
                          (
                            opportunity,
                          ) => (
                            <OpportunityCard
                              creatingTask={
                                creatingTaskOpportunityId ===
                                opportunity.oportunidade_id
                              }
                              disabled={Boolean(
                                movingOpportunityId ||
                                  savingOpportunityId ||
                                  creatingTaskOpportunityId,
                              )}
                              key={
                                opportunity.oportunidade_id
                              }
                              moving={
                                movingOpportunityId ===
                                opportunity.oportunidade_id
                              }
                              onCreateTask={
                                handleCreateTask
                              }
                              onMove={
                                handleMoveOpportunity
                              }
                              onUpdate={
                                handleUpdateOpportunity
                              }
                              opportunity={
                                opportunity
                              }
                              pipeline={
                                pipeline
                              }
                              saving={
                                savingOpportunityId ===
                                opportunity.oportunidade_id
                              }
                            />
                          ),
                        )
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-serif text-xl font-semibold text-[var(--navy)]">
            Próximas tarefas
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Ações pendentes vinculadas à
            operação comercial.
          </p>
        </div>

        {tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Nenhuma tarefa registrada.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {tasks
              .slice(0, 20)
              .map((task) => {
                const completed =
                  task.status ===
                    "concluida" ||
                  task.status ===
                    "concluído";

                return (
                  <div
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                    key={
                      task.tarefa_id
                    }
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={`text-sm font-semibold ${
                            completed
                              ? "text-slate-400 line-through"
                              : "text-slate-800"
                          }`}
                        >
                          {
                            task.titulo
                          }
                        </p>

                        <PriorityBadge
                          priority={
                            task.prioridade
                          }
                        />
                      </div>

                      <p className="mt-1 text-xs text-slate-400">
                        {task.nome_cliente ||
                          "Oportunidade / prospect"}{" "}
                        ·{" "}
                        {task.responsavel_nome ||
                          "Usuário autenticado"}
                      </p>

                      {task.descricao ? (
                        <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                          {
                            task.descricao
                          }
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-2 sm:items-end">
                      <p className="text-xs font-semibold text-slate-600">
                        {task.prazo_em
                          ? formatDateTime(
                              task.prazo_em,
                            )
                          : "Sem prazo"}
                      </p>

                      {completed ? (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          Concluída
                        </span>
                      ) : (
                        <button
                          className="rounded-lg bg-[var(--navy)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={Boolean(
                            completingTaskId,
                          )}
                          onClick={() =>
                            void handleCompleteTask(
                              task,
                            )
                          }
                          type="button"
                        >
                          {completingTaskId ===
                          task.tarefa_id
                            ? "Concluindo..."
                            : "Concluir tarefa"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
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

function OpportunityCard({
  opportunity,
  pipeline,
  moving,
  saving,
  creatingTask,
  disabled,
  onMove,
  onUpdate,
  onCreateTask,
}: {
  opportunity: CrmOpportunityRow;
  pipeline: CrmPipelineRow[];
  moving: boolean;
  saving: boolean;
  creatingTask: boolean;
  disabled: boolean;
  onMove: (
    opportunity: CrmOpportunityRow,
    stageCode: string,
  ) => Promise<void>;
  onUpdate: (
    opportunity: CrmOpportunityRow,
    form: FormData,
  ) => Promise<void>;
  onCreateTask: (
    opportunity: CrmOpportunityRow,
    event: FormEvent<HTMLFormElement>,
  ) => Promise<void>;
}) {
  const [editing, setEditing] =
    useState(false);

  const [taskForm, setTaskForm] =
    useState(false);

  const displayName =
    opportunity.nome_cliente ||
    opportunity.nome_prospect ||
    "Prospect sem nome";

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--gold-dark)]">
        {opportunity.produto_nome ||
          "Produto não informado"}
      </p>

      <h3 className="mt-2 text-sm font-semibold leading-5 text-slate-800">
        {opportunity.titulo}
      </h3>

      <p className="mt-1 text-xs text-slate-500">
        {displayName}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[var(--navy)]">
          {formatCurrency(
            opportunity.valor_potencial,
          )}
        </span>

        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
          {opportunity.probabilidade ??
            0}
          %
        </span>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">
          Etapa do funil
        </p>

        <select
          className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none disabled:opacity-50"
          disabled={disabled}
          onChange={(event) =>
            void onMove(
              opportunity,
              event.target.value,
            )
          }
          value={
            opportunity.etapa_codigo
          }
        >
          {pipeline.map(
            (stage) => (
              <option
                key={
                  stage.etapa_id
                }
                value={
                  stage.codigo
                }
              >
                {stage.nome}
              </option>
            ),
          )}
        </select>

        {moving ? (
          <p className="mt-2 text-[10px] font-semibold text-[var(--gold-dark)]">
            Movendo oportunidade...
          </p>
        ) : null}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">
          Responsável
        </p>

        <p className="mt-1 text-xs font-medium text-slate-600">
          {opportunity.responsavel_nome ||
            "Usuário autenticado"}
        </p>
      </div>

      {opportunity.proxima_acao ? (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">
            Próxima ação
          </p>

          <p className="mt-1 text-xs leading-5 text-slate-600">
            {
              opportunity.proxima_acao
            }
          </p>

          {opportunity.proxima_acao_em ? (
            <p className="mt-1 text-[10px] text-slate-400">
              {formatDateTime(
                opportunity.proxima_acao_em,
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {opportunity.previsao_fechamento ? (
        <p className="mt-3 text-[10px] text-slate-400">
          Fechamento previsto:{" "}
          {formatDate(
            opportunity.previsao_fechamento,
          )}
        </p>
      ) : null}

      {opportunity.motivo_perda ? (
        <div className="mt-3 rounded-lg bg-rose-50 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">
            Motivo da perda
          </p>

          <p className="mt-1 text-xs text-rose-700">
            {
              opportunity.motivo_perda
            }
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
        <button
          className="rounded-lg border border-slate-200 px-2 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          onClick={() =>
            setEditing(
              (value) => !value,
            )
          }
          type="button"
        >
          {editing
            ? "Fechar edição"
            : "Editar operação"}
        </button>

        <button
          className="rounded-lg bg-[var(--gold)] px-2 py-2 text-[11px] font-bold text-[var(--navy)]"
          onClick={() =>
            setTaskForm(
              (value) => !value,
            )
          }
          type="button"
        >
          {taskForm
            ? "Fechar tarefa"
            : "+ Tarefa"}
        </button>
      </div>

      {editing ? (
        <form
          className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();

            void onUpdate(
              opportunity,
              new FormData(
                event.currentTarget,
              ),
            );
          }}
        >
          <CardField label="Próxima ação">
            <textarea
              className="card-input min-h-[72px] resize-y py-2"
              defaultValue={
                opportunity.proxima_acao ??
                ""
              }
              name="proxima_acao"
              placeholder="Ex.: ligar para apresentar proposta"
            />
          </CardField>

          <CardField label="Data/hora da próxima ação">
            <input
              className="card-input"
              defaultValue={toDateTimeLocal(
                opportunity.proxima_acao_em,
              )}
              name="proxima_acao_em"
              type="datetime-local"
            />
          </CardField>

          <CardField label="Previsão de fechamento">
            <input
              className="card-input"
              defaultValue={
                opportunity.previsao_fechamento ??
                ""
              }
              name="previsao_fechamento"
              type="date"
            />
          </CardField>

          <button
            className="w-full rounded-lg bg-[var(--navy)] px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            disabled={saving}
            type="submit"
          >
            {saving
              ? "Salvando..."
              : "Salvar operação"}
          </button>
        </form>
      ) : null}

      {taskForm ? (
        <form
          className="mt-3 space-y-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3"
          onSubmit={(event) =>
            void onCreateTask(
              opportunity,
              event,
            )
          }
        >
          <CardField label="Título da tarefa">
            <input
              className="card-input"
              name="titulo"
              placeholder="Ex.: Fazer follow-up"
              required
            />
          </CardField>

          <CardField label="Descrição">
            <textarea
              className="card-input min-h-[64px] resize-y py-2"
              name="descricao"
            />
          </CardField>

          <div className="grid grid-cols-2 gap-2">
            <CardField label="Tipo">
              <select
                className="card-input"
                defaultValue="follow_up"
                name="tipo"
              >
                <option value="follow_up">
                  Follow-up
                </option>
                <option value="ligacao">
                  Ligação
                </option>
                <option value="reuniao">
                  Reunião
                </option>
                <option value="proposta">
                  Proposta
                </option>
                <option value="outro">
                  Outro
                </option>
              </select>
            </CardField>

            <CardField label="Prioridade">
              <select
                className="card-input"
                defaultValue="normal"
                name="prioridade"
              >
                <option value="baixa">
                  Baixa
                </option>
                <option value="normal">
                  Normal
                </option>
                <option value="alta">
                  Alta
                </option>
                <option value="urgente">
                  Urgente
                </option>
              </select>
            </CardField>
          </div>

          <CardField label="Prazo">
            <input
              className="card-input"
              name="prazo_em"
              type="datetime-local"
            />
          </CardField>

          <p className="text-[10px] leading-4 text-slate-500">
            Responsável padrão: usuário
            autenticado no Comercial 360.
          </p>

          <button
            className="w-full rounded-lg bg-[var(--gold)] px-3 py-2.5 text-xs font-bold text-[var(--navy)] disabled:opacity-50"
            disabled={creatingTask}
            type="submit"
          >
            {creatingTask
              ? "Criando..."
              : "Criar tarefa"}
          </button>
        </form>
      ) : null}

      <style jsx>{`
        .card-input {
          width: 100%;
          min-height: 36px;
          border: 1px solid
            rgb(226 232 240);
          border-radius: 0.5rem;
          background: white;
          padding-left: 0.6rem;
          padding-right: 0.6rem;
          font-size: 0.75rem;
          color: rgb(71 85 105);
          outline: none;
        }

        .card-input:focus {
          border-color: var(--gold);
        }
      `}</style>
    </article>
  );
}

function CardField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>

      {children}
    </label>
  );
}

function PriorityBadge({
  priority,
}: {
  priority: string | null;
}) {
  if (!priority) {
    return null;
  }

  const normalized =
    priority.toLowerCase();

  const className =
    normalized === "urgente"
      ? "bg-rose-50 text-rose-700"
      : normalized === "alta"
        ? "bg-amber-50 text-amber-700"
        : normalized === "baixa"
          ? "bg-slate-100 text-slate-500"
          : "bg-blue-50 text-blue-700";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${className}`}
    >
      {priority}
    </span>
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