/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Módulo Operação — rotina dos colaboradores dentro de cada empresa do Grupo
 * (porte de app/modulos/operacao/__init__.py).
 *
 *   • Cronômetro de jornada por empresa (barra superior das páginas da empresa),
 *     com Iniciar/Pausar. Só uma empresa fica "em andamento" por vez.
 *   • Demandas: tarefas do dia a dia (pontuais ou recorrentes: diária, semanal,
 *     mensal), com anotações, histórico, conclusão e cronômetro por tarefa.
 *   • Chamados: solicitações à empresa (no estilo Onvio), numeradas, com setor,
 *     assunto, status e histórico de movimentações.
 *
 * Rotas sob /operacao/<empresa>/... — o acesso segue as empresas liberadas para o
 * usuário no portal (admin vê tudo). Tabelas próprias com prefixo operacao_
 * (já existem no schema erp: a criação de tabelas do original foi omitida).
 *
 * Regras de visibilidade:
 *   • demandas e tempo: cada colaborador vê as suas; o administrador vê todas;
 *   • chamados: todos que têm acesso à empresa veem a fila da empresa.
 */
import {
  Markup, PyDate, abort, beforeRequest, blueprintStatic, contextProcessor, flash, g, jsonify, q, q1, redirect,
  render_template, request, route, run, ultimoDiaMes, url_for, pyPercent,
} from "../../core/flask";
import * as portal from "../portal";
import { ICONES_OPERACAO } from "./icones";

export const SETORES = ["Financeiro", "Comercial", "Processos", "Contábil", "Jurídico"];
export const STATUS_CHAMADO: Record<string, string> = { aberto: "Em aberto", atendimento: "Em atendimento", concluido: "Concluído" };
export const STATUS_TAREFA: Record<string, string> = { aberta: "A fazer", andamento: "Em andamento", concluida: "Concluída" };
export const RECORRENCIAS: Record<string, string> = { diaria: "Diária", semanal: "Semanal", mensal: "Mensal" };
export const PRIORIDADES: Record<string, string> = { alta: "Alta", normal: "Normal", baixa: "Baixa" };

// Sem sinal de uso por este tempo, o cronômetro pausa sozinho no último uso
// (ex.: o colaborador fechou o sistema sem pausar).
export const INATIVIDADE_MIN = 30;

// ─────────────────────────── utilidades ───────────────────────────
function _agora(): PyDate {
  return PyDate.now();
}

function _iso(d: PyDate): string {
  return d.isoformat("T");
}

function _dt(s: string | null | undefined): PyDate | null {
  return s ? PyDate.fromisoformat(s) : null;
}

