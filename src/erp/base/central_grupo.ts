/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * central_grupo.ts — Central de Operações do Grupo Capuzzo (porte de app/central_grupo.py).
 *
 * Só acrescenta rotas sob /central: a página do Plano de ação (HTML puro, sem
 * Jinja) e a API JSON usada por ela. Usa apenas as próprias tabelas
 * (central_tarefas, central_etapas e central_subetapas), que já existem no schema erp
 * — a criação/migração das tabelas do original foi omitida.
 *
 * A página vem de public/login-grupo/static/central.html, embutida em
 * central_html.gen.ts por tools/erp/gerar_central.mjs (não lê o disco em execução).
 */
import { PyDate, Resposta, getConnection, jsonify, pyRound, request, route } from "../core/flask";
import { CENTRAL_HTML } from "./central_html.gen";

// ═════════════════════════════════════════════════════════════════
//  EMPRESAS DO GRUPO
//  Para ativar uma empresa, troque "status" para "ativa" e acrescente
//  os módulos dela em "modulos". Cada módulo tem um "destino":
//     rota interna do app (ex.: "/") ou uma tela da própria central.
// ═════════════════════════════════════════════════════════════════
export const EMPRESAS: any[] = [
  {
    id: "capuzzo-assessoria",
    nome: "Capuzzo Assessoria",
    sigla: "CA",
    cor: "var(--c-assessoria)",
    ramo: "Assessoria e consultoria",
    status: "ativa",
    modulos: [
      {
        id: "condominios",
        nome: "Condomínios de Investimento",
        status: "ativo",
        desc: "Clientes, cotas, apuração, vencimentos e títulos privados.",
        destino: "/",
      },
    ],
  },
  { id: "capuzzo-cred", nome: "Capuzzo Cred", sigla: "CC", cor: "var(--c-cred)", ramo: "Crédito e operações financeiras", status: "dev", modulos: [] },
  { id: "terceiriza-facil", nome: "Terceiriza Fácil", sigla: "TF", cor: "var(--c-terceiriza)", ramo: "Terceirização de serviços", status: "dev", modulos: [] },
  { id: "hortstufas", nome: "Hortstufas", sigla: "HS", cor: "var(--c-hort)", ramo: "Estufas e produção agrícola", status: "dev", modulos: [] },
  { id: "health-club", nome: "Health Club", sigla: "HC", cor: "var(--c-health)", ramo: "Saúde e bem-estar", status: "dev", modulos: [] },
  { id: "restaurante-grao", nome: "Restaurante Grão", sigla: "RG", cor: "var(--c-grao)", ramo: "Alimentação", status: "dev", modulos: [] },
];

// ═════════════════════════════════════════════════════════════════
//  PLANO DE AÇÃO — tabelas próprias, no mesmo banco do app
// ═════════════════════════════════════════════════════════════════
export const PRIORIDADES = ["urgente", "alta", "media", "baixa"];
export const PRIORIDADE_PADRAO = "media";

export function hoje_iso() {
  return PyDate.now().strftime("%Y-%m-%d");
}

export function normalizar_prioridade(valor: any) {
  valor = String(valor || "").trim().toLowerCase();
  return PRIORIDADES.includes(valor) ? valor : PRIORIDADE_PADRAO;
}

/** int() do Python para números e textos numéricos (lança erro como o Python se inválido). */
function pyInt(v: any): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim();
  if (!/^[-+]?\d+$/.test(s)) throw new Error(`invalid literal for int(): '${v}'`);
  return parseInt(s, 10);
}

/**
 * Percentual da etapa.
 * Com subetapas, quem manda é o check: percentual = concluídas / total.
 * Sem subetapas, vale o percentual informado à mão na régua.
 */
export function percentual_etapa(etapa: any): number {
  const subs = etapa.subetapas || [];
  if (!subs.length) return pyInt(etapa.percentual || 0);
  const feitas = subs.filter((s: any) => s.feito).length;
  return Math.trunc(pyRound((feitas * 100.0) / subs.length));
}

