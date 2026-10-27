/* eslint-disable @typescript-eslint/no-explicit-any */
// Gestão Tática (GT) — Capuzzo Assessoria, dentro do ERP (Finanças). Porte de modulos/financas/gt.py.
//
// Réplica da planilha "NOVO MODELO GT.xlsx":
//   • cada cliente tem uma banca; mês a mês entram aporte, saque (rendimento pago), congelamento e retirada;
//   • o resultado das operações do mês × % repassado (75%) é dividido entre os clientes pelo "percentual da banca";
//   • percentual da banca = base de cálculo do cliente ÷ soma das bases do mês, onde
//         base = banca inicial × peso + aporte × peso ÷ 30 × (30 − dia do aporte)
//                + congelado × peso ÷ 30 × dia do congelamento + saque × peso ÷ 30 × dia do saque
//   • resultado bruto = % da banca × resultado repassado do mês;
//     taxa de gestão = bruto × % taxa; resultado líquido = bruto − taxa − tarifa;
//     saldo final = banca inicial + aporte + líquido;  banca inicial do mês seguinte = saldo final − saque − congelado.
//   • Retirada = pagamento ao cliente de um valor que já foi congelado (não mexe no saldo).
// Os meses importados da planilha ficam com os valores exatamente como estavam nela (fechados).
// Tabelas próprias (prefixo financas_gt_): clientes, mov, resultados, meses, config.
import ExcelJS from "exceljs";

import {
  PyDate, abort, flash, getConnection, pyPercent, pyRound, redirect, render_template, request, route, url_for, get, post,
} from "../../core/flask";
import { F, _ctx_prod, _so_capuzzo, reais } from "./capuzzo";
import * as d from "./dados";
import { _csrf } from "./index";

export const MESES_NOME = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro",
  "Outubro", "Novembro", "Dezembro"];
export const MESES_CURTO = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const REPASSE_PADRAO = 0.75;

let _pronto = false;

/** As tabelas já existem no schema `erp`; aqui só fica o ajuste único de dados que o Python fazia. */
export async function preparar() {
  if (_pronto) return;
  const conn = await getConnection();
  try {
    // ajuste único (22/10/2026): a situação passou a seguir a cor da aba da planilha; o Diego (aba não vermelha)
    // tinha entrado como inativo na primeira importação.
    if (!(await conn.execute("SELECT 1 FROM financas_gt_config WHERE chave = 'ajuste_situacao_abas'")).fetchone()) {
      await conn.execute("UPDATE financas_gt_clientes SET ativo = 1 WHERE aba = 'DIEGO'");
      await conn.execute("INSERT INTO financas_gt_config (chave, valor) VALUES ('ajuste_situacao_abas', '1')");
    }
    await conn.commit();
  } finally { await conn.close(); }
  _pronto = true;
}

export async function config(chave: string, padrao: any = null) {
  const r = await d.q("SELECT valor FROM financas_gt_config WHERE chave = ?", [chave], true);
  return r ? r.valor : padrao;
}

export async function set_config(chave: string, valor: any) {
  await d.ex("INSERT INTO financas_gt_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor", [chave, valor]);
}

// ───────────────────────── utilidades ─────────────────────────
export function rotulo(comp: string, curto = false) {
  const [a, m] = comp.split("-");
  return `${(curto ? MESES_CURTO : MESES_NOME)[parseInt(m, 10)]}/${a}`;
}

export function somar_mes(comp: string, n: number) {
  const [a, m] = comp.split("-").map((x) => parseInt(x, 10));
  const t = a * 12 + (m - 1) + n;
  return `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((((t % 12) + 12) % 12) + 1).padStart(2, "0")}`;
}

export function comp_valida(s: any) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(s || ""); }

/** float() do Python para texto já limpo; inválido → null. */
function pyFloat(s: string): number | null {
  const t = s.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) && !/^[-+]?(inf|infinity|nan)$/i.test(t)) return null;
  return Number(t.replace(/^([-+]?)inf$/i, "$1Infinity"));
}

/** Lê número digitado (1.234,56 · 1234.56 · R$ 1.234,56 · 25%). */
export function num(v: any, padrao = 0.0): number {
  if (v === null || v === undefined) return padrao;
  if (typeof v === "number") return v;
  let s = String(v).replace("R$", "").replace(/%/g, "").replace(/ /g, "").trim();
  if (!s) return padrao;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(/,/g, ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = pyFloat(s);
  return n === null ? padrao : n;
}

export function dia(v: any): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const f = pyFloat(String(v).replace(/,/g, "."));
  if (f === null || !Number.isFinite(f)) return null;
  const n = Math.trunc(f);
  return Math.max(0, Math.min(30, n));
}

export function pct(v: any, casas = 2) {
  return v !== null && v !== undefined ? pyPercent("%." + casas + "f%%", (v || 0) * 100).replace(".", ",") : "—";
}

export async function mes_fechado(comp: string) {
  const r = await d.q("SELECT fechado FROM financas_gt_meses WHERE competencia = ?", [comp], true);
  return Boolean(r && r.fechado);
}

export async function competencias(): Promise<string[]> {
  return (await d.q(`SELECT competencia c FROM financas_gt_mov UNION SELECT competencia FROM financas_gt_resultados
                                     ORDER BY c`)).map((r: any) => r.c);
}

export async function ultimo_calculado(): Promise<string | null> {
  const r = await d.q("SELECT MAX(competencia) c FROM financas_gt_mov WHERE calculado = 1", [], true);
  return r ? r.c : null;
}

/** O mês em que se trabalha: o primeiro depois do último calculado (ou o último que existir). */
export async function mes_atual_trabalho() {
  const uc = await ultimo_calculado();
  const comps = await competencias();
  if (uc) {
    const prox = somar_mes(uc, 1);
    return comps.includes(prox) ? prox : uc;
  }
  return comps.length ? comps[comps.length - 1] : PyDate.today().strftime("%Y-%m");
}

