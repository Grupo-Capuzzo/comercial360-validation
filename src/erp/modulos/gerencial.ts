/* eslint-disable @typescript-eslint/no-explicit-any */
// Gerencial do Grupo: relatórios de todas as empresas num lugar só, para o gestor (administrador).
// Fonte: o realizado (baixas) do módulo Finanças de cada empresa. Empresas que ainda não lançam no
// Finanças aparecem como "sem dados" até começarem a usar.
import { Markup, PyDate, abort, g, get, q, render_template, request } from "../core/flask";
import { TEMA_GRUPO, empresas_visiveis } from "./portal";
import * as fin from "./financas/dados";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ── formatação (valores em centavos) ──
function milhar(n: number) { return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
export function brl(c: number) {
  const v = Math.round(c || 0), a = Math.abs(v);
  return `${v < 0 ? "-" : ""}R$ ${milhar(Math.floor(a / 100))},${String(a % 100).padStart(2, "0")}`;
}
function compacto(c: number) {
  const r = (c || 0) / 100, a = Math.abs(r);
  const f = (x: number, s: string) => `${(x).toFixed(Math.abs(x) >= 100 ? 0 : 1).replace(".", ",")}${s}`;
  if (a >= 1e6) return f(r / 1e6, " mi");
  if (a >= 1e3) return f(r / 1e3, " mil");
  return String(Math.round(r));
}
function pct(x: number | null) { return x === null ? "—" : `${x >= 0 ? "" : "-"}${Math.abs(x).toFixed(2).replace(".", ",")}%`; }
function variacao(a: number, b: number): number | null { return a ? ((b - a) / Math.abs(a)) * 100 : (b ? null : 0); }
function esc(s: string) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

/** Escala "redonda" para o eixo Y (inclui o zero). */
function escala(min: number, max: number) {
  min = Math.min(0, min); max = Math.max(0, max);
  if (min === max) max = 100;
  const bruto = (max - min) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= bruto)!;
  const lo = Math.floor(min / passo) * passo, hi = Math.ceil(max / passo) * passo;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + passo / 2; v += passo) ticks.push(v);
  return { lo, hi, ticks };
}

/** Barras agrupadas em SVG (valores podem ser negativos). */
function grafico_barras(rotulos: string[], series: { nome: string; classe: string; valores: number[] }[]) {
  const W = 720, H = 270, L = 64, R = 8, T = 10, B = 34;
  const todos = series.flatMap((s) => s.valores);
  const { lo, hi, ticks } = escala(Math.min(...todos, 0), Math.max(...todos, 0));
  const y = (v: number) => T + (hi - v) / (hi - lo) * (H - T - B);
  const bw = (W - L - R) / rotulos.length;
  const barw = Math.max(2, Math.min(56, (bw - Math.min(10, bw * 0.18) * 2) / series.length));
  const gap = (bw - barw * series.length) / 2;
  let s = `<svg class="ger-svg" viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="none">`;
  for (const t of ticks) s += `<line class="ger-grade${t === 0 ? " zero" : ""}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ger-eixo" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${compacto(t)}</text>`;
  rotulos.forEach((r, i) => {
    const x0 = L + i * bw + gap;
    series.forEach((se, j) => {
      const v = se.valores[i] || 0;
      const ya = y(Math.max(v, 0)), yb = y(Math.min(v, 0));
      s += `<rect class="ger-bar ${se.classe}" x="${x0 + j * barw}" y="${ya}" width="${Math.max(1, barw - 2)}" height="${Math.max(v ? 1 : 0, yb - ya)}" rx="2"><title>${esc(r)} · ${esc(se.nome)}: ${brl(v)}</title></rect>`;
    });
    s += `<text class="ger-eixo rot" x="${L + i * bw + bw / 2}" y="${H - 12}" text-anchor="middle">${esc(r.length > 14 ? r.slice(0, 13) + "…" : r)}</text>`;
  });
  s += "</svg>";
  const legenda = series.map((se) => `<span><i class="${se.classe}"></i>${esc(se.nome)}</span>`).join("");
  return Markup(`<div class="ger-legenda">${legenda}</div>${s}`);
}

