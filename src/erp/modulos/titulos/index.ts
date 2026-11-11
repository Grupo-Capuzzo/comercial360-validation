/* eslint-disable @typescript-eslint/no-explicit-any */
// Títulos Privados (nova versão): empréstimos da Capuzzo a terceiros, com juros na devolução.
//
//  • Painel: clientes em atraso, valor emprestado que ainda não voltou, juros a receber, projeção mensal e ranking.
//  • Calculadora (sempre Tabela Price) → Gerar título → contrato para assinatura eletrônica (módulo Contratos).
//  • Assinado: cria no Finanças as contas a receber (uma por parcela) e a conta a pagar do repasse (dia da assinatura).
//  • Todo dia o sistema atualiza o valor das parcelas em atraso (taxa do título, pro rata dia) aqui e no contas a receber,
//    considerando os pagamentos parciais (abatem encargos → juros → principal).
//  • Quitação: valor para quitar hoje (vencidas atualizadas + futuras a valor presente).
//
// Tabelas: private_loan_clients, private_loans, private_loan_installments, private_loan_payments (já existiam) e,
// no Finanças, financas_lancamentos/financas_baixas (os pagamentos dos títulos assinados ficam nas baixas).
import crypto from "node:crypto";
import {
  PyDate, abort, flash, g, get, post, q, q1, redirect, render_template, request, route, run, url_for,
} from "../../core/flask";
import { gravarConfig, lerConfig } from "../../core/arquivos";
import { checar_csrf } from "../portal";
import * as ct from "../contratos/dados";
import * as fin from "../financas/dados";
import { r2, tabela_price, situacao_parcela, valor_quitacao, type Pagamento } from "./calc";

const EMPRESA = "assessoria";
const ATIVOS = ["active", "overdue"];
export const STATUS_TITULO: Record<string, [string, string]> = {
  rascunho: ["Aguardando assinatura", "badge-pending"],
  active: ["Ativo", "badge-active"],
  overdue: ["Ativo", "badge-active"],
  paid: ["Quitado", "badge-inactive"],
  cancelled: ["Cancelado", "badge-inactive"],
};

// ───────────────────────── utilidades ─────────────────────────
function hoje() { return PyDate.today().isoformat(); }
function agora() { return PyDate.now().strftime("%Y-%m-%d %H:%M:%S"); }
function so_digitos(s: any) { return String(s ?? "").replace(/\D/g, ""); }
function num_br(v: any): number {
  let t = String(v ?? "").replace(/R\$|\s|%/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return Number(t);
}
export function moeda(v: any) {
  const n = Number(v || 0), a = Math.abs(n);
  const [i, c] = a.toFixed(2).split(".");
  return `${n < -0.004 ? "-" : ""}R$ ${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${c}`;
}
function pct(taxa: number) { return `${(taxa * 100).toFixed(2).replace(".", ",")}% a.m.`; }
function data_br(s: any) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; }
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function uid(): number | null { try { return g().portal_user?.id ?? null; } catch { return null; } }
function usuario_nome(): string { try { return g().portal_user?.nome ?? "sistema"; } catch { return "sistema"; } }
function voltar_seguro(d: string | null | undefined, padrao: string) { return d && d.startsWith("/") && !d.startsWith("//") ? d : padrao; }

// ───────────────────────── leitura ─────────────────────────
export async function clientes(so_ativos = false) {
  return q(`SELECT * FROM private_loan_clients ${so_ativos ? "WHERE status = 'ativo'" : ""} ORDER BY name`);
}

async function titulos(where = "", params: any[] = []) {
  return q("SELECT l.*, c.name AS cliente_nome, c.document AS cliente_doc FROM private_loans l " +
    `JOIN private_loan_clients c ON c.id = l.private_client_id ${where} ORDER BY l.id DESC`, params);
}

/** Pagamentos de cada parcela: as baixas do contas a receber (títulos assinados) ou os pagamentos antigos. */
async function pagamentos_das_parcelas(parcelas: any[]): Promise<Map<number, Pagamento[]>> {
  const out = new Map<number, Pagamento[]>();
  for (const p of parcelas) out.set(p.id, []);
  const lancs = parcelas.filter((p) => p.lancamento_id).map((p) => p.lancamento_id);
  const sem = parcelas.filter((p) => !p.lancamento_id).map((p) => p.id);
  const [baixas, antigos] = await Promise.all([
    lancs.length ? q(`SELECT lancamento_id, data, valor, desconto FROM financas_baixas WHERE lancamento_id IN (${lancs.map(() => "?").join(",")})`, lancs) : Promise.resolve([]),
    sem.length ? q(`SELECT installment_id, payment_date, amount FROM private_loan_payments WHERE installment_id IN (${sem.map(() => "?").join(",")})`, sem) : Promise.resolve([]),
  ]);
  const por_lanc = new Map(parcelas.filter((p) => p.lancamento_id).map((p) => [Number(p.lancamento_id), p.id]));
  for (const b of baixas) out.get(por_lanc.get(Number(b.lancamento_id))!)?.push({ data: String(b.data).slice(0, 10), valor: (Number(b.valor || 0) + Number(b.desconto || 0)) / 100 });
  for (const a of antigos) out.get(a.installment_id)?.push({ data: String(a.payment_date).slice(0, 10), valor: Number(a.amount || 0) });
  return out;
}