export async function listar_tarefas() {
  const conn = await getConnection();
  try {
    const tarefas: any[] = [];
    for (const l of (await conn.execute(
      "SELECT id, titulo, responsavel, prazo_total, status, descricao, " +
      "criado_em, prioridade FROM central_tarefas ORDER BY criado_em, id")).fetchall()) {
      tarefas.push({
        id: l.id,
        titulo: l.titulo,
        responsavel: l.responsavel,
        prazoTotal: l.prazo_total,
        status: l.status,
        descricao: l.descricao,
        criadoEm: l.criado_em,
        prioridade: normalizar_prioridade(l.prioridade),
        etapas: [],
      });
    }
    const indice = new Map(tarefas.map((t) => [t.id, t]));
    const etapas_por_id = new Map<string, any>();
    for (const l of (await conn.execute(
      "SELECT id, tarefa_id, nome, responsavel, prazo, percentual, observacoes, motivo " +
      "FROM central_etapas ORDER BY tarefa_id, ordem, id")).fetchall()) {
      const dono = indice.get(l.tarefa_id);
      if (dono === undefined) continue;
      const etapa = {
        id: l.id,
        nome: l.nome,
        responsavel: l.responsavel,
        prazo: l.prazo,
        percentual: l.percentual,
        observacoes: l.observacoes,
        motivo: l.motivo || "",
        subetapas: [] as any[],
      };
      etapas_por_id.set(etapa.id, etapa);
      dono.etapas.push(etapa);
    }

    for (const l of (await conn.execute(
      "SELECT id, etapa_id, nome, feito, prazo, concluido_em, motivo " +
      "FROM central_subetapas ORDER BY etapa_id, ordem, id")).fetchall()) {
      const etapa = etapas_por_id.get(l.etapa_id);
      if (etapa === undefined) continue;
      etapa.subetapas.push({
        id: l.id,
        nome: l.nome,
        feito: !!l.feito,
        prazo: l.prazo || "",
        concluidoEm: l.concluido_em || "",
        motivo: l.motivo || "",
      });
    }

    // O percentual entregue à tela já vem calculado pelo check.
    for (const etapa of etapas_por_id.values()) etapa.percentual = percentual_etapa(etapa);

    return tarefas;
  } finally {
    await conn.close();
  }
}

/** dict.get(k, padrão) do Python: só usa o padrão se a chave não existir. */
function pegar(d: any, k: string, padrao: any) {
  return d && Object.prototype.hasOwnProperty.call(d, k) ? d[k] : padrao;
}

export async function salvar_tarefa(dados: any) {
  const agora = PyDate.now().isoformat("T");
  const conn = await getConnection();
  try {
    await conn.execute(
      `INSERT INTO central_tarefas
           (id, titulo, responsavel, prazo_total, status, prioridade,
            descricao, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
           titulo=excluded.titulo,
           responsavel=excluded.responsavel,
           prazo_total=excluded.prazo_total,
           status=excluded.status,
           prioridade=excluded.prioridade,
           descricao=excluded.descricao,
           atualizado_em=excluded.atualizado_em`,
      [
        dados.id,
        pegar(dados, "titulo", ""),
        pegar(dados, "responsavel", ""),
        pegar(dados, "prazoTotal", ""),
        pegar(dados, "status", "todo"),
        normalizar_prioridade(dados.prioridade),
        pegar(dados, "descricao", ""),
        dados.criadoEm || agora,
        agora,
      ],
    );
    await conn.execute(
      "DELETE FROM central_subetapas WHERE etapa_id IN " +
      "(SELECT id FROM central_etapas WHERE tarefa_id = ?)", [dados.id]);
    await conn.execute("DELETE FROM central_etapas WHERE tarefa_id = ?", [dados.id]);
    for (const [ordem, etapa] of (dados.etapas || []).entries()) {
      // INSERT OR REPLACE do original (evita quebrar a gravação se um id de etapa
      // repetir — duplicação de tarefa, importação) → ON CONFLICT DO UPDATE.
      await conn.execute(
        `INSERT INTO central_etapas
             (id, tarefa_id, ordem, nome, responsavel, prazo,
              percentual, observacoes, motivo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET tarefa_id=excluded.tarefa_id, ordem=excluded.ordem, nome=excluded.nome,
             responsavel=excluded.responsavel, prazo=excluded.prazo, percentual=excluded.percentual,
             observacoes=excluded.observacoes, motivo=excluded.motivo`,
        [
          etapa.id,
          dados.id,
          ordem,
          pegar(etapa, "nome", ""),
          pegar(etapa, "responsavel", ""),
          pegar(etapa, "prazo", ""),
          percentual_etapa(etapa),
          pegar(etapa, "observacoes", ""),
          pegar(etapa, "motivo", "") || "",
        ],
      );
      for (const [ordem_sub, sub] of (etapa.subetapas || []).entries()) {
        const feito = sub.feito ? 1 : 0;
        // Carimba a data ao concluir e limpa ao desmarcar, para o
        // cronograma saber o que foi entregue e quando.
        let concluido = sub.concluidoEm || "";
        if (feito && !concluido) concluido = hoje_iso();
        if (!feito) concluido = "";
        await conn.execute(
          `INSERT INTO central_subetapas
               (id, etapa_id, ordem, nome, feito, prazo, concluido_em, motivo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET etapa_id=excluded.etapa_id, ordem=excluded.ordem, nome=excluded.nome,
               feito=excluded.feito, prazo=excluded.prazo, concluido_em=excluded.concluido_em, motivo=excluded.motivo`,
          [
            sub.id,
            etapa.id,
            ordem_sub,
            pegar(sub, "nome", ""),
            feito,
            pegar(sub, "prazo", "") || "",
            concluido,
            pegar(sub, "motivo", "") || "",
          ],
        );
      }
    }
    await conn.commit();
  } finally {
    await conn.close();
  }
}

