/* eslint-disable @typescript-eslint/no-explicit-any */
// Produtos da Capuzzo Assessoria dentro do ERP (Finanças) — porte de modulos/financas/capuzzo.py.
//
//   /financas/assessoria/condominios/...      Condomínios de Investimento (réplica de consulta do módulo principal)
//   /financas/assessoria/gestao-tatica/       Gestão Tática (gt.ts)
//   /financas/assessoria/titulos/             Títulos Privados (carteira)
//
// IMPORTANTE: o módulo Condomínios original (rotas /, /cotas, /clientes, /apuracao...) continua sendo o
// principal. Estas telas SÓ LEEM as tabelas existentes. Integração com o financeiro: cada produto tem um
// centro de custo próprio (criado automaticamente); receitas e despesas lançadas nesse centro aparecem na aba do produto.
import { PyDate, abort, get, pyRound, render_template, request } from "../../core/flask";
import { PyFloat } from "../../core/py";
import { CAST_NUM } from "../contratos/dados";
import * as d from "./dados";
import { _ctx, _empresa } from "./index";

export const EMPRESA = "assessoria";
export const PRODUTOS_CENTRO: Record<string, string> = { condominios: "Condomínios de Investimento", tatica: "Gestão Tática", titulos: "Títulos Privados" };
export const COND_NOMES: Record<string, string> = { civil: "Construção Civil", agro: "Agronegócio", saude: "Saúde" };
export const COND_CORES: Record<string, string> = { civil: "#C7A955", agro: "#2F6B1A", saude: "#3B6EA8" };

// ───────────────────────── apoio ─────────────────────────
export async function _so_capuzzo(slug: string): Promise<any> {
  if (slug !== EMPRESA) abort(404);
  return _empresa(slug);
}

/** Valores do módulo Condomínios estão em reais (float); o ERP usa centavos. */
export function reais(v: any) { return d.moeda(pyRound(Number(v || 0) * 100)); }

/** No SQLite consultava sqlite_master; no Supabase todas as tabelas já existem. */
export async function _tem_tabela(_nome: string) { return true; }

/** Valor de coluna REAL do SQLite (float no Python): imprime "10000.0" como o Jinja. */
export function F(v: any) { return typeof v === "number" ? new PyFloat(v) : v; }

const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);

/** Um centro de custo por produto — é por ele que o financeiro 'conversa' com os produtos. */
export async function garantir_centros(slug = EMPRESA) {
  const existentes = new Set((await d.q("SELECT nome FROM financas_centros WHERE empresa_slug = ?", [slug])).map((c: any) => c.nome));
  for (const nome of Object.values(PRODUTOS_CENTRO)) {
    if (!existentes.has(nome)) await d.ex("INSERT INTO financas_centros (empresa_slug, nome) VALUES (?, ?)", [slug, nome]);
  }
}

async function _centro_id(produto: string, slug = EMPRESA) {
  await garantir_centros(slug);
  const r = await d.q("SELECT id FROM financas_centros WHERE empresa_slug = ? AND nome = ?", [slug, PRODUTOS_CENTRO[produto]], true);
  return r ? r.id : null;
}

