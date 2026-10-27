/* eslint-disable @typescript-eslint/no-explicit-any */
// validacao_sistema_calculations.py — Validação Sistema (projeção gerencial)
// Condomínios de Investimento — Grupo Capuzzo
//
// Simula, cota a cota, quanto cada cliente ainda vai receber de rendimento até o
// vencimento de cada cota, assumindo que o cliente RETIRA a cota no vencimento.
// SOMENTE LEITURA e SOMENTE SIMULAÇÃO — não grava nada.
//
// Regras de retirada:
//   Civil  (1,7%/mês): rende até o mês do vencimento, inclusive (sem mês extra).
//   Agro   (1,5%/mês): no mês do vencimento 3,5%; +1 mês extra a 1,5%.
//   Saúde  (1,8%/mês): rende até o mês do vencimento; +1 mês extra a 1,8%.
//   Cota sem maturity_date → ativa em todo o horizonte, com a taxa normal.
//
// Os valores monetários/taxas são devolvidos como Decimal (como no Python):
// str() igual ao Python, valueOf() numérico para os templates.
import { PyDate, pyStr, ultimoDiaMes } from "../core/py";
import { Decimal, D, ROUND_HALF_UP, pyFloatRepr, pyInt, dget, ou, sortBy, pyMax, pyMin, somaDec, ehTypeOuValue } from "./pyextra";
import * as db from "./database";

export { Decimal } from "./pyextra";

// ══════════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════════