/** Títulos com as parcelas calculadas na data (saldo atualizado, encargos, atraso). */
async function titulos_calculados(lista: any[], data_ref = hoje()) {
  const ids = lista.map((t) => t.id);
  const parcelas = ids.length ? await q(`SELECT * FROM private_loan_installments WHERE loan_id IN (${ids.map(() => "?").join(",")}) ORDER BY loan_id, installment_number`, ids) : [];
  const pags = await pagamentos_das_parcelas(parcelas);
  const por = new Map<number, any[]>();
  for (const p of parcelas) (por.get(p.loan_id) ?? por.set(p.loan_id, []).get(p.loan_id)!).push(p);
  for (const t of lista) {
    t.taxa = Number(t.interest_rate_monthly || 0);
    t.parcelas = (por.get(t.id) ?? []).map((p) => {
      const base = { vencimento: String(p.due_date).slice(0, 10), principal: Number(p.principal_amount || 0), juros: Number(p.interest_amount || 0) };
      if (!base.principal && !base.juros) base.principal = Number(p.installment_amount || 0);
      const s = situacao_parcela(base, pags.get(p.id) ?? [], t.taxa, data_ref);
      return { ...p, ...base, valor: Number(p.installment_amount || 0), sit: s, pagamentos: pags.get(p.id) ?? [] };
    });
    const ab = t.parcelas.filter((p: any) => !p.sit.quitada);
    t.saldo = r2(ab.reduce((a: number, p: any) => a + p.sit.saldo, 0));
    t.principal_aberto = r2(ab.reduce((a: number, p: any) => a + p.sit.principal, 0));
    t.juros_aberto = r2(ab.reduce((a: number, p: any) => a + p.sit.juros, 0));
    t.encargos = r2(ab.reduce((a: number, p: any) => a + p.sit.encargos, 0));
    t.atrasadas = ab.filter((p: any) => p.sit.dias_atraso > 0);
    t.saldo_atraso = r2(t.atrasadas.reduce((a: number, p: any) => a + p.sit.saldo, 0));
    t.dias_atraso = Math.max(0, ...t.atrasadas.map((p: any) => p.sit.dias_atraso));
    t.pagas = t.parcelas.length - ab.length;
    t.proxima = ab.find((p: any) => p.sit.dias_atraso === 0) ?? null;
    t.status_nome = (STATUS_TITULO[t.status] ?? [t.status, ""])[0];
    t.status_cls = (STATUS_TITULO[t.status] ?? ["", "badge-inactive"])[1];
  }
  return lista;
}

// ───────────────────────── Finanças (contas a receber / a pagar) ─────────────────────────
async function categoria(tipo: "receita" | "despesa", nome: string, grupo: string) {
  const c = await q1("SELECT id FROM financas_categorias WHERE empresa_slug = ? AND tipo = ? AND lower(nome) = lower(?) ORDER BY ativo DESC, id LIMIT 1", [EMPRESA, tipo, nome]);
  if (c) return c.id;
  return (await run("INSERT INTO financas_categorias (empresa_slug, tipo, nome, grupo_dre, ativo, ordem) VALUES (?, ?, ?, ?, 1, 0)", [EMPRESA, tipo, nome, grupo])).lastrowid;
}

async function pessoa_financas(cli: any) {
  const doc = so_digitos(cli.document);
  if (doc) {
    const ps = await q("SELECT id, documento FROM financas_pessoas WHERE empresa_slug = ? AND documento <> ''", [EMPRESA]);
    const p = ps.find((x: any) => so_digitos(x.documento) === doc);
    if (p) return p.id;
  }
  const p = await q1("SELECT id FROM financas_pessoas WHERE empresa_slug = ? AND lower(nome) = lower(?) LIMIT 1", [EMPRESA, cli.name]);
  if (p) return p.id;
  return (await run("INSERT INTO financas_pessoas (empresa_slug, tipo, nome, documento, email, telefone, cidade, uf, cep, logradouro, numero, complemento, bairro, pix_chave, origem, criado_em) " +
    "VALUES (?, 'cliente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'titulos', ?)",
  [EMPRESA, cli.name, cli.document || "", cli.email || "", cli.phone || "", cli.cidade || "", cli.uf || "", cli.cep || "", cli.logradouro || "",
    cli.numero || "", cli.complemento || "", cli.bairro || "", cli.pix_key || "", agora()])).lastrowid;
}