/** Receitas/despesas do mês e saldo em aberto lançados no centro de custo do produto. */
export async function financeiro_do_produto(produto: string, slug = EMPRESA) {
  const cid = await _centro_id(produto, slug);
  const hoje = d.hoje();
  const ini = hoje.replace({ day: 1 }).isoformat();
  const hi = hoje.isoformat();
  const lancs: any[] = await d.completar(await d.q("SELECT * FROM financas_lancamentos WHERE empresa_slug = ? AND centro_id = ? AND cancelado = 0",
    [slug, cid]), slug);
  const noMes = (l: any) => ini <= (l.competencia || "") && (l.competencia || "") <= hi;
  const aberto = (l: any) => ["aberto", "vencido", "parcial"].includes(l.situacao);
  const soma = (xs: any[], k: string) => xs.reduce((s, x) => s + x[k], 0);
  const rec_mes = soma(lancs.filter((l) => l.tipo === "receber" && noMes(l)), "pago");
  const desp_mes = soma(lancs.filter((l) => l.tipo === "pagar" && noMes(l)), "pago");
  const a_receber = soma(lancs.filter((l) => l.tipo === "receber" && aberto(l)), "saldo");
  const a_pagar = soma(lancs.filter((l) => l.tipo === "pagar" && aberto(l)), "saldo");
  const abertos = lancs.filter(aberto).sort((a, b) => cmp(a.vencimento, b.vencimento)).slice(0, 10);
  return {
    centro_id: cid, receitas_mes: rec_mes, despesas_mes: desp_mes, a_receber, a_pagar,
    abertos, receitas_mes_fmt: d.moeda(rec_mes), a_receber_fmt: d.moeda(a_receber),
  };
}

// ───────────────────────── Condomínios: dados ─────────────────────────
async function _conds(): Promise<any[]> {
  return d.q("SELECT * FROM condominiums ORDER BY id");
}

export async function _resumo_condominios() {
  const hoje = d.hoje().isoformat();
  const em30 = d.hoje().addDays(30).isoformat();
  const por: any[] = [];
  for (const c of await _conds()) {
    const r = await d.q(`SELECT COUNT(*) n, COALESCE(SUM(share_value),0) v, COUNT(DISTINCT client_id) cl,
                          SUM(CASE WHEN maturity_date BETWEEN ? AND ? THEN 1 ELSE 0 END) venc30,
                          SUM(CASE WHEN maturity_date <> '' AND maturity_date < ? THEN 1 ELSE 0 END) vencidas
                   FROM shares WHERE condominium_id = ? AND status = 'ativa'`, [hoje, em30, hoje, c.id], true);
    const pend = await d.q("SELECT COUNT(*) n, COALESCE(SUM(share_value),0) v FROM shares WHERE condominium_id = ? AND status='pendente'",
      [c.id], true);
    por.push({
      ...c, nome: COND_NOMES[c.code] ?? c.name, cor: COND_CORES[c.code] ?? "#888",
      ativas: r.n, valor: r.v, cotistas: r.cl, venc30: r.venc30 || 0,
      vencidas: r.vencidas || 0, pendentes: pend.n, valor_pend: pend.v,
      rendimento: r.v * Number(c.default_monthly_rate || 0),
    });
  }
  const tot = await d.q("SELECT COUNT(DISTINCT client_id) cl FROM shares WHERE status='ativa'", [], true);
  const ret = await d.q("SELECT COUNT(*) n FROM shares WHERE status='ativa' AND COALESCE(withdrawal_requested,0)=1", [], true);
  let ct_ag = 0, ct_dep = 0;
  if (await _tem_tabela("contratos")) {
    for (const row of await d.q("SELECT status, COUNT(*) n FROM contratos GROUP BY status")) {
      if (["rascunho", "aguardando"].includes(row.status)) ct_ag += row.n;
      else if (row.status === "assinado") ct_dep += row.n;
    }
  }
  const s = (k: string) => por.reduce((a, p) => a + p[k], 0);
  const patrimonio = s("valor");
  const rendimento = s("rendimento");
  return {
    por_produto: por, patrimonio, patrimonio_fmt: reais(patrimonio),
    cotas_ativas: s("ativas"), cotistas: tot.cl,
    pendentes: s("pendentes"), valor_pendente_fmt: reais(s("valor_pend")),
    rendimento, rendimento_fmt: reais(rendimento),
    vencem_30: s("venc30"), vencidas: s("vencidas"),
    retiradas: ret.n, contratos_aguardando: ct_ag, contratos_deposito: ct_dep,
  };
}

