/* eslint-disable @typescript-eslint/no-explicit-any */
// Módulo Finanças — ERP financeiro de cada empresa do Grupo (porte de modulos/financas/__init__.py).
//
//   /financas/<empresa>/                     visão geral (saldos, a receber/a pagar, resultado)
//   /financas/<empresa>/receber | pagar      contas a receber / a pagar (parcelas, recorrência, baixas)
//   /financas/<empresa>/extrato              movimentações por conta, saldo corrido, transferências
//   /financas/<empresa>/conciliacao          importação de OFX e conciliação com os lançamentos
//   /financas/<empresa>/relatorios/...       fluxo de caixa mensal e DRE gerencial
//   /financas/<empresa>/cadastros/...        contas bancárias, clientes e fornecedores, categorias, centros de custo
//
// Acesso: mesmas empresas liberadas no portal (admin vê todas). Tabelas próprias (prefixo financas_).
// Os helpers _ctx/_empresa/... são exportados com os mesmos nomes para capuzzo/cond_ops/gt/integracao_omie.
// Atenção: _ctx, _empresa, _do_slug e _usuario... que acessam o banco são async (use await).
import {
  PyDate, abort, blueprintStatic, flash, g, jsonify, post, redirect, render_template, request, route, sendFile,
  templateFilter, url_for, get,
} from "../../core/flask";
import { lerArquivo } from "../../core/arquivos";
import { erroSeguro } from "../../core/diagnostico-assessoria";
import * as portal from "../portal";
import * as d from "./dados";
import { cnpj_valido, consultar, consultar_local, cpf_valido, fmt_doc } from "./consulta_doc";
import { fic } from "./icones";
import { menu_empresa, topico_ativo } from "./menu";
import { registrar as registrar_omie } from "./integracao_omie";
import { registrar as registrar_capuzzo } from "./capuzzo";
import { registrar as registrar_cond_ops } from "./cond_ops";
import { registrar as registrar_gt } from "./gt";

// ───────────────────────── apoio ─────────────────────────
export function _usuario(): any {
  const u = g().portal_user;
  if (!u) abort(403);
  return u;
}

export async function _empresa(slug: string): Promise<any> {
  if (!(slug in portal.EMPRESAS_POR_SLUG)) abort(404);
  const u = _usuario();
  if (!(await portal.pode_ver(u, slug))) abort(403);
  const e = (await portal.empresas_com_status()).find((x: any) => x.slug === slug);
  if (e.status === "inativo" && !u.admin) abort(403);
  if (!(e.modulos ?? []).some((m: any) => m.id === "financas")) abort(404); // só nas empresas que têm o módulo Finanças
  await d.garantir_padroes(slug);
  return e;
}

export function _csrf() {
  portal.checar_csrf();
}

export function _voltar(padrao: string): string {
  const r = request();
  const v = r.form.get("voltar") || r.args.get("voltar") || "";
  return v.startsWith("/") && !v.startsWith("//") ? v : padrao;
}

export async function _ctx(e: any, ativo: string, extra: Record<string, any> = {}): Promise<Record<string, any>> {
  const menu = menu_empresa(e.slug);
  return {
    t: e.tema_full, empresa: e, modulos: portal.modulos_da_empresa(e), fin_ativo: ativo, fic, ic: fic,
    menu, topico: topico_ativo(menu, ativo),
    moeda: d.moeda, data_br: d.data_br, valor_campo: d.valor_campo, SITUACOES: d.SITUACOES,
    TIPOS_CONTA: d.TIPOS_CONTA, TIPOS_PESSOA: d.TIPOS_PESSOA, FORMAS: d.FORMAS,
    GRUPOS_DRE: d.GRUPOS_DRE, NOME_GRUPO: d.NOME_GRUPO, hoje_iso: d.hoje().isoformat(),
    // listas usadas pelos diálogos de lançamento em qualquer tela
    categorias_todas: await d.categorias(e.slug), pessoas_todas: await d.pessoas(e.slug),
    centros_todos: await d.centros(e.slug), contas_ativas: await d.contas(e.slug, true), ...extra,
  };
}

/** Checkbox com campo oculto: ausente = ativo (cadastro novo); marcado envia '1'. */
export function _ativo(nome = "ativo"): number {
  const vals = request().form.getlist(nome);
  return !vals.length || vals.includes("1") ? 1 : 0;
}

/** int(x or 0) or None — como no Python (texto inválido → None). */
export function _int(nome: string, fonte?: any): number | null {
  const f = fonte || request().form;
  const s = String(f.get(nome) || "0").trim().replace(/_/g, "");
  if (!/^[-+]?\d+$/.test(s)) return null;
  const v = parseInt(s, 10);
  return v || null;
}

/** Garante que um id (conta, pessoa, categoria…) pertence à empresa. */
export async function _do_slug(tabela: string, id_: any, slug: string): Promise<number | null> {
  if (!id_) return null;
  const r = await d.q(`SELECT id FROM ${tabela} WHERE id = ? AND empresa_slug = ?`, [id_, slug], true);
  return r ? r.id : null;
}

/** Atalhos de mês anterior/seguinte quando o período é um mês cheio. */
export function _navegacao_mes(de: string, ate: string): any {
  const ini = PyDate.fromisoformat(de);
  const fim_mes = d.somar_meses(ini.replace({ day: 1 }), 1).addDays(-1).isoformat();
  if (ini.day !== 1 || ate !== fim_mes) return null;
  const ant = d.somar_meses(ini, -1), prox = d.somar_meses(ini, 1);
  const fim = (x: PyDate) => d.somar_meses(x, 1).addDays(-1).isoformat();
  return { rotulo: `${d.MESES[ini.month]}/${ini.year}`, ant: [ant.isoformat(), fim(ant)], prox: [prox.isoformat(), fim(prox)] };
}

export function _periodo(): [string, string] {
  const hoje = d.hoje();
  const args = request().args;
  const de = d.data_valida(args.get("de"), hoje.replace({ day: 1 }).isoformat());
  let ate = d.data_valida(args.get("ate"), d.somar_meses(hoje.replace({ day: 1 }), 1).replace({ day: 1 }).isoformat());
  if (args.get("ate") === null) ate = PyDate.fromisoformat(ate).addDays(-1).isoformat();
  return [de, ate];
}

const ABERTAS = ["aberto", "vencido", "parcial"];
const soma = (lst: any[], campo: string) => lst.reduce((a, x) => a + x[campo], 0);

function _ler_form_lancamento_sync() { return request().form; }

/** Formulário simples (usado por telas antigas, ex. conciliação). */
async function _ler_form_lancamento(slug: string, tipo: string): Promise<[string[], any]> {
  const f = _ler_form_lancamento_sync();
  const valor = d.para_centavos(f.get("valor"));
  const venc = d.data_valida(f.get("vencimento"));
  const erros: string[] = [];
  if (!(f.get("descricao") || "").trim()) erros.push("Informe a descrição.");
  if (!valor || valor <= 0) erros.push("Informe um valor maior que zero.");
  if (!venc) erros.push("Informe o vencimento.");
  const tipo_cat = tipo === "receber" ? "receita" : "despesa";
  let cat = _int("categoria_id");
  if (cat && !(await d.q("SELECT 1 FROM financas_categorias WHERE id = ? AND empresa_slug = ? AND tipo = ?", [cat, slug, tipo_cat])).length) cat = null;
  return [erros, {
    descricao: Array.from((f.get("descricao") || "").trim()).slice(0, 200).join(""), valor, vencimento: venc,
    competencia: d.data_valida(f.get("competencia"), venc), pessoa_id: await _do_slug("financas_pessoas", _int("pessoa_id"), slug),
    categoria_id: cat, centro_id: await _do_slug("financas_centros", _int("centro_id"), slug),
    conta_id: await _do_slug("financas_contas", _int("conta_id"), slug),
    forma_pagamento: d.FORMAS.includes(f.get("forma_pagamento")) ? f.get("forma_pagamento") : "",
    documento: corta((f.get("documento") || "").trim(), 60), obs: corta((f.get("obs") || "").trim(), 2000),
    modo: ["unico", "parcelado", "recorrente"].includes(f.get("modo")) ? f.get("modo") : "unico",
    parcelas: _int("parcelas") || 1,
  }];
}

