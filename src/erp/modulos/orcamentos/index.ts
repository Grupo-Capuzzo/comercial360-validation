/* eslint-disable @typescript-eslint/no-explicit-any */
// Orçamentos (Grão e Ether Nexus): pedido de compra/serviço → cotações com fornecedores → análise → aprovação
// → lançamento da cotação vencedora no contas a pagar do Finanças da empresa.
// Quadro no estilo do Notion (Entrada … Aprovado → Lançado no contas a pagar), com prioridade e prazo.
// Fornecedores = cadastro de clientes/fornecedores do Finanças (financas_pessoas), com os mesmos dados.
import {
  PyDate, abort, flash, g, get, jsonify, post, q, q1, redirect, render_template, request, route, run, sendFile, url_for,
} from "../../core/flask";
import { lerArquivo, salvarArquivo } from "../../core/arquivos";
import * as portal from "../portal";
import * as d from "../financas/dados";
import { cnpj_valido, cpf_valido } from "../financas/consulta_doc";

export const ETAPAS: [string, string, string][] = [
  ["entrada", "Entrada", "#9a9a9a"],
  ["solicitar", "Solicitar orçamento", "#8d8d8d"],
  ["solicitado", "Orçamento solicitado", "#3b82f6"],
  ["aguardando", "Aguardando retorno", "#d4a017"],
  ["recebido", "Orçamento recebido", "#e07b39"],
  ["analise", "Em análise", "#a26bd6"],
  ["ajuste", "Ajuste / complementação", "#d9534f"],
  ["aprovado", "Aprovado", "#3e9b6a"],
  ["lancado", "Lançado no contas a pagar", "#2f7d4f"],
];
export const NOME_ETAPA: Record<string, string> = Object.fromEntries(ETAPAS.map(([k, n]) => [k, n]));
export const PRIORIDADES: [string, string, string][] = [["baixa", "Baixa", "#7a8a99"], ["normal", "Normal", "#d4a017"], ["alta", "Alta", "#e07b39"], ["critica", "Crítica", "#d9534f"]];
const PRIO: Record<string, [string, string]> = Object.fromEntries(PRIORIDADES.map(([k, n, c]) => [k, [n, c]]));
const FINAIS = ["aprovado", "lancado", "cancelado"];

function agora() { return PyDate.now().isoformat("T").slice(0, 19); }
function hoje() { return PyDate.today().isoformat(); }
function corta(s: any, n: number) { return [...String(s ?? "")].slice(0, n).join(""); }
function u(): any { const x = g().portal_user; if (!x) abort(403); return x; }

async function empresa(slug: string) {
  const base = portal.EMPRESAS_POR_SLUG[slug];
  if (!base || !(base.modulos ?? []).some((m: any) => m.id === "orcamentos")) abort(404);
  if (!(await portal.pode_ver_modulo(u(), slug, "orcamentos"))) abort(403);
  const e = (await portal.empresas_com_status()).find((x: any) => x.slug === slug)!;
  if (e.status === "inativo" && !u().admin) abort(403);
  return e;
}
function csrf() { portal.checar_csrf(); }

async function orc_ou_404(slug: string, oid: number) {
  const o = await q1("SELECT * FROM orc_orcamentos WHERE id = ? AND empresa_slug = ?", [oid, slug]);
  if (!o) abort(404);
  return o;
}
async function historico(oid: number, texto: string) {
  await run("INSERT INTO orc_historico (orcamento_id, usuario_id, texto, criado_em) VALUES (?, ?, ?, ?)", [oid, u().id, corta(texto, 2000), agora()]);
  await run("UPDATE orc_orcamentos SET atualizado_em = ? WHERE id = ?", [agora(), oid]);
}

function situacao_prazo(o: any) {
  if (!o.prazo) return "sem";
  if (FINAIS.includes(o.status)) return "ok";
  if (o.prazo < hoje()) return "atrasado";
  if (o.prazo === hoje()) return "hoje";
  return "no_prazo";
}