// ───────────────────────── valor a distribuir ─────────────────────────
/** O valor informado na apuração; nos meses vindos da planilha, a soma repassada da aba ADM. */
export async function valor_distribuir(comp: string) {
  const r = await d.q("SELECT valor_distribuir v FROM financas_gt_meses WHERE competencia = ?", [comp], true);
  if (r && r.v !== null && r.v !== undefined) return r.v;
  const t = await d.q("SELECT SUM(valor_repassado) t FROM financas_gt_resultados WHERE competencia = ?", [comp], true);
  return t ? (t.t || 0) : 0;
}

export async function salvar_valor_distribuir(comp: string, valor: number) {
  await d.ex("INSERT INTO financas_gt_meses (competencia, fechado, valor_distribuir) VALUES (?, 0, ?) "
    + "ON CONFLICT(competencia) DO UPDATE SET valor_distribuir = excluded.valor_distribuir", [comp, valor]);
}

// ───────────────────────── cálculo do mês ─────────────────────────
export function base_calculo(m: any) {
  const L = m.peso !== null && m.peso !== undefined ? m.peso : 1;
  const [C, E, K, G] = ["banca_inicial", "aporte", "congelado", "saque"].map((k) => m[k] || 0);
  const [D, J, F] = ["dia_aporte", "dia_congel", "dia_saque"].map((k) => m[k] || 0);
  return C * L + E * L / 30 * (30 - D) + K * L / 30 * J + G * L / 30 * F;
}

/** Recalcula todos os clientes do mês com a regra da planilha e grava. */
export async function calcular_mes(comp: string): Promise<[number, number]> {
  const movs: any[] = await d.q(`SELECT m.*, c.taxa_pct taxa_cli, c.tarifa tarifa_cli FROM financas_gt_mov m
                  JOIN financas_gt_clientes c ON c.id = m.gt_cliente_id WHERE m.competencia = ?`, [comp]);
  const ant = new Map<number, any>((await d.q("SELECT * FROM financas_gt_mov WHERE competencia = ?", [somar_mes(comp, -1)])).map((r: any) => [r.gt_cliente_id, r]));
  const total = await valor_distribuir(comp);
  for (const m of movs) {
    const a = ant.get(m.gt_cliente_id);
    if (a && a.saldo_final !== null && a.saldo_final !== undefined) { // banca inicial = saldo do mês anterior − saque − congelado
      m.banca_inicial = (a.saldo_final || 0) - (m.saque || 0) - (m.congelado || 0);
    }
    m.base_calculo = base_calculo(m);
  }
  const soma = movs.reduce((s, m) => s + Math.max(m.base_calculo, 0), 0);
  const conn = await getConnection();
  try {
    for (const m of movs) {
      const M = Math.max(m.base_calculo, 0);
      const N = soma ? M / soma : 0;
      const O = N * total;
      const taxa = m.taxa_pct !== null && m.taxa_pct !== undefined ? m.taxa_pct : m.taxa_cli;
      let tarifa = m.tarifa !== null && m.tarifa !== undefined ? m.tarifa : m.tarifa_cli;
      if (M <= 0) tarifa = 0;
      const C = m.banca_inicial || 0, E = m.aporte || 0;
      const S = O * (taxa || 0);
      const T = O - S - (tarifa || 0);
      const U = C + E + T;
      const Q = C > 0 ? O / C : (E > 0 ? O / E : 0);
      await conn.execute(`UPDATE financas_gt_mov SET banca_inicial=?, base_calculo=?, percentual=?, resultado_bruto=?, tarifa=?,
                            rentab=?, taxa_pct=?, taxa_gestao=?, resultado_liquido=?, saldo_final=?, calculado=1,
                            atualizado_em=datetime('now','localtime') WHERE id=?`,
        [C, m.base_calculo, N, O, tarifa, Q, taxa, S, T, U, m.id]);
    }
    await conn.commit();
  } finally { await conn.close(); }
  return [movs.length, total];
}

/** Abre o mês: cria a linha de cada cliente ativo com saldo, já com o saque = líquido do mês anterior. */
export async function gerar_mes(comp: string) {
  const ant = somar_mes(comp, -1);
  let criados = 0;
  for (const c of await d.q("SELECT * FROM financas_gt_clientes WHERE ativo = 1")) {
    const a = await d.q("SELECT * FROM financas_gt_mov WHERE gt_cliente_id = ? AND competencia = ?", [c.id, ant], true);
    if (!a || (a.saldo_final || 0) <= 0.5) continue;
    if (await d.q("SELECT 1 FROM financas_gt_mov WHERE gt_cliente_id = ? AND competencia = ?", [c.id, comp], true)) continue;
    const saque = (a.resultado_liquido || 0) > 0 ? pyRound(a.resultado_liquido || 0, 2) : 0;
    await d.ex(`INSERT INTO financas_gt_mov (gt_cliente_id, competencia, banca_inicial, saque, dia_saque, peso, taxa_pct, tarifa, origem)
                VALUES (?,?,?,?,?,?,?,?, 'app')`,
      [c.id, comp, (a.saldo_final || 0) - saque, saque, c.dia_saque || 10, c.peso, c.taxa_pct, c.tarifa]);
    criados += 1;
  }
  // congelados que completam os 60 dias neste mês: já entram como retirada (saque efetivo) sugerida
  const [a_, m_] = comp.split("-").map((x) => parseInt(x, 10));
  for (const p of await congelados_pendentes(null, new PyDate(9999, 1, 1))) {
    if (p.libera_em.year === a_ && p.libera_em.month === m_) {
      await d.ex(`INSERT INTO financas_gt_mov (gt_cliente_id, competencia, dia_retirada, retirada, origem) VALUES (?,?,?,?, 'app')
                    ON CONFLICT(gt_cliente_id, competencia) DO UPDATE SET
                      dia_retirada = COALESCE(financas_gt_mov.dia_retirada, excluded.dia_retirada),
                      retirada = CASE WHEN COALESCE(financas_gt_mov.retirada,0) = 0 THEN excluded.retirada ELSE financas_gt_mov.retirada END`,
        [p.gt_cliente_id, comp, Math.min(p.libera_em.day, 30), pyRound(p.valor, 2)]);
    }
  }
  await d.ex("INSERT OR IGNORE INTO financas_gt_meses (competencia, fechado) VALUES (?, 0)", [comp]);
  return criados;
}