export async function _resumo_titulos() {
  if (!(await _tem_tabela("private_loans"))) {
    return { ativos: 0, a_receber_fmt: d.moeda(0), vencidas: 0, vencido_fmt: d.moeda(0), proxima: null, a_receber: 0, vencido: 0 };
  }
  const hoje = d.hoje().isoformat();
  const ativos = (await d.q("SELECT COUNT(*) n FROM private_loans WHERE status = 'active'", [], true)).n;
  const abertas: any[] = await d.q(`SELECT i.* FROM private_loan_installments i JOIN private_loans l ON l.id = i.loan_id
                     WHERE l.status = 'active' AND i.status <> 'paid'`);
  const resto = (i: any) => Math.max(Number(i.installment_amount || 0) - Number(i.paid_amount || 0), 0);
  const a_receber = abertas.reduce((s, i) => s + resto(i), 0);
  const venc = abertas.filter((i) => (i.due_date || "") < hoje);
  const vencido = venc.reduce((s, i) => s + resto(i), 0);
  const futuras = abertas.filter((i) => (i.due_date || "") >= hoje).sort((a, b) => cmp(a.due_date, b.due_date));
  const prox = futuras.length ? `${d.data_br(futuras[0].due_date)} · ${reais(futuras[0].installment_amount)}` : null;
  return {
    ativos, a_receber, a_receber_fmt: reais(a_receber), vencidas: venc.length,
    vencido, vencido_fmt: reais(vencido), proxima: prox,
  };
}

export async function resumo_produtos(_slug = EMPRESA) {
  const { resumo_gt } = await import("./gt");
  return { condominios: await _resumo_condominios(), titulos: await _resumo_titulos(), tatica: await resumo_gt() };
}

export async function _ctx_prod(e: any, ativo: string, extra: Record<string, any> = {}) {
  return { ...(await _ctx(e, ativo)), reais, COND_NOMES, COND_CORES, ...extra };
}

const SEMANA = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

async function _movimento_mensal(periodo = "12m"): Promise<[any, string[]]> {
  // Aquisições (pela data de aquisição) e retiradas efetivadas (cotas inativadas por retirada, pela data da retirada),
  // mês a mês, por condomínio — com o detalhe de cliente/cota/valor para abrir ao clicar.
  const hoje = d.hoje();
  const anos = (await d.q("SELECT DISTINCT substr(acquisition_date,1,4) a FROM shares WHERE acquisition_date <> '' "
    + "ORDER BY a DESC")).map((r: any) => r.a).filter((a: any) => a);
  let meses: string[];
  if (/^\d{4}$/.test(periodo)) {
    meses = Array.from({ length: 12 }, (_, i) => `${periodo}-${String(i + 1).padStart(2, "0")}`);
  } else {
    const ini = d.somar_meses(hoje.replace({ day: 1 }), -11);
    meses = Array.from({ length: 12 }, (_, i) => d.somar_meses(ini, i).strftime("%Y-%m"));
  }
  const conds = await _conds();
  const base: Record<string, any> = {};
  for (const m of meses) {
    base[m] = {
      mes: m, rotulo: `${d.MESES[parseInt(m.slice(5, 7), 10)]}/${m.slice(0, 4)}`,
      c: Object.fromEntries(conds.map((c) => [c.code, { aq_n: 0, aq_v: 0, rt_n: 0, rt_v: 0, aq: [], rt: [] }])),
    };
  }
  const ph = meses.map(() => "?").join(",");
  for (const s of await d.q(`SELECT s.share_number, s.share_value, s.acquisition_date dt, cl.full_name cliente, s.client_id, cd.code
                     FROM shares s JOIN clients cl ON cl.id = s.client_id JOIN condominiums cd ON cd.id = s.condominium_id
                     WHERE s.status IN ('ativa','inativa') AND substr(s.acquisition_date,1,7) IN (${ph})
                     ORDER BY s.acquisition_date, cl.full_name, s.id`, meses)) {
    const x = base[s.dt.slice(0, 7)].c[s.code];
    if (x !== undefined) {
      x.aq_n += 1;
      x.aq_v += s.share_value || 0;
      x.aq.push({ cli: s.cliente, cid: s.client_id, cota: s.share_number, v: s.share_value ? F(s.share_value) : 0, dt: s.dt });
    }
  }
  for (const s of await d.q(`SELECT s.share_number, s.share_value, COALESCE(NULLIF(s.withdrawal_effective_date,''), s.withdrawal_date) dt,
                            cl.full_name cliente, s.client_id, cd.code
                     FROM shares s JOIN clients cl ON cl.id = s.client_id JOIN condominiums cd ON cd.id = s.condominium_id
                     WHERE s.status = 'inativa'
                       AND substr(COALESCE(NULLIF(s.withdrawal_effective_date,''), s.withdrawal_date),1,7) IN (${ph})
                     ORDER BY dt, cl.full_name, s.id`, meses)) {
    const x = base[s.dt.slice(0, 7)].c[s.code];
    if (x !== undefined) {
      x.rt_n += 1;
      x.rt_v += s.share_value || 0;
      x.rt.push({ cli: s.cliente, cid: s.client_id, cota: s.share_number, v: s.share_value ? F(s.share_value) : 0, dt: s.dt });
    }
  }
  const linhas = meses.map((m) => base[m]);
  const ks = ["aq_n", "aq_v", "rt_n", "rt_v"];
  for (const l of linhas) {
    for (const k of ["aq_v", "rt_v", "aq_n", "rt_n"]) l[k] = Object.values(l.c).reduce((s: number, x: any) => s + x[k], 0);
  }
  const tot = Object.fromEntries(conds.map((c) => [c.code, Object.fromEntries(ks.map((k) => [k, linhas.reduce((s, l) => s + l.c[c.code][k], 0)]))]));
  const geral = Object.fromEntries(ks.map((k) => [k, linhas.reduce((s, l) => s + l[k], 0)]));
  return [{ linhas, conds, tot, geral }, anos];
}