/** Orçamentos da empresa com o resumo das cotações (quantidade, menor valor, vencedora). */
async function listar(slug: string, busca = "", prio = "", resp: number | null = null, mostrar_cancelados = false) {
  let sql = "SELECT * FROM orc_orcamentos WHERE empresa_slug = ?";
  const p: any[] = [slug];
  if (!mostrar_cancelados) sql += " AND status <> 'cancelado'";
  if (busca) { sql += " AND (titulo LIKE ? OR descricao LIKE ? OR tipo LIKE ?)"; p.push(`%${busca}%`, `%${busca}%`, `%${busca}%`); }
  if (prio && PRIO[prio]) { sql += " AND prioridade = ?"; p.push(prio); }
  if (resp) { sql += " AND responsavel_id = ?"; p.push(resp); }
  const lista = await q(sql + " ORDER BY CASE prioridade WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, CASE WHEN prazo = '' THEN 1 ELSE 0 END, prazo, id DESC", p);
  const ids = lista.map((o) => o.id);
  const [cots, nomes] = await Promise.all([
    ids.length ? q(`SELECT c.orcamento_id, c.id, c.valor, c.frete, p.nome FROM orc_cotacoes c LEFT JOIN financas_pessoas p ON p.id = c.pessoa_id WHERE c.orcamento_id IN (${ids.map(() => "?").join(",")})`, ids) : Promise.resolve([]),
    q("SELECT id, nome FROM portal_usuarios"),
  ]);
  const nm = new Map(nomes.map((r: any) => [r.id, r.nome]));
  for (const o of lista) {
    const cs = cots.filter((c: any) => c.orcamento_id === o.id);
    o.n_cot = cs.length;
    o.menor = cs.length ? Math.min(...cs.map((c: any) => Number(c.valor) + Number(c.frete))) : null;
    const v = cs.find((c: any) => c.id === o.cotacao_vencedora_id);
    o.vencedora = v ? { nome: v.nome, total: Number(v.valor) + Number(v.frete) } : null;
    o.sit = situacao_prazo(o);
    o.prio_nome = PRIO[o.prioridade]?.[0] ?? o.prioridade; o.prio_cor = PRIO[o.prioridade]?.[1] ?? "#999";
    o.resp_nome = o.responsavel_id ? (nm.get(o.responsavel_id) ?? "") : "";
  }
  return lista;
}