// ───────────────────────── rentabilidade e congelados ─────────────────────────
/** Menor e maior rentabilidade do mês (bruta e líquida) entre os clientes com a banca cheia o mês todo. */
export async function faixa_rentab(comp: string) {
  const linhas: any[] = await d.q(`SELECT m.*, c.nome FROM financas_gt_mov m JOIN financas_gt_clientes c ON c.id = m.gt_cliente_id
                    WHERE m.competencia = ? AND m.calculado = 1 AND m.banca_inicial > 1`, [comp]);
  let cheios = linhas.filter((x) => !(x.aporte || 0) && !(x.congelado || 0));
  if (!cheios.length) cheios = linhas;
  if (!cheios.length) return null;
  const br = cheios.map((x) => (x.resultado_bruto || 0) / x.banca_inicial);
  const lq = cheios.map((x) => (x.resultado_liquido || 0) / x.banca_inicial);
  return {
    comp, valor: await valor_distribuir(comp), bruta_min: Math.min(...br), bruta_max: Math.max(...br),
    liq_min: Math.min(...lq), liq_max: Math.max(...lq), n: cheios.length,
  };
}

export function _data(comp: string, dia_: any): PyDate {
  const [a, m] = comp.split("-").map((x) => parseInt(x, 10));
  const n = Math.trunc(Number(dia_ || 1));
  const dd = Math.min(Math.max(Number.isNaN(n) ? 1 : n, 1), m === 2 ? 28 : 30);
  const r = new PyDate(a, m, dd);
  return r.valid() ? r : new PyDate(a, m, 1);
}

export const PRAZO_CONGELADO = 60; // dias entre o congelamento e o saque efetivo (sem rendimento nesse período)

/** Valores congelados ainda não sacados (regra: o saque sai 60 dias depois do congelamento).
 *  Casa congelamentos e retiradas em ordem (o primeiro congelado é o primeiro pago). */
export async function congelados_pendentes(gt_cliente_id: number | null = null, hoje: PyDate | null = null) {
  hoje = hoje || PyDate.today();
  let sql = `SELECT m.*, c.nome, c.ativo FROM financas_gt_mov m JOIN financas_gt_clientes c ON c.id = m.gt_cliente_id
             WHERE (m.congelado > 0 OR m.retirada > 0) AND c.ativo = 1`;
  const par: any[] = [];
  if (gt_cliente_id) { sql += " AND m.gt_cliente_id = ?"; par.push(gt_cliente_id); }
  const por_cli = new Map<number, any>();
  for (const x of await d.q(sql + " ORDER BY m.competencia", par)) {
    if (!por_cli.has(x.gt_cliente_id)) por_cli.set(x.gt_cliente_id, { nome: x.nome, id: x.gt_cliente_id, ev: [] });
    const c = por_cli.get(x.gt_cliente_id);
    if ((x.congelado || 0) > 0) c.ev.push([_data(x.competencia, x.dia_congel), 0, x.congelado, x.competencia]);
    if ((x.retirada || 0) > 0) c.ev.push([_data(x.competencia, x.dia_retirada), 1, x.retirada, x.competencia]);
  }
  const pend: any[] = [];
  for (const c of por_cli.values()) {
    const fila: any[] = []; // congelados ainda não pagos, na ordem
    const evs = [...c.ev].sort((e1: any, e2: any) => e1[0].compare(e2[0]) || e1[1] - e2[1]);
    for (const [dt, tipo, valor0, comp] of evs) {
      let valor = valor0;
      if (tipo === 0) fila.push({ valor, data: dt, comp });
      else if (dt.compare(hoje) <= 0) { // retirada efetivada paga os congelados mais antigos (sobra = retirada sem congelamento)
        while (valor > 0.005 && fila.length) {
          const usar = Math.min(valor, fila[0].valor);
          fila[0].valor -= usar;
          valor -= usar;
          if (fila[0].valor <= 0.5) fila.shift();
        }
      }
    }
    for (const f of fila) {
      const libera = f.data.addDays(PRAZO_CONGELADO);
      pend.push({
        cliente: c.nome, gt_cliente_id: c.id, valor: f.valor, congelado_em: f.data,
        libera_em: libera, dias: libera.diffDays(hoje), comp: f.comp,
      });
    }
  }
  return pend.sort((a, b) => a.libera_em.compare(b.libera_em));
}

// ───────────────────────── leituras ─────────────────────────
export async function resumo_mensal() {
  const linhas: any[] = await d.q(`SELECT competencia c, COUNT(*) n, SUM(banca_inicial) banca, SUM(aporte) aporte, SUM(saque) saque,
                           SUM(retirada) retirada, SUM(congelado) congelado, SUM(resultado_bruto) bruto, SUM(tarifa) tarifa,
                           SUM(taxa_gestao) taxa, SUM(resultado_liquido) liquido, SUM(saldo_final) saldo,
                           MIN(calculado) calc
                    FROM financas_gt_mov GROUP BY competencia ORDER BY competencia`);
  const res = new Map<string, any>((await d.q(`SELECT competencia c, SUM(valor) valor, SUM(valor_repassado) repassado
                                       FROM financas_gt_resultados GROUP BY competencia`)).map((r: any) => [r.c, r]));
  const mes_ = new Map<string, any>((await d.q("SELECT * FROM financas_gt_meses")).map((r: any) => [r.competencia, r]));
  for (const l of linhas) {
    const r = res.get(l.c) || {};
    l.operacao = r.valor || 0;
    l.repassado = r.repassado || 0;
    l.retido = l.operacao - l.repassado;
    const vd = (mes_.get(l.c) || {}).valor_distribuir;
    l.distribuido = vd !== null && vd !== undefined ? vd : l.repassado;
    l.rentab = l.banca ? (l.bruto || 0) / l.banca : null;
    l.fechado = mes_.has(l.c) ? mes_.get(l.c).fechado : 0;
    l.rotulo = rotulo(l.c, true);
  }
  return linhas;
}