export async function excluir_tarefa(tarefa_id: string) {
  const conn = await getConnection();
  try {
    await conn.execute(
      "DELETE FROM central_subetapas WHERE etapa_id IN " +
      "(SELECT id FROM central_etapas WHERE tarefa_id = ?)", [tarefa_id]);
    await conn.execute("DELETE FROM central_etapas WHERE tarefa_id = ?", [tarefa_id]);
    await conn.execute("DELETE FROM central_tarefas WHERE id = ?", [tarefa_id]);
    await conn.commit();
  } finally {
    await conn.close();
  }
}

/** Execução total = média simples dos percentuais das etapas. */
export function progresso(tarefa: any) {
  const etapas = tarefa.etapas || [];
  if (!etapas.length) return tarefa.status === "done" ? 100 : 0;
  const soma = etapas.reduce((s: number, e: any) => s + percentual_etapa(e), 0);
  return Math.trunc(pyRound(soma / etapas.length));
}

export function resumo_plano(tarefas: any[]) {
  const hoje = hoje_iso();
  const total = tarefas.length;

  let etapas_total = 0, etapas_concluidas = 0;
  let subs_total = 0, subs_feitas = 0, subs_atrasadas = 0;
  let entregas_atrasadas = 0;
  for (const t of tarefas) {
    for (const e of t.etapas || []) {
      etapas_total += 1;
      const pct = percentual_etapa(e);
      if (pct >= 100) etapas_concluidas += 1;
      else if (e.prazo && e.prazo < hoje) entregas_atrasadas += 1;
      for (const sb of e.subetapas || []) {
        subs_total += 1;
        if (sb.feito) subs_feitas += 1;
        else {
          const limite = sb.prazo || e.prazo || "";
          if (limite && limite < hoje) subs_atrasadas += 1;
        }
      }
    }
  }

  return {
    etapasTotal: etapas_total,
    etapasConcluidas: etapas_concluidas,
    subtarefasTotal: subs_total,
    subtarefasFeitas: subs_feitas,
    subtarefasAtrasadas: subs_atrasadas,
    entregasAtrasadas: entregas_atrasadas,
    execucaoPorSubtarefa: subs_total ? Math.trunc(pyRound((subs_feitas * 100.0) / subs_total)) : 0,
    total,
    concluidas: tarefas.filter((t) => t.status === "done").length,
    andamento: tarefas.filter((t) => t.status === "doing" || t.status === "review").length,
    atrasadas: tarefas.filter((t) => t.prazoTotal && t.status !== "done" && t.prazoTotal < hoje).length,
    urgentes: tarefas.filter((t) => t.prioridade === "urgente" && t.status !== "done").length,
    execucaoMedia: total ? Math.trunc(pyRound(tarefas.reduce((s, t) => s + progresso(t), 0) / total)) : 0,
  };
}

/** datetime.now().strftime("%y%m%d%H%M%S%f") — com microssegundos. */
function marca_id() {
  const micro = String(Math.floor(performance.timeOrigin * 1000 + performance.now() * 1000) % 1000000).padStart(6, "0");
  return PyDate.now().strftime("%y%m%d%H%M%S") + micro;
}

// ═════════════════════════════════════════════════════════════════
//  ROTAS
// ═════════════════════════════════════════════════════════════════
/** Acrescenta as rotas da central ao app. */
export function registrar() {
  // A central é uma página única (HTML puro, sem Jinja). Assim ela não interfere nos templates.
  const _pagina = () => new Resposta(CENTRAL_HTML, 200, "text/html; charset=utf-8");

  route("central_home", "/central", ["GET"], () => _pagina());
  route("central_plano", "/central/plano", ["GET"], () => _pagina());

  route("central_api_empresas", "/central/api/empresas", ["GET"], () => jsonify({ empresas: EMPRESAS }));

  route("central_api_tarefas", "/central/api/tarefas", ["GET", "POST"], async () => {
    if (request().method === "POST") {
      // get_json(silent=True) or {}: só aceita objeto JSON (lista/valor vazio vira {})
      let dados: any = request().is_json ? request().json : null;
      if (!dados || typeof dados !== "object" || (Array.isArray(dados) && !dados.length)) dados = {};
      if (!dados.id) dados.id = "t" + marca_id();
      await salvar_tarefa(dados);
      const tarefas = await listar_tarefas();
      return jsonify({ ok: true, id: dados.id, tarefas, resumo: resumo_plano(tarefas) });
    }
    const tarefas = await listar_tarefas();
    return jsonify({ tarefas, resumo: resumo_plano(tarefas), hoje: PyDate.now().strftime("%Y-%m-%d") });
  });

  route("central_api_excluir_tarefa", "/central/api/tarefas/<tarefa_id>", ["DELETE"], async (tarefa_id: string) => {
    await excluir_tarefa(tarefa_id);
    const tarefas = await listar_tarefas();
    return jsonify({ ok: true, tarefas, resumo: resumo_plano(tarefas) });
  });
}