async function lancamento(tipo: "receber" | "pagar", desc: string, pessoa_id: number, categoria_id: number, centavos: number, venc: string, doc: string, obs: string, parcela = 1, parcelas = 1, grupo = "") {
  const a = PyDate.now().isoformat("T");
  return (await run("INSERT INTO financas_lancamentos (empresa_slug, tipo, descricao, pessoa_id, categoria_id, valor, competencia, vencimento, previsao, " +
    "documento, obs, parcela, parcelas, grupo, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  [EMPRESA, tipo, desc, pessoa_id, categoria_id, centavos, venc, venc, venc, doc, obs, parcela, parcelas, grupo, uid(), a, a])).lastrowid;
}

/** Depois da assinatura do contrato: título ativo + contas a receber (parcelas) + conta a pagar (repasse). */
export async function ativar_por_contrato(contrato_id: number) {
  const t = await q1("SELECT * FROM private_loans WHERE contrato_id = ?", [contrato_id]);
  if (!t || t.status !== "rascunho") return;
  const cli: any = await q1("SELECT * FROM private_loan_clients WHERE id = ?", [t.private_client_id]);
  if (!cli) return;
  const dia = hoje();
  const [pessoa, cat_rec, cat_pag] = await Promise.all([
    pessoa_financas(cli), categoria("receita", "Parcela de Titulos", "receita_bruta"), categoria("despesa", "Emprestimo de Titulos", "despesas_operacionais")]);
  const parcelas = await q("SELECT * FROM private_loan_installments WHERE loan_id = ? ORDER BY installment_number", [t.id]);
  const grupo = `tp${t.id}`;
  for (const p of parcelas) {
    if (p.lancamento_id) continue;
    const lid = await lancamento("receber", `Título ${t.loan_number} — parcela ${p.installment_number}/${parcelas.length} · ${cli.name}`, pessoa, cat_rec,
      Math.round(Number(p.installment_amount) * 100), String(p.due_date).slice(0, 10), t.loan_number, `Título privado ${t.loan_number}. Valor atualizado todo dia pelo sistema em caso de atraso.`,
      p.installment_number, parcelas.length, grupo);
    await run("UPDATE private_loan_installments SET lancamento_id = ?, updated_at = ? WHERE id = ?", [lid, agora(), p.id]);
  }
  let repasse = t.repasse_lancamento_id;
  if (!repasse) repasse = await lancamento("pagar", `Repasse do título ${t.loan_number} · ${cli.name}`, pessoa, cat_pag,
    Math.round(Number(t.original_amount) * 100), dia, t.loan_number, `Valor emprestado no título privado ${t.loan_number}.`);
  await run("UPDATE private_loans SET status = 'active', assinado_em = ?, start_date = ?, repasse_lancamento_id = ?, updated_at = ? WHERE id = ?",
    [agora(), dia, repasse, agora(), t.id]);
}
ct.POS_ASSINATURA.titulo = ativar_por_contrato;

/** Recalcula as parcelas em aberto (aqui e no contas a receber). */
export async function atualizar_titulos(ids: number[] | null = null) {
  const lista = await titulos(ids ? `WHERE l.id IN (${ids.map(() => "?").join(",")})` : "WHERE l.status IN ('active', 'overdue')", ids ?? []);
  const ativos = lista.filter((t: any) => ATIVOS.includes(t.status));
  await titulos_calculados(ativos);
  const momento = agora();
  const lancs = ativos.flatMap((t: any) => t.parcelas.filter((p: any) => p.lancamento_id).map((p: any) => Number(p.lancamento_id)));
  const somas = new Map<number, any>();
  if (lancs.length) {
    for (const r of await q(`SELECT lancamento_id, SUM(valor) AS v, SUM(desconto) AS d, SUM(juros) AS j FROM financas_baixas WHERE lancamento_id IN (${lancs.map(() => "?").join(",")}) GROUP BY lancamento_id`, lancs)) somas.set(Number(r.lancamento_id), r);
  }
  const atuais = new Map<number, any>();
  if (lancs.length) for (const r of await q(`SELECT id, valor, cancelado FROM financas_lancamentos WHERE id IN (${lancs.map(() => "?").join(",")})`, lancs)) atuais.set(Number(r.id), r);
  let n = 0;
  for (const t of ativos) {
    for (const p of t.parcelas) {
      const s = p.sit;
      const st = s.quitada ? "paid" : s.dias_atraso > 0 ? "overdue" : "open";
      const pago_data = s.quitada ? (p.pagamentos.map((x: any) => x.data).sort().pop() ?? null) : null;
      if (st !== p.status || Math.abs(Number(p.saldo_atualizado || 0) - s.saldo) > 0.004 || Math.abs(Number(p.paid_amount || 0) - s.pago) > 0.004 || String(p.atualizado_em || "").slice(0, 10) !== momento.slice(0, 10)) {
        await run("UPDATE private_loan_installments SET status = ?, paid_amount = ?, paid_date = ?, saldo_atualizado = ?, encargos = ?, atualizado_em = ?, updated_at = ? WHERE id = ?",
          [st, s.pago, pago_data, s.saldo, s.encargos_total, momento, momento, p.id]);
        n++;
      }
      if (p.lancamento_id) {
        const l = atuais.get(Number(p.lancamento_id));
        if (l && !Number(l.cancelado)) {
          const b = somas.get(Number(p.lancamento_id)) ?? {};
          const alvo = Math.round(s.saldo * 100) + Number(b.v || 0) + Number(b.d || 0) - Number(b.j || 0);
          if (alvo > 0 && alvo !== Number(l.valor)) await run("UPDATE financas_lancamentos SET valor = ?, atualizado_em = ? WHERE id = ?", [alvo, PyDate.now().isoformat("T"), p.lancamento_id]);
        }
      }
    }
    const novo = t.parcelas.length && t.parcelas.every((p: any) => p.sit.quitada) ? "paid" : t.atrasadas.length ? "overdue" : "active";
    if (novo !== t.status) await run("UPDATE private_loans SET status = ?, updated_at = ? WHERE id = ?", [novo, momento, t.id]);
  }
  return n;
}

/** Roda a atualização uma vez por dia (na primeira visita do dia e pelo relógio do servidor). */
export async function atualizar_se_preciso() {
  const dia = hoje();
  if ((await lerConfig("titulos_atualizado_em", "")) === dia) return false;
  await gravarConfig("titulos_atualizado_em", dia);
  try { await atualizar_titulos(); } catch (e: any) { console.error("[titulos] atualização diária falhou:", e?.message ?? e); await gravarConfig("titulos_atualizado_em", ""); }
  return true;
}

// ───────────────────────── contrato ─────────────────────────
function doc_tipo(doc: string) { return so_digitos(doc).length > 11 ? "CNPJ" : "CPF"; }

async function criar_contrato(t: any, cli: any, linhas: any[]) {
  const cfg = await ct.config();
  const total_parcelas = r2(linhas.reduce((a, l) => a + Number(l.installment_amount), 0));
  const dados: any = {
    titulo_id: t.id, numero: t.loan_number, tipo: "titulo",
    investidor: {
      nome: cli.name, documento: ct.fmt_doc(cli.document), documento_tipo: doc_tipo(cli.document), email: cli.email || "",
      rg: cli.rg, nacionalidade: cli.nacionalidade, estado_civil: cli.estado_civil, profissao: cli.profissao,
      endereco: [cli.logradouro, cli.numero, cli.complemento, cli.bairro].filter(Boolean).join(", "), cidade: cli.cidade, uf: cli.uf, cep: cli.cep,
      telefone: cli.phone || "", pix: cli.pix_key || "",
    },
    produto: { nome: `Título privado nº ${t.loan_number}` },
    qtd: linhas.length, parcela: Number(t.installment_amount), valor_total: Number(t.original_amount), total_parcelas,
    taxa: Number(t.interest_rate_monthly), taxa_txt: pct(Number(t.interest_rate_monthly)),
    primeiro_venc: String(t.first_due_date).slice(0, 10), ultimo_venc: String(t.final_due_date).slice(0, 10),
    parcelas: linhas.map((l) => ({ n: l.installment_number, venc: String(l.due_date).slice(0, 10), valor: Number(l.installment_amount), juros: Number(l.interest_amount), amort: Number(l.principal_amount) })),
    empresa: { empresa_nome: cfg.empresa_nome, empresa_cnpj: cfg.empresa_cnpj, empresa_endereco: cfg.empresa_endereco },
    cidade_assinatura: cfg.cidade_assinatura, data_emissao: hoje(),
    testemunhas: [{ nome: cfg.testemunha1_nome, cpf: cfg.testemunha1_cpf }, { nome: cfg.testemunha2_nome, cpf: cfg.testemunha2_cpf }].filter((x) => x.nome),
    arquivo: `titulo-${t.loan_number}-${String(cli.name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    cotas: [],
  };
  const html_termo = render_template("titulos/contrato_modelo.html", { d: dados, moeda, data_br, extenso: ct.extenso_reais });
  const momento = ct.agora();
  const usuario = usuario_nome();
  const cid = (await run(
    "INSERT INTO contratos (codigo, tipo, condominium_id, client_id, share_ids, dados, html_termo, html_anexo, hash_original, token, status, criado_por, criado_em) " +
    "VALUES (?, 'titulo', NULL, NULL, '[]', ?, ?, '', ?, ?, 'rascunho', ?, ?)",
    [crypto.randomUUID(), ct.py_json(dados, false), html_termo, ct.sha256(html_termo, ""), crypto.randomBytes(32).toString("base64url"), usuario, momento])).lastrowid!;
  await run("INSERT INTO contratos_signatarios (contrato_id, papel, ordem, nome, email, cpf, status, assinatura_tipo, assinatura_texto, ip, user_agent, verificacao, assinado_em) " +
    "VALUES (?, 'empresa', 1, ?, ?, ?, 'assinado', 'texto', ?, '', '', ?, ?)",
  [cid, cfg.empresa_nome, cfg.empresa_email, cfg.empresa_cnpj, cfg.empresa_assinante, `Login no portal (${usuario})`, momento]);
  await run("INSERT INTO contratos_signatarios (contrato_id, papel, ordem, nome, email, cpf) VALUES (?, 'cliente', 2, ?, ?, ?)",
    [cid, String(cli.name).trim(), String(cli.email || "").trim(), ct.fmt_doc(cli.document)]);
  await ct.evento(cid, "criado", `Contrato do título ${t.loan_number} criado por ${usuario} · ${moeda(t.original_amount)} em ${linhas.length} parcela(s)`);
  await ct.evento(cid, "assinado_empresa", `${cfg.empresa_assinante} (${cfg.empresa_email}) — assinado por ${usuario}`);
  return cid;
}

async function proximo_numero() {
  const ano = PyDate.today().year;
  const r = await q1("SELECT COUNT(*) AS n FROM private_loans WHERE loan_number LIKE ?", [`TP-${ano}-%`]);
  let n = Number(r?.n ?? 0) + 1;
  while (await q1("SELECT 1 AS x FROM private_loans WHERE loan_number = ?", [`TP-${ano}-${String(n).padStart(3, "0")}`])) n++;
  return `TP-${ano}-${String(n).padStart(3, "0")}`;
}

function ler_calculo(src: any) {
  const entrada = { valor: String(src.get("valor") ?? ""), taxa: String(src.get("taxa") ?? ""), parcelas: String(src.get("parcelas") ?? ""), primeira: String(src.get("primeira") ?? "") };
  let resultado: any = null, erro: string | null = null;
  if (entrada.valor || entrada.taxa || entrada.parcelas || entrada.primeira) {
    try {
      resultado = tabela_price(num_br(entrada.valor), num_br(entrada.taxa) / 100, Math.trunc(Number(entrada.parcelas)), entrada.primeira);
    } catch (e: any) { erro = e?.message ?? String(e); }
  }
  return { entrada, resultado, erro };
}

// ───────────────────────── rotas ─────────────────────────
function ctx(pagina: string, extra: Record<string, any>) {
  return { active_page: pagina, moeda, data_br, pct, STATUS_TITULO, hoje_iso: hoje(), ...extra };
}

export function registrar() {
  // Atualização diária pelo relógio do servidor (além da primeira visita do dia ao painel).
  const G: any = globalThis;
  if (!G.__erpTitulosRelogio) {
    G.__erpTitulosRelogio = setInterval(() => { atualizar_se_preciso().catch(() => {}); }, 60 * 60 * 1000);
    G.__erpTitulosRelogio.unref?.();
  }

  get("titulos.painel", "/titulos", async () => {
    await atualizar_se_preciso();
    const dia = hoje();
    const lista = await titulos_calculados(await titulos("WHERE l.status IN ('active', 'overdue')"));
    const aguardando = await titulos("WHERE l.status = 'rascunho'");
    const cards: Record<string, number> = {
      emprestado: r2(lista.reduce((a: number, t: any) => a + t.principal_aberto, 0)),
      juros: r2(lista.reduce((a: number, t: any) => a + t.juros_aberto, 0)),
      encargos: r2(lista.reduce((a: number, t: any) => a + t.encargos, 0)),
      saldo: r2(lista.reduce((a: number, t: any) => a + t.saldo, 0)),
      atraso: r2(lista.reduce((a: number, t: any) => a + t.saldo_atraso, 0)),
      titulos: lista.length,
    };
    // Ranking de clientes em atraso
    const rk = new Map<number, any>();
    for (const t of lista) if (t.atrasadas.length) {
      const r = rk.get(t.private_client_id) ?? rk.set(t.private_client_id, { id: t.private_client_id, nome: t.cliente_nome, valor: 0, parcelas: 0, dias: 0, titulos: [] as any[] }).get(t.private_client_id)!;
      r.valor = r2(r.valor + t.saldo_atraso); r.parcelas += t.atrasadas.length; r.dias = Math.max(r.dias, t.dias_atraso); r.titulos.push(t.loan_number);
    }
    const ranking = [...rk.values()].sort((a, b) => b.valor - a.valor);
    cards.clientes_atraso = ranking.length;
    // Projeção mensal (próximos 12 meses) — o que está em atraso fica numa barra própria
    const meses: any[] = [];
    const d0 = PyDate.today();
    for (let i = 0; i < 12; i++) {
      const y = d0.year + Math.floor((d0.month - 1 + i) / 12), m = ((d0.month - 1 + i) % 12) + 1;
      meses.push({ chave: `${y}-${String(m).padStart(2, "0")}`, nome: `${MESES[m - 1]}/${String(y).slice(2)}`, principal: 0, juros: 0, n: 0 });
    }
    const idx = new Map(meses.map((m, i) => [m.chave, i]));
    for (const t of lista) for (const p of t.parcelas) {
      if (p.sit.quitada || p.sit.dias_atraso > 0) continue;
      const i = idx.get(p.vencimento.slice(0, 7));
      if (i === undefined) continue;
      meses[i].principal = r2(meses[i].principal + p.sit.principal);
      meses[i].juros = r2(meses[i].juros + p.sit.juros + p.sit.encargos);
      meses[i].n++;
    }
    const maior = Math.max(1, ...meses.map((m) => m.principal + m.juros));
    const vencendo = lista.flatMap((t: any) => t.parcelas.filter((p: any) => !p.sit.quitada && p.sit.dias_atraso === 0 && p.vencimento <= PyDate.today().addDays(15).isoformat())
      .map((p: any) => ({ t, p }))).sort((a: any, b: any) => (a.p.vencimento < b.p.vencimento ? -1 : 1)).slice(0, 10);
    return render_template("titulos/painel.html", ctx("titulos_painel", { cards, ranking, meses, maior, aguardando, vencendo, dia, atualizado: await lerConfig("titulos_atualizado_em", "") }));
  });

  // Lista de títulos
  get("titulos.lista", "/titulos/lista", async () => {
    const st = String(request().args.get("status", "") || "");
    const busca = String(request().args.get("q", "") || "").trim().toLowerCase();
    let lista = await titulos_calculados(await titulos());
    if (st === "atraso") lista = lista.filter((t: any) => t.atrasadas.length);
    else if (st) lista = lista.filter((t: any) => (st === "active" ? ATIVOS.includes(t.status) : t.status === st));
    if (busca) lista = lista.filter((t: any) => `${t.cliente_nome} ${t.loan_number} ${t.cliente_doc ?? ""}`.toLowerCase().includes(busca));
    return render_template("titulos/lista.html", ctx("titulos_lista", { lista, st, busca }));
  });

  // Calculadora (Price) → gerar título
  route("titulos.calculadora", "/titulos/calculadora", ["GET"], async () => {
    const { entrada, resultado, erro } = ler_calculo(request().args);
    const cliente_sel = request().args.get("cliente", null, "int");
    return render_template("titulos/calculadora.html", ctx("titulos_calculadora", { entrada, resultado, erro, clientes: await clientes(true), cliente_sel }));
  });

  post("titulos.gerar", "/titulos/gerar", async () => {
    checar_csrf();
    const f = request().form;
    const { entrada, resultado, erro } = ler_calculo(f);
    const volta = url_for("titulos.calculadora", { ...entrada, cliente: f.get("cliente_id") || null });
    if (!resultado) { flash(erro || "Preencha a calculadora.", "error"); return redirect(volta); }
    const cid_cli = f.get("cliente_id", null, "int");
    const cli = cid_cli ? await q1("SELECT * FROM private_loan_clients WHERE id = ?", [cid_cli]) : null;
    if (!cli) { flash("Escolha o cliente do título.", "error"); return redirect(volta); }
    const falta = [["name", "nome"], ["document", "CPF/CNPJ"], ["email", "e-mail"]].filter(([k]) => !String(cli[k] || "").trim()).map(([, n]) => n);
    if (falta.length) { flash(`Complete o cadastro do cliente antes de gerar o contrato — falta: ${falta.join(", ")}.`, "error"); return redirect(url_for("titulos.cliente", { pcid: cli.id, voltar: volta })); }
    const numero = await proximo_numero();
    const L = resultado.linhas;
    const tid = (await run("INSERT INTO private_loans (private_client_id, loan_number, original_amount, contracted_amount, interest_rate_monthly, interest_rate_daily, " +
      "interest_type, calculation_method, start_date, first_due_date, final_due_date, installments_count, installment_amount, status, notes, empresa_slug, origem) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'compound', 'price', ?, ?, ?, ?, ?, 'rascunho', ?, ?, 'local')",
    [cli.id, numero, resultado.valor, resultado.total_pago, resultado.taxa, Math.pow(1 + resultado.taxa, 1 / 30) - 1, hoje(), L[0].vencimento, L[L.length - 1].vencimento,
      L.length, resultado.parcela, String(f.get("obs") || "").trim(), EMPRESA])).lastrowid!;
    for (const l of L) {
      await run("INSERT INTO private_loan_installments (loan_id, installment_number, due_date, principal_amount, interest_amount, installment_amount, paid_amount, status, saldo_atualizado) VALUES (?, ?, ?, ?, ?, ?, 0, 'open', ?)",
        [tid, l.numero, l.vencimento, l.amortizacao, l.juros, l.parcela, l.parcela]);
    }
    const t = await q1("SELECT * FROM private_loans WHERE id = ?", [tid]);
    const linhas = await q("SELECT * FROM private_loan_installments WHERE loan_id = ? ORDER BY installment_number", [tid]);
    const cid = await criar_contrato(t, cli, linhas);
    await run("UPDATE private_loans SET contrato_id = ? WHERE id = ?", [cid, tid]);
    flash(`Título ${numero} gerado. Confira o contrato e envie para o cliente assinar.`, "success");
    return redirect(url_for("titulos.titulo", { tid }));
  });

  // Detalhe do título
  get("titulos.titulo", "/titulos/<int:tid>", async (tid: number) => {
    const t0 = (await titulos("WHERE l.id = ?", [tid]))[0];
    if (!t0) abort(404);
    const [t] = await titulos_calculados([t0]);
    const cli: any = (await q1("SELECT * FROM private_loan_clients WHERE id = ?", [t.private_client_id])) ?? {};
    const c = t.contrato_id ? await ct.obter(t.contrato_id) : null;
    const link = c ? await ct.link_assinatura(c) : "";
    const contas = await q("SELECT id, nome FROM financas_contas WHERE empresa_slug = ? AND ativa = 1 AND considerada = 1 ORDER BY nome", [EMPRESA]);
    const pagamentos = t.parcelas.flatMap((p: any) => p.pagamentos.map((x: any) => ({ ...x, parcela: p.installment_number }))).sort((a: any, b: any) => (a.data < b.data ? 1 : -1));
    const repasse = t.repasse_lancamento_id ? await q1("SELECT id, valor, vencimento FROM financas_lancamentos WHERE id = ?", [t.repasse_lancamento_id]) : null;
    return render_template("titulos/titulo.html", ctx("titulos_lista", {
      t, cli, c, link, contas, pagamentos, repasse, STATUS_CONTRATO: ct.STATUS,
      msg_wpp: c ? `Olá, ${String(cli.name).trim().split(/\s+/)[0]}! Segue o link para assinatura eletrônica do contrato do título ${t.loan_number} (${moeda(t.original_amount)} em ${t.parcelas.length} parcela(s)): ${link}` : "",
    }));
  });

  post("titulos.contrato_acao", "/titulos/<int:tid>/contrato", async (tid: number) => {
    checar_csrf();
    const t = await q1("SELECT * FROM private_loans WHERE id = ?", [tid]);
    if (!t || !t.contrato_id) abort(404);
    const acao = request().form.get("acao");
    try {
      if (acao === "email") { await ct.enviar_para_assinatura(t.contrato_id); flash("Contrato enviado por e-mail para o cliente assinar.", "success"); }
      else if (acao === "manual") { await ct.marcar_enviado_manual(t.contrato_id, request().form.get("canal") || "link"); flash("Marcado como enviado. O cliente assina pelo link.", "success"); }
      else if (acao === "cancelar") {
        if (t.status !== "rascunho") { flash("Só dá para cancelar um título que ainda não foi assinado.", "error"); }
        else {
          await ct.cancelar(t.contrato_id, String(request().form.get("motivo") || "Cancelado pela Capuzzo").trim());
          await run("UPDATE private_loans SET status = 'cancelled', updated_at = ? WHERE id = ?", [agora(), tid]);
          flash("Título e contrato cancelados.", "success");
        }
      }
    } catch (e: any) {
      flash(`Não foi possível: ${e?.message ?? e}`, "error");
    }
    return redirect(url_for("titulos.titulo", { tid }));
  });

  post("titulos.pagamento", "/titulos/<int:tid>/pagamento", async (tid: number) => {
    checar_csrf();
    const f = request().form;
    const t = await q1("SELECT * FROM private_loans WHERE id = ?", [tid]);
    if (!t) abort(404);
    if (!ATIVOS.includes(t.status)) { flash("O título não está ativo.", "error"); return redirect(url_for("titulos.titulo", { tid })); }
    const p = await q1("SELECT * FROM private_loan_installments WHERE id = ? AND loan_id = ?", [f.get("parcela_id", null, "int"), tid]);
    const valor = num_br(f.get("valor"));
    const dia = String(f.get("data") || hoje());
    if (!p || !(valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) { flash("Informe a parcela, a data e o valor recebido.", "error"); return redirect(url_for("titulos.titulo", { tid })); }
    await registrar_recebimento(t, p, dia, valor, 0, f.get("conta_id", null, "int"));
    await atualizar_titulos([tid]);
    flash(`Recebimento de ${moeda(valor)} registrado na parcela ${p.installment_number}.`, "success");
    return redirect(url_for("titulos.titulo", { tid }));
  });

  // Quitação / amortização: valor para quitar hoje (ou numa data), por cliente e parcelas
  get("titulos.quitacao", "/titulos/quitacao", async () => {
    const a = request().args;
    const pcid = a.get("cliente", null, "int");
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(a.get("data") || "")) ? String(a.get("data")) : hoje();
    const lista_cli = await q("SELECT DISTINCT c.id, c.name FROM private_loan_clients c JOIN private_loans l ON l.private_client_id = c.id WHERE l.status IN ('active', 'overdue') ORDER BY c.name");
    let linhas: any[] = [], tot: any = null;
    const marcadas = new Set(a.getlist("p", "int"));
    if (pcid) {
      const ts = await titulos_calculados(await titulos("WHERE l.private_client_id = ? AND l.status IN ('active', 'overdue')", [pcid]), dia);
      for (const t of ts) for (const p of t.parcelas) {
        if (p.sit.quitada) continue;
        const qv = valor_quitacao(p, p.pagamentos, t.taxa, dia);
        linhas.push({ t, p, qv, marcada: !marcadas.size || marcadas.has(p.id) });
      }
      const sel = linhas.filter((l) => l.marcada);
      tot = {
        n: sel.length, quitacao: r2(sel.reduce((s, l) => s + l.qv.quitacao, 0)), desconto: r2(sel.reduce((s, l) => s + l.qv.desconto, 0)),
        nominal: r2(sel.reduce((s, l) => s + l.qv.saldo, 0)), encargos: r2(sel.reduce((s, l) => s + l.qv.encargos, 0)),
        principal: r2(sel.reduce((s, l) => s + l.qv.principal, 0)),
      };
    }
    const contas = await q("SELECT id, nome FROM financas_contas WHERE empresa_slug = ? AND ativa = 1 AND considerada = 1 ORDER BY nome", [EMPRESA]);
    return render_template("titulos/quitacao.html", ctx("titulos_quitacao", { lista_cli, pcid, dia, linhas, tot, contas, cliente_nome: (lista_cli.find((c: any) => c.id === pcid) ?? {}).name ?? "" }));
  });

  post("titulos.quitacao_registrar", "/titulos/quitacao", async () => {
    checar_csrf();
    const f = request().form;
    const pcid = f.get("cliente", null, "int");
    const dia = hoje();
    const ids = new Set(f.getlist("p", "int"));
    const conta = f.get("conta_id", null, "int");
    if (!pcid || !ids.size) { flash("Escolha o cliente e as parcelas.", "error"); return redirect(url_for("titulos.quitacao", { cliente: pcid })); }
    const ts = await titulos_calculados(await titulos("WHERE l.private_client_id = ? AND l.status IN ('active', 'overdue')", [pcid]), dia);
    let total = 0, n = 0;
    for (const t of ts) for (const p of t.parcelas) {
      if (!ids.has(p.id) || p.sit.quitada) continue;
      const qv = valor_quitacao(p, p.pagamentos, t.taxa, dia);
      if (qv.quitacao <= 0) continue;
      await registrar_recebimento(t, p, dia, qv.quitacao, qv.desconto, conta, qv.futura ? "Quitação antecipada (desconto dos juros futuros)" : "Quitação");
      total += qv.quitacao; n++;
    }
    await atualizar_titulos(ts.map((t: any) => t.id));
    flash(`Quitação registrada: ${n} parcela(s), ${moeda(total)} recebidos em ${data_br(dia)}.`, "success");
    return redirect(url_for("titulos.quitacao", { cliente: pcid }));
  });

  // Clientes
  get("titulos.clientes", "/titulos/clientes", async () => {
    const lista = await clientes();
    const ts = await titulos_calculados(await titulos("WHERE l.status IN ('active', 'overdue', 'rascunho')"));
    for (const c of lista) {
      const meus = ts.filter((t: any) => t.private_client_id === c.id);
      c.n_titulos = meus.length; c.saldo = r2(meus.reduce((a: number, t: any) => a + (ATIVOS.includes(t.status) ? t.saldo : 0), 0));
      c.atraso = r2(meus.reduce((a: number, t: any) => a + t.saldo_atraso, 0));
    }
    return render_template("titulos/clientes.html", ctx("titulos_clientes", { lista }));
  });

  route("titulos.cliente", "/titulos/clientes/<int:pcid>", ["GET", "POST"], async (pcid: number) => {
    const novo = pcid === 0;
    const cli = novo ? {} : await q1("SELECT * FROM private_loan_clients WHERE id = ?", [pcid]);
    if (!cli) abort(404);
    const voltar = voltar_seguro(request().args.get("voltar") || request().form.get("voltar"), url_for("titulos.clientes"));
    if (request().method === "POST") {
      checar_csrf();
      const f = request().form;
      const v: Record<string, string> = {};
      for (const k of CAMPOS_CLIENTE.map(([k]) => k)) v[k] = String(f.get(k) || "").trim();
      if (!v.name) { flash("Informe o nome do cliente.", "error"); return render_template("titulos/cliente.html", ctx("titulos_clientes", { cli: { ...cli, ...v }, novo, voltar, CAMPOS_CLIENTE })); }
      if (novo) {
        const cols = Object.keys(v);
        const id = (await run(`INSERT INTO private_loan_clients (${cols.join(", ")}, status) VALUES (${cols.map(() => "?").join(", ")}, 'ativo')`, cols.map((k) => v[k]))).lastrowid;
        flash("Cliente cadastrado.", "success");
        const dest = voltar.includes("/titulos/calculadora") ? voltar + (voltar.includes("?") ? "&" : "?") + `cliente=${id}` : voltar;
        return redirect(dest);
      }
      const cols = Object.keys(v);
      await run(`UPDATE private_loan_clients SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...cols.map((k) => v[k]), agora(), pcid]);
      flash("Cadastro atualizado.", "success");
      return redirect(voltar);
    }
    const meus = novo ? [] : await titulos_calculados(await titulos("WHERE l.private_client_id = ?", [pcid]));
    return render_template("titulos/cliente.html", ctx("titulos_clientes", { cli, novo, voltar, CAMPOS_CLIENTE, meus }));
  });
}