/** Fornecedor (cadastro do Finanças): reaproveita pelo CPF/CNPJ ou cria com os mesmos campos do cadastro geral. */
async function salvar_fornecedor(slug: string, f: any): Promise<number> {
  const nome = corta((f.get("f_nome") || "").trim(), 160);
  if (!nome) throw new Error("Informe o nome do fornecedor.");
  const doc = d.so_digitos(f.get("f_documento")).slice(0, 14);
  if (doc && ((doc.length === 11 && !cpf_valido(doc)) || (doc.length === 14 && !cnpj_valido(doc)) || ![11, 14].includes(doc.length))) throw new Error("CPF/CNPJ do fornecedor inválido.");
  const txt = (k: string, n = 120) => corta((f.get("f_" + k) || "").trim(), n);
  const banco = d.so_digitos(f.get("f_banco_codigo")).slice(0, 3);
  const base: Record<string, any> = {
    tipo: "fornecedor", nome, documento: doc, email: txt("email", 160).toLowerCase(), telefone: txt("telefone", 40),
    nome_fantasia: txt("nome_fantasia", 160), cep: txt("cep", 9), logradouro: txt("logradouro", 160), numero: txt("numero", 20),
    complemento: txt("complemento", 80), bairro: txt("bairro", 80), cidade: txt("cidade", 80), uf: txt("uf", 2).toUpperCase(),
    atividade: txt("atividade", 200), situacao_receita: txt("situacao_receita", 40),
    banco_codigo: banco ? banco.padStart(3, "0") : "", banco_nome: banco ? (d.NOME_BANCO[banco.padStart(3, "0")] ?? txt("banco_nome", 80)) : "",
    agencia: d.so_digitos(f.get("f_agencia")).slice(0, 6), agencia_dv: txt("agencia_dv", 2).toUpperCase(),
    conta: d.so_digitos(f.get("f_conta")).slice(0, 15), conta_dv: txt("conta_dv", 2).toUpperCase(),
    conta_tipo: f.get("f_conta_tipo") in d.CONTA_TIPOS ? f.get("f_conta_tipo") : "",
    titular_nome: txt("titular_nome", 160), titular_documento: d.so_digitos(f.get("f_titular_documento")).slice(0, 14),
    pix_tipo: f.get("f_pix_tipo") in d.PIX_TIPOS ? f.get("f_pix_tipo") : "", pix_chave: txt("pix_chave", 120), obs: txt("obs", 1000),
  };
  const ja = doc ? await q1("SELECT id FROM financas_pessoas WHERE empresa_slug = ? AND documento = ?", [slug, doc]) : null;
  const cols = Object.keys(base).filter((k) => base[k] !== "" || k === "nome");
  if (ja) { // completa o cadastro existente com o que veio preenchido
    await run(`UPDATE financas_pessoas SET ${cols.map((c) => c + " = ?").join(", ")} WHERE id = ?`, [...cols.map((c) => base[c]), ja.id]);
    return ja.id;
  }
  return (await run(`INSERT INTO financas_pessoas (${Object.keys(base).join(", ")}, empresa_slug, criado_em) VALUES (${Object.keys(base).map(() => "?").join(", ")}, ?, ?)`,
    [...Object.values(base), slug, d.agora_iso()])).lastrowid!;
}

async function ctx(e: any, ativo: string, extra: Record<string, any> = {}) {
  return {
    t: e.tema_full, empresa: e, modulos: portal.modulos_da_empresa(e), orc_ativo: ativo, ETAPAS, NOME_ETAPA, PRIORIDADES, PRIO,
    moeda: d.moeda, data_br: d.data_br, hoje_iso: hoje(), valor_campo: d.valor_campo, ...extra,
  };
}