/** s[:n] do Python (por caractere). */
function corta(s: string, n: number) { return Array.from(s).slice(0, n).join(""); }

// ───────────────────────── tela de lançamento (padrão Omie / Conta Azul) ─────────────────────────
async function _ler_cabecalho(slug: string, _tipo: string): Promise<any> {
  const f = request().form;
  return {
    descricao: corta((f.get("descricao") || "").trim(), 200),
    pessoa_id: await _do_slug("financas_pessoas", _int("pessoa_id"), slug),
    conta_id: await _do_slug("financas_contas", _int("conta_id"), slug),
    centro_id: null,
    forma_pagamento: d.FORMAS.includes(f.get("forma_pagamento")) ? f.get("forma_pagamento") : "",
    documento: corta((f.get("documento") || "").trim(), 60), obs: corta((f.get("obs") || "").trim(), 2000),
    natureza_custo: f.get("natureza_custo") in d.NATUREZAS_CUSTO ? f.get("natureza_custo") : "",
    competencia: d.competencia_valida(f.get("competencia")),
  };
}

const ehDigitos = (s: string) => /^\d+$/.test(s);

/** Linhas de categoria (rateio): rat_categoria[], rat_centro[], rat_valor[]. */
async function _ler_rateio(slug: string, tipo: string): Promise<any[]> {
  const tipo_cat = tipo === "receber" ? "receita" : "despesa";
  const validas = new Set((await d.categorias(slug, tipo_cat, false)).map((c) => c.id));
  const f = request().form;
  const cats = f.getlist("rat_categoria"), cens = f.getlist("rat_centro"), vals = f.getlist("rat_valor");
  const linhas: any[] = [];
  for (let i = 0; i < Math.min(cats.length, cens.length, vals.length); i++) {
    const [cat, cen, val] = [cats[i], cens[i], vals[i]];
    const v = d.para_centavos(val) || 0;
    const c = ehDigitos(cat) && validas.has(parseInt(cat, 10)) ? parseInt(cat, 10) : null;
    const k = await _do_slug("financas_centros", ehDigitos(cen) ? parseInt(cen, 10) : null, slug);
    if (v > 0 || c) linhas.push({ categoria_id: c, centro_id: k, valor: v });
  }
  return linhas.filter((x) => x.valor > 0);
}

function _ler_parcelas(): any[] {
  const f = request().form;
  const parc: any[] = [];
  const prevs = f.getlist("par_prev");
  const vencs = f.getlist("par_venc"), valores = f.getlist("par_valor");
  for (let i = 0; i < Math.min(vencs.length, valores.length); i++) {
    const v = d.para_centavos(valores[i]), dt = d.data_valida(vencs[i]);
    if (v && v > 0 && dt) parc.push({ vencimento: dt, valor: v, previsao: d.data_valida(i < prevs.length ? prevs[i] : "", dt) });
  }
  return parc;
}

async function _form_ctx(e: any, tipo: string, extra: Record<string, any> = {}) {
  const tipo_cat = tipo === "receber" ? "receita" : "despesa";
  return {
    ...(await _ctx(e, tipo)), tipo, categorias: await d.categorias(e.slug, tipo_cat),
    pessoas: await d.pessoas(e.slug, tipo === "receber" ? "cliente" : "fornecedor"),
    contas: await d.contas(e.slug, true), centros: await d.centros(e.slug),
    FREQUENCIAS: d.FREQUENCIAS, NATUREZAS_CUSTO: d.NATUREZAS_CUSTO, ...extra,
  };
}

async function _lanc_ou_404(slug: string, lid: number): Promise<any> {
  const l = await d.q("SELECT * FROM financas_lancamentos WHERE id = ? AND empresa_slug = ?", [lid, slug], true);
  if (!l) abort(404);
  return l;
}

async function _linha_ou_404(slug: string, xid: number): Promise<any> {
  const x = await d.q("SELECT * FROM financas_extrato_importado WHERE id = ? AND empresa_slug = ?", [xid, slug], true);
  if (!x) abort(404);
  return x;
}

const MIMES: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip", ".eml": "message/rfc822",
};