/** date.fromisoformat estrito (só AAAA-MM-DD): lança erro se inválida. */
function _data_iso(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid isoformat string: '${s}'`);
  return PyDate.fromisoformat(s).isoformat();
}

async function _q(sql: string, params: any[] = []): Promise<any[]> {
  return q(sql, params);
}
async function _q1(sql: string, params: any[] = []): Promise<any | null> {
  return q1(sql, params);
}
async function _exec(sql: string, params: any[] = []): Promise<number | null> {
  return (await run(sql, params)).lastrowid;
}

/** Equivale a strftime('%s', x) do SQLite (segundos desde 1970) para textos ISO. */
const SEG = (x: string) => `EXTRACT(EPOCH FROM CAST(${x} AS timestamp))`;

/** Ícone do módulo (ou do portal, se não houver aqui). */
export function oic(nome: string) {
  if (nome in ICONES_OPERACAO) {
    return Markup(`<svg class="ms" viewBox="0 0 24 24" aria-hidden="true">${ICONES_OPERACAO[nome]}</svg>`);
  }
  return portal.ic(nome);
}

export function hhmmss(seg: any) {
  const s = Math.trunc(Math.max(Number(seg || 0), 0));
  return pyPercent("%02d:%02d:%02d", [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]);
}

export function hhmm(seg: any) {
  const s = Math.trunc(Math.max(Number(seg || 0), 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (!h && !m) return s ? "< 1 min" : "0 min";
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

export function data_br(iso: any) {
  if (!iso) return "";
  const p = String(iso).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

export function data_hora_br(iso: any) {
  if (!iso) return "";
  return `${data_br(iso)} ${String(iso).slice(11, 16)}`;
}

export function numero_chamado(n: any) {
  return String(Math.trunc(Number(n))).padStart(6, "0");
}

function _usuario(): any {
  const u = g().portal_user;
  if (!u) abort(403);
  return u;
}

/** Mesma regra do portal: empresa existe, usuário tem acesso e não está inativa. */
async function _empresa(slug: string) {
  const base = portal.EMPRESAS_POR_SLUG[slug];
  if (!base) abort(404);
  const u = _usuario();
  if (!(await portal.pode_ver(u, slug))) abort(403);
  const e = (await portal.empresas_com_status()).find((x: any) => x.slug === slug)!;
  if (e.status === "inativo" && !u.admin) abort(403);
  return e;
}

function _checar_csrf() {
  portal.checar_csrf();
}

/** Colaboradores que podem receber demandas da empresa (ativos). */
export async function usuarios_da_empresa(slug: string) {
  return _q(
    "SELECT id, nome FROM portal_usuarios WHERE ativo = 1 AND (perfil = 'admin' OR id IN " +
    "(SELECT usuario_id FROM portal_usuario_empresas WHERE empresa_slug = ?)) ORDER BY nome", [slug]);
}

export async function nomes_usuarios(): Promise<Map<number, string>> {
  return new Map((await _q("SELECT id, nome FROM portal_usuarios")).map((r) => [r.id, r.nome]));
}

// ─────────────────────────── cronômetros ───────────────────────────
/**
 * Pausa cronômetros sem sinal de uso há mais de INATIVIDADE_MIN minutos.
 * O fim registrado é o último momento de uso, não a hora de agora — assim o
 * tempo não cresce sozinho quando o colaborador fecha o sistema sem pausar.
 */
export async function fechar_abandonados(uid: number) {
  const limite = _iso(_agora().addSeconds(-INATIVIDADE_MIN * 60));
  for (const j of await _q("SELECT id, ultimo_sinal FROM operacao_jornada WHERE usuario_id = ? AND fim IS NULL " +
    "AND ultimo_sinal < ?", [uid, limite])) {
    await _exec("UPDATE operacao_jornada SET fim = CASE WHEN inicio > ? THEN inicio ELSE ? END WHERE id = ?",
      [j.ultimo_sinal, j.ultimo_sinal, j.id]);
    await _exec("UPDATE operacao_tarefa_tempo SET fim = CASE WHEN inicio > ? THEN inicio ELSE ? END " +
      "WHERE usuario_id = ? AND fim IS NULL", [j.ultimo_sinal, j.ultimo_sinal, uid]);
  }
}

export async function jornada_ativa(uid: number) {
  return _q1("SELECT * FROM operacao_jornada WHERE usuario_id = ? AND fim IS NULL " +
    "ORDER BY id DESC LIMIT 1", [uid]);
}

export async function sinal(uid: number) {
  await _exec("UPDATE operacao_jornada SET ultimo_sinal = ? WHERE usuario_id = ? AND fim IS NULL",
    [_iso(_agora()), uid]);
}

/** Tempo na empresa no dia (padrão: hoje), contando o intervalo em andamento. */
export async function segundos_jornada(uid: number, slug: string, dia?: PyDate | null) {
  dia = dia ?? PyDate.today();
  const ini_dia = new PyDate(dia.year, dia.month, dia.day, 0, 0, 0, true);
  const fim_dia = ini_dia.addDays(1);
  const agora = _agora();
  let total = 0;
  for (const r of await _q("SELECT inicio, fim FROM operacao_jornada WHERE usuario_id = ? AND empresa_slug = ? " +
    "AND inicio < ? AND (fim IS NULL OR fim > ?)", [uid, slug, _iso(fim_dia), _iso(ini_dia)])) {
    const ini = _dt(r.inicio)!;
    const a = ini.compare(ini_dia) > 0 ? ini : ini_dia;
    const fim = r.fim ? _dt(r.fim)! : agora;
    const b = fim.compare(fim_dia) < 0 ? fim : fim_dia;
    total += Math.max(b.diffSeconds(a), 0);
  }
  return Math.trunc(total);
}

export async function tarefa_em_andamento(uid: number) {
  return _q1("SELECT tt.*, t.titulo, t.empresa_slug FROM operacao_tarefa_tempo tt " +
    "JOIN operacao_tarefas t ON t.id = tt.tarefa_id " +
    "WHERE tt.usuario_id = ? AND tt.fim IS NULL ORDER BY tt.id DESC LIMIT 1", [uid]);
}

export async function parar_tarefa(uid: number) {
  const agora = _iso(_agora());
  await _exec("UPDATE operacao_tarefa_tempo SET fim = ? WHERE usuario_id = ? AND fim IS NULL", [agora, uid]);
}

export async function iniciar_jornada(uid: number, slug: string) {
  const ativa = await jornada_ativa(uid);
  if (ativa && ativa.empresa_slug === slug) return;
  const agora = _iso(_agora());
  if (ativa) { // muda de empresa: encerra a anterior e a tarefa que corria nela
    await _exec("UPDATE operacao_jornada SET fim = ? WHERE id = ?", [agora, ativa.id]);
    await parar_tarefa(uid);
  }
  await _exec("INSERT INTO operacao_jornada (usuario_id, empresa_slug, inicio, ultimo_sinal) VALUES (?, ?, ?, ?)",
    [uid, slug, agora, agora]);
}

export async function pausar_jornada(uid: number) {
  const agora = _iso(_agora());
  await _exec("UPDATE operacao_jornada SET fim = ? WHERE usuario_id = ? AND fim IS NULL", [agora, uid]);
  await parar_tarefa(uid);
}

export async function iniciar_tarefa(uid: number, tarefa: any) {
  await parar_tarefa(uid);
  await iniciar_jornada(uid, tarefa.empresa_slug);
  await _exec("INSERT INTO operacao_tarefa_tempo (tarefa_id, usuario_id, inicio) VALUES (?, ?, ?)",
    [tarefa.id, uid, _iso(_agora())]);
  if (tarefa.status === "aberta") {
    await _exec("UPDATE operacao_tarefas SET status = 'andamento', atualizado_em = ? WHERE id = ?",
      [_iso(_agora()), tarefa.id]);
  }
}

export async function segundos_por_tarefa(ids: number[]): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const agora = _iso(_agora());
  const marcas = ids.map(() => "?").join(",");
  const linhas = await _q(`SELECT tarefa_id, CAST(SUM(${SEG("COALESCE(fim, ?)")} - ${SEG("inicio")}) AS bigint) AS s ` +
    `FROM operacao_tarefa_tempo WHERE tarefa_id IN (${marcas}) GROUP BY tarefa_id`, [agora, ...ids]);
  return new Map(linhas.map((r) => [r.tarefa_id, Math.trunc(Number(r.s || 0))]));
}

export async function estado_cronometro(uid: number, slug: string) {
  await fechar_abandonados(uid);
  const ativa = await jornada_ativa(uid);
  const tarefa = await tarefa_em_andamento(uid);
  const nesta = !!(tarefa && tarefa.empresa_slug === slug);
  return {
    rodando: !!(ativa && ativa.empresa_slug === slug),
    outra_empresa: ativa && ativa.empresa_slug !== slug ? (portal.EMPRESAS_POR_SLUG[ativa.empresa_slug]?.nome ?? null) : null,
    segundos_hoje: await segundos_jornada(uid, slug),
    tarefa: nesta ? { id: tarefa!.tarefa_id, titulo: tarefa!.titulo } : null,
    tarefa_segundos: nesta ? ((await segundos_por_tarefa([tarefa!.tarefa_id])).get(tarefa!.tarefa_id) ?? 0) : 0,
  };
}

// ─────────────────────────── demandas ───────────────────────────
export function proximo_vencimento(venc: string, recorrencia: string) {
  const base = venc ? PyDate.fromisoformat(venc) : PyDate.today();
  if (recorrencia === "diaria") {
    let d = base.addDays(1);
    while (d.weekday() >= 5) d = d.addDays(1); // pula sábado e domingo
    return d.isoformat();
  }
  if (recorrencia === "semanal") return base.addDays(7).isoformat();
  if (recorrencia === "mensal") {
    const [ano, mes] = base.month === 12 ? [base.year + 1, 1] : [base.year, base.month + 1];
    const dia = Math.min(base.day, ultimoDiaMes(ano, mes));
    return new PyDate(ano, mes, dia).isoformat();
  }
  return "";
}

export async function nota(tarefa_id: number, uid: number, texto: string, tipo = "nota") {
  await _exec("INSERT INTO operacao_tarefa_notas (tarefa_id, usuario_id, tipo, texto, criado_em) VALUES (?, ?, ?, ?, ?)",
    [tarefa_id, uid, tipo, texto, _iso(_agora())]);
}

async function _tarefa_ou_404(slug: string, tid: number) {
  const t = await _q1("SELECT * FROM operacao_tarefas WHERE id = ? AND empresa_slug = ?", [tid, slug]);
  if (!t) abort(404);
  const u = _usuario();
  if (!u.admin && t.responsavel_id !== u.id) abort(403);
  return t;
}

export function situacao_tarefa(t: any, hoje?: string) {
  hoje = hoje || PyDate.today().isoformat();
  if (t.status === "concluida") return "concluida";
  if (t.vencimento && t.vencimento < hoje) return "atrasada";
  if (t.vencimento === hoje) return "hoje";
  return "futura";
}

export async function contadores(uid: number, slug: string, admin = false) {
  const hoje = PyDate.today().isoformat();
  const filtro = admin ? "" : " AND responsavel_id = ?";
  const params = admin ? [slug] : [slug, uid];
  const r = (await _q1("SELECT " +
    "SUM(CASE WHEN status <> 'concluida' THEN 1 ELSE 0 END) AS abertas, " +
    `SUM(CASE WHEN status <> 'concluida' AND vencimento <> '' AND vencimento < '${hoje}' THEN 1 ELSE 0 END) AS atrasadas, ` +
    `SUM(CASE WHEN status <> 'concluida' AND (vencimento = '${hoje}') THEN 1 ELSE 0 END) AS hoje ` +
    `FROM operacao_tarefas WHERE empresa_slug = ?${filtro}`, params)) ?? {};
  const ch = await _q1("SELECT COUNT(*) AS n FROM operacao_chamados WHERE empresa_slug = ? AND status <> 'concluido'", [slug]);
  return { abertas: r.abertas || 0, atrasadas: r.atrasadas || 0, hoje: r.hoje || 0, chamados: ch ? ch.n : 0 };
}

// ─────────────────────────── contexto comum ───────────────────────────
async function _ctx(empresa: any, ativo: string) {
  const u = _usuario();
  return {
    t: empresa.tema_full, empresa, modulos: portal.modulos_da_empresa(empresa),
    op_ativo: ativo, oic, hhmmss, hhmm, data_br,
    data_hora_br, numero_chamado,
    SETORES, STATUS_CHAMADO, STATUS_TAREFA,
    RECORRENCIAS, PRIORIDADES,
    cont: await contadores(u.id, empresa.slug, u.admin),
  };
}

function _voltar_seguro(destino: string | null | undefined, padrao: string) {
  return destino && destino.startsWith("/") && !destino.startsWith("//") ? destino : padrao;
}

// ─────────────────────────── registro ───────────────────────────
export function registrar() {
  blueprintStatic("operacao", "/login-grupo/operacao/static");

  // Usado pela barra da empresa incluída nas páginas do portal.
  contextProcessor(() => ({ oic }));

  // Qualquer página aberta conta como uso: mantém o cronômetro vivo.
  const SINAIS: Map<number, number> = ((globalThis as any).__erpSinais ??= new Map());
  beforeRequest(async () => {
    const u = g().portal_user;
    if (u && !request().rota.startsWith("/static/")) {
      // No máximo 1 sinal por minuto por usuário, sem segurar a página (roda em segundo plano).
      const ult = SINAIS.get(u.id) ?? 0;
      if (Date.now() - ult > 60000) {
        SINAIS.set(u.id, Date.now());
        void (async () => {
          try {
            await fechar_abandonados(u.id);
            await sinal(u.id);
          } catch {
            // cronômetro nunca pode derrubar uma página
          }
        })();
      }
    }
    return null;
  });

  // ─────────────────────── API do cronômetro ───────────────────────
  route("operacao.cronometro", "/operacao/<slug>/cronometro", ["GET", "POST"], async (slug: string) => {
    await _empresa(slug);
    const uid = _usuario().id;
    if (request().method === "POST") {
      _checar_csrf();
      const acao = request().form.get("acao");
      if (acao === "iniciar") await iniciar_jornada(uid, slug);
      else if (acao === "pausar") await pausar_jornada(uid);
      else if (acao === "parar_tarefa") await parar_tarefa(uid);
    } else {
      await sinal(uid);
    }
    return jsonify(await estado_cronometro(uid, slug));
  });

  // ─────────────────────── demandas ───────────────────────
  route("operacao.demandas", "/operacao/<slug>/demandas", ["GET"], async (slug: string) => {
    const e = await _empresa(slug);
    const u = _usuario();
    const hoje = PyDate.today();
    const hoje_iso = hoje.isoformat();
    const busca = (request().args.get("q") || "").trim();
    const tipo_f: string = request().args.get("tipo", "");
    // Quadro do usuário logado. O administrador pode ver o de outra pessoa ou o da equipe toda.
    let de: string = request().args.get("de", "eu");
    let resp: number | null = null;
    if (!u.admin) de = "eu";
    else if (/^\d+$/.test(de)) resp = Number(de);
    else if (de !== "equipe") de = "eu";
    const alvo_id = de === "eu" ? u.id : resp;

    let sql = "SELECT * FROM operacao_tarefas WHERE empresa_slug = ?";
    let params: any[] = [slug];
    if (alvo_id) { sql += " AND responsavel_id = ?"; params.push(alvo_id); }
    if (busca) { sql += " AND (titulo LIKE ? OR descricao LIKE ?)"; params = [...params, `%${busca}%`, `%${busca}%`]; }
    if (tipo_f === "rotina") sql += " AND tipo = 'recorrente'";
    else if (tipo_f === "avulsa") sql += " AND tipo <> 'recorrente'";
    const corte = hoje.addDays(-14).isoformat();
    sql += " AND (status <> 'concluida' OR concluida_em >= ?)";
    params.push(corte);
    const todas = await _q(sql + " ORDER BY CASE WHEN vencimento = '' THEN 1 ELSE 0 END, vencimento, " +
      "CASE prioridade WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, id", params);

    const ids = todas.map((t) => t.id);
    const [tempos, nomes, em_andamento, etapas, notas] = await Promise.all([
      segundos_por_tarefa(ids), nomes_usuarios(), tarefa_em_andamento(u.id),
      ids.length ? _q(`SELECT tarefa_id, COUNT(*) AS n, SUM(feito) AS f FROM operacao_tarefa_etapas WHERE tarefa_id IN (${ids.map(() => "?").join(",")}) GROUP BY tarefa_id`, ids) : Promise.resolve([]),
      ids.length ? _q(`SELECT tarefa_id, COUNT(*) AS n FROM operacao_tarefa_notas WHERE tipo = 'nota' AND tarefa_id IN (${ids.map(() => "?").join(",")}) GROUP BY tarefa_id`, ids) : Promise.resolve([]),
    ]);
    const et = new Map(etapas.map((r: any) => [r.tarefa_id, r]));
    const nt = new Map(notas.map((r: any) => [r.tarefa_id, r.n]));
    for (const t of todas) {
      t.situacao = situacao_tarefa(t, hoje_iso);
      t.segundos = tempos.get(t.id) ?? 0;
      t.resp_nome = nomes.get(t.responsavel_id) ?? "—";
      t.rodando = !!(em_andamento && em_andamento.tarefa_id === t.id);
      t.fixa = t.tipo === "recorrente" && t.criado_por !== t.responsavel_id;
      const x: any = et.get(t.id);
      t.etapas_n = x ? Number(x.n) : 0;
      t.etapas_f = x ? Number(x.f || 0) : 0;
      t.notas_n = Number(nt.get(t.id) ?? 0);
    }
    const abertas = todas.filter((t) => t.status !== "concluida");
    const colunas = [
      { id: "aberta", nome: "A fazer", desc: "Ainda não iniciadas", itens: abertas.filter((t) => t.situacao !== "atrasada" && t.status === "aberta") },
      { id: "andamento", nome: "Em andamento", desc: "Iniciadas, ainda abertas", itens: abertas.filter((t) => t.situacao !== "atrasada" && t.status === "andamento") },
      { id: "atraso", nome: "Em atraso", desc: "Passaram do vencimento", itens: abertas.filter((t) => t.situacao === "atrasada") },
      { id: "concluida", nome: "Concluídas", desc: "Últimos 14 dias", itens: todas.filter((t) => t.status === "concluida")
        .sort((a, b) => (a.concluida_em < b.concluida_em ? 1 : a.concluida_em > b.concluida_em ? -1 : 0)).slice(0, 40) },
    ];
    const lista = todas;
    const aba = "quadro";
    const abas = { abertas: abertas.length };

    // Onde o tempo foi gasto (7 dias): por tarefa
    const d6 = hoje.addDays(-6);
    const desde = _iso(new PyDate(d6.year, d6.month, d6.day, 0, 0, 0, true));
    const todos = !alvo_id;
    const filtro_u = todos ? "" : " AND tt.usuario_id = ?";
    const p2 = [slug, desde, ...(todos ? [] : [alvo_id])];
    const gasto = await _q(`SELECT t.id, t.titulo, CAST(SUM(${SEG("COALESCE(tt.fim, ?)")} - ${SEG("tt.inicio")}) AS bigint) AS s ` +
      "FROM operacao_tarefa_tempo tt JOIN operacao_tarefas t ON t.id = tt.tarefa_id " +
      `WHERE t.empresa_slug = ? AND tt.inicio >= ?${filtro_u} GROUP BY t.id ORDER BY s DESC LIMIT 8`,
      [_iso(_agora()), ...p2]);
    const maior = Math.max(...(gasto.length ? gasto.map((r) => r.s || 0) : [1])) || 1;

    // Tempo na empresa: hoje e nos últimos 7 dias (do usuário filtrado)
    const alvo = alvo_id || u.id;
    const semana: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const dia = hoje.addDays(-i);
      semana.push({ dia, s: await segundos_jornada(alvo, slug, dia) });
    }

    const ctx = await _ctx(e, "demandas");
    return render_template("operacao/demandas.html", {
      ...ctx, aba, lista, abas, colunas, busca, resp, de, tipo_f, usuarios: await usuarios_da_empresa(slug), gasto, maior,
      semana, hoje_iso, alvo_nome: alvo_id ? (nomes.get(alvo_id) ?? "—") : "Toda a equipe",
    });
  });

  route("operacao.demanda_nova", "/operacao/<slug>/demandas/nova", ["POST"], async (slug: string) => {
    await _empresa(slug);
    _checar_csrf();
    const u = _usuario();
    const f = request().form;
    const titulo = (f.get("titulo") || "").trim().slice(0, 200);
    if (!titulo) {
      flash("Informe o título da demanda.", "erro");
      return redirect(url_for("operacao.demandas", { slug }));
    }
    const tipo = f.get("tipo") === "recorrente" ? "recorrente" : "pontual";
    let rec = tipo === "recorrente" && f.get("recorrencia") in RECORRENCIAS ? f.get("recorrencia") : "";
    if (tipo === "recorrente" && !rec) rec = "mensal";
    let resp = f.get("responsavel_id", null, "int") || u.id;
    if (!u.admin) {
      resp = u.id; // colaborador só lança para si
    } else if (!(await usuarios_da_empresa(slug)).some((x) => x.id === resp)) {
      resp = u.id;
    }
    let venc = (f.get("vencimento") || "").trim();
    try {
      venc = venc ? _data_iso(venc) : "";
    } catch {
      venc = "";
    }
    if (tipo === "recorrente" && !venc) venc = PyDate.today().isoformat();
    const prio = f.get("prioridade") in PRIORIDADES ? f.get("prioridade") : "normal";
    const agora = _iso(_agora());
    const tid = (await _exec("INSERT INTO operacao_tarefas (empresa_slug, responsavel_id, criado_por, titulo, descricao, tipo, " +
      "recorrencia, prioridade, vencimento, chamado_id, criado_em, atualizado_em) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [slug, resp, u.id, titulo, (f.get("descricao") || "").trim(), tipo, rec, prio, venc,
        f.get("chamado_id", null, "int"), agora, agora]))!;
    await _exec("UPDATE operacao_tarefas SET serie_id = id WHERE id = ? AND tipo = 'recorrente'", [tid]);
    await nota(tid, u.id, "Demanda criada" + (rec ? ` (recorrência ${RECORRENCIAS[rec].toLowerCase()})` : ""), "evento");
    flash("Demanda lançada.", "ok");
    const destino = f.get("voltar") || url_for("operacao.demanda", { slug, tid });
    return redirect(_voltar_seguro(destino, url_for("operacao.demandas", { slug })));
  });

  route("operacao.demanda", "/operacao/<slug>/demandas/<int:tid>", ["GET"], async (slug: string, tid: number) => {
    const e = await _empresa(slug);
    const t = await _tarefa_ou_404(slug, tid);
    const u = _usuario();
    const nomes = await nomes_usuarios();
    const notas = await _q("SELECT * FROM operacao_tarefa_notas WHERE tarefa_id = ? ORDER BY criado_em DESC, id DESC", [tid]);
    for (const n of notas) n.autor = nomes.get(n.usuario_id) ?? "—";
    const tempos = await _q("SELECT * FROM operacao_tarefa_tempo WHERE tarefa_id = ? ORDER BY inicio DESC", [tid]);
    const agora = _agora();
    for (const x of tempos) {
      x.segundos = Math.trunc((x.fim ? _dt(x.fim)! : agora).diffSeconds(_dt(x.inicio)!));
      x.autor = nomes.get(x.usuario_id) ?? "—";
    }
    const em_andamento = await tarefa_em_andamento(u.id);
    let serie: any[] = [];
    if (t.serie_id) {
      serie = await _q("SELECT id, vencimento, status, concluida_em FROM operacao_tarefas WHERE serie_id = ? " +
        "ORDER BY vencimento DESC, id DESC LIMIT 12", [t.serie_id]);
    }
    const chamado = t.chamado_id ? await _q1("SELECT id, assunto FROM operacao_chamados WHERE id = ?", [t.chamado_id]) : null;
    const etapas = await _q("SELECT * FROM operacao_tarefa_etapas WHERE tarefa_id = ? ORDER BY ordem, id", [tid]);
    t.situacao = situacao_tarefa(t);
    t.fixa = t.tipo === "recorrente" && t.criado_por !== t.responsavel_id;
    const ctx = await _ctx(e, "demandas");
    return render_template("operacao/demanda.html", {
      ...ctx, tarefa: t, notas, tempos: tempos.slice(0, 30),
      total: tempos.reduce((s, x) => s + x.segundos, 0), rodando: !!(em_andamento && em_andamento.tarefa_id === tid),
      resp_nome: nomes.get(t.responsavel_id) ?? "—", criador: nomes.get(t.criado_por) ?? "—",
      usuarios: await usuarios_da_empresa(slug), serie, chamado, etapas,
      etapas_feitas: etapas.filter((x) => x.feito).length,
    });
  });

  route("operacao.demanda_acao", "/operacao/<slug>/demandas/<int:tid>/acao", ["POST"], async (slug: string, tid: number) => {
    await _empresa(slug);
    _checar_csrf();
    const t = await _tarefa_ou_404(slug, tid);
    const u = _usuario();
    const f = request().form;
    const acao = f.get("acao");
    const agora = _iso(_agora());
    let voltar = f.get("voltar") || url_for("operacao.demanda", { slug, tid });
    if (!voltar.startsWith("/") || voltar.startsWith("//")) voltar = url_for("operacao.demanda", { slug, tid });

    const viaQuadro = (request().headers.get("x-requested-with") ?? "") === "fetch";
    // Mover no quadro: A fazer / Em andamento / Concluídas
    let acao_ef = acao;
    if (acao === "status") {
      const novo = f.get("novo");
      if (novo === "concluida") acao_ef = "concluir";
      else if (novo === "aberta" || novo === "andamento") {
        if (t.status === "concluida") {
          await _exec("UPDATE operacao_tarefas SET status = ?, concluida_em = '', atualizado_em = ? WHERE id = ?", [novo, agora, tid]);
          await nota(tid, u.id, "Reaberta", "evento");
        } else if (t.status !== novo) {
          if (novo === "aberta") { const r = await tarefa_em_andamento(u.id); if (r && r.tarefa_id === tid) await parar_tarefa(u.id); }
          await _exec("UPDATE operacao_tarefas SET status = ?, atualizado_em = ? WHERE id = ?", [novo, agora, tid]);
          await nota(tid, u.id, novo === "andamento" ? "Movida para Em andamento" : "Movida para A fazer", "evento");
        }
        if (viaQuadro) return jsonify({ ok: true });
        return redirect(voltar);
      }
    }
    if (acao_ef === "etapa_add") {
      const texto = (f.get("texto") || "").trim().slice(0, 300);
      if (texto) {
        const o = await _q1("SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM operacao_tarefa_etapas WHERE tarefa_id = ?", [tid]);
        await _exec("INSERT INTO operacao_tarefa_etapas (tarefa_id, ordem, texto) VALUES (?, ?, ?)", [tid, o?.o ?? 1, texto]);
        await _exec("UPDATE operacao_tarefas SET atualizado_em = ? WHERE id = ?", [agora, tid]);
      }
      return redirect(voltar + "#etapas");
    }
    if (acao_ef === "etapa_toggle" || acao_ef === "etapa_del") {
      const eid = f.get("etapa_id", null, "int");
      const etp = eid ? await _q1("SELECT * FROM operacao_tarefa_etapas WHERE id = ? AND tarefa_id = ?", [eid, tid]) : null;
      if (etp) {
        if (acao_ef === "etapa_del") await _exec("DELETE FROM operacao_tarefa_etapas WHERE id = ?", [eid]);
        else {
          await _exec("UPDATE operacao_tarefa_etapas SET feito = ?, feito_em = ? WHERE id = ?", [etp.feito ? 0 : 1, etp.feito ? "" : agora, eid]);
          if (!etp.feito && t.status === "aberta") await _exec("UPDATE operacao_tarefas SET status = 'andamento', atualizado_em = ? WHERE id = ?", [agora, tid]);
        }
      }
      if (viaQuadro) return jsonify({ ok: true });
      return redirect(voltar + "#etapas");
    }

    if (acao_ef === "iniciar") {
      if (t.status === "concluida") flash("Reabra a demanda para registrar tempo nela.", "erro");
      else await iniciar_tarefa(u.id, t);
    } else if (acao_ef === "parar") {
      await parar_tarefa(u.id);
    } else if (acao_ef === "nota") {
      const texto = (f.get("texto") || "").trim();
      if (texto) {
        await nota(tid, u.id, texto.slice(0, 4000));
        await _exec("UPDATE operacao_tarefas SET atualizado_em = ? WHERE id = ?", [agora, tid]);
      }
    } else if (acao_ef === "concluir" && t.status !== "concluida") {
      const rodando = await tarefa_em_andamento(u.id);
      if (rodando && rodando.tarefa_id === tid) await parar_tarefa(u.id);
      await _exec("UPDATE operacao_tarefas SET status = 'concluida', concluida_em = ?, atualizado_em = ? WHERE id = ?",
        [agora, agora, tid]);
      await nota(tid, u.id, "Concluída", "evento");
      if (t.tipo === "recorrente" && t.recorrencia) {
        const prox = proximo_vencimento(t.vencimento, t.recorrencia);
        const ja = await _q1("SELECT id FROM operacao_tarefas WHERE serie_id = ? AND vencimento = ?",
          [t.serie_id || tid, prox]);
        if (!ja) {
          const nid = (await _exec("INSERT INTO operacao_tarefas (empresa_slug, responsavel_id, criado_por, titulo, descricao, " +
            "tipo, recorrencia, prioridade, vencimento, serie_id, criado_em, atualizado_em) " +
            "VALUES (?, ?, ?, ?, ?, 'recorrente', ?, ?, ?, ?, ?, ?)",
            [slug, t.responsavel_id, u.id, t.titulo, t.descricao, t.recorrencia,
              t.prioridade, prox, t.serie_id || tid, agora, agora]))!;
          await nota(nid, u.id, `Gerada pela recorrência (${RECORRENCIAS[t.recorrencia].toLowerCase()})`, "evento");
          await _exec("INSERT INTO operacao_tarefa_etapas (tarefa_id, ordem, texto) SELECT ?, ordem, texto FROM operacao_tarefa_etapas WHERE tarefa_id = ? ORDER BY ordem, id", [nid, tid]);
          flash(`Concluída. Próxima ocorrência criada para ${data_br(prox)}.`, "ok");
        } else {
          flash("Demanda concluída.", "ok");
        }
      } else {
        flash("Demanda concluída.", "ok");
      }
    } else if (acao_ef === "reabrir" && t.status === "concluida") {
      await _exec("UPDATE operacao_tarefas SET status = 'aberta', concluida_em = '', atualizado_em = ? WHERE id = ?",
        [agora, tid]);
      await nota(tid, u.id, "Reaberta", "evento");
    } else if (acao_ef === "editar") {
      // Rotina fixa (lançada pelo administrador para o colaborador): só o administrador muda título e recorrência.
      const fixa = t.tipo === "recorrente" && t.criado_por !== t.responsavel_id && !u.admin;
      const titulo = fixa ? t.titulo : (f.get("titulo") || "").trim().slice(0, 200) || t.titulo;
      let venc = (f.get("vencimento") || "").trim();
      try {
        venc = venc ? _data_iso(venc) : "";
      } catch {
        venc = t.vencimento;
      }
      const tipo = fixa ? t.tipo : f.get("tipo") === "recorrente" ? "recorrente" : "pontual";
      let rec = fixa ? t.recorrencia : tipo === "recorrente" && f.get("recorrencia") in RECORRENCIAS ? f.get("recorrencia") : "";
      if (tipo === "recorrente" && !rec) rec = "mensal";
      const prio = f.get("prioridade") in PRIORIDADES ? f.get("prioridade") : t.prioridade;
      let resp = t.responsavel_id;
      if (u.admin) {
        const novo = f.get("responsavel_id", null, "int");
        if (novo && (await usuarios_da_empresa(slug)).some((x) => x.id === novo)) resp = novo;
      }
      const mudancas: string[] = [];
      if (titulo !== t.titulo) mudancas.push("título");
      if (venc !== t.vencimento) mudancas.push(`vencimento para ${data_br(venc) || "sem data"}`);
      if (resp !== t.responsavel_id) mudancas.push(`responsável para ${(await nomes_usuarios()).get(resp) ?? "—"}`);
      if (tipo !== t.tipo || rec !== t.recorrencia) mudancas.push("recorrência " + (rec ? RECORRENCIAS[rec].toLowerCase() : "removida"));
      await _exec("UPDATE operacao_tarefas SET titulo = ?, descricao = ?, vencimento = ?, tipo = ?, recorrencia = ?, " +
        "prioridade = ?, responsavel_id = ?, serie_id = COALESCE(serie_id, CASE WHEN CAST(? AS text) = 'recorrente' THEN id END), " +
        "atualizado_em = ? WHERE id = ?",
        [titulo, (f.get("descricao") || "").trim(), venc, tipo, rec, prio, resp, tipo, agora, tid]);
      if (mudancas.length) await nota(tid, u.id, "Alterado: " + mudancas.join(", "), "evento");
      flash("Demanda atualizada.", "ok");
      if (resp !== u.id && !u.admin) return redirect(url_for("operacao.demandas", { slug }));
    } else if (acao_ef === "excluir") {
      if (!(u.admin || t.criado_por === u.id)) abort(403);
      if ((await tarefa_em_andamento(u.id))?.tarefa_id === tid) await parar_tarefa(u.id);
      await _exec("DELETE FROM operacao_tarefa_notas WHERE tarefa_id = ?", [tid]);
      await _exec("DELETE FROM operacao_tarefa_tempo WHERE tarefa_id = ?", [tid]);
      await _exec("DELETE FROM operacao_tarefa_etapas WHERE tarefa_id = ?", [tid]);
      await _exec("DELETE FROM operacao_tarefas WHERE id = ?", [tid]);
      flash("Demanda excluída.", "ok");
      return redirect(url_for("operacao.demandas", { slug }));
    }
    if (viaQuadro) return jsonify({ ok: true });
    return redirect(voltar);
  });

  // ─────────────────────── chamados ───────────────────────
  async function _chamado_ou_404(slug: string, cid: number) {
    const c = await _q1("SELECT * FROM operacao_chamados WHERE id = ? AND empresa_slug = ?", [cid, slug]);
    if (!c) abort(404);
    return c;
  }

  route("operacao.chamados", "/operacao/<slug>/chamados", ["GET"], async (slug: string) => {
    const e = await _empresa(slug);
    const args = request().args;
    const st: string = args.get("status", "abertos");
    const setor: string = args.get("setor", "");
    const busca = (args.get("q") || "").trim();
    let sql = "SELECT * FROM operacao_chamados WHERE empresa_slug = ?";
    let params: any[] = [slug];
    if (st === "abertos") {
      sql += " AND status <> 'concluido'";
    } else if (st in STATUS_CHAMADO) {
      sql += " AND status = ?";
      params.push(st);
    }
    if (SETORES.includes(setor)) {
      sql += " AND setor = ?";
      params.push(setor);
    }
    if (busca) {
      sql += " AND (assunto LIKE ? OR solicitante LIKE ? OR descricao LIKE ? OR CAST(id AS TEXT) LIKE ?)";
      params = [...params, `%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca.replace(/^[#0]+/, "") || busca}%`];
    }
    const lista = await _q(sql + " ORDER BY ultima_mov_em DESC, id DESC", params);
    const nomes = await nomes_usuarios();
    for (const c of lista) c.resp_nome = c.responsavel_id ? (nomes.get(c.responsavel_id) ?? "") : "";
    const totais = Object.fromEntries((await _q(
      "SELECT status, COUNT(*) AS n FROM operacao_chamados WHERE empresa_slug = ? GROUP BY status", [slug])).map((r) => [r.status, r.n]));
    const ctx = await _ctx(e, "chamados");
    return render_template("operacao/chamados.html", {
      ...ctx, lista, st, setor, busca, totais, usuarios: await usuarios_da_empresa(slug),
    });
  });

  route("operacao.chamado_novo", "/operacao/<slug>/chamados/novo", ["POST"], async (slug: string) => {
    await _empresa(slug);
    _checar_csrf();
    const u = _usuario();
    const f = request().form;
    const assunto = (f.get("assunto") || "").trim().slice(0, 200);
    const setor = f.get("setor");
    if (!assunto || !SETORES.includes(setor)) {
      flash("Informe o setor e o assunto do chamado.", "erro");
      return redirect(url_for("operacao.chamados", { slug }));
    }
    const agora = _iso(_agora());
    const cid = (await _exec("INSERT INTO operacao_chamados (empresa_slug, setor, assunto, descricao, solicitante, aberto_por, " +
      "status, aberto_em, ultima_mov_em) VALUES (?, ?, ?, ?, ?, ?, 'aberto', ?, ?)",
      [slug, setor, assunto, (f.get("descricao") || "").trim(),
        (f.get("solicitante") || "").trim().slice(0, 160) || u.nome, u.id, agora, agora]))!;
    await _exec("INSERT INTO operacao_chamado_mov (chamado_id, usuario_id, texto, status, criado_em) VALUES (?, ?, ?, 'aberto', ?)",
      [cid, u.id, "Chamado aberto", agora]);
    flash(`Chamado nº ${numero_chamado(cid)} aberto.`, "ok");
    return redirect(url_for("operacao.chamado", { slug, cid }));
  });

  route("operacao.chamado", "/operacao/<slug>/chamados/<int:cid>", ["GET"], async (slug: string, cid: number) => {
    const e = await _empresa(slug);
    const c = await _chamado_ou_404(slug, cid);
    const nomes = await nomes_usuarios();
    const movs = await _q("SELECT * FROM operacao_chamado_mov WHERE chamado_id = ? ORDER BY criado_em, id", [cid]);
    for (const m of movs) m.autor = nomes.get(m.usuario_id) ?? "—";
    const tarefas = await _q("SELECT id, titulo, status, responsavel_id FROM operacao_tarefas WHERE chamado_id = ? ORDER BY id", [cid]);
    const u = _usuario();
    for (const t of tarefas) {
      t.resp_nome = nomes.get(t.responsavel_id) ?? "—";
      t.posso_abrir = u.admin || t.responsavel_id === u.id;
    }
    const ctx = await _ctx(e, "chamados");
    return render_template("operacao/chamado.html", {
      ...ctx, c, movs, tarefas,
      aberto_por: nomes.get(c.aberto_por) ?? "—",
      resp_nome: c.responsavel_id ? (nomes.get(c.responsavel_id) ?? "") : "",
      usuarios: await usuarios_da_empresa(slug),
    });
  });

  route("operacao.chamado_mov", "/operacao/<slug>/chamados/<int:cid>/mov", ["POST"], async (slug: string, cid: number) => {
    await _empresa(slug);
    _checar_csrf();
    const c = await _chamado_ou_404(slug, cid);
    const u = _usuario();
    const f = request().form;
    const texto = (f.get("texto") || "").trim().slice(0, 4000);
    const novo = f.get("status") in STATUS_CHAMADO ? f.get("status") : c.status;
    let resp = c.responsavel_id;
    if (f.has("responsavel_id")) {
      const r = f.get("responsavel_id", null, "int");
      resp = (await usuarios_da_empresa(slug)).some((x) => x.id === r) ? r : null;
    }
    if (!texto && novo === c.status && resp === c.responsavel_id) {
      flash("Escreva uma mensagem ou altere o status.", "erro");
      return redirect(url_for("operacao.chamado", { slug, cid }));
    }
    const partes: string[] = [];
    if (novo !== c.status) partes.push(`Status: ${STATUS_CHAMADO[novo]}`);
    if (resp !== c.responsavel_id) partes.push(`Responsável: ${resp ? ((await nomes_usuarios()).get(resp) ?? "ninguém") : "ninguém"}`);
    const agora = _iso(_agora());
    await _exec("INSERT INTO operacao_chamado_mov (chamado_id, usuario_id, texto, status, criado_em) VALUES (?, ?, ?, ?, ?)",
      [cid, u.id, (texto && partes.length ? texto + "\n" : texto) + partes.join(" · "),
        novo !== c.status ? novo : "", agora]);
    await _exec("UPDATE operacao_chamados SET status = ?, responsavel_id = ?, ultima_mov_em = ? WHERE id = ?",
      [novo, resp, agora, cid]);
    flash("Movimentação registrada.", "ok");
    return redirect(url_for("operacao.chamado", { slug, cid }));
  });
}