export async function clientes_situacao() {
  const uc = await ultimo_calculado();
  const lista: any[] = await d.q(`SELECT c.*, (SELECT MIN(competencia) FROM financas_gt_mov WHERE gt_cliente_id = c.id) primeiro,
                          (SELECT MAX(competencia) FROM financas_gt_mov WHERE gt_cliente_id = c.id AND calculado = 1) ultimo,
                          (SELECT SUM(aporte) FROM financas_gt_mov WHERE gt_cliente_id = c.id) aportes,
                          (SELECT SUM(saque) FROM financas_gt_mov WHERE gt_cliente_id = c.id) saques,
                          (SELECT SUM(resultado_liquido) FROM financas_gt_mov WHERE gt_cliente_id = c.id) liquido,
                          (SELECT SUM(taxa_gestao) FROM financas_gt_mov WHERE gt_cliente_id = c.id) taxa_total,
                          (SELECT SUM(congelado) - SUM(retirada) FROM financas_gt_mov WHERE gt_cliente_id = c.id) congelado_pagar
                   FROM financas_gt_clientes c ORDER BY c.ativo DESC, c.nome`);
  const pend = new Map<number, number>();
  for (const p_ of await congelados_pendentes()) pend.set(p_.gt_cliente_id, (pend.get(p_.gt_cliente_id) ?? 0) + p_.valor);
  for (const c of lista) {
    c.congelado_pagar = pend.get(c.id) ?? 0;
    const u = await d.q("SELECT * FROM financas_gt_mov WHERE gt_cliente_id = ? AND calculado = 1 ORDER BY competencia DESC LIMIT 1", [c.id], true);
    c.saldo = u && u.competencia === uc ? (u.saldo_final || 0) : 0;
    c.ult = u;
  }
  return lista;
}

/** Números da GT para a Visão geral do ERP. */
export async function resumo_gt() {
  await preparar();
  const uc = await ultimo_calculado();
  if (!uc) return { uc: null };
  const r = await d.q(`SELECT SUM(saldo_final) saldo, SUM(resultado_bruto) bruto, SUM(taxa_gestao) taxa, SUM(tarifa) tarifa,
                      SUM(banca_inicial) banca, SUM(CASE WHEN saldo_final > 1 THEN 1 ELSE 0 END) n
               FROM financas_gt_mov WHERE competencia = ?`, [uc], true);
  return {
    uc, rotulo: rotulo(uc), saldo: r.saldo || 0, bruto: r.bruto || 0, taxa: r.taxa || 0,
    tarifa: r.tarifa || 0, n: r.n || 0, rentab: r.banca ? (r.bruto || 0) / r.banca : null,
    saldo_fmt: reais(r.saldo), bruto_fmt: reais(r.bruto), receita_fmt: reais((r.taxa || 0) + (r.tarifa || 0)),
  };
}

async function _ctx_gt(e: any, ativo: string, extra: Record<string, any> = {}) {
  return _ctx_prod(e, ativo, { pct, rotulo, MESES_NOME, ...extra });
}

// ───────────────────────── importação da planilha ─────────────────────────
function _norm(s: any) {
  const t = String(s ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toUpperCase();
  return t.replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Valor "calculado" da célula (como openpyxl data_only=True). */
function valorCalc(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v || "formula" in v || "sharedFormula" in v) return v.result === undefined ? null : valorCalc(v.result);
    if ("richText" in v) return v.richText.map((x: any) => x.text).join("");
    if ("text" in v) return v.text;
    if ("error" in v) return null;
  }
  return v;
}
/** Valor "com fórmula" (como openpyxl data_only=False): fórmulas viram "=...". */
function valorForm(cell: any): any {
  const f = cell.formula;
  if (f) return "=" + f;
  return valorCalc(cell.value);
}

function _comp(v: any) {
  if (v instanceof Date) return `${String(v.getUTCFullYear()).padStart(4, "0")}-${String(v.getUTCMonth() + 1).padStart(2, "0")}`;
  return null;
}

function _n(v: any): number | null { return typeof v === "number" ? v : null; }

function _aba_vermelha(ws: any) {
  const cor = ws.properties?.tabColor;
  const rgb = cor ? cor.argb ?? cor.rgb : null;
  if (typeof rgb !== "string" || rgb.length < 6) return false;
  const r = parseInt(rgb.slice(-6, -4), 16), g = parseInt(rgb.slice(-4, -2), 16), b = parseInt(rgb.slice(-2), 16);
  return r > 180 && g < 90 && b < 90;
}