async function dados_gerenciais(empresas: any[], anoA: number, anoB: number) {
  const slugs = empresas.map((e) => e.slug);
  const zeros = () => Array(12).fill(0);
  const por: Record<string, any> = {};
  for (const e of empresas) por[e.slug] = { empresa: e, rec: { [anoA]: zeros(), [anoB]: zeros() }, desp: { [anoA]: zeros(), [anoB]: zeros() }, tem: false };
  if (slugs.length) {
    const linhas = await q(
      "SELECT l.empresa_slug, l.tipo, substr(b.data, 1, 4) AS a, substr(b.data, 6, 2) AS m, SUM(b.valor) AS s " +
      "FROM financas_baixas b JOIN financas_lancamentos l ON l.id = b.lancamento_id " +
      `WHERE l.empresa_slug IN (${slugs.map(() => "?").join(",")}) AND b.data BETWEEN ? AND ?` + fin.filtro_consideradas("b.") +
      " GROUP BY l.empresa_slug, l.tipo, substr(b.data, 1, 4), substr(b.data, 6, 2)",
      [...slugs, `${anoA}-01-01`, `${anoB}-12-31`]);
    for (const r of linhas) {
      const x = por[r.empresa_slug], ano = Number(r.a), i = Number(r.m) - 1;
      if (!x || !(ano in x.rec) || i < 0 || i > 11) continue;
      (r.tipo === "receber" ? x.rec : x.desp)[ano][i] += Number(r.s || 0);
      x.tem = true;
    }
  }
  const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const linhas = Object.values(por).map((x: any) => {
    const res = (ano: number) => x.rec[ano].map((v: number, i: number) => v - x.desp[ano][i]);
    const rA = res(anoA), rB = res(anoB);
    return {
      ...x, resA: rA, resB: rB,
      recA: soma(x.rec[anoA]), recB: soma(x.rec[anoB]), despA: soma(x.desp[anoA]), despB: soma(x.desp[anoB]),
      totA: soma(rA), totB: soma(rB),
    };
  }).map((x: any) => ({ ...x, var_rs: x.totB - x.totA, var_pct: variacao(x.totA, x.totB) }));

  const com = linhas.filter((x: any) => x.tem);
  const mensalA = zeros(), mensalB = zeros();
  for (const x of com) for (let i = 0; i < 12; i++) { mensalA[i] += x.resA[i]; mensalB[i] += x.resB[i]; }
  const tot = {
    recA: soma(com.map((x: any) => x.recA)), recB: soma(com.map((x: any) => x.recB)),
    despA: soma(com.map((x: any) => x.despA)), despB: soma(com.map((x: any) => x.despB)),
    resA: soma(mensalA), resB: soma(mensalB), mensalA, mensalB,
  };
  const melhor = [...com].sort((a: any, b: any) => b.totB - a.totB)[0] ?? null;
  const cresc = com.filter((x: any) => x.var_pct !== null && x.var_pct > 0).sort((a: any, b: any) => b.var_pct - a.var_pct)[0] ?? null;

  // Despesas por grupo da DRE (caixa) no ano atual, somando as empresas
  const grupos = new Map<string, number>();
  const dres = await Promise.all(com.map((x: any) => fin.dre(x.empresa.slug, anoB, "caixa")));
  for (const r of dres) for (const gr of r.ordem) {
    if (gr.natureza === "receita" || gr.chave === "investimentos" || gr.total >= 0) continue;
    grupos.set(gr.nome, (grupos.get(gr.nome) ?? 0) + Math.abs(gr.total));
  }
  const desp_grupos = [...grupos.entries()].map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v).slice(0, 8);
  const maior_grupo = Math.max(1, ...desp_grupos.map((x) => x.v));

  return { linhas, com, sem: linhas.filter((x: any) => !x.tem), tot, melhor, cresc, desp_grupos, maior_grupo };
}

export function registrar() {
  get("portal_gerencial", "/grupo/gerencial", async () => {
    const user = g().portal_user;
    if (!user.admin) abort(403);
    const hoje = PyDate.today();
    let anoB = request().args.get("ano", null, "int") || hoje.year;
    if (anoB < 2020 || anoB > hoje.year + 1) anoB = hoje.year;
    const anoA = anoB - 1;
    const empresas = await empresas_visiveis(user);
    const d = await dados_gerenciais(empresas, anoA, anoB);
    const nomes = d.com.map((x: any) => x.empresa.nome);
    const graficos = {
      mensal: grafico_barras(MESES, [
        { nome: `Resultado ${anoA}`, classe: "s-a", valores: d.tot.mensalA },
        { nome: `Resultado ${anoB}`, classe: "s-b", valores: d.tot.mensalB }]),
      empresas: d.com.length ? grafico_barras(nomes, [
        { nome: `Resultado ${anoA}`, classe: "s-a", valores: d.com.map((x: any) => x.totA) },
        { nome: `Resultado ${anoB}`, classe: "s-b", valores: d.com.map((x: any) => x.totB) }]) : null,
      rec_desp: d.com.length ? grafico_barras(nomes, [
        { nome: `Receita ${anoB}`, classe: "s-rec", valores: d.com.map((x: any) => x.recB) },
        { nome: `Despesa ${anoB}`, classe: "s-desp", valores: d.com.map((x: any) => x.despB) }]) : null,
    };
    return render_template("portal/gerencial.html", {
      t: TEMA_GRUPO, anoA, anoB, anos: Array.from({ length: hoje.year - 2022 }, (_, i) => hoje.year - i),
      ...d, graficos, MESES, brl, pct, variacao,
    });
  });
}