export function registrar() {
  // ───────────────────────── Condomínios: telas ─────────────────────────
  get("financas.cond_painel", "/financas/<slug>/condominios/", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const res = await _resumo_condominios();
    let dias = request().args.get("dias", 30, "int");
    dias = [15, 30, 60, 90].includes(dias) ? dias : 30;
    const hoje = d.hoje().isoformat();
    const ate = d.hoje().addDays(dias).isoformat();
    const vencendo: any[] = await d.q(`SELECT s.id, s.client_id, s.share_number, s.share_value, s.maturity_date, cl.full_name cliente, cd.code
                      FROM shares s JOIN clients cl ON cl.id = s.client_id JOIN condominiums cd ON cd.id = s.condominium_id
                      WHERE s.status = 'ativa' AND s.maturity_date BETWEEN ? AND ?
                      ORDER BY s.maturity_date, cl.full_name, s.share_number, s.id`, [hoje, ate]);
    // agrupa por dia de vencimento → cliente → cotas
    const por_dia = new Map<string, any>();
    for (const s of vencendo) {
      if (!por_dia.has(s.maturity_date)) por_dia.set(s.maturity_date, { data: s.maturity_date, total: 0, n: 0, clientes: new Map() });
      const dia = por_dia.get(s.maturity_date);
      dia.total += s.share_value || 0;
      dia.n += 1;
      if (!dia.clientes.has(s.client_id)) dia.clientes.set(s.client_id, { client_id: s.client_id, nome: s.cliente, total: 0, cotas: [] });
      const c = dia.clientes.get(s.client_id);
      c.total += s.share_value || 0;
      c.cotas.push(s);
    }
    const venc_dias: any[] = [];
    for (const dia of Array.from(por_dia.values()).sort((a, b) => cmp(a.data, b.data))) {
      dia.clientes = Array.from(dia.clientes.values()).sort((a: any, b: any) => b.total - a.total);
      dia.sem = SEMANA[PyDate.fromisoformat(dia.data.slice(0, 10)).weekday()];
      venc_dias.push(dia);
    }
    const n_cli_venc = new Set(vencendo.map((s) => s.client_id)).size;
    const ultimas = await d.q(`SELECT mc.*, cd.code, COALESCE(SUM(i.income_value),0) total, COUNT(i.id) itens
                     FROM monthly_calculations mc LEFT JOIN condominiums cd ON cd.id = mc.condominium_id
                     LEFT JOIN monthly_calculation_items i ON i.monthly_calculation_id = mc.id
                     GROUP BY mc.id, cd.code ORDER BY mc.calculation_year DESC, mc.calculation_month DESC, mc.id DESC LIMIT 6`);
    let periodo = request().args.get("periodo", "12m");
    if (!/^\d{4}$/.test(periodo)) periodo = "12m";
    const [mov, anos] = await _movimento_mensal(periodo);
    return render_template("financas/cap/cond_painel.html", await _ctx_prod(e, "cond_painel", {
      res, venc_dias, venc_total: venc_dias.reduce((s, x) => s + x.total, 0), n_cotas_venc: vencendo.length, n_cli_venc, dias,
      ultimas, mov, periodo: request().args.get("periodo", "12m"), anos,
    }));
  });

  get("financas.cond_produto", "/financas/<slug>/condominios/<any(civil, agro, saude):code>", async (slug: string, code: string) => {
    const e = await _so_capuzzo(slug);
    const cond = await d.q("SELECT * FROM condominiums WHERE code = ?", [code], true);
    if (!cond) abort(404);
    const status = request().args.get("status", "ativa");
    const busca = String(request().args.get("q") || "").trim();
    let sql = `SELECT s.*, cl.full_name cliente, cl.cpf FROM shares s JOIN clients cl ON cl.id = s.client_id
             WHERE s.condominium_id = ?`;
    const par: any[] = [cond.id];
    if (["ativa", "pendente", "inativa"].includes(status)) { sql += " AND s.status = ?"; par.push(status); }
    if (busca) {
      sql += " AND (cl.full_name LIKE ? OR s.share_number LIKE ? OR cl.cpf LIKE ?)";
      par.push(`%${busca}%`, `%${busca}%`, `%${d.so_digitos(busca) || busca}%`);
    }
    sql += ` ORDER BY ${CAST_NUM("s.share_number")}, s.share_number, s.id`; // s.id: desempate como a ordem do SQLite
    const cotas = await d.q(sql, par);
    const prod = (await _resumo_condominios()).por_produto.find((p: any) => p.code === code);
    return render_template("financas/cap/cond_produto.html", await _ctx_prod(e, `cond_${code}`, {
      cond, code, prod, cotas, status, busca, hoje: d.hoje().isoformat(),
    }));
  });

  get("financas.cond_cotistas", "/financas/<slug>/condominios/cotistas", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const busca = String(request().args.get("q") || "").trim();
    let sql = `SELECT cl.*, COUNT(s.id) FILTER (WHERE s.status='ativa') cotas_ativas,
                    COALESCE(SUM(s.share_value) FILTER (WHERE s.status='ativa'), 0) valor,
                    COUNT(s.id) FILTER (WHERE s.status='pendente') pendentes,
                    MIN(s.maturity_date) FILTER (WHERE s.status='ativa' AND s.maturity_date >= date('now')) prox_venc
             FROM clients cl LEFT JOIN shares s ON s.client_id = cl.id WHERE 1=1`;
    const par: any[] = [];
    if (busca) {
      sql += " AND (cl.full_name LIKE ? OR cl.cpf LIKE ? OR cl.email LIKE ?)";
      par.push(`%${busca}%`, `%${d.so_digitos(busca) || busca}%`, `%${busca}%`);
    }
    sql += " GROUP BY cl.id ORDER BY valor DESC, cl.full_name";
    const lista = await d.q(sql, par);
    return render_template("financas/cap/cond_cotistas.html", await _ctx_prod(e, "cond_cotistas", { lista, busca }));
  });

  get("financas.cond_cotista", "/financas/<slug>/condominios/cotistas/<int:cid>", async (slug: string, cid: number) => {
    const e = await _so_capuzzo(slug);
    const cli = await d.q("SELECT * FROM clients WHERE id = ?", [cid], true);
    if (!cli) abort(404);
    const cotas: any[] = await d.q(`SELECT s.*, cd.code FROM shares s JOIN condominiums cd ON cd.id = s.condominium_id
                   WHERE s.client_id = ? ORDER BY s.status, cd.id, ${CAST_NUM("s.share_number")}, s.id`, [cid]);
    const contratos: any[] = (await _tem_tabela("contratos"))
      ? await d.q("SELECT id, codigo, status, criado_em, assinado_em, dados FROM contratos WHERE client_id = ? ORDER BY id DESC", [cid])
      : [];
    for (const c of contratos) c.dados = JSON.parse(c.dados || "{}");
    const rend = await d.q(`SELECT mc.calculation_month m, mc.calculation_year a, SUM(i.income_value) v
                  FROM monthly_calculation_items i JOIN monthly_calculations mc ON mc.id = i.monthly_calculation_id
                  WHERE i.client_id = ? GROUP BY a, m ORDER BY a DESC, m DESC LIMIT 12`, [cid]);
    const ativas = cotas.filter((c) => c.status === "ativa");
    return render_template("financas/cap/cond_cotista.html", await _ctx_prod(e, "cond_cotistas", {
      cli, cotas, contratos, rend, total_ativo: ativas.reduce((s, c) => s + c.share_value, 0), n_ativas: ativas.length,
    }));
  });

  get("financas.cond_vencimentos", "/financas/<slug>/condominios/vencimentos", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const aba = request().args.get("aba", "vencimentos");
    const dias = request().args.get("dias", 60, "int");
    const hoje = d.hoje().isoformat();
    const ate = d.hoje().addDays(Math.max(dias, 1)).isoformat();
    const base = `SELECT s.*, cl.full_name cliente, cl.email, cl.phone, cd.code FROM shares s
              JOIN clients cl ON cl.id = s.client_id JOIN condominiums cd ON cd.id = s.condominium_id`;
    let lista: any[];
    if (aba === "retiradas") {
      lista = await d.q(base + " WHERE s.status = 'ativa' AND COALESCE(s.withdrawal_requested,0) = 1 "
        + "ORDER BY COALESCE(s.withdrawal_effective_date, s.maturity_date) NULLS FIRST, s.id");
    } else if (aba === "vencidas") {
      lista = await d.q(base + " WHERE s.status = 'ativa' AND s.maturity_date <> '' AND s.maturity_date < ? ORDER BY s.maturity_date, s.id", [hoje]);
    } else {
      lista = await d.q(base + " WHERE s.status = 'ativa' AND s.maturity_date BETWEEN ? AND ? ORDER BY s.maturity_date, s.id", [hoje, ate]);
    }
    const { B } = await import("./cond_ops");
    const b = B();
    for (const s of lista) { // datas sugeridas para os botões "Vai renovar" / "Vai retirar" (mesma regra do módulo principal)
      s.condominium_code = s.code;
      [s.sug_ren, s.sug_venc] = await b._sugestao_renovacao(s, d.hoje());
      [s.sug_ped, s.sug_eff, s.sug_dias] = await b._sugestao_retirada(s, d.hoje());
    }
    return render_template("financas/cap/cond_vencimentos.html", await _ctx_prod(e, "cond_vencimentos", {
      lista, aba, dias, hoje, total: lista.reduce((s, x) => s + x.share_value, 0),
    }));
  });

  get("financas.cond_apuracao", "/financas/<slug>/condominios/apuracoes", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const lista: any[] = await d.q(`SELECT mc.*, cd.code, cd.name, COALESCE(SUM(i.income_value),0) total, COUNT(i.id) itens,
                          COUNT(DISTINCT i.client_id) clientes
                   FROM monthly_calculations mc LEFT JOIN condominiums cd ON cd.id = mc.condominium_id
                   LEFT JOIN monthly_calculation_items i ON i.monthly_calculation_id = mc.id
                   GROUP BY mc.id, cd.code, cd.name ORDER BY mc.calculation_year DESC, mc.calculation_month DESC, mc.id DESC`);
    const meses = new Map<string, any>();
    for (const a of lista) {
      const k = `${a.calculation_year}|${a.calculation_month}`;
      if (!meses.has(k)) meses.set(k, { ano: a.calculation_year, mes: a.calculation_month, total: 0, itens: [] });
      meses.get(k).total += a.total;
      meses.get(k).itens.push(a);
    }
    return render_template("financas/cap/cond_apuracao.html", await _ctx_prod(e, "cond_apuracao", { meses: Array.from(meses.values()) }));
  });

  get("financas.cond_contratos", "/financas/<slug>/condominios/contratos", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    let lista: any[] = [];
    if (await _tem_tabela("contratos")) {
      lista = await d.q(`SELECT ct.id, ct.tipo, ct.status, ct.criado_em, ct.enviado_em, ct.assinado_em, ct.concluido_em, ct.dados,
                              cl.full_name cliente, cd.code
                       FROM contratos ct JOIN clients cl ON cl.id = ct.client_id
                       JOIN condominiums cd ON cd.id = ct.condominium_id ORDER BY ct.id DESC`);
      for (const c of lista) c.dados = JSON.parse(c.dados || "{}");
    }
    const st = {
      rascunho: ["Aguardando envio", "neutro"], aguardando: ["Aguardando assinatura", "aviso"],
      assinado: ["Assinado · aguarda depósito", "aviso"], concluido: ["Concluído", "ok"], cancelado: ["Cancelado", "risco"],
    };
    const tipo = request().args.get("tipo", "");
    if (tipo) lista = lista.filter((c) => c.tipo === tipo);
    const TIPOS_CT = { aquisicao: "Aquisição", renovacao: "Renovação", retirada: "Retirada" };
    return render_template("financas/cap/cond_contratos.html", await _ctx_prod(e, "cond_contratos", { lista, ST: st, TIPOS_CT, tipo }));
  });

  // ───────────────────────── Títulos Privados ─────────────────────────
  get("financas.titulos_painel", "/financas/<slug>/titulos/", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const aba = request().args.get("aba", "carteira");
    const hoje = d.hoje().isoformat();
    let emprestimos: any[] = [], parcelas: any[] = [];
    if (await _tem_tabela("private_loans")) {
      emprestimos = await d.q(`SELECT l.*, c.name cliente,
                                    (SELECT COUNT(*) FROM private_loan_installments i WHERE i.loan_id=l.id AND i.status='paid') pagas,
                                    (SELECT COALESCE(SUM(i.installment_amount - COALESCE(i.paid_amount,0)),0)
                                       FROM private_loan_installments i WHERE i.loan_id=l.id AND i.status<>'paid') saldo,
                                    (SELECT MIN(i.due_date) FROM private_loan_installments i WHERE i.loan_id=l.id AND i.status<>'paid') prox
                             FROM private_loans l LEFT JOIN private_loan_clients c ON c.id = l.private_client_id
                             ORDER BY l.status, prox NULLS FIRST, l.id`); // NULLS FIRST: ordem do SQLite
      parcelas = await d.q(`SELECT i.*, l.loan_number, l.id loan_id, c.name cliente FROM private_loan_installments i
                          JOIN private_loans l ON l.id = i.loan_id LEFT JOIN private_loan_clients c ON c.id = l.private_client_id
                          WHERE i.status <> 'paid' AND l.status = 'active' ORDER BY i.due_date, i.id`);
    }
    return render_template("financas/cap/titulos.html", await _ctx_prod(e, aba === "parcelas" ? "tit_parcelas" : "tit_painel", {
      aba, res: await _resumo_titulos(), emprestimos, parcelas, hoje,
      fin: await financeiro_do_produto("titulos", slug),
    }));
  });
  // Gestão Tática: telas em gt.ts
}