/** Lê o NOVO MODELO GT.xlsx (valores já calculados pelo Excel) e grava clientes, meses e resultados. */
export async function importar_planilha(dados_xlsx: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(dados_xlsx) as any);
  const sheet = (nome: string) => wb.worksheets.find((w) => w.name === nome);
  const nomes = new Map<string, Map<string, number>>();
  let prioridade = new Set<string>();
  // nome do cliente de cada aba: pelas fórmulas da aba RESUMO / PERCENTUAL DA BANCA (='FLAVIA'!C20 → Flávia Lacerda)
  for (const [aba_ref, col_nome] of [["PERCENTUAL DA BANCA", "B"], ["RESUMO", "B"]]) {
    const ws = sheet(aba_ref);
    if (!ws) continue;
    for (let r = 2; r <= ws.rowCount; r++) {
      const nome = valorForm(ws.getCell(`${col_nome}${r}`));
      for (const col of ["C", "D", "E"]) {
        const fx = valorForm(ws.getCell(`${col}${r}`));
        const m = /^='?([^'!]+)'?!/.exec(String(fx ?? ""));
        if (m && nome) {
          const aba_c = m[1].trim();
          if (aba_ref === "RESUMO" && prioridade.has(aba_c)) break;
          if (!nomes.has(aba_c)) nomes.set(aba_c, new Map());
          const mm = nomes.get(aba_c)!;
          const k = String(nome).trim();
          mm.set(k, (mm.get(k) ?? 0) + 1);
          break;
        }
      }
    }
    if (aba_ref === "PERCENTUAL DA BANCA") prioridade = new Set(nomes.keys());
  }
  const especiais = new Set(["RESUMO", "ADM", "PERCENTUAL DA BANCA"]);
  const situacao = new Map<string, number>();
  const resumo = { clientes: 0, meses: 0, resultados: 0, abas: [] as string[] };
  const COLS = "CDEFGHIJKLMNOPQRSTU".split("");
  const conn = await getConnection();
  try {
    for (const ws of wb.worksheets) {
      if (especiais.has(ws.name.trim().toUpperCase())) continue;
      const cab = Array.from({ length: 21 }, (_, i) => _norm(valorCalc(ws.getRow(1).getCell(i + 1).value)));
      if (!cab.includes("COMPETENCIA") || !cab.includes("SALDO FINAL")) continue;
      const cand = nomes.get(ws.name.trim());
      let nome: string;
      if (cand && cand.size) {
        let melhor = "", mx = -1;
        for (const [k, n] of cand) if (n > mx) { melhor = k; mx = n; }
        nome = melhor;
      } else {
        nome = ws.name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); // str.title()
      }
      const linhas: [string, Record<string, number | null>][] = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const comp = _comp(valorCalc(ws.getCell(`B${r}`).value));
        if (!comp) continue;
        const v: Record<string, number | null> = {};
        for (const col of COLS) v[col] = _n(valorCalc(ws.getCell(`${col}${r}`).value));
        if (!"CEGIKOU".split("").some((k) => v[k])) continue;
        linhas.push([comp, v]);
      }
      if (!linhas.length) continue;
      const ativo = _aba_vermelha(ws) ? 0 : 1; // na planilha, aba vermelha = cliente inativo
      situacao.set(ws.name.trim(), ativo);
      const row = (await conn.execute("SELECT id FROM financas_gt_clientes WHERE aba = ?", [ws.name.trim()])).fetchone();
      const ult = linhas[linhas.length - 1][1];
      const calc = linhas.map(([, v]) => v).filter((v) => v.U !== null || v.O !== null);
      const u = calc.length ? calc[calc.length - 1] : ult;
      const params = [nome, u.L !== null ? u.L : 1, u.R !== null ? u.R : 0.25, u.P !== null ? u.P : 67, u.F ? Math.trunc(u.F) : 10];
      let gid: number;
      if (row) {
        gid = row.id;
        await conn.execute("UPDATE financas_gt_clientes SET nome=?, peso=?, taxa_pct=?, tarifa=?, dia_saque=? WHERE id=?", [...params, gid]);
      } else {
        gid = (await conn.execute(`INSERT INTO financas_gt_clientes (nome, peso, taxa_pct, tarifa, dia_saque, aba, inicio)
                                      VALUES (?,?,?,?,?,?,?)`, [...params, ws.name.trim(), linhas[0][0]])).lastrowid!;
      }
      for (const [comp, v] of linhas) {
        const calculado = v.U !== null || v.O !== null ? 1 : 0;
        const dd = (k: string) => (v[k] !== null ? Math.trunc(v[k]!) : null);
        await conn.execute(`INSERT INTO financas_gt_mov (gt_cliente_id, competencia, banca_inicial, dia_aporte, aporte, dia_saque, saque,
                                    dia_retirada, retirada, dia_congel, congelado, peso, base_calculo, percentual, resultado_bruto, tarifa,
                                    rentab, taxa_pct, taxa_gestao, resultado_liquido, saldo_final, calculado, origem)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'planilha')
                                ON CONFLICT(gt_cliente_id, competencia) DO UPDATE SET
                                    banca_inicial=excluded.banca_inicial, dia_aporte=excluded.dia_aporte, aporte=excluded.aporte,
                                    dia_saque=excluded.dia_saque, saque=excluded.saque, dia_retirada=excluded.dia_retirada,
                                    retirada=excluded.retirada, dia_congel=excluded.dia_congel, congelado=excluded.congelado,
                                    peso=excluded.peso, base_calculo=excluded.base_calculo, percentual=excluded.percentual,
                                    resultado_bruto=excluded.resultado_bruto, tarifa=excluded.tarifa, rentab=excluded.rentab,
                                    taxa_pct=excluded.taxa_pct, taxa_gestao=excluded.taxa_gestao,
                                    resultado_liquido=excluded.resultado_liquido, saldo_final=excluded.saldo_final,
                                    calculado=excluded.calculado, origem='planilha'`,
          [gid, comp, v.C || 0, dd("D"), v.E || 0, dd("F"), v.G || 0, dd("H"), v.I || 0, dd("J"),
            v.K || 0, v.L !== null ? v.L : 1, v.M, v.N, v.O, v.P, v.Q, v.R, v.S, v.T, v.U, calculado]);
        resumo.meses += 1;
      }
      resumo.clientes += 1;
      resumo.abas.push(ws.name.trim());
    }
    // resultados das operações (aba ADM)
    const adm = sheet("ADM");
    if (adm) {
      const regs: any[][] = [];
      for (let r = 2; r <= adm.rowCount; r++) {
        const comp = _comp(valorCalc(adm.getCell(`A${r}`).value)), origem = valorCalc(adm.getCell(`B${r}`).value);
        if (!comp || !origem) continue;
        const valor = _n(valorCalc(adm.getCell(`C${r}`).value)) || 0, rep = _n(valorCalc(adm.getCell(`D${r}`).value));
        const rp = valor && rep !== null ? rep / valor : REPASSE_PADRAO;
        regs.push([comp, String(origem).trim(), valor, pyRound(rp, 4), rep !== null ? rep : valor * rp]);
      }
      for (const comp of new Set(regs.map((x) => x[0]))) {
        await conn.execute("DELETE FROM financas_gt_resultados WHERE competencia = ? AND fonte = 'planilha'", [comp]);
      }
      await conn.executemany("INSERT INTO financas_gt_resultados (competencia, origem, valor, repasse_pct, valor_repassado, fonte) "
        + "VALUES (?,?,?,?,?, 'planilha')", regs);
      resumo.resultados = regs.length;
    }
    // meses totalmente calculados na planilha ficam fechados; o resto fica aberto
    for (const r of (await conn.execute("SELECT competencia, MIN(calculado) AS mc FROM financas_gt_mov GROUP BY competencia")).fetchall()) {
      await conn.execute("INSERT INTO financas_gt_meses (competencia, fechado, fechado_em) VALUES (?, ?, datetime('now','localtime')) "
        + "ON CONFLICT(competencia) DO UPDATE SET fechado = excluded.fechado", [r.competencia, r.mc ? 1 : 0]);
    }
    // situação de cada cliente = cor da aba (vermelha = inativo)
    for (const [aba, ativo] of situacao) await conn.execute("UPDATE financas_gt_clientes SET ativo = ? WHERE aba = ?", [ativo, aba]);
    await conn.commit();
  } finally { await conn.close(); }
  return resumo;
}