export const CAMPOS_CLIENTE: [string, string, string][] = [
  ["name", "Nome completo / razão social", "text"], ["document", "CPF / CNPJ", "text"], ["rg", "RG", "text"],
  ["email", "E-mail (recebe o contrato)", "email"], ["phone", "Telefone / WhatsApp", "text"],
  ["nacionalidade", "Nacionalidade", "text"], ["estado_civil", "Estado civil", "text"], ["profissao", "Profissão", "text"],
  ["cep", "CEP", "text"], ["logradouro", "Endereço", "text"], ["numero", "Número", "text"], ["complemento", "Complemento", "text"],
  ["bairro", "Bairro", "text"], ["cidade", "Cidade", "text"], ["uf", "UF", "text"], ["pix_key", "Chave PIX", "text"], ["notes", "Observações", "text"],
];

/** Grava um recebimento: baixa no contas a receber (título assinado) ou pagamento avulso (títulos antigos). */
async function registrar_recebimento(t: any, p: any, dia: string, valor: number, desconto: number, conta_id: number | null, obs = "") {
  if (p.lancamento_id) {
    const lanc = await q1("SELECT * FROM financas_lancamentos WHERE id = ?", [p.lancamento_id]);
    if (lanc) {
      await fin.registrar_baixa(EMPRESA, lanc, conta_id || lanc.conta_id || null, dia, Math.round(valor * 100), 0, Math.round(desconto * 100), uid());
      return;
    }
  }
  await run("INSERT INTO private_loan_payments (loan_id, installment_id, payment_date, amount, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?)",
    [t.id, p.id, dia, r2(valor + desconto), desconto ? "quitacao" : "parcela", obs || null]);
}