export function registrar() {
  // ── Quadro (kanban) ──
  get("orcamentos.quadro", "/orcamentos/<slug>/", async (slug: string) => {
    const e = await empresa(slug);
    await d.garantir_padroes(slug);
    const a = request().args;
    const busca = String(a.get("q") || "").trim(), prio = String(a.get("prio") || ""), resp = a.get("resp", null, "int");
    const lista = await listar(slug, busca, prio, resp);
    const colunas = ETAPAS.map(([k, n, c]) => ({ id: k, nome: n, cor: c, itens: lista.filter((o) => o.status === k) }));
    const usuarios = await q("SELECT id, nome FROM portal_usuarios WHERE ativo = 1 ORDER BY nome");
    const kpi = {
      abertos: lista.filter((o) => !FINAIS.includes(o.status)).length,
      atrasados: lista.filter((o) => o.sit === "atrasado").length,
      aprovados: lista.filter((o) => o.status === "aprovado").length,
      lancados_valor: lista.filter((o) => o.status === "lancado").reduce((s, o) => s + (o.vencedora?.total ?? 0), 0),
    };
    return render_template("orcamentos/quadro.html", await ctx(e, "quadro", { colunas, busca, prio, resp, usuarios, kpi }));
  });

  // ── Lista (tabela) ──
  get("orcamentos.lista", "/orcamentos/<slug>/lista", async (slug: string) => {
    const e = await empresa(slug);
    const a = request().args;
    const busca = String(a.get("q") || "").trim(), prio = String(a.get("prio") || ""), st = String(a.get("status") || "");
    let lista = await listar(slug, busca, prio, null, st === "cancelado");
    if (st) lista = lista.filter((o) => o.status === st);
    return render_template("orcamentos/lista.html", await ctx(e, "lista", { lista, busca, prio, st }));
  });

  // ── Novo ──
  post("orcamentos.novo", "/orcamentos/<slug>/novo", async (slug: string) => {
    await empresa(slug);
    csrf();
    const f = request().form;
    const titulo = corta((f.get("titulo") || "").trim(), 200);
    if (!titulo) { flash("Informe o título do orçamento.", "erro"); return redirect(url_for("orcamentos.quadro", { slug })); }
    const st = NOME_ETAPA[f.get("status")] ? f.get("status") : "entrada";
    const oid = (await run("INSERT INTO orc_orcamentos (empresa_slug, titulo, descricao, tipo, prioridade, prazo, status, responsavel_id, criado_por, criado_em, atualizado_em) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [slug, titulo, corta((f.get("descricao") || "").trim(), 5000), corta((f.get("tipo") || "").trim(), 80), PRIO[f.get("prioridade")] ? f.get("prioridade") : "normal",
      d.data_valida(f.get("prazo"), "") || "", st, f.get("responsavel_id", null, "int") || u().id, u().id, agora(), agora()])).lastrowid!;
    await historico(oid, `Orçamento criado em "${NOME_ETAPA[st]}"`);
    flash("Orçamento criado. Agora cadastre as cotações dos fornecedores.", "ok");
    return redirect(url_for("orcamentos.ver", { slug, oid }));
  });

  // ── Detalhe ──
  get("orcamentos.ver", "/orcamentos/<slug>/<int:oid>", async (slug: string, oid: number) => {
    const e = await empresa(slug);
    const o = await orc_ou_404(slug, oid);
    const [cots, anexos, hist, usuarios, categorias, centros, contas, fornecedores] = await Promise.all([
      q("SELECT c.*, p.nome, p.nome_fantasia, p.documento, p.email, p.telefone, p.cidade, p.uf, p.banco_codigo, p.banco_nome, p.agencia, p.agencia_dv, p.conta, p.conta_dv, p.pix_tipo, p.pix_chave " +
        "FROM orc_cotacoes c LEFT JOIN financas_pessoas p ON p.id = c.pessoa_id WHERE c.orcamento_id = ? ORDER BY (c.valor + c.frete), c.id", [oid]),
      q("SELECT id, cotacao_id, nome, tamanho, criado_em FROM orc_anexos WHERE orcamento_id = ? ORDER BY id", [oid]),
      q("SELECT h.*, u.nome AS autor FROM orc_historico h LEFT JOIN portal_usuarios u ON u.id = h.usuario_id WHERE h.orcamento_id = ? ORDER BY h.id DESC", [oid]),
      q("SELECT id, nome FROM portal_usuarios WHERE ativo = 1 ORDER BY nome"),
      d.categorias(slug, "despesa"), d.centros(slug), d.contas(slug, true),
      q("SELECT id, nome, documento FROM financas_pessoas WHERE empresa_slug = ? AND ativo = 1 AND tipo IN ('fornecedor', 'ambos') ORDER BY nome", [slug]),
    ]);
    const menor = cots.length ? Math.min(...cots.map((c: any) => Number(c.valor) + Number(c.frete))) : 0;
    for (const c of cots) {
      c.total = Number(c.valor) + Number(c.frete);
      c.dif = c.total - menor;
      c.anexos = anexos.filter((a: any) => a.cotacao_id === c.id);
      c.vencedora = c.id === o.cotacao_vencedora_id;
    }
    o.sit = situacao_prazo(o);
    const lancs = o.lancamento_ids ? await q(`SELECT id, descricao, valor, vencimento FROM financas_lancamentos WHERE id IN (${String(o.lancamento_ids).split(",").filter(Boolean).map(() => "?").join(",") || "0"})`,
      String(o.lancamento_ids).split(",").filter(Boolean).map(Number)) : [];
    return render_template("orcamentos/orcamento.html", await ctx(e, "quadro", {
      o, cots, menor, anexos: anexos.filter((a: any) => !a.cotacao_id), hist, usuarios, categorias, centros, contas, fornecedores, lancs,
      venc: cots.find((c: any) => c.vencedora) ?? null, FORMAS: d.FORMAS, BANCOS: d.BANCOS, CONTA_TIPOS: d.CONTA_TIPOS, PIX_TIPOS: d.PIX_TIPOS,
    }));
  });

  // ── Editar dados do orçamento / mudar etapa ──
  post("orcamentos.salvar", "/orcamentos/<slug>/<int:oid>/salvar", async (slug: string, oid: number) => {
    await empresa(slug);
    csrf();
    const o = await orc_ou_404(slug, oid);
    const f = request().form;
    const titulo = corta((f.get("titulo") || "").trim(), 200) || o.titulo;
    const prio = PRIO[f.get("prioridade")] ? f.get("prioridade") : o.prioridade;
    const prazo = f.has("prazo") ? (d.data_valida(f.get("prazo"), "") || "") : o.prazo;
    const resp = f.get("responsavel_id", null, "int") || o.responsavel_id;
    const mud: string[] = [];
    if (titulo !== o.titulo) mud.push("título");
    if (prio !== o.prioridade) mud.push(`prioridade ${PRIO[prio][0]}`);
    if (prazo !== o.prazo) mud.push(prazo ? `prazo ${d.data_br(prazo)}` : "sem prazo");
    if (resp !== o.responsavel_id) mud.push("responsável");
    await run("UPDATE orc_orcamentos SET titulo = ?, descricao = ?, tipo = ?, prioridade = ?, prazo = ?, responsavel_id = ? WHERE id = ?",
      [titulo, corta((f.get("descricao") ?? o.descricao).trim(), 5000), corta((f.get("tipo") ?? o.tipo).trim(), 80), prio, prazo, resp, oid]);
    if (mud.length) await historico(oid, `Alterado: ${mud.join(", ")}`);
    flash("Orçamento atualizado.", "ok");
    return redirect(url_for("orcamentos.ver", { slug, oid }));
  });

  post("orcamentos.etapa", "/orcamentos/<slug>/<int:oid>/etapa", async (slug: string, oid: number) => {
    await empresa(slug);
    csrf();
    const o = await orc_ou_404(slug, oid);
    const novo = String(request().form.get("status") || "");
    const fetch_ = request().headers.get("x-requested-with") === "fetch";
    const erro = (m: string) => fetch_ ? jsonify({ ok: false, msg: m }) : (flash(m, "erro"), redirect(url_for("orcamentos.ver", { slug, oid })));
    if (!NOME_ETAPA[novo] && novo !== "cancelado") return erro("Etapa inválida.");
    if (o.status === "lancado") return erro("Este orçamento já foi lançado no contas a pagar.");
    if (novo === "lancado") return erro("Use “Gerar contas a pagar” dentro do orçamento para lançar.");
    if (novo === "aprovado" && !o.cotacao_vencedora_id) return erro("Escolha a cotação vencedora antes de aprovar.");
    await run("UPDATE orc_orcamentos SET status = ?, aprovado_em = CASE WHEN ? = 'aprovado' THEN ? ELSE aprovado_em END WHERE id = ?", [novo, novo, agora(), oid]);
    await historico(oid, `Etapa: ${NOME_ETAPA[o.status] ?? o.status} → ${NOME_ETAPA[novo] ?? "Cancelado"}`);
    if (fetch_) return jsonify({ ok: true });
    return redirect(url_for("orcamentos.ver", { slug, oid }));
  });

  // ── Cotações ──
  post("orcamentos.cotacao", "/orcamentos/<slug>/<int:oid>/cotacao", async (slug: string, oid: number) => {
    await empresa(slug);
    csrf();
    const o = await orc_ou_404(slug, oid);
    const f = request().form;
    const volta = url_for("orcamentos.ver", { slug, oid }) + "#cotacoes";
    if (o.status === "lancado") { flash("Orçamento já lançado: não dá para alterar as cotações.", "erro"); return redirect(volta); }
    let pid: number | null = null;
    try {
      pid = f.get("pessoa_id") === "novo" ? await salvar_fornecedor(slug, f) : await q1("SELECT id FROM financas_pessoas WHERE id = ? AND empresa_slug = ?", [f.get("pessoa_id", null, "int"), slug]).then((r) => r?.id ?? null);
    } catch (ex: any) { flash(ex.message, "erro"); return redirect(volta); }
    if (!pid) { flash("Escolha ou cadastre o fornecedor.", "erro"); return redirect(volta); }
    const valor = d.para_centavos(f.get("valor")) || 0;
    if (valor <= 0) { flash("Informe o valor da cotação.", "erro"); return redirect(volta); }
    const cid = f.get("id", null, "int");
    const campos = [pid, valor, d.para_centavos(f.get("frete")) || 0, corta((f.get("prazo_entrega") || "").trim(), 80), d.data_valida(f.get("validade"), "") || "",
      d.FORMAS.includes(f.get("forma_pagamento")) ? f.get("forma_pagamento") : "", Math.max(1, Math.min(120, f.get("parcelas", 1, "int") || 1)),
      d.data_valida(f.get("primeiro_venc"), "") || "", Math.max(1, Math.min(365, f.get("intervalo_dias", 30, "int") || 30)), corta((f.get("obs") || "").trim(), 2000)];
    let cotid = cid;
    if (cid && await q1("SELECT 1 AS x FROM orc_cotacoes WHERE id = ? AND orcamento_id = ?", [cid, oid])) {
      await run("UPDATE orc_cotacoes SET pessoa_id = ?, valor = ?, frete = ?, prazo_entrega = ?, validade = ?, forma_pagamento = ?, parcelas = ?, primeiro_venc = ?, intervalo_dias = ?, obs = ? WHERE id = ?", [...campos, cid]);
      await historico(oid, `Cotação alterada: ${(await q1("SELECT nome FROM financas_pessoas WHERE id = ?", [pid]))?.nome} · ${d.moeda(valor)}`);
    } else {
      cotid = (await run("INSERT INTO orc_cotacoes (orcamento_id, pessoa_id, valor, frete, prazo_entrega, validade, forma_pagamento, parcelas, primeiro_venc, intervalo_dias, obs, criado_por, criado_em) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [oid, ...campos, u().id, agora()])).lastrowid!;
      await historico(oid, `Cotação recebida: ${(await q1("SELECT nome FROM financas_pessoas WHERE id = ?", [pid]))?.nome} · ${d.moeda(valor)}`);
      if (["entrada", "solicitar", "solicitado", "aguardando"].includes(o.status)) await run("UPDATE orc_orcamentos SET status = 'recebido' WHERE id = ?", [oid]);
    }
    for (const a of (request().files.get("anexos") ?? []).filter((x: any) => x && x.filename && x.size > 0 && x.size <= 15 * 1024 * 1024).slice(0, 10)) {
      const caminho = `orcamentos/${oid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await salvarArquivo(caminho, a.read(), a.mimetype || "application/octet-stream");
      await run("INSERT INTO orc_anexos (orcamento_id, cotacao_id, nome, tipo, tamanho, caminho, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [oid, cotid, corta(a.filename, 200), a.mimetype || "", a.size, caminho, u().id, agora()]);
    }
    flash("Cotação salva.", "ok");
    return redirect(volta);
  });

  post("orcamentos.cotacao_acao", "/orcamentos/<slug>/<int:oid>/cotacao/<int:cid>/<any(vencedora, excluir):acao>", async (slug: string, oid: number, cid: number, acao: string) => {
    await empresa(slug);
    csrf();
    const o = await orc_ou_404(slug, oid);
    const c = await q1("SELECT c.*, p.nome FROM orc_cotacoes c LEFT JOIN financas_pessoas p ON p.id = c.pessoa_id WHERE c.id = ? AND c.orcamento_id = ?", [cid, oid]);
    const volta = url_for("orcamentos.ver", { slug, oid }) + "#cotacoes";
    if (!c) abort(404);
    if (o.status === "lancado") { flash("Orçamento já lançado no contas a pagar.", "erro"); return redirect(volta); }
    if (acao === "excluir") {
      await run("DELETE FROM orc_anexos WHERE cotacao_id = ?", [cid]);
      await run("DELETE FROM orc_cotacoes WHERE id = ?", [cid]);
      if (o.cotacao_vencedora_id === cid) await run("UPDATE orc_orcamentos SET cotacao_vencedora_id = NULL WHERE id = ?", [oid]);
      await historico(oid, `Cotação excluída: ${c.nome}`);
      flash("Cotação excluída.", "ok");
    } else {
      await run("UPDATE orc_orcamentos SET cotacao_vencedora_id = ?, status = 'aprovado', aprovado_em = ?, obs_aprovacao = ? WHERE id = ?",
        [cid, agora(), corta((request().form.get("motivo") || "").trim(), 1000), oid]);
      await historico(oid, `Aprovado: ${c.nome} · ${d.moeda(Number(c.valor) + Number(c.frete))}${request().form.get("motivo") ? ` — ${request().form.get("motivo")}` : ""}`);
      flash(`Cotação de ${c.nome} aprovada. Agora gere o lançamento no contas a pagar.`, "ok");
      return redirect(url_for("orcamentos.ver", { slug, oid }) + "#lancar");
    }
    return redirect(volta);
  });

  // ── Gerar contas a pagar com a cotação vencedora ──
  post("orcamentos.lancar", "/orcamentos/<slug>/<int:oid>/lancar", async (slug: string, oid: number) => {
    await empresa(slug);
    csrf();
    const o = await orc_ou_404(slug, oid);
    const volta = url_for("orcamentos.ver", { slug, oid }) + "#lancar";
    if (o.status === "lancado") { flash("Este orçamento já foi lançado.", "erro"); return redirect(volta); }
    const c = o.cotacao_vencedora_id ? await q1("SELECT * FROM orc_cotacoes WHERE id = ? AND orcamento_id = ?", [o.cotacao_vencedora_id, oid]) : null;
    if (!c) { flash("Escolha a cotação vencedora antes.", "erro"); return redirect(volta); }
    const f = request().form;
    const n = Math.max(1, Math.min(120, f.get("parcelas", 1, "int") || 1));
    const intervalo = Math.max(1, Math.min(365, f.get("intervalo_dias", 30, "int") || 30));
    const primeiro = d.data_valida(f.get("primeiro_venc"), "");
    if (!primeiro) { flash("Informe o vencimento da 1ª parcela.", "erro"); return redirect(volta); }
    const total = d.para_centavos(f.get("valor")) || (Number(c.valor) + Number(c.frete));
    const cat = await q1("SELECT id FROM financas_categorias WHERE id = ? AND empresa_slug = ? AND tipo = 'despesa'", [f.get("categoria_id", null, "int"), slug]);
    const centro = await q1("SELECT id FROM financas_centros WHERE id = ? AND empresa_slug = ?", [f.get("centro_id", null, "int"), slug]);
    const conta = await q1("SELECT id FROM financas_contas WHERE id = ? AND empresa_slug = ?", [f.get("conta_id", null, "int"), slug]);
    const desc = corta((f.get("descricao") || `Orçamento #${oid} — ${o.titulo}`).trim(), 200);
    const base = Math.floor(total / n);
    const grupo = n > 1 ? `orc${oid}` : "";
    const ids: number[] = [];
    const a = d.agora_iso();
    for (let i = 0; i < n; i++) {
      const venc = intervalo === 30 ? d.somar_meses(primeiro, i).isoformat() : PyDate.fromisoformat(primeiro).addDays(intervalo * i).isoformat();
      const valor = base + (i === 0 ? total - base * n : 0);
      ids.push((await run("INSERT INTO financas_lancamentos (empresa_slug, tipo, descricao, pessoa_id, categoria_id, centro_id, conta_id, valor, competencia, vencimento, previsao, " +
        "forma_pagamento, documento, obs, parcela, parcelas, grupo, criado_por, criado_em, atualizado_em) VALUES (?, 'pagar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [slug, n > 1 ? `${desc} (${i + 1}/${n})` : desc, c.pessoa_id, cat?.id ?? null, centro?.id ?? null, conta?.id ?? null, valor, venc, venc, venc,
        c.forma_pagamento || "", `ORC-${oid}`, `Gerado pelo orçamento #${oid} (cotação aprovada).`, i + 1, n, grupo, u().id, a, a])).lastrowid!);
    }
    await run("UPDATE orc_orcamentos SET status = 'lancado', lancado_em = ?, lancamento_ids = ? WHERE id = ?", [agora(), ids.join(","), oid]);
    await historico(oid, `Lançado no contas a pagar: ${n} parcela(s), total ${d.moeda(total)}`);
    flash(`Contas a pagar gerado: ${n} parcela(s) de ${d.moeda(total)} no total.`, "ok");
    return redirect(url_for("orcamentos.ver", { slug, oid }));
  });

  // ── Comentário / anexos do orçamento ──
  post("orcamentos.comentar", "/orcamentos/<slug>/<int:oid>/comentar", async (slug: string, oid: number) => {
    await empresa(slug);
    csrf();
    await orc_ou_404(slug, oid);
    const texto = (request().form.get("texto") || "").trim();
    const arqs = (request().files.get("anexos") ?? []).filter((x: any) => x && x.filename && x.size > 0 && x.size <= 15 * 1024 * 1024).slice(0, 10);
    for (const a of arqs) {
      const caminho = `orcamentos/${oid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await salvarArquivo(caminho, a.read(), a.mimetype || "application/octet-stream");
      await run("INSERT INTO orc_anexos (orcamento_id, cotacao_id, nome, tipo, tamanho, caminho, usuario_id, criado_em) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)",
        [oid, corta(a.filename, 200), a.mimetype || "", a.size, caminho, u().id, agora()]);
    }
    if (texto || arqs.length) await historico(oid, (texto ? texto : "") + (arqs.length ? `${texto ? "\n" : ""}📎 ${arqs.map((a: any) => a.filename).join(", ")}` : ""));
    return redirect(url_for("orcamentos.ver", { slug, oid }) + "#historico");
  });

  get("orcamentos.anexo", "/orcamentos/<slug>/<int:oid>/anexo/<int:aid>", async (slug: string, oid: number, aid: number) => {
    await empresa(slug);
    await orc_ou_404(slug, oid);
    const a = await q1("SELECT * FROM orc_anexos WHERE id = ? AND orcamento_id = ?", [aid, oid]);
    if (!a) abort(404);
    const dados = await lerArquivo(a.caminho);
    if (!dados) abort(404);
    return sendFile(dados, { download_name: a.nome, mimetype: a.tipo || "application/octet-stream", as_attachment: !/^(application\/pdf|image\/)/.test(a.tipo || "") });
  });

  route("orcamentos.excluir", "/orcamentos/<slug>/<int:oid>/excluir", ["POST"], async (slug: string, oid: number) => {
    await empresa(slug);
    csrf();
    const o = await orc_ou_404(slug, oid);
    if (o.status === "lancado") { flash("Orçamento já lançado no contas a pagar não pode ser excluído.", "erro"); return redirect(url_for("orcamentos.ver", { slug, oid })); }
    await run("DELETE FROM orc_orcamentos WHERE id = ?", [oid]);
    flash("Orçamento excluído.", "ok");
    return redirect(url_for("orcamentos.quadro", { slug }));
  });
}