export const CENTS = D("0.01");
export const AGRO_MATURITY_RATE = D("0.035");
export const DEFAULT_RATES: Record<string, Decimal> = { civil: D("0.017"), agro: D("0.015"), saude: D("0.018") };
export const EXTRA_WITHDRAWAL_MONTHS: Record<string, number> = { civil: 0, agro: 1, saude: 1 };
export const MESES_ABREV = ["", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const STATUS_CONSIDERADOS = ["ativa"];

const tem = (o: Record<string, any>, k: any) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

// ══════════════════════════════════════════════════════════════
// UTILITÁRIOS DE DATA / MÊS
// ══════════════════════════════════════════════════════════════

function _strp(texto: string, re: RegExp, ordem: "ymd" | "dmy"): PyDate | null {
  const m = re.exec(texto);
  if (!m) return null;
  const [y, mo, d] = ordem === "ymd" ? [+m[1], +m[2], +m[3]] : [+m[3], +m[2], +m[1]];
  const r = new PyDate(y, mo, d);
  if (!r.valid()) return null;
  if (m[4] !== undefined) {
    const h = +m[4], mi = +m[5], s = +m[6];
    if (h > 23 || mi > 59 || s > 61) return null;
  }
  return r;
}

/** Converte texto/date para date. null se vazio ou inválido. */
export function parse_date(valor: any): PyDate | null {
  if (!valor) return null;
  if (valor instanceof PyDate) return valor.isDatetime ? valor.date() : valor;
  const texto = pyStr(valor).trim();
  if (!texto) return null;
  return (
    _strp(texto, /^(\d{4})-(\d{1,2})-(\d{1,2})$/, "ymd") ??
    _strp(texto, /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, "dmy") ??
    _strp(texto, /^(\d{1,2})-(\d{1,2})-(\d{4})$/, "dmy") ??
    _strp(texto, /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/, "ymd")
  );
}

/** Primeiro dia do mês da data informada. */
export function month_start(d: any): PyDate | null {
  const x = parse_date(d);
  return x === null ? null : new PyDate(x.year, x.month, 1);
}

/** Soma n meses (n pode ser negativo), sempre retornando o dia 1. */
export function add_months(d: any, n: number): PyDate | null {
  const x = parse_date(d);
  if (x === null) return null;
  const total = x.year * 12 + (x.month - 1) + n;
  const ano = Math.floor(total / 12), mes = total - ano * 12;
  return new PyDate(ano, mes + 1, 1);
}

/** True se as duas datas são do mesmo mês/ano. */
export function same_month(d1: any, d2: any): boolean {
  const a = parse_date(d1), b = parse_date(d2);
  if (a === null || b === null) return false;
  return a.year === b.year && a.month === b.month;
}

/** Primeiro dia do mês seguinte. */
export function month_after(d1: any): PyDate | null { return add_months(d1, 1); }

/** Diferença em meses (d2 - d1). */
export function months_between(d1: any, d2: any): number | null {
  const a = parse_date(d1), b = parse_date(d2);
  if (a === null || b === null) return null;
  return (b.year * 12 + b.month) - (a.year * 12 + a.month);
}

/** Chave 'AAAA-MM'. */
export function month_key(d: any): string {
  const x = parse_date(d);
  return x ? `${String(x.year).padStart(4, "0")}-${String(x.month).padStart(2, "0")}` : "";
}

/** Rótulo 'ago/2026'. */
export function month_label(d: any): string {
  const x = parse_date(d);
  return x ? `${MESES_ABREV[x.month]}/${x.year}` : "";
}

/** Último dia do mês. */
export function month_end(d: any): PyDate | null {
  const x = parse_date(d);
  return x === null ? null : new PyDate(x.year, x.month, ultimoDiaMes(x.year, x.month));
}

// ══════════════════════════════════════════════════════════════
// UTILITÁRIOS NUMÉRICOS
// ══════════════════════════════════════════════════════════════

/** Converte qualquer coisa para Decimal com segurança. */
export function to_decimal(valor: any, padrao = "0"): Decimal {
  if (valor instanceof Decimal) return valor;
  if (valor === null || valor === undefined || valor === "") return D(padrao);
  try {
    if (typeof valor === "number") return new Decimal(Number.isInteger(valor) ? String(valor) : pyFloatRepr(valor));
    return new Decimal(pyStr(valor));
  } catch {
    return D(padrao);
  }
}

/** Arredonda para centavos (ROUND_HALF_UP). */
export function money(valor: any): Decimal {
  return to_decimal(valor).quantize(CENTS, ROUND_HALF_UP);
}

/** R$ 10.000,00 — formatação pt-BR a partir de Decimal. */
export function formatar_valor(valor: any): string {
  try {
    return ("R$ " + money(valor).format(",.2f")).replace(/,/g, "X").replace(/\./g, ",").replace(/X/g, ".");
  } catch {
    return "R$ 0,00";
  }
}

/** 0.017 → '1,7%' · 0.035 → '3,5%' · 0.0175 → '1,75%'. */
export function rate_label(taxa: any): string {
  const pct = to_decimal(taxa).mul(D("100")).normalize();
  let texto = pct.toPlain();
  if (texto.includes(".")) texto = texto.replace(/0+$/, "").replace(/\.$/, "");
  return texto.replace(/\./g, ",") + "%";
}

/** Taxa normal do condomínio: preferir a cadastrada no banco. */
export function normal_rate_for(condominium: any): Decimal {
  const code = ou(dget(condominium || {}, "code"), "");
  const bruta = dget(condominium || {}, "default_monthly_rate");
  let taxa = to_decimal(bruta, "0");
  if (taxa.le(0)) taxa = tem(DEFAULT_RATES, code) ? DEFAULT_RATES[code] : D("0");
  return taxa;
}

// ══════════════════════════════════════════════════════════════
// REGRA CENTRAL — a cota rende neste mês?
// ══════════════════════════════════════════════════════════════

/** Decide se UMA cota rende em UM mês da projeção. */
export function should_share_yield_in_month(share: any, condominium: any, projection_month: any): any {
  if (typeof condominium === "string") {
    condominium = { code: condominium, default_monthly_rate: tem(DEFAULT_RATES, condominium) ? DEFAULT_RATES[condominium] : 0 };
  }
  condominium = condominium || {};
  const code = String(ou(dget(condominium, "code"), "")).trim().toLowerCase();
  const taxa_normal = normal_rate_for(condominium);
  const pm = month_start(projection_month);
  const mat = parse_date(dget(share || {}, "maturity_date"));

  const resultado = (should: boolean, rate: any, reason: string,
    { maturity = false, extra = false, has_mat = true, badge = "normal" } = {}) => ({
    should_yield: should,
    rate: to_decimal(rate),
    reason,
    is_maturity_month: maturity,
    is_extra_withdrawal_month: extra,
    has_maturity: has_mat,
    badge,
  });

  if (pm === null) return resultado(false, 0, "Mês de projeção inválido", { has_mat: mat !== null, badge: "fora" });

  if (mat === null) {
    return resultado(true, taxa_normal,
      "Sem vencimento cadastrado — considerada ativa em " +
      "todo o horizonte, com a taxa normal do condomínio",
      { has_mat: false, badge: "sem_vencimento" });
  }

  const mat_m = month_start(mat);
  const delta = months_between(mat_m, pm)!;
  const dm = mat.strftime("%d/%m/%Y");

  if (code === "civil") {
    if (delta < 0) return resultado(true, taxa_normal, `Antes do vencimento (${dm}) — taxa normal`);
    if (delta === 0) {
      return resultado(true, taxa_normal, `Mês do vencimento (${dm}) — recebe normalmente; retirada 3 dias depois`,
        { maturity: true, badge: "venc_civil" });
    }
    return resultado(false, 0, `Após o vencimento (${dm}) — cota fora da base de rendimento`, { badge: "fora" });
  }

  if (code === "agro") {
    if (delta < 0) return resultado(true, taxa_normal, `Antes do vencimento (${dm}) — taxa normal`);
    if (delta === 0) {
      return resultado(true, AGRO_MATURITY_RATE, `Mês do vencimento (${dm}) — taxa especial Agro de ${rate_label(AGRO_MATURITY_RATE)}`,
        { maturity: true, badge: "venc_agro" });
    }
    if (delta === 1) {
      return resultado(true, taxa_normal, "Mês extra de retirada (prazo de 30 dias) — taxa normal", { extra: true, badge: "mes_extra" });
    }
    return resultado(false, 0, `Após o mês extra de retirada (venc. ${dm}) — cota fora da base de rendimento`, { badge: "fora" });
  }

  if (code === "saude") {
    if (delta < 0) return resultado(true, taxa_normal, `Antes do vencimento (${dm}) — taxa normal`);
    if (delta === 0) {
      return resultado(true, taxa_normal, `Mês do vencimento (${dm}) — taxa normal`, { maturity: true, badge: "venc_saude" });
    }
    if (delta === 1) {
      return resultado(true, taxa_normal, "Mês extra de retirada (prazo de 30 dias) — taxa normal", { extra: true, badge: "mes_extra" });
    }
    return resultado(false, 0, `Após o mês extra de retirada (venc. ${dm}) — cota fora da base de rendimento`, { badge: "fora" });
  }

  // Condomínio desconhecido — trata como Civil (conservador)
  const extras = tem(EXTRA_WITHDRAWAL_MONTHS, code) ? EXTRA_WITHDRAWAL_MONTHS[code] : 0;
  if (delta < 0) return resultado(true, taxa_normal, "Antes do vencimento — taxa normal");
  if (delta === 0) return resultado(true, taxa_normal, "Mês do vencimento — taxa normal", { maturity: true, badge: "venc_civil" });
  if (delta <= extras) return resultado(true, taxa_normal, "Mês extra de retirada — taxa normal", { extra: true, badge: "mes_extra" });
  return resultado(false, 0, "Após o vencimento — fora da base", { badge: "fora" });
}

/** Último mês em que a cota ainda rende (null se não tem vencimento). */
export function share_last_yield_month(share: any, condominium: any): PyDate | null {
  if (typeof condominium === "string") condominium = { code: condominium };
  const code = String(ou(dget(condominium || {}, "code"), "")).trim().toLowerCase();
  const mat = parse_date(dget(share || {}, "maturity_date"));
  if (mat === null) return null;
  return add_months(month_start(mat), tem(EXTRA_WITHDRAWAL_MONTHS, code) ? EXTRA_WITHDRAWAL_MONTHS[code] : 0);
}

// ══════════════════════════════════════════════════════════════
// DESCRIÇÃO DA REGRA DE RETIRADA
// ══════════════════════════════════════════════════════════════

export const WITHDRAWAL_RULE_TEXT: Record<string, string> = {
  civil: "Rende até o mês do vencimento · retirada em 3 dias · sem mês extra",
  agro: "3,5% no mês do vencimento · +1 mês à taxa normal (retirada em 30 dias)",
  saude: "Taxa normal no mês do vencimento · +1 mês à taxa normal (retirada em 30 dias)",
};

export function withdrawal_rule_text(code: any): string {
  const k = String(ou(code, "")).trim().toLowerCase();
  return tem(WITHDRAWAL_RULE_TEXT, k) ? WITHDRAWAL_RULE_TEXT[k] : "Rende até o mês do vencimento";
}

/** Lista de primeiros-dias-de-mês do horizonte da projeção. */
export function build_month_range(start_month: any, months: any): PyDate[] {
  const inicio = month_start(start_month) ?? month_start(PyDate.today())!;
  let qtd: number;
  try {
    qtd = pyInt(months);
  } catch (e) {
    if (!ehTypeOuValue(e)) throw e;
    qtd = 24;
  }
  qtd = Math.max(1, Math.min(qtd, 120));
  return Array.from({ length: qtd }, (_, i) => add_months(inicio, i)!);
}

// ══════════════════════════════════════════════════════════════
// PROJEÇÃO — CLIENTE x CONDOMÍNIO
// ══════════════════════════════════════════════════════════════

/** Projeta, mês a mês, o rendimento das cotas de UM cliente em UM condomínio. */
export async function calculate_client_condominium_projection(
  client_id: number, condominium_id: number, start_month: any, months: any,
  shares: any[] | null = null, condominium: any = null,
): Promise<any> {
  if (shares === null || shares === undefined || condominium === null || condominium === undefined) {
    const todas = await db.get_shares_for_validation(condominium_id, client_id);
    if (shares === null || shares === undefined) shares = todas;
    if (condominium === null || condominium === undefined) {
      condominium = (await db.get_condominiums()).find((c) => c.id === condominium_id) ?? {};
    }
  }
  return _projecao(condominium_id, start_month, months, shares!, condominium);
}

/** Parte síncrona da projeção (usada também por calculate_all_clients_validation). */
function _projecao(condominium_id: number, start_month: any, months: any, shares: any[], condominium0: any): any {
  const condominium: any = { ...(condominium0 || {}) };
  const code = String(ou(dget(condominium, "code"), "")).trim().toLowerCase();
  const taxa_normal = normal_rate_for(condominium);
  const meses = build_month_range(start_month, months);
  const inicio = meses[0];

  // ── Nível 3 · lista de cotas ──
  let cotas_out: any[] = [];
  let total_investido = D("0");
  const maturities: PyDate[] = [];
  let sem_vencimento = 0;

  for (const s of shares) {
    const valor = money(dget(s, "share_value"));
    total_investido = total_investido.add(valor);
    const mat = parse_date(dget(s, "maturity_date"));
    if (mat) maturities.push(mat);
    else sem_vencimento += 1;

    const ultimo = share_last_yield_month(s, condominium);
    const obs: string[] = [];
    if (mat === null) obs.push("Sem vencimento cadastrado — rende em todo o horizonte");
    if (dget(s, "withdrawal_requested")) {
      const eff = ou(dget(s, "withdrawal_effective_date"), "—");
      obs.push(`Retirada já solicitada · efetiva em ${pyStr(eff)}`);
    }
    if (mat && mat.compare(inicio) < 0) obs.push("Vencimento anterior ao início da projeção");
    if (dget(s, "notes")) obs.push(pyStr(dget(s, "notes")));

    cotas_out.push({
      share_id: dget(s, "id"),
      share_number: dget(s, "share_number"),
      share_value: valor,
      acquisition_date: ou(dget(s, "acquisition_date"), ""),
      maturity_date: ou(dget(s, "maturity_date"), ""),
      status: ou(dget(s, "status"), ""),
      withdrawal_requested: Boolean(dget(s, "withdrawal_requested")),
      withdrawal_rule: withdrawal_rule_text(code),
      has_maturity: mat !== null,
      last_yield_month: ultimo ? month_key(ultimo) : "",
      last_yield_month_label: ultimo ? month_label(ultimo) : "Indeterminado",
      notes: obs,
    });
  }
  cotas_out = sortBy(cotas_out, (c) => [c.maturity_date || "9999-99-99", pyStr(c.share_number)]);

  // ── Projeção mensal ──
  const projecao: any[] = [];
  for (const pm of meses) {
    let base = D("0"), rend = D("0"), rend_normal = D("0"), rend_especial = D("0");
    let incluidas = 0, vencendo = 0, extras = 0, sem_venc_mes = 0;
    const taxas: string[] = [], badges: string[] = [];
    const vencendo_cotas: any[] = [], encerrando_cotas: any[] = [];

    for (const s of shares) {
      const r = should_share_yield_in_month(s, condominium, pm);
      if (!r.should_yield) continue;
      const valor = money(dget(s, "share_value"));
      const taxa: Decimal = r.rate;
      const parcela = money(valor.mul(taxa));
      base = base.add(valor);
      rend = rend.add(parcela);
      incluidas += 1;
      if (r.is_maturity_month && taxa.ne(taxa_normal)) rend_especial = rend_especial.add(parcela);
      else rend_normal = rend_normal.add(parcela);

      const rot = rate_label(taxa);
      if (!taxas.includes(rot)) taxas.push(rot);
      if (!badges.includes(r.badge)) badges.push(r.badge);

      if (r.is_maturity_month) {
        vencendo += 1;
        vencendo_cotas.push({ share_number: dget(s, "share_number"), share_value: valor, maturity_date: ou(dget(s, "maturity_date"), ""), rate_label: rot });
      }
      if (r.is_extra_withdrawal_month) extras += 1;
      if (!r.has_maturity) sem_venc_mes += 1;

      const ultimo_cota = share_last_yield_month(s, condominium);
      if (ultimo_cota && same_month(ultimo_cota, pm)) {
        encerrando_cotas.push({ share_number: dget(s, "share_number"), share_value: valor, maturity_date: ou(dget(s, "maturity_date"), "") });
      }
    }

    const notas: string[] = [];
    if (incluidas === 0) {
      notas.push("Nenhuma cota rende neste mês — todas já saíram da base");
      if (!badges.includes("fora")) badges.push("fora");
    }
    if (vencendo) {
      if (code === "agro") notas.push(`${vencendo} cota(s) vencendo — taxa especial Agro ${rate_label(AGRO_MATURITY_RATE)} neste mês`);
      else notas.push(`${vencendo} cota(s) vencendo — recebem normalmente neste mês`);
    }
    if (extras) notas.push(`${extras} cota(s) no mês extra de retirada (prazo de 30 dias)`);
    if (sem_venc_mes) notas.push(`${sem_venc_mes} cota(s) sem vencimento cadastrado`);
    if (encerrando_cotas.length) {
      const nums = encerrando_cotas.map((c) => pyStr(c.share_number)).join(", ");
      notas.push(`Último rendimento da(s) cota(s) ${nums} — sai(em) da base no mês seguinte`);
    }

    projecao.push({
      month: month_key(pm),
      month_label: month_label(pm),
      base_amount: money(base),
      yield_amount: money(rend),
      normal_yield_amount: money(rend_normal),
      special_yield_amount: money(rend_especial),
      rates_applied: taxas,
      shares_included: incluidas,
      shares_maturing: vencendo,
      shares_extra: extras,
      maturing_shares: vencendo_cotas,
      ending_shares: encerrando_cotas,
      badges,
      notes: notas,
    });
  }

  // ── Resumos do condomínio ──
  const futuros = sortBy(maturities.filter((m) => m.compare(inicio) >= 0), (m) => m);
  const proximo = futuros.length ? futuros[0] : maturities.length ? pyMin(maturities) : null;

  let ultimo_mes: string, ultimo_label: string;
  if (sem_vencimento) {
    ultimo_mes = ""; ultimo_label = "Indeterminado (cota sem vencimento)";
  } else {
    const ultimos = shares.map((s) => share_last_yield_month(s, condominium)).filter((u): u is PyDate => !!u);
    const alvo = ultimos.length ? pyMax(ultimos) : null;
    ultimo_mes = alvo ? month_key(alvo) : "";
    ultimo_label = alvo ? month_label(alvo) : "—";
  }

  return {
    condominium_id: ou(dget(condominium, "id"), condominium_id),
    condominium_name: ou(dget(condominium, "name"), code),
    condominium_code: code,
    normal_rate: taxa_normal,
    normal_rate_label: rate_label(taxa_normal),
    withdrawal_rule: withdrawal_rule_text(code),
    total_invested: money(total_investido),
    shares_count: shares.length,
    shares_without_maturity: sem_vencimento,
    next_maturity_date: proximo ? proximo.isoformat() : "",
    next_maturity_overdue: Boolean(proximo && proximo.compare(inicio) < 0),
    last_yield_month: ultimo_mes,
    last_yield_month_label: ultimo_label,
    current_month_yield: projecao.length ? projecao[0].yield_amount : D("0"),
    next_month_yield: projecao.length > 1 ? projecao[1].yield_amount : D("0"),
    yield_12m: money(somaDec(projecao.slice(0, 12).map((m) => m.yield_amount), D("0"))),
    yield_horizon: money(somaDec(projecao.map((m) => m.yield_amount), D("0"))),
    shares: cotas_out,
    monthly_projection: projecao,
  };
}

// ══════════════════════════════════════════════════════════════
// PROJEÇÃO — TODOS OS CLIENTES
// ══════════════════════════════════════════════════════════════

const _vazioFiltro = (v: any) => v === null || v === undefined || v === "" || v === 0 || v === "0" || v === false;

/** Estrutura completa da tela Validação Sistema (somente leitura). */
export async function calculate_all_clients_validation(start_month: any = null, months: any = 24,
  client_filter: any = null, condominium_filter: any = null): Promise<any[]> {
  const inicio = month_start(start_month) ?? month_start(PyDate.today())!;
  const meses = build_month_range(inicio, months);

  const conds = new Map<any, any>();
  for (const c of await db.get_condominiums()) conds.set(c.id, { ...c });

  let cond_id: any = null;
  if (!_vazioFiltro(condominium_filter)) {
    try {
      cond_id = pyInt(condominium_filter);
    } catch (e) {
      if (!ehTypeOuValue(e)) throw e;
      const alvo = pyStr(condominium_filter).trim().toLowerCase();
      cond_id = null;
      for (const c of conds.values()) if (String(ou(dget(c, "code"), "")).toLowerCase() === alvo) { cond_id = c.id; break; }
    }
  }

  let cli_id: any = null, busca: any = null;
  if (!_vazioFiltro(client_filter)) {
    try {
      cli_id = pyInt(client_filter);
    } catch (e) {
      if (!ehTypeOuValue(e)) throw e;
      busca = pyStr(client_filter).trim();
    }
  }

  const shares = await db.get_shares_for_validation(cond_id, cli_id, busca);

  // ── Agrupa cotas por cliente e por condomínio (Map preserva a ordem de inserção) ──
  const por_cliente = new Map<any, any>();
  for (const s of shares) {
    const cid = dget(s, "client_id");
    if (!por_cliente.has(cid)) {
      por_cliente.set(cid, {
        client_id: cid,
        client_name: ou(dget(s, "client_name"), ""),
        client_document: ou(dget(s, "client_cpf"), ""),
        client_status: ou(dget(s, "client_status"), ""),
        _por_cond: new Map<any, any[]>(),
      });
    }
    const cli = por_cliente.get(cid);
    const ck = dget(s, "condominium_id");
    if (!cli._por_cond.has(ck)) cli._por_cond.set(ck, []);
    cli._por_cond.get(ck).push(s);
  }

  let resultado: any[] = [];
  for (const [cid, cli] of por_cliente) {
    let condominios: any[] = [];
    let total_investido = D("0");
    const total_por_cond: Record<string, Decimal> = { civil: D("0"), agro: D("0"), saude: D("0") };
    let qtd_cotas = 0;
    const maturities: PyDate[] = [];
    let indeterminado = false;

    const chaves = meses.map((m) => month_key(m));
    const totais_mes: Record<string, Decimal> = {}, base_mes: Record<string, Decimal> = {};
    const rend_cond_mes: Record<string, Record<string, Decimal>> = {}, base_cond_mes: Record<string, Record<string, Decimal>> = {};
    const cotas_ativas_mes: Record<string, number> = {};
    const vencendo_mes: Record<string, any[]> = {}, encerrando_mes: Record<string, any[]> = {};
    for (const k of chaves) {
      totais_mes[k] = D("0"); base_mes[k] = D("0"); rend_cond_mes[k] = {}; base_cond_mes[k] = {};
      cotas_ativas_mes[k] = 0; vencendo_mes[k] = []; encerrando_mes[k] = [];
    }
    const g0 = (o: Record<string, Decimal>, k: string) => (tem(o, k) ? o[k] : D("0"));

    for (const [cond_key, cotas] of cli._por_cond as Map<any, any[]>) {
      const cond = conds.has(cond_key) ? conds.get(cond_key) : { id: cond_key, code: "", name: "?" };
      const bloco = _projecao(cond_key, inicio, months, cotas, cond);
      condominios.push(bloco);

      total_investido = total_investido.add(bloco.total_invested);
      const code = bloco.condominium_code;
      total_por_cond[code] = g0(total_por_cond, code).add(bloco.total_invested);
      qtd_cotas += bloco.shares_count;
      if (bloco.shares_without_maturity) indeterminado = true;
      for (const c of cotas) {
        const m = parse_date(dget(c, "maturity_date"));
        if (m) maturities.push(m);
      }
      const nome_cond = bloco.condominium_name;
      for (const linha of bloco.monthly_projection) {
        const k = linha.month;
        totais_mes[k] = g0(totais_mes, k).add(linha.yield_amount);
        base_mes[k] = g0(base_mes, k).add(linha.base_amount);
        if (!tem(rend_cond_mes, k)) rend_cond_mes[k] = {};
        if (!tem(base_cond_mes, k)) base_cond_mes[k] = {};
        rend_cond_mes[k][code] = g0(rend_cond_mes[k], code).add(linha.yield_amount);
        base_cond_mes[k][code] = g0(base_cond_mes[k], code).add(linha.base_amount);
        cotas_ativas_mes[k] = (tem(cotas_ativas_mes, k) ? cotas_ativas_mes[k] : 0) + linha.shares_included;
        for (const c of linha.maturing_shares) vencendo_mes[k].push({ ...c, condominium_code: code, condominium_name: nome_cond });
        for (const c of linha.ending_shares) encerrando_mes[k].push({ ...c, condominium_code: code, condominium_name: nome_cond });
      }
    }
    condominios = sortBy(condominios, (b) => b.condominium_name);

    const futuros = sortBy(maturities.filter((m) => m.compare(inicio) >= 0), (m) => m);
    const proximo = futuros.length ? futuros[0] : maturities.length ? pyMin(maturities) : null;

    let ultimo_label: string, ultimo_mes: string;
    if (indeterminado) {
      ultimo_label = "Indeterminado (cota sem vencimento)";
      ultimo_mes = "";
    } else {
      const ativos = chaves.filter((k) => g0(totais_mes, k).gt(0));
      ultimo_mes = ativos.length ? ativos[ativos.length - 1] : "";
      ultimo_label = ultimo_mes ? month_label(`${ultimo_mes}-01`) : "—";
    }

    const totais_lista: any[] = [];
    for (const k of chaves) {
      const venc = vencendo_mes[k] ?? [];
      const fim = encerrando_mes[k] ?? [];
      const notas_mes: string[] = [];
      if (venc.length) {
        notas_mes.push("Vence no mês: " + venc.map((c) =>
          `${pyStr(c.condominium_name)} nº ${pyStr(c.share_number)} (${formatar_valor(c.share_value)})`).join(" · "));
      }
      if (fim.length) {
        notas_mes.push("Último rendimento: " + fim.map((c) => `${pyStr(c.condominium_name)} nº ${pyStr(c.share_number)}`).join(" · "));
      }
      if (!venc.length && !fim.length && (cotas_ativas_mes[k] ?? 0) === 0) notas_mes.push("Nenhuma cota rende neste mês");
      totais_lista.push({
        month: k,
        month_label: month_label(`${k}-01`),
        base_amount: money(g0(base_mes, k)),
        yield_amount: money(g0(totais_mes, k)),
        by_condominium: Object.fromEntries(Object.entries(rend_cond_mes[k] ?? {}).map(([c, v]) => [c, money(v)])),
        base_by_condominium: Object.fromEntries(Object.entries(base_cond_mes[k] ?? {}).map(([c, v]) => [c, money(v)])),
        shares_included: cotas_ativas_mes[k] ?? 0,
        maturing_shares: venc,
        ending_shares: fim,
        notes: notas_mes,
      });
    }

    resultado.push({
      client_id: cid,
      client_name: cli.client_name,
      client_document: cli.client_document,
      client_status: cli.client_status,
      total_invested: money(total_investido),
      total_by_condominium: Object.fromEntries(Object.entries(total_por_cond).map(([k, v]) => [k, money(v)])),
      shares_count: qtd_cotas,
      next_maturity_date: proximo ? proximo.isoformat() : "",
      next_maturity_overdue: Boolean(proximo && proximo.compare(inicio) < 0),
      current_month_yield: money(g0(totais_mes, chaves[0])),
      next_month_yield: chaves.length > 1 ? money(g0(totais_mes, chaves[1])) : D("0"),
      yield_12m: money(somaDec(chaves.slice(0, 12).map((k) => g0(totais_mes, k)), D("0"))),
      yield_horizon: money(somaDec(chaves.map((k) => g0(totais_mes, k)), D("0"))),
      last_yield_month: ultimo_mes,
      last_yield_month_label: ultimo_label,
      monthly_totals: totais_lista,
      condominiums: condominios,
    });
  }
  resultado = sortBy(resultado, (c) => c.total_invested, true);
  return resultado;
}

// ══════════════════════════════════════════════════════════════
// CARDS DO TOPO DA TELA
// ══════════════════════════════════════════════════════════════

/** Consolida os cards do topo a partir do resultado da função principal. */
export function calculate_validation_totals(clientes: any[], start_month: any = null, months: any = 24): any {
  const inicio = month_start(start_month) ?? month_start(PyDate.today())!;
  const meses = build_month_range(inicio, months);
  const chaves = meses.map((m) => month_key(m));
  const limite_12m = add_months(inicio, 11)!;

  let total_investido = D("0"), rend_mes_atual = D("0"), rend_12m = D("0"), rend_horizonte = D("0"), sai_da_base = D("0");
  let total_cotas = 0, cotas_saindo = 0, sem_vencimento = 0;
  const por_cond: Record<string, Decimal> = { civil: D("0"), agro: D("0"), saude: D("0") };

  for (const cli of clientes) {
    total_investido = total_investido.add(cli.total_invested);
    total_cotas += cli.shares_count;
    rend_mes_atual = rend_mes_atual.add(cli.current_month_yield);
    rend_12m = rend_12m.add(cli.yield_12m);
    rend_horizonte = rend_horizonte.add(cli.yield_horizon);
    for (const [k, v] of Object.entries(cli.total_by_condominium as Record<string, Decimal>)) {
      por_cond[k] = (tem(por_cond, k) ? por_cond[k] : D("0")).add(v);
    }
    for (const bloco of cli.condominiums) {
      for (const cota of bloco.shares) {
        if (!cota.has_maturity) { sem_vencimento += 1; continue; }
        const ultimo = cota.last_yield_month;
        if (ultimo && ultimo <= month_key(limite_12m)) {
          sai_da_base = sai_da_base.add(cota.share_value);
          cotas_saindo += 1;
        }
      }
    }
  }

  const curva: Record<string, Decimal> = {};
  for (const k of chaves) curva[k] = D("0");
  for (const cli of clientes) {
    for (const linha of cli.monthly_totals) {
      curva[linha.month] = (tem(curva, linha.month) ? curva[linha.month] : D("0")).add(linha.yield_amount);
    }
  }

  return {
    total_invested: money(total_investido),
    total_by_condominium: Object.fromEntries(Object.entries(por_cond).map(([k, v]) => [k, money(v)])),
    clients_count: clientes.length,
    shares_count: total_cotas,
    shares_without_maturity: sem_vencimento,
    current_month_yield: money(rend_mes_atual),
    yield_12m: money(rend_12m),
    yield_horizon: money(rend_horizonte),
    leaving_base_12m: money(sai_da_base),
    leaving_shares_12m: cotas_saindo,
    window_12m_label: `${month_label(inicio)} — ${month_label(limite_12m)}`,
    monthly_curve: chaves.map((k) => ({ month: k, month_label: month_label(`${k}-01`), yield_amount: money(tem(curva, k) ? curva[k] : D("0")) })),
  };
}