export function registrar() {
  // ───────────────────────── telas ─────────────────────────
  /** Painel gerencial: sempre o último mês apurado (o mais atualizado). */
  get("financas.tatica_painel", "/financas/<slug>/gestao-tatica/", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    await preparar();
    const meses = await resumo_mensal();
    const uc = await ultimo_calculado();
    const atual = meses.find((m) => m.c === uc) ?? null;
    const situ = await clientes_situacao();
    const ativos = situ.filter((c) => c.ativo);
    const ranking = situ.filter((c) => c.saldo > 0.5).sort((a, b) => b.saldo - a.saldo);
    const total_banca = ranking.reduce((s, c) => s + c.saldo, 0);
    const cong = await congelados_pendentes();
    const ret_mes = uc ? ((await d.q("SELECT SUM(retirada) r FROM financas_gt_mov WHERE competencia = ?", [uc], true)).r || 0) : 0;
    const ult12 = meses.filter((m) => m.c <= (uc || "9999")).slice(-12);
    const trabalho = await mes_atual_trabalho();
    return render_template("financas/cap/gt_painel.html", await _ctx_gt(e, "tat_painel", {
      atual, uc, ativos, ranking, total_banca, cong, total_cong: cong.reduce((s, p) => s + p.valor, 0),
      ret_mes, ult12, trabalho, divulgacao: _data(somar_mes(trabalho, 1), 6), vazio: !meses.length,
    }));
  });

  /** Apuração: informa o valor a distribuir e o sistema faz o rateio pela fórmula da planilha. */
  const gt_mes = async (slug: string, comp: string | null = null) => {
    const e = await _so_capuzzo(slug);
    await preparar();
    comp = comp_valida(comp) ? comp! : await mes_atual_trabalho();
    const movs: any[] = await d.q(`SELECT m.*, c.nome, c.ativo, c.taxa_pct taxa_cli, c.tarifa tarifa_cli FROM financas_gt_mov m
                  JOIN financas_gt_clientes c ON c.id = m.gt_cliente_id WHERE m.competencia = ? ORDER BY c.nome`, [comp]);
    const ant = new Map<number, any>((await d.q("SELECT gt_cliente_id, saldo_final FROM financas_gt_mov WHERE competencia = ? "
      + "AND saldo_final IS NOT NULL", [somar_mes(comp, -1)])).map((r: any) => [r.gt_cliente_id, r]));
    for (const m of movs) {
      const a = ant.get(m.gt_cliente_id);
      m.tem_ant = a !== undefined;
      m.saldo_ant = a ? F(a.saldo_final) : null;
      m.taxa_cli = F(m.taxa_cli); m.tarifa_cli = F(m.tarifa_cli); // REAL → float do Python ("67.0")
    }
    const ja = new Set(movs.map((m) => m.gt_cliente_id));
    const fora = (await d.q("SELECT id, nome, ativo FROM financas_gt_clientes ORDER BY ativo DESC, nome")).filter((c: any) => !ja.has(c.id));
    const tot = Object.fromEntries(["banca_inicial", "aporte", "saque", "retirada", "congelado", "base_calculo",
      "resultado_bruto", "tarifa", "taxa_gestao", "resultado_liquido", "saldo_final"].map((k) => [k, movs.reduce((s, m) => s + (m[k] || 0), 0)]));
    const faixas: any[] = [];
    for (const i of [3, 2, 1]) { const f = await faixa_rentab(somar_mes(comp, -i)); if (f) faixas.push(f); }
    const res = await d.q("SELECT * FROM financas_gt_resultados WHERE competencia = ? AND valor <> 0 ORDER BY id", [comp]);
    return render_template("financas/cap/gt_mes.html", await _ctx_gt(e, "tat_mes", {
      comp, movs, fora, tot,
      fechado: await mes_fechado(comp), calculado: movs.length > 0 && movs.every((m) => m.calculado),
      valor: await valor_distribuir(comp), faixa: await faixa_rentab(comp), faixas, res,
      anterior: somar_mes(comp, -1), proximo: somar_mes(comp, 1), divulgacao: _data(somar_mes(comp, 1), 6),
      cong: (await congelados_pendentes()).filter((p) => ja.has(p.gt_cliente_id)),
    }));
  };
  get("financas.gt_mes", "/financas/<slug>/gestao-tatica/mes/", (slug: string) => gt_mes(slug));
  get("financas.gt_mes", "/financas/<slug>/gestao-tatica/mes/<comp>", (slug: string, comp: string) => gt_mes(slug, comp));

  post("financas.gt_mes_salvar", "/financas/<slug>/gestao-tatica/mes/<comp>/salvar", async (slug: string, comp: string) => {
    await _so_capuzzo(slug);
    _csrf();
    await preparar();
    if (!comp_valida(comp)) abort(404);
    if (await mes_fechado(comp)) {
      flash("Este mês está fechado. Reabra para alterar.", "warning");
      return redirect(url_for("financas.gt_mes", { slug, comp }));
    }
    const f = request().form;
    if (String(f.get("valor_distribuir") || "").trim()) await salvar_valor_distribuir(comp, num(f.get("valor_distribuir")));
    for (const m of await d.q("SELECT id FROM financas_gt_mov WHERE competencia = ?", [comp])) {
      const p = `m${m.id}_`;
      if (!f.has(p + "aporte")) continue;
      if (f.get(p + "remover") === "1") { await d.ex("DELETE FROM financas_gt_mov WHERE id = ?", [m.id]); continue; }
      await d.ex(`UPDATE financas_gt_mov SET banca_inicial=?, dia_aporte=?, aporte=?, dia_saque=?, saque=?, dia_retirada=?, retirada=?,
                dia_congel=?, congelado=?, peso=?, taxa_pct=?, tarifa=?, obs=? WHERE id=?`,
        [num(f.get(p + "banca")), dia(f.get(p + "dia_aporte")), num(f.get(p + "aporte")), dia(f.get(p + "dia_saque")),
          num(f.get(p + "saque")), dia(f.get(p + "dia_retirada")), num(f.get(p + "retirada")), dia(f.get(p + "dia_congel")),
          num(f.get(p + "congelado")), num(f.get(p + "peso"), 1), num(f.get(p + "taxa"), 25) / 100,
          String(f.get(p + "tarifa") || "").trim() ? num(f.get(p + "tarifa")) : null,
          String(f.get(p + "obs") || "").trim(), m.id]);
    }
    await d.ex("INSERT OR IGNORE INTO financas_gt_meses (competencia, fechado) VALUES (?, 0)", [comp]);
    const [n, total] = await calcular_mes(comp);
    const fx = await faixa_rentab(comp);
    const extra = fx ? ` Rentabilidade bruta de ${pct(fx.bruta_min)} a ${pct(fx.bruta_max)}.` : "";
    flash(`${rotulo(comp)} calculado: ${reais(total)} distribuídos entre ${n} cliente(s).${extra}`, "success");
    return redirect(url_for("financas.gt_mes", { slug, comp }));
  });

  post("financas.gt_planilha", "/financas/<slug>/gestao-tatica/planilha/<any(encerrar, reativar):acao>", async (slug: string, acao: string) => {
    await _so_capuzzo(slug);
    _csrf();
    await preparar();
    await set_config("planilha_encerrada", acao === "encerrar" ? "1" : "0");
    flash(acao === "encerrar" ? "Planilha encerrada: daqui em diante a GT é feita só no sistema (a importação fica bloqueada)."
      : "Importação da planilha liberada novamente.", acao === "encerrar" ? "success" : "warning");
    return redirect(url_for("financas.gt_importar", { slug }));
  });

  post("financas.gt_mes_acao", "/financas/<slug>/gestao-tatica/mes/<comp>/<any(gerar, fechar, reabrir, incluir):acao>", async (slug: string, comp: string, acao: string) => {
    await _so_capuzzo(slug);
    _csrf();
    await preparar();
    if (!comp_valida(comp)) abort(404);
    if (acao === "gerar") {
      const n = await gerar_mes(comp);
      flash(`${rotulo(comp)} aberto com ${n} investidor(es). Confira os movimentos, informe o valor a distribuir e clique em Calcular e salvar.`, "success");
    } else if (acao === "fechar") {
      await d.ex("INSERT INTO financas_gt_meses (competencia, fechado, fechado_em) VALUES (?, 1, datetime('now','localtime')) "
        + "ON CONFLICT(competencia) DO UPDATE SET fechado = 1, fechado_em = datetime('now','localtime')", [comp]);
      flash(`${rotulo(comp)} fechado.`, "success");
    } else if (acao === "reabrir") {
      await d.ex("UPDATE financas_gt_meses SET fechado = 0 WHERE competencia = ?", [comp]);
      flash(`${rotulo(comp)} reaberto para edição. Ao calcular, os valores serão refeitos pela regra do app.`, "warning");
    } else if (acao === "incluir") {
      const cid = request().form.get("gt_cliente_id", null, "int");
      const c = await d.q("SELECT * FROM financas_gt_clientes WHERE id = ?", [cid], true);
      if (c && !(await mes_fechado(comp))) {
        await d.ex(`INSERT OR IGNORE INTO financas_gt_mov (gt_cliente_id, competencia, peso, taxa_pct, tarifa, dia_saque, origem)
                    VALUES (?,?,?,?,?,?, 'app')`, [cid, comp, c.peso, c.taxa_pct, c.tarifa, c.dia_saque]);
        await d.ex("UPDATE financas_gt_clientes SET ativo = 1 WHERE id = ?", [cid]);
        flash(`${c.nome} incluído em ${rotulo(comp)}. Informe o aporte e o dia.`, "success");
      }
    }
    return redirect(url_for("financas.gt_mes", { slug, comp }));
  });

  get("financas.gt_clientes", "/financas/<slug>/gestao-tatica/clientes", async (slug: string) => {
    const e = await _so_capuzzo(slug);
    await preparar();
    const lista = await clientes_situacao();
    return render_template("financas/cap/gt_clientes.html", await _ctx_gt(e, "tat_clientes", {
      lista, total: lista.reduce((s, c) => s + c.saldo, 0), uc: await ultimo_calculado(),
    }));
  });

  const gt_cliente = async (slug: string, cid: number | null = null) => {
    const e = await _so_capuzzo(slug);
    await preparar();
    const c = cid ? await d.q("SELECT * FROM financas_gt_clientes WHERE id = ?", [cid], true) : null;
    if (cid && !c) abort(404);
    if (request().method === "POST") {
      _csrf();
      const f = request().form;
      const nome = String(f.get("nome") || "").trim();
      if (!nome) flash("Informe o nome do cliente.", "error");
      else {
        const vals = [nome, num(f.get("peso"), 1), num(f.get("taxa"), 25) / 100, num(f.get("tarifa"), 67), dia(f.get("dia_saque")) || 10,
          f.get("ativo") === "1" ? 1 : 0, f.get("client_id", null, "int"), String(f.get("obs") || "").trim()];
        if (c) {
          await d.ex("UPDATE financas_gt_clientes SET nome=?, peso=?, taxa_pct=?, tarifa=?, dia_saque=?, ativo=?, client_id=?, obs=? WHERE id=?",
            [...vals, cid]);
          flash("Cliente atualizado. Os novos parâmetros valem para os próximos meses calculados.", "success");
        } else {
          cid = await d.ex(`INSERT INTO financas_gt_clientes (nome, peso, taxa_pct, tarifa, dia_saque, ativo, client_id, obs, inicio)
                              VALUES (?,?,?,?,?,?,?,?,?)`, [...vals, f.get("comp") || null]);
          const comp = f.get("comp") || "";
          if (comp_valida(comp) && !(await mes_fechado(comp))) {
            await d.ex(`INSERT OR IGNORE INTO financas_gt_mov (gt_cliente_id, competencia, aporte, dia_aporte, peso, taxa_pct, tarifa, dia_saque, origem)
                            VALUES (?,?,?,?,?,?,?,?, 'app')`,
              [cid, comp, num(f.get("aporte")), dia(f.get("dia_aporte")), vals[1], vals[2], vals[3], vals[4]]);
            await d.ex("INSERT OR IGNORE INTO financas_gt_meses (competencia, fechado) VALUES (?, 0)", [comp]);
          }
          flash("Cliente cadastrado.", "success");
        }
        return redirect(url_for("financas.gt_cliente", { slug, cid }));
      }
    }
    const hist: any[] = cid ? await d.q("SELECT * FROM financas_gt_mov WHERE gt_cliente_id = ? ORDER BY competencia DESC", [cid]) : [];
    const cotistas = await d.q("SELECT id, full_name FROM clients ORDER BY full_name");
    const calc = hist.filter((h) => h.calculado);
    const ult = calc.length ? calc[0] : null;
    const r12 = calc.slice(0, 12).map((h) => h.rentab).filter((x) => x !== null && x !== undefined);
    return render_template("financas/cap/gt_cliente.html", await _ctx_gt(e, "tat_clientes", {
      c, hist, ult, cotistas, rent12: r12.length ? r12.reduce((s, x) => s + x, 0) / r12.length : null,
      tot: Object.fromEntries(["aporte", "saque", "retirada", "congelado", "resultado_bruto", "taxa_gestao", "tarifa", "resultado_liquido"]
        .map((k) => [k, hist.reduce((s, h) => s + (h[k] || 0), 0)])),
      serie: [...calc].reverse().map((h) => [h.competencia, h.saldo_final || 0]).slice(-24),
      trabalho: await mes_atual_trabalho(), uc: await ultimo_calculado(),
      cong: cid ? await congelados_pendentes(cid) : [],
    }));
  };
  route("financas.gt_cliente", "/financas/<slug>/gestao-tatica/clientes/novo", ["GET", "POST"], (slug: string) => gt_cliente(slug));
  route("financas.gt_cliente", "/financas/<slug>/gestao-tatica/clientes/<int:cid>", ["GET", "POST"], (slug: string, cid: number) => gt_cliente(slug, cid));

  route("financas.gt_importar", "/financas/<slug>/gestao-tatica/importar", ["GET", "POST"], async (slug: string) => {
    const e = await _so_capuzzo(slug);
    await preparar();
    const encerrada = (await config("planilha_encerrada")) === "1";
    if (request().method === "POST" && encerrada) {
      _csrf();
      flash("A planilha foi encerrada — a importação está bloqueada.", "error");
    } else if (request().method === "POST") {
      _csrf();
      const arq = request().file("arquivo");
      if (!arq || !/\.(xlsx|xlsm)$/.test(arq.filename.toLowerCase())) {
        flash("Escolha a planilha da Gestão Tática (.xlsx).", "error");
      } else {
        try {
          const r = await importar_planilha(arq.read());
          flash(`Planilha importada: ${r.clientes} cliente(s), ${r.meses} registro(s) mensais e `
            + `${r.resultados} resultado(s) de operações.`, "success");
          return redirect(url_for("financas.tatica_painel", { slug }));
        } catch (exc: any) {
          flash(`Não foi possível ler a planilha: ${exc?.message ?? exc}`, "error");
        }
      }
    }
    const n = (await d.q("SELECT COUNT(*) n FROM financas_gt_mov", [], true)).n;
    return render_template("financas/cap/gt_importar.html", await _ctx_gt(e, "tat_importar", { ja_tem: n, encerrada }));
  });
}