export function registrar() {
  templateFilter("doc_fmt", (v: any) => fmt_doc(v));
  blueprintStatic("financas", "/login-grupo/financas/static");

  // ───────────────────────── visão geral ─────────────────────────
  get("financas.painel", "/financas/<slug>/", async (slug: string) => {
    const e = await _empresa(slug);
    const hoje = d.hoje();
    const hoje_iso = hoje.isoformat();
    // saldo de caixa: só contas correntes, poupança, aplicações e caixa (cartão de crédito não compõe o saldo)
    // As leituras são independentes: vão ao banco ao mesmo tempo (bem mais rápido online).
    const mes_ini = hoje.replace({ day: 1 }).isoformat();
    let produtos_indisponiveis = false;
    const [contas0, todos, mes, ctx, sem_lanc, produtos] = await Promise.all([
      d.contas(slug, true),
      (async () => (await d.completar(await d.q(
        "SELECT * FROM financas_lancamentos WHERE empresa_slug = ? AND cancelado = 0" + d.filtro_consideradas() + " ORDER BY id", [slug]), slug))
        .filter((l) => ABERTAS.includes(l.situacao)))(),
      d.resumo_periodo(slug, mes_ini, hoje_iso),
      _ctx(e, "painel"),
      (async () => !(await d.q("SELECT 1 FROM financas_lancamentos WHERE empresa_slug = ? LIMIT 1", [slug])).length)(),
      (async () => {
        if (slug !== "assessoria") return null;
        try {
          const capuzzo: any = await import("./capuzzo");
          return typeof capuzzo.resumo_produtos === "function" ? await capuzzo.resumo_produtos(slug) : null;
        } catch (exc) { // indicadores de produto nunca derrubam a visão geral
          produtos_indisponiveis = true;
          console.error("[erp] assessoria: produtos indisponiveis", erroSeguro(exc));
          return null;
        }
      })(),
    ]);
    const contas = contas0.filter((c: any) => d.TIPOS_SALDO.includes(c.tipo));
    const em7 = hoje.addDays(7).isoformat();
    const lim30 = hoje.addDays(30).isoformat();
    const abertos = todos.filter((l: any) => l.vencimento <= lim30);
    const somaT = (tipo: string, cond: (l: any) => boolean) => abertos.filter((l) => l.tipo === tipo && cond(l)).reduce((a, l) => a + l.saldo, 0);
    const cards = {
      receber_vencido: somaT("receber", (l) => l.vencimento < hoje_iso),
      receber_hoje: somaT("receber", (l) => l.vencimento === hoje_iso),
      receber_7: somaT("receber", (l) => hoje_iso < l.vencimento && l.vencimento <= em7),
      pagar_vencido: somaT("pagar", (l) => l.vencimento < hoje_iso),
      pagar_hoje: somaT("pagar", (l) => l.vencimento === hoje_iso),
      pagar_7: somaT("pagar", (l) => hoje_iso < l.vencimento && l.vencimento <= em7),
    };
    // projeção de saldo nos próximos 30 dias (saldo atual + a receber − a pagar)
    const saldo_atual = soma(contas, "saldo");
    const proj: any[] = [];
    let s = saldo_atual;
    const sinal = (l: any) => l.saldo * (l.tipo === "receber" ? 1 : -1);
    const quando = (l: any) => l.previsao || l.vencimento;
    const pend_ant = abertos.filter((l) => quando(l) < hoje_iso).reduce((a, l) => a + sinal(l), 0);
    for (let i = 0; i < 31; i++) {
      const dia = hoje.addDays(i).isoformat();
      let delta = abertos.filter((l) => quando(l) === dia).reduce((a, l) => a + sinal(l), 0);
      if (i === 0) delta += pend_ant;
      s += delta;
      proj.push({ dia, saldo: s });
    }
    const proximos = d.ordenar(abertos.filter((l) => l.vencimento <= em7), (l) => [l.vencimento, l.tipo]).slice(0, 12);
    // tudo o que está em aberto (sem limite de data) para os indicadores gerais
    const em30 = hoje.addDays(30).isoformat();
    const tot = (tipo: string, cond: (l: any) => boolean = () => true) => {
      const lst = todos.filter((l) => l.tipo === tipo && cond(l));
      return { valor: soma(lst, "saldo"), n: lst.length };
    };
    const ind: any = {
      receber: tot("receber"), pagar: tot("pagar"),
      receber_venc: tot("receber", (l) => l.vencimento < hoje_iso),
      pagar_venc: tot("pagar", (l) => l.vencimento < hoje_iso),
      receber_30: tot("receber", (l) => hoje_iso <= l.vencimento && l.vencimento <= em30),
      pagar_30: tot("pagar", (l) => hoje_iso <= l.vencimento && l.vencimento <= em30),
    };
    ind.atraso = ind.receber_venc.valor + ind.pagar_venc.valor;
    ind.inadimplencia = ind.receber.valor ? (100 * ind.receber_venc.valor / ind.receber.valor) : 0;
    ind.cobertura = ind.pagar_30.valor ? (saldo_atual / ind.pagar_30.valor) : null;
    ind.liquido_30 = saldo_atual + ind.receber_30.valor - ind.pagar_30.valor
      + ind.receber_venc.valor - ind.pagar_venc.valor;
    const maior = Math.max(...contas.map((c) => Math.abs(c.saldo)), 1);
    return render_template("financas/painel.html", {
      ...ctx, contas, cards, mes,
      saldo_atual, proj, proximos, ind, maior, produtos, produtos_indisponiveis,
      sem_contas: !contas.length, sem_lanc,
    });
  });

  // ───────────────────────── contas a receber / a pagar ─────────────────────────
  get("financas.lancamentos", "/financas/<slug>/<any(receber, pagar):tipo>", async (slug: string, tipo: string) => {
    const e = await _empresa(slug);
    const [de, ate] = _periodo();
    const args = request().args;
    const situacao = args.get("situacao", "");
    const busca = (args.get("q") || "").trim();
    const cat = _int("categoria", args);
    const lista = await d.listar_lancamentos(slug, tipo, de, ate, situacao, busca, cat);
    const tot = {
      vencido: soma(lista.filter((l) => l.situacao === "vencido"), "saldo"),
      aberto: soma(lista.filter((l) => l.situacao === "aberto" || l.situacao === "parcial"), "saldo"),
      pago: soma(lista, "pago"),
      total: soma(lista.filter((l) => l.situacao !== "cancelado"), "valor"),
    };
    const tipo_cat = tipo === "receber" ? "receita" : "despesa";
    return render_template("financas/lancamentos.html", {
      ...(await _ctx(e, tipo)), tipo, lista, tot, de, ate,
      nav: _navegacao_mes(de, ate),
      situacao, busca, cat, categorias: await d.categorias(slug, tipo_cat),
      pessoas: await d.pessoas(slug, tipo === "receber" ? "cliente" : "fornecedor"),
      contas: await d.contas(slug, true), centros: await d.centros(slug),
    });
  });

  route("financas.lancamento_novo", "/financas/<slug>/<any(receber, pagar):tipo>/novo", ["GET", "POST"], async (slug: string, tipo: string) => {
    const e = await _empresa(slug);
    const req = request();
    if (req.method === "GET") {
      return render_template("financas/lancamento_form.html", {
        ...(await _form_ctx(e, tipo)), l: null, rateio: [], hoje: d.hoje().isoformat(),
        voltar: _voltar(url_for("financas.lancamentos", { slug, tipo })),
      });
    }
    _csrf();
    const u = _usuario();
    const volta = _voltar(url_for("financas.lancamentos", { slug, tipo }));
    // formulário antigo (diálogo rápido) continua aceito
    if (!req.form.has("par_venc")) {
      const [erros, dados] = await _ler_form_lancamento(slug, tipo);
      if (erros.length) { flash(erros.join(" "), "erro"); return redirect(volta); }
      if (dados.modo === "unico") dados.parcelas = 1;
      const ids = await d.criar_lancamentos(slug, tipo, dados, u.id);
      flash(ids.length > 1 ? `${ids.length} lançamentos criados.` : "Lançamento criado.", "ok");
      return redirect(volta);
    }
    const cab = await _ler_cabecalho(slug, tipo);
    cab.repeticao = ["parcelado", "recorrente"].includes(req.form.get("condicao")) ? req.form.get("condicao") : "";
    const rateio = await _ler_rateio(slug, tipo);
    const parcelas = _ler_parcelas();
    const erros: string[] = [];
    if (!cab.descricao) erros.push("Informe a descrição.");
    if (!parcelas.length) erros.push("Informe valor e vencimento.");
    if (!rateio.length) erros.push("Informe ao menos uma categoria com valor.");
    if (erros.length) {
      flash(erros.join(" "), "erro");
      return redirect(url_for("financas.lancamento_novo", { slug, tipo }));
    }
    const comp0 = PyDate.fromisoformat(cab.competencia || d.competencia_valida(parcelas[0].vencimento));
    const v0 = PyDate.fromisoformat(parcelas[0].vencimento);
    for (const p of parcelas) { // recorrente: a competência acompanha cada vencimento; parcelado/único: competência fixa
      const vi = PyDate.fromisoformat(p.vencimento);
      if (cab.repeticao !== "recorrente") p.competencia = comp0.isoformat();
      else if (vi.diffDays(v0) >= 28) p.competencia = d.somar_meses(comp0, (vi.year - v0.year) * 12 + vi.month - v0.month).isoformat();
      else p.competencia = comp0.addDays(vi.diffDays(v0)).isoformat(); // semanal / quinzenal
    }
    const [ids, grupo] = await d.criar_lancamento_completo(slug, tipo, cab, parcelas, rateio, u.id);
    const [salvos, recusados] = await d.salvar_anexos(slug, ids[0], grupo, req.files.get("anexos") ?? [], u.id);
    if (req.form.get("ja_pago") && ids.length === 1) {
      const conta = (await _do_slug("financas_contas", _int("pago_conta_id"), slug)) || cab.conta_id;
      if (conta) {
        const l = await d.q("SELECT * FROM financas_lancamentos WHERE id = ?", [ids[0]], true);
        await d.registrar_baixa(slug, l, conta, d.data_valida(req.form.get("pago_data"), parcelas[0].vencimento), l.valor, 0, 0, u.id);
      } else {
        flash("Para registrar como já pago, escolha a conta.", "erro");
      }
    }
    let msg = ids.length > 1 ? `${ids.length} lançamentos criados.` : "Lançamento criado.";
    if (salvos) msg += ` ${salvos} anexo(s) salvo(s).`;
    flash(msg, "ok");
    if (recusados.length) flash("Anexos não salvos: " + recusados.join("; "), "erro");
    if (req.form.get("acao") === "novo") return redirect(url_for("financas.lancamento_novo", { slug, tipo }));
    return redirect(url_for("financas.lancamento", { slug, lid: ids[0] }));
  });

  route("financas.lancamento", "/financas/<slug>/lancamento/<int:lid>", ["GET", "POST"], async (slug: string, lid: number) => {
    const e = await _empresa(slug);
    let l = await _lanc_ou_404(slug, lid);
    const req = request();
    if (req.method === "POST") {
      _csrf();
      const cab = await _ler_cabecalho(slug, l.tipo);
      const parc = _ler_parcelas();
      const rateio = await _ler_rateio(slug, l.tipo);
      if (!cab.descricao || !parc.length || !rateio.length) {
        flash("Informe descrição, valor, vencimento e ao menos uma categoria.", "erro");
        return redirect(url_for("financas.lancamento", { slug, lid }));
      }
      Object.assign(cab, {
        valor: parc[0].valor, vencimento: parc[0].vencimento, previsao: parc[0].previsao,
        competencia: cab.competencia || d.competencia_valida(parc[0].vencimento),
      });
      await d.atualizar_lancamento(lid, cab, rateio);
      let n_prop = 0;
      if (req.form.get("propagar") && l.grupo) {
        // aplica descrição-base, pessoa, conta, forma, categorias e natureza às próximas parcelas em aberto
        for (const x of await d.completar(await d.q("SELECT * FROM financas_lancamentos WHERE grupo = ? AND parcela > ? AND cancelado = 0 ORDER BY id",
          [l.grupo, l.parcela]), slug)) {
          if (!["aberto", "vencido"].includes(x.situacao)) continue;
          let desc = cab.descricao;
          if (l.repeticao === "parcelado") desc = desc.replace(/\s*\(\d+\/\d+\)$/, "") + ` (${x.parcela}/${x.parcelas})`;
          await d.atualizar_lancamento(x.id, {
            ...cab, descricao: desc, valor: x.valor, vencimento: x.vencimento,
            previsao: x.previsao, competencia: x.competencia,
          }, rateio);
          n_prop += 1;
        }
      }
      const [salvos, recusados] = await d.salvar_anexos(slug, lid, "", req.files.get("anexos") ?? [], _usuario().id);
      flash("Lançamento atualizado." + (n_prop ? ` Aplicado também a ${n_prop} parcela(s) seguinte(s).` : "")
        + (salvos ? ` ${salvos} anexo(s) salvo(s).` : ""), "ok");
      if (recusados.length) flash("Anexos não salvos: " + recusados.join("; "), "erro");
      return redirect(_voltar(url_for("financas.lancamento", { slug, lid })));
    }
    l = (await d.completar([await d.q("SELECT * FROM financas_lancamentos WHERE id = ?", [lid], true)], slug))[0];
    const baixas = await d.q("SELECT b.*, c.nome AS conta_nome FROM financas_baixas b LEFT JOIN financas_contas c ON c.id = b.conta_id " +
      "WHERE b.lancamento_id = ? ORDER BY b.data, b.id", [lid]);
    const irmaos = l.grupo ? await d.completar(await d.q("SELECT * FROM financas_lancamentos WHERE grupo = ? AND grupo <> '' ORDER BY parcela, id",
      [l.grupo]), slug) : [];
    return render_template("financas/lancamento_form.html", {
      ...(await _form_ctx(e, l.tipo)), l, baixas, irmaos,
      rateio: await d.rateio_de(l), anexos: await d.anexos_de(l), hoje: d.hoje().isoformat(),
      voltar: url_for("financas.lancamentos", { slug, tipo: l.tipo }),
    });
  });

  /** Lista de clientes/fornecedores para a busca da tela de lançamento (sempre atualizada). */
  get("financas.pessoas_json", "/financas/<slug>/pessoas.json", async (slug: string) => {
    await _empresa(slug);
    const t = request().args.get("tipo");
    const tipo = t === "cliente" || t === "fornecedor" ? t : null;
    return jsonify((await d.pessoas(slug, tipo)).map((p) => ({
      cidade: p.cidade || "", doc: p.documento || "", fantasia: p.nome_fantasia || "", id: p.id, nome: p.nome, uf: p.uf || "",
    })));
  });

  /** Ajusta vencimento e valor das parcelas em aberto do mesmo grupo. */
  post("financas.lancamento_parcelas", "/financas/<slug>/lancamento/<int:lid>/parcelas", async (slug: string, lid: number) => {
    await _empresa(slug);
    _csrf();
    const l = await _lanc_ou_404(slug, lid);
    const f = request().form;
    let n = 0;
    for (const x of await d.completar(await d.q("SELECT * FROM financas_lancamentos WHERE grupo = ? AND grupo <> '' AND empresa_slug = ? ORDER BY id",
      [l.grupo, slug]), slug)) {
      if (!["aberto", "vencido"].includes(x.situacao)) continue;
      const venc = d.data_valida(f.get(`venc_${x.id}`));
      const prev = d.data_valida(f.get(`prev_${x.id}`), venc);
      const val = d.para_centavos(f.get(`valor_${x.id}`));
      if (!venc || !val || val <= 0 || (venc === x.vencimento && val === x.valor && prev === x.previsao)) continue;
      await d.atualizar_lancamento(x.id, { ...x, valor: val, vencimento: venc, previsao: prev },
        (await d.rateio_de(x)).map((r) => ({ ...r, valor: r.valor })));
      n += 1;
    }
    flash(n ? `${n} parcela(s) ajustada(s).` : "Nenhuma parcela alterada.", "ok");
    return redirect(url_for("financas.lancamento", { slug, lid }) + "#parcelas");
  });

  get("financas.anexo_baixar", "/financas/<slug>/anexo/<int:aid>", async (slug: string, aid: number) => {
    await _empresa(slug);
    const a = await d.q("SELECT * FROM financas_anexos WHERE id = ? AND empresa_slug = ?", [aid, slug], true);
    const p = a ? d.caminho_anexo(a) : null;
    const dados = p ? await lerArquivo(p) : null;
    if (!dados) abort(404);
    const nome = String(a.nome);
    const i = nome.lastIndexOf(".");
    const mime = (i > 0 && MIMES[nome.slice(i).toLowerCase()]) || "application/octet-stream";
    return sendFile(dados!, { download_name: nome, mimetype: mime, as_attachment: request().args.get("baixar") === "1" });
  });

  post("financas.anexo_excluir", "/financas/<slug>/anexo/<int:aid>/excluir", async (slug: string, aid: number) => {
    await _empresa(slug);
    _csrf();
    const a = await d.q("SELECT * FROM financas_anexos WHERE id = ? AND empresa_slug = ?", [aid, slug], true);
    if (a) {
      await d.excluir_anexo(a);
      flash("Anexo removido.", "ok");
    }
    return redirect(_voltar(url_for("financas.lancamento", { slug, lid: a ? a.lancamento_id : 0 })));
  });

  post("financas.lancamento_baixar", "/financas/<slug>/lancamento/<int:lid>/baixar", async (slug: string, lid: number) => {
    await _empresa(slug);
    _csrf();
    const l = (await d.completar([await _lanc_ou_404(slug, lid)], slug))[0];
    const volta = _voltar(url_for("financas.lancamento", { slug, lid }));
    if (["pago", "cancelado"].includes(l.situacao)) {
      flash("Este lançamento não tem saldo para baixar.", "erro");
      return redirect(volta);
    }
    const f = request().form;
    const conta = await _do_slug("financas_contas", _int("conta_id"), slug);
    const valor = d.para_centavos(f.get("valor"));
    const juros = d.para_centavos(f.get("juros")) || 0;
    const desconto = d.para_centavos(f.get("desconto")) || 0;
    const data_ = d.data_valida(f.get("data"), d.hoje().isoformat());
    if (!conta) flash("Escolha a conta onde o valor entrou ou saiu.", "erro");
    else if (!valor || valor <= 0) flash("Informe o valor pago.", "erro");
    else {
      await d.registrar_baixa(slug, l, conta, data_, valor, Math.max(juros, 0), Math.max(desconto, 0), _usuario().id);
      flash(l.tipo === "receber" ? "Recebimento registrado." : "Pagamento registrado.", "ok");
    }
    return redirect(volta);
  });

  /** Baixa em lote: quita o saldo de vários lançamentos de uma vez (como no Omie). */
  post("financas.lote_baixar", "/financas/<slug>/lote/baixar", async (slug: string) => {
    await _empresa(slug);
    _csrf();
    const f = request().form;
    const conta = await _do_slug("financas_contas", _int("conta_id"), slug);
    const data_ = d.data_valida(f.get("data"), d.hoje().isoformat());
    const ids = f.getlist("ids").filter(ehDigitos).map((x: string) => parseInt(x, 10));
    const volta = _voltar(url_for("financas.painel", { slug }));
    if (!conta || !ids.length) {
      flash("Selecione os lançamentos e a conta.", "erro");
      return redirect(volta);
    }
    let n = 0;
    for (const l of await d.completar(await d.q(`SELECT * FROM financas_lancamentos WHERE empresa_slug = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
      [slug, ...ids]), slug)) {
      if (ABERTAS.includes(l.situacao) && l.saldo > 0) {
        await d.registrar_baixa(slug, l, conta, data_, l.saldo, 0, 0, _usuario().id);
        n += 1;
      }
    }
    flash(`${n} lançamento(s) baixado(s).`, "ok");
    return redirect(volta);
  });

  post("financas.lancamento_acao", "/financas/<slug>/lancamento/<int:lid>/<any(cancelar, reativar, excluir):acao>", async (slug: string, lid: number, acao: string) => {
    await _empresa(slug);
    _csrf();
    const l = await _lanc_ou_404(slug, lid);
    const tem_baixa = (await d.q("SELECT 1 FROM financas_baixas WHERE lancamento_id = ? LIMIT 1", [lid])).length;
    const lista = url_for("financas.lancamentos", { slug, tipo: l.tipo });
    if (acao === "cancelar") {
      await d.ex("UPDATE financas_lancamentos SET cancelado = 1, atualizado_em = ? WHERE id = ?", [d.agora_iso(), lid]);
      flash("Lançamento cancelado (fica no histórico, fora dos totais).", "ok");
    } else if (acao === "reativar") {
      await d.ex("UPDATE financas_lancamentos SET cancelado = 0, atualizado_em = ? WHERE id = ?", [d.agora_iso(), lid]);
      flash("Lançamento reativado.", "ok");
    } else if (acao === "excluir") {
      if (tem_baixa) flash("Estorne os pagamentos antes de excluir este lançamento.", "erro");
      else {
        for (const a of await d.q("SELECT * FROM financas_anexos WHERE lancamento_id = ?", [lid])) await d.excluir_anexo(a);
        await d.ex("DELETE FROM financas_rateios WHERE lancamento_id = ?", [lid]);
        await d.ex("DELETE FROM financas_lancamentos WHERE id = ?", [lid]);
        flash("Lançamento excluído.", "ok");
        return redirect(lista);
      }
    }
    return redirect(_voltar(url_for("financas.lancamento", { slug, lid })));
  });

  post("financas.baixa_estornar", "/financas/<slug>/baixa/<int:bid>/estornar", async (slug: string, bid: number) => {
    await _empresa(slug);
    _csrf();
    const b = await d.q("SELECT b.*, l.empresa_slug FROM financas_baixas b JOIN financas_lancamentos l ON l.id = b.lancamento_id " +
      "WHERE b.id = ?", [bid], true);
    if (!b || b.empresa_slug !== slug) abort(404);
    await d.estornar_baixa(bid);
    flash("Pagamento estornado e retirado do extrato.", "ok");
    return redirect(_voltar(url_for("financas.lancamento", { slug, lid: b.lancamento_id })));
  });

  // ───────────────────────── extrato ─────────────────────────
  get("financas.extrato", "/financas/<slug>/extrato", async (slug: string) => {
    const e = await _empresa(slug);
    const contas = await d.contas(slug, false, true);
    const conta_id = _int("conta", request().args) || (contas.length ? contas[0].id : null);
    const conta = contas.find((c) => c.id === conta_id) ?? null;
    const [de, ate] = _periodo();
    let movs: any[] = [], saldo_ini = 0;
    if (conta) {
      saldo_ini = await d.saldo_conta_ate(conta, PyDate.fromisoformat(de).addDays(-1).isoformat());
      movs = await d.q("SELECT m.*, c.nome AS categoria_nome, p.nome AS pessoa_nome, b.lancamento_id FROM financas_movimentos m " +
        "LEFT JOIN financas_categorias c ON c.id = m.categoria_id LEFT JOIN financas_pessoas p ON p.id = m.pessoa_id " +
        "LEFT JOIN financas_baixas b ON b.id = m.baixa_id " +
        "WHERE m.conta_id = ? AND m.data BETWEEN ? AND ? ORDER BY m.data, m.id", [conta.id, de, ate]);
      let s = saldo_ini;
      for (const m of movs) { s += m.valor; m.saldo = s; }
    }
    return render_template("financas/extrato.html", {
      ...(await _ctx(e, "extrato")), contas, conta, de, ate,
      nav: _navegacao_mes(de, ate),
      movs, saldo_ini,
      entradas: movs.filter((m) => m.valor > 0).reduce((a, m) => a + m.valor, 0),
      saidas: -movs.filter((m) => m.valor < 0).reduce((a, m) => a + m.valor, 0),
      categorias: await d.categorias(slug), pessoas: await d.pessoas(slug),
    });
  });

  /** Movimento avulso direto no extrato (ex.: tarifa, rendimento) — registrado como lançamento já pago. */
  post("financas.movimento_novo", "/financas/<slug>/movimento/novo", async (slug: string) => {
    await _empresa(slug);
    _csrf();
    const f = request().form;
    const conta = await _do_slug("financas_contas", _int("conta_id"), slug);
    const valor = d.para_centavos(f.get("valor"));
    const tipo = f.get("sentido") === "entrada" ? "receber" : "pagar";
    const data_ = d.data_valida(f.get("data"), d.hoje().isoformat());
    const volta = _voltar(url_for("financas.extrato", { slug, conta }));
    if (!conta || !valor || valor <= 0 || !(f.get("descricao") || "").trim()) {
      flash("Informe conta, descrição e valor.", "erro");
      return redirect(volta);
    }
    const u = _usuario();
    const dados = {
      descricao: corta(f.get("descricao").trim(), 200), valor, vencimento: data_, competencia: data_,
      categoria_id: await _do_slug("financas_categorias", _int("categoria_id"), slug),
      pessoa_id: await _do_slug("financas_pessoas", _int("pessoa_id"), slug), conta_id: conta, modo: "unico", parcelas: 1,
    };
    const lid = (await d.criar_lancamentos(slug, tipo, dados, u.id))[0];
    await d.registrar_baixa(slug, await d.q("SELECT * FROM financas_lancamentos WHERE id = ?", [lid], true), conta, data_, valor, 0, 0, u.id);
    flash("Movimento lançado no extrato.", "ok");
    return redirect(volta);
  });

  post("financas.transferencia", "/financas/<slug>/transferencia", async (slug: string) => {
    await _empresa(slug);
    _csrf();
    const f = request().form;
    const o = await _do_slug("financas_contas", _int("origem_id"), slug);
    const dd = await _do_slug("financas_contas", _int("destino_id"), slug);
    const valor = d.para_centavos(f.get("valor"));
    const data_ = d.data_valida(f.get("data"), d.hoje().isoformat());
    const volta = _voltar(url_for("financas.extrato", { slug, conta: o }));
    if (!o || !dd || o === dd || !valor || valor <= 0) {
      flash("Escolha contas diferentes e um valor maior que zero.", "erro");
      return redirect(volta);
    }
    const agora = d.agora_iso();
    const nomes = new Map<number, string>((await d.contas(slug)).map((c) => [c.id, c.nome]));
    const desc = corta((f.get("descricao") || "").trim(), 200);
    const tid = await d.ex("INSERT INTO financas_transferencias (empresa_slug, origem_id, destino_id, data, valor, descricao, criado_em) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)", [slug, o, dd, data_, valor, desc, agora]);
    const uid = _usuario().id;
    await d.ex("INSERT INTO financas_movimentos (empresa_slug, conta_id, data, descricao, valor, origem, transferencia_id, criado_por, criado_em) " +
      "VALUES (?, ?, ?, ?, ?, 'transferencia', ?, ?, ?)", [slug, o, data_, desc || `Transferência para ${nomes.get(dd)}`, -valor, tid, uid, agora]);
    await d.ex("INSERT INTO financas_movimentos (empresa_slug, conta_id, data, descricao, valor, origem, transferencia_id, criado_por, criado_em) " +
      "VALUES (?, ?, ?, ?, ?, 'transferencia', ?, ?, ?)", [slug, dd, data_, desc || `Transferência de ${nomes.get(o)}`, valor, tid, uid, agora]);
    flash("Transferência registrada nas duas contas.", "ok");
    return redirect(volta);
  });

  post("financas.transferencia_excluir", "/financas/<slug>/transferencia/<int:tid>/excluir", async (slug: string, tid: number) => {
    await _empresa(slug);
    _csrf();
    const t = await d.q("SELECT * FROM financas_transferencias WHERE id = ? AND empresa_slug = ?", [tid, slug], true);
    if (!t) abort(404);
    for (const m of await d.q("SELECT id FROM financas_movimentos WHERE transferencia_id = ?", [tid])) {
      await d.ex("UPDATE financas_extrato_importado SET status = 'pendente', movimento_id = NULL WHERE movimento_id = ?", [m.id]);
    }
    await d.ex("DELETE FROM financas_movimentos WHERE transferencia_id = ?", [tid]);
    await d.ex("DELETE FROM financas_transferencias WHERE id = ?", [tid]);
    flash("Transferência excluída.", "ok");
    return redirect(_voltar(url_for("financas.extrato", { slug })));
  });

  // ───────────────────────── conciliação bancária ─────────────────────────
  get("financas.conciliacao", "/financas/<slug>/conciliacao", async (slug: string) => {
    const e = await _empresa(slug);
    const contas = await d.contas(slug, false, true);
    const conta_id = _int("conta", request().args) || (contas.length ? contas[0].id : null);
    const conta = contas.find((c) => c.id === conta_id) ?? null;
    let pend: any[] = [], feitas: any[] = [];
    if (conta) {
      pend = await d.q("SELECT * FROM financas_extrato_importado WHERE conta_id = ? AND status = 'pendente' ORDER BY data, id", [conta.id]);
      for (const p of pend) p.sugestoes = await d.sugestoes_conciliacao(slug, p);
      feitas = await d.q("SELECT * FROM financas_extrato_importado WHERE conta_id = ? AND status <> 'pendente' ORDER BY data DESC, id DESC LIMIT 30",
        [conta.id]);
    }
    return render_template("financas/conciliacao.html", {
      ...(await _ctx(e, "conciliacao")), contas, conta, pend,
      feitas, categorias: await d.categorias(slug), pessoas: await d.pessoas(slug),
      importacoes: conta ? await d.q("SELECT * FROM financas_importacoes WHERE conta_id = ? ORDER BY id DESC LIMIT 5", [conta.id]) : [],
    });
  });

  post("financas.conciliacao_importar", "/financas/<slug>/conciliacao/importar", async (slug: string) => {
    await _empresa(slug);
    _csrf();
    const conta = await _do_slug("financas_contas", _int("conta_id"), slug);
    const arq = request().file("arquivo");
    const volta = url_for("financas.conciliacao", { slug, conta });
    if (!conta || !arq || !arq.filename) {
      flash("Escolha a conta e o arquivo OFX do banco.", "erro");
      return redirect(volta);
    }
    const conteudo = arq.read();
    if (conteudo.length > 5 * 1024 * 1024) {
      flash("Arquivo muito grande (máximo 5 MB).", "erro");
      return redirect(volta);
    }
    const itens = d.ler_ofx(conteudo);
    if (!itens.length) {
      flash("Não encontrei lançamentos nesse arquivo. Exporte o extrato no formato OFX pelo internet banking.", "erro");
      return redirect(volta);
    }
    const ja = new Set((await d.q("SELECT fitid FROM financas_extrato_importado WHERE conta_id = ? AND fitid <> ''", [conta])).map((r: any) => r.fitid));
    const novos = itens.filter((i) => !i.fitid || !ja.has(i.fitid));
    const imp = await d.ex("INSERT INTO financas_importacoes (empresa_slug, conta_id, arquivo, linhas, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)",
      [slug, conta, corta(arq.filename, 200), novos.length, _usuario().id, d.agora_iso()]);
    for (const i of novos) {
      await d.ex("INSERT INTO financas_extrato_importado (importacao_id, empresa_slug, conta_id, data, valor, descricao, fitid) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)", [imp, slug, conta, i.data, i.valor, i.descricao, i.fitid]);
    }
    const rep = itens.length - novos.length;
    flash(`${novos.length} lançamento(s) importado(s) para conciliar` + (rep ? `; ${rep} já estavam importados.` : "."), "ok");
    return redirect(volta);
  });

  post("financas.conciliacao_acao", "/financas/<slug>/conciliacao/<int:xid>/<any(vincular, criar, ignorar, desfazer):acao>", async (slug: string, xid: number, acao: string) => {
    await _empresa(slug);
    _csrf();
    const x = await _linha_ou_404(slug, xid);
    const u = _usuario();
    const f = request().form;
    const volta = url_for("financas.conciliacao", { slug, conta: x.conta_id });
    if (acao === "ignorar") {
      await d.ex("UPDATE financas_extrato_importado SET status = 'ignorado' WHERE id = ?", [xid]);
      return redirect(volta);
    }
    if (acao === "desfazer") {
      await d.ex("UPDATE financas_extrato_importado SET status = 'pendente', movimento_id = NULL WHERE id = ?", [xid]);
      return redirect(volta);
    }
    if (x.status !== "pendente") return redirect(volta);
    let mid: number;
    if (acao === "vincular") {
      const l = (await d.completar([await _lanc_ou_404(slug, _int("lancamento_id") || 0)], slug))[0];
      const tipo_ok = (l.tipo === "receber") === (x.valor > 0);
      if (!tipo_ok || !ABERTAS.includes(l.situacao)) {
        flash("Esse lançamento não combina com a linha do extrato.", "erro");
        return redirect(volta);
      }
      const valor = Math.abs(x.valor);
      const juros = Math.max(valor - l.saldo, 0);
      const desconto = f.get("quitar") ? Math.max(l.saldo - valor, 0) : 0;
      [, mid] = await d.registrar_baixa(slug, l, x.conta_id, x.data, valor, juros, desconto, u.id);
    } else { // criar lançamento novo já pago a partir da linha
      const tipo = x.valor > 0 ? "receber" : "pagar";
      const tipo_cat = tipo === "receber" ? "receita" : "despesa";
      let cat = _int("categoria_id");
      if (cat && !(await d.q("SELECT 1 FROM financas_categorias WHERE id = ? AND empresa_slug = ? AND tipo = ?", [cat, slug, tipo_cat])).length) cat = null;
      const dados = {
        descricao: corta((f.get("descricao") || x.descricao).trim(), 200), valor: Math.abs(x.valor),
        vencimento: x.data, competencia: x.data, categoria_id: cat,
        pessoa_id: await _do_slug("financas_pessoas", _int("pessoa_id"), slug), conta_id: x.conta_id,
        modo: "unico", parcelas: 1,
      };
      const lid = (await d.criar_lancamentos(slug, tipo, dados, u.id))[0];
      [, mid] = await d.registrar_baixa(slug, await d.q("SELECT * FROM financas_lancamentos WHERE id = ?", [lid], true),
        x.conta_id, x.data, Math.abs(x.valor), 0, 0, u.id);
    }
    await d.ex("UPDATE financas_movimentos SET conciliado = 1, fitid = ? WHERE id = ?", [x.fitid, mid]);
    await d.ex("UPDATE financas_extrato_importado SET status = 'conciliado', movimento_id = ? WHERE id = ?", [mid, xid]);
    flash("Conciliado.", "ok");
    return redirect(volta);
  });

  // ───────────────────────── relatórios ─────────────────────────
  get("financas.rel_fluxo", "/financas/<slug>/relatorios/fluxo", async (slug: string) => {
    const e = await _empresa(slug);
    const ano = request().args.get("ano", null, "int") || d.hoje().year;
    const meses = await d.fluxo_mensal(slug, ano);
    const maior = Math.max(...meses.map((m) => Math.max(m.entradas + m.prev_entradas, m.saidas + m.prev_saidas)), 1);
    const acum: number[] = [];
    let s = 0;
    for (const m of meses) {
      s += (m.entradas + m.prev_entradas) - (m.saidas + m.prev_saidas);
      acum.push(s);
    }
    return render_template("financas/rel_fluxo.html", { ...(await _ctx(e, "rel_fluxo")), ano, meses, maior, acum });
  });

  get("financas.rel_dre", "/financas/<slug>/relatorios/dre", async (slug: string) => {
    const e = await _empresa(slug);
    const ano = request().args.get("ano", null, "int") || d.hoje().year;
    const regime = request().args.get("regime") === "caixa" ? "caixa" : "competencia";
    return render_template("financas/rel_dre.html", {
      ...(await _ctx(e, "rel_dre")), ano, regime, r: await d.dre(slug, ano, regime),
      MESES: d.MESES,
    });
  });

  // ───────────────────────── cadastros ─────────────────────────
  route("financas.cad_contas", "/financas/<slug>/cadastros/contas", ["GET", "POST"], async (slug: string) => {
    const e = await _empresa(slug);
    const req = request();
    if (req.method === "POST") {
      _csrf();
      const f = req.form;
      if (f.get("acao") === "considerar") { // seleção em lote (quadro "Contas consideradas no sistema")
        const marcadas = new Set(f.getlist("considerada").filter(ehDigitos).map((x: string) => parseInt(x, 10)));
        for (const c of await d.contas(slug)) {
          await d.ex("UPDATE financas_contas SET considerada = ? WHERE id = ?", [marcadas.has(c.id) ? 1 : 0, c.id]);
        }
        flash(`${marcadas.size} conta(s) considerada(s) no sistema. As demais saem dos saldos, listas e relatórios.`, "ok");
        return redirect(url_for("financas.cad_contas", { slug }));
      }
      const cid = await _do_slug("financas_contas", _int("id"), slug);
      const nome = corta((f.get("nome") || "").trim(), 80);
      if (!nome) {
        flash("Informe o nome da conta.", "erro");
        return redirect(url_for("financas.cad_contas", { slug }));
      }
      const campos = [nome, f.get("tipo") in d.TIPOS_CONTA ? f.get("tipo") : "corrente", corta((f.get("banco") || "").trim(), 60),
        corta((f.get("agencia") || "").trim(), 20), corta((f.get("numero") || "").trim(), 30),
        d.para_centavos(f.get("saldo_inicial")) || 0, d.data_valida(f.get("data_saldo_inicial"), d.hoje().isoformat()),
        _ativo("ativa"), _ativo("considerada")];
      if (cid) {
        await d.ex("UPDATE financas_contas SET nome=?, tipo=?, banco=?, agencia=?, numero=?, saldo_inicial=?, data_saldo_inicial=?, ativa=?, considerada=? " +
          "WHERE id = ?", [...campos, cid]);
        flash("Conta atualizada.", "ok");
      } else {
        await d.ex("INSERT INTO financas_contas (nome, tipo, banco, agencia, numero, saldo_inicial, data_saldo_inicial, ativa, considerada, empresa_slug, criado_em) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [...campos, slug, d.agora_iso()]);
        flash("Conta cadastrada.", "ok");
      }
      return redirect(url_for("financas.cad_contas", { slug }));
    }
    const editar = await d.q("SELECT * FROM financas_contas WHERE id = ? AND empresa_slug = ?", [req.args.get("editar", null, "int"), slug], true);
    return render_template("financas/cad_contas.html", { ...(await _ctx(e, "cad_contas")), contas: await d.contas(slug), editar });
  });

  /** Liga/desliga a conta no sistema, direto da lista de contas. */
  post("financas.cad_contas_considerar", "/financas/<slug>/cadastros/contas/<int:cid>/considerar", async (slug: string, cid: number) => {
    await _empresa(slug);
    _csrf();
    const conta_id = await _do_slug("financas_contas", cid, slug);
    if (conta_id) {
      await d.ex("UPDATE financas_contas SET considerada = CASE considerada WHEN 1 THEN 0 ELSE 1 END " +
        "WHERE id = ?", [conta_id]);
    }
    return redirect(_voltar(url_for("financas.cad_contas", { slug })));
  });

  route("financas.cad_pessoas", "/financas/<slug>/cadastros/pessoas", ["GET", "POST"], async (slug: string) => {
    const e = await _empresa(slug);
    const req = request();
    if (req.method === "POST") {
      _csrf();
      const f = req.form;
      let pid = await _do_slug("financas_pessoas", _int("id"), slug);
      const nome = corta((f.get("nome") || "").trim(), 160);
      if (!nome) {
        flash("Informe o nome.", "erro");
        return redirect(url_for("financas.cad_pessoas", { slug }));
      }
      const doc = d.so_digitos(f.get("documento")).slice(0, 14);
      if (doc) {
        if ((doc.length === 11 && !cpf_valido(doc)) || (doc.length === 14 && !cnpj_valido(doc)) || ![11, 14].includes(doc.length)) {
          flash("CPF/CNPJ inválido — confira os dígitos.", "erro");
          return redirect(url_for("financas.cad_pessoas", { slug, editar: pid || null }));
        }
        const dup = await d.q("SELECT id, nome FROM financas_pessoas WHERE empresa_slug = ? AND documento = ? AND id <> ?",
          [slug, doc, pid || 0], true);
        if (dup) {
          flash(`Este CPF/CNPJ já está cadastrado para ${dup.nome}.`, "erro");
          return redirect(url_for("financas.cad_pessoas", { slug, editar: dup.id }));
        }
      }
      const txt = (k: string, n = 120) => corta((f.get(k) || "").trim(), n);
      const banco = d.so_digitos(f.get("banco_codigo")).slice(0, 3);
      const base: Record<string, any> = {
        tipo: f.get("tipo") in d.TIPOS_PESSOA ? f.get("tipo") : "cliente", nome, documento: doc,
        email: txt("email", 160).toLowerCase(), telefone: txt("telefone", 40), cidade: txt("cidade", 80),
        uf: txt("uf", 2).toUpperCase(), obs: txt("obs", 1000), ativo: _ativo(),
        nome_fantasia: txt("nome_fantasia", 160), cep: txt("cep", 9), logradouro: txt("logradouro", 160),
        numero: txt("numero", 20), complemento: txt("complemento", 80), bairro: txt("bairro", 80),
        situacao_receita: txt("situacao_receita", 40), atividade: txt("atividade", 200),
        banco_codigo: banco ? banco.padStart(3, "0") : "", banco_nome: banco ? (d.NOME_BANCO[banco.padStart(3, "0")] ?? txt("banco_nome", 80)) : "",
        agencia: d.so_digitos(f.get("agencia")).slice(0, 6), agencia_dv: txt("agencia_dv", 2).toUpperCase(),
        conta: d.so_digitos(f.get("conta")).slice(0, 15), conta_dv: txt("conta_dv", 2).toUpperCase(),
        conta_tipo: f.get("conta_tipo") in d.CONTA_TIPOS ? f.get("conta_tipo") : "",
        titular_nome: txt("titular_nome", 160), titular_documento: d.so_digitos(f.get("titular_documento")).slice(0, 14),
        pix_tipo: f.get("pix_tipo") in d.PIX_TIPOS ? f.get("pix_tipo") : "", pix_chave: txt("pix_chave", 120),
      };
      const cols = Object.keys(base);
      if (pid) {
        await d.ex(`UPDATE financas_pessoas SET ${cols.map((c) => c + " = ?").join(", ")} WHERE id = ?`, [...Object.values(base), pid]);
        flash("Cadastro atualizado.", "ok");
      } else {
        pid = await d.ex(`INSERT INTO financas_pessoas (${cols.join(", ")}, empresa_slug, criado_em) VALUES ` +
          `(${cols.map(() => "?").join(", ")}, ?, ?)`, [...Object.values(base), slug, d.agora_iso()]);
        flash(`${nome} cadastrado.`, "ok");
      }
      return redirect(url_for("financas.cad_pessoas", { slug, tipo: req.args.get("tipo") || null, editar: pid }));
    }
    const tipo = req.args.get("tipo", "");
    const busca = (req.args.get("q") || "").trim();
    const lista = await d.pessoas(slug, tipo || null, busca, false);
    const editar = await d.q("SELECT * FROM financas_pessoas WHERE id = ? AND empresa_slug = ?", [req.args.get("editar", null, "int"), slug], true);
    return render_template("financas/cad_pessoas.html", {
      ...(await _ctx(e, "cad_pessoas")), lista, tipo, busca, editar,
      pode_importar: slug === portal.EMPRESA_CONDOMINIOS, BANCOS: d.BANCOS, CONTA_TIPOS: d.CONTA_TIPOS,
      PIX_TIPOS: d.PIX_TIPOS, novo: req.args.get("novo") === "1",
    });
  });

  /** Consulta CPF/CNPJ (Receita para CNPJ; cadastros do app para CPF) e devolve os dados para o formulário. */
  get("financas.cad_pessoas_consulta", "/financas/<slug>/cadastros/pessoas/consulta", async (slug: string) => {
    await _empresa(slug);
    const doc = d.so_digitos(request().args.get("doc"));
    const r = await consultar(slug, doc);
    const ja = doc ? await d.q("SELECT id, nome FROM financas_pessoas WHERE empresa_slug = ? AND documento = ? AND id <> ?",
      [slug, doc, request().args.get("id", 0, "int")], true) : null;
    if (ja) {
      r.ja_cadastrado = { id: ja.id, nome: ja.nome, url: url_for("financas.cad_pessoas", { slug, editar: ja.id }) };
    }
    return jsonify(r);
  });

  /** Traz os clientes do módulo Condomínios (somente leitura da tabela clients) como clientes do Finanças. */
  post("financas.cad_pessoas_importar", "/financas/<slug>/cadastros/pessoas/importar-condominios", async (slug: string) => {
    await _empresa(slug);
    _csrf();
    if (slug !== portal.EMPRESA_CONDOMINIOS) abort(404);
    const ja = new Set((await d.q("SELECT externo_id FROM financas_pessoas WHERE empresa_slug = ? AND origem = 'condominios'", [slug])).map((r: any) => r.externo_id));
    const permitidos = new Set(["email", "telefone", "cep", "logradouro", "bairro", "cidade", "uf", ...d.PESSOAS_CAMPOS_EXTRAS]);
    let n = 0;
    for (const c of await d.q("SELECT id, full_name, cpf FROM clients ORDER BY full_name, id")) {
      if (ja.has(String(c.id))) continue;
      const doc = d.so_digitos(c.cpf).slice(0, 14);
      const x: Record<string, any> = doc ? { ...(((await consultar_local("__nenhuma__", doc)) || {}).dados ?? {}) } : {};
      delete x.nome;
      const campos: Record<string, any> = {};
      for (const [k, v] of Object.entries(x)) if (permitidos.has(k)) campos[k] = v || "";
      campos.uf = String(campos.uf ?? "").slice(0, 2).toUpperCase();
      const cols = Object.keys(campos);
      await d.ex(`INSERT INTO financas_pessoas (empresa_slug, tipo, nome, documento, origem, externo_id, criado_em` +
        `${cols.map((k) => ", " + k).join("")}) VALUES (?, 'cliente', ?, ?, 'condominios', ?, ?${", ?".repeat(cols.length)})`,
      [slug, c.full_name, doc, String(c.id), d.agora_iso(), ...Object.values(campos)]);
      n += 1;
    }
    flash(n ? `${n} cliente(s) dos Condomínios trazido(s) para o Finanças.` : "Todos os clientes dos Condomínios já estavam aqui.", "ok");
    return redirect(url_for("financas.cad_pessoas", { slug, tipo: "cliente" }));
  });

  route("financas.cad_categorias", "/financas/<slug>/cadastros/categorias", ["GET", "POST"], async (slug: string) => {
    const e = await _empresa(slug);
    const req = request();
    if (req.method === "POST") {
      _csrf();
      const f = req.form;
      const cid = await _do_slug("financas_categorias", _int("id"), slug);
      const nome = corta((f.get("nome") || "").trim(), 80);
      const grupo = f.get("grupo_dre") in d.NOME_GRUPO ? f.get("grupo_dre") : "";
      const tipo = (d.GRUPOS_DRE.find(([k]) => k === grupo) ?? [null, null, "despesa"])[2];
      if (!nome || !grupo) flash("Informe o nome e o grupo da DRE.", "erro");
      else if (cid) {
        await d.ex("UPDATE financas_categorias SET nome = ?, grupo_dre = ?, tipo = ?, ativo = ? WHERE id = ?",
          [nome, grupo, tipo, _ativo(), cid]);
        flash("Categoria atualizada.", "ok");
      } else {
        await d.ex("INSERT INTO financas_categorias (empresa_slug, tipo, nome, grupo_dre, ordem) VALUES (?, ?, ?, ?, 999)",
          [slug, tipo, nome, grupo]);
        flash("Categoria criada.", "ok");
      }
      return redirect(url_for("financas.cad_categorias", { slug }));
    }
    const cats = await d.categorias(slug, null, false);
    const uso: Record<string, number> = {};
    for (const r of await d.q(
      "SELECT categoria_id, COUNT(DISTINCT lid) AS n FROM (" +
      " SELECT l.categoria_id, l.id lid FROM financas_lancamentos l WHERE l.empresa_slug = ?" +
      " UNION ALL SELECT r.categoria_id, r.lancamento_id FROM financas_rateios r JOIN financas_lancamentos l ON l.id = r.lancamento_id" +
      " WHERE l.empresa_slug = ?) AS x GROUP BY categoria_id", [slug, slug])) uso[r.categoria_id] = r.n;
    const por_grupo = d.GRUPOS_DRE.map(([k, n, nat]) => [k, n, nat, cats.filter((c) => c.grupo_dre === k)]);
    const editar = await d.q("SELECT * FROM financas_categorias WHERE id = ? AND empresa_slug = ?", [req.args.get("editar", null, "int"), slug], true);
    return render_template("financas/cad_categorias.html", { ...(await _ctx(e, "cad_categorias")), por_grupo, uso, editar });
  });

  /** Sugere o grupo da DRE enquanto o usuário digita o nome da categoria. */
  get("financas.cad_categorias_sugerir", "/financas/<slug>/cadastros/categorias/sugerir", async (slug: string) => {
    await _empresa(slug);
    const r = await d.sugerir_grupo(slug, request().args.get("nome", ""), request().args.get("natureza"));
    if (r) r.grupo_nome = d.NOME_GRUPO[r.grupo] ?? "";
    return jsonify(r || {});
  });

  route("financas.cad_centros", "/financas/<slug>/cadastros/centros", ["GET", "POST"], async (slug: string) => {
    const e = await _empresa(slug);
    const req = request();
    if (req.method === "POST") {
      _csrf();
      const cid = await _do_slug("financas_centros", _int("id"), slug);
      const nome = corta((req.form.get("nome") || "").trim(), 80);
      if (!nome) flash("Informe o nome.", "erro");
      else if (cid) {
        await d.ex("UPDATE financas_centros SET nome = ?, ativo = ? WHERE id = ?", [nome, _ativo(), cid]);
        flash("Centro de custo atualizado.", "ok");
      } else {
        await d.ex("INSERT INTO financas_centros (empresa_slug, nome) VALUES (?, ?)", [slug, nome]);
        flash("Centro de custo criado.", "ok");
      }
      return redirect(url_for("financas.cad_centros", { slug }));
    }
    const editar = await d.q("SELECT * FROM financas_centros WHERE id = ? AND empresa_slug = ?", [req.args.get("editar", null, "int"), slug], true);
    return render_template("financas/cad_centros.html", { ...(await _ctx(e, "cad_centros")), centros: await d.centros(slug, false), editar });
  });

  // Produtos da Capuzzo Assessoria (Condomínios, Gestão Tática, Títulos Privados) e integrações
  registrar_capuzzo();
  registrar_cond_ops();
  registrar_gt();
  registrar_omie();
}
