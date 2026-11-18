/* eslint-disable @typescript-eslint/no-explicit-any */
// Termo de Aquisição concluído (depósito confirmado e cotas ativadas) → Finanças da Capuzzo Assessoria:
//   • contas a receber: a entrada (aporte) no dia do depósito;
//   • contas a pagar: a previsão dos rendimentos mês a mês (mesma regra da apuração: proporcional no
//     primeiro período, taxa do produto, dia de pagamento do produto) e a retirada do valor no vencimento.
// Todos os lançamentos do contrato ficam no grupo "ct<id>" — assim não duplica se for gerado de novo.
import { PyDate, q, q1, run, g } from "../../core/flask";
import { calculate_share_income, next_business_day } from "../../base/calculations";
import { D } from "../../base/pyextra";

const EMPRESA = "assessoria";
/** Agronegócio: no mês do vencimento a taxa é variável (3,5% a 4,5%). Na previsão usamos o cenário realista. */
const AGRO_TAXA_PREVISTA = D("0.04");

const CATEGORIAS: Record<string, { aporte: string; rendimento: string; retirada: string }> = {
  civil: { aporte: "Aquisição de Cotas", rendimento: "Rendimento Clube Civil", retirada: "Retirada Clube Civil" },
  agro: { aporte: "Aquisição de cotas Agro", rendimento: "Rendimento Agro", retirada: "Retirada Agro" },
  saude: { aporte: "Aquisição de Cotas", rendimento: "Rendimento Saúde Prime", retirada: "Retirada Saúde Prime" },
};
const NOME_PRODUTO: Record<string, string> = { civil: "Construção Civil", agro: "Agronegócio", saude: "Saúde" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const so_digitos = (s: any) => String(s ?? "").replace(/\D/g, "");
const agora = () => PyDate.now().isoformat("T");
const centavos = (v: number) => Math.round(v * 100);

async function categoria(tipo: "receita" | "despesa", nome: string, grupo: string) {
  const c = await q1("SELECT id FROM financas_categorias WHERE empresa_slug = ? AND tipo = ? AND lower(nome) = lower(?) ORDER BY ativo DESC, id LIMIT 1", [EMPRESA, tipo, nome]);
  if (c) return c.id;
  return (await run("INSERT INTO financas_categorias (empresa_slug, tipo, nome, grupo_dre, ativo, ordem) VALUES (?, ?, ?, ?, 1, 0)", [EMPRESA, tipo, nome, grupo])).lastrowid;
}

/** O cotista no cadastro de clientes/fornecedores do Finanças (procura pelo CPF/CNPJ, depois pelo nome). */
async function pessoa(cli: any) {
  const doc = so_digitos(cli.cpf);
  if (doc) {
    const ps = await q("SELECT id, documento FROM financas_pessoas WHERE empresa_slug = ? AND documento <> ''", [EMPRESA]);
    const p = ps.find((x: any) => so_digitos(x.documento) === doc);
    if (p) return p.id;
  }
  const p = await q1("SELECT id FROM financas_pessoas WHERE empresa_slug = ? AND lower(nome) = lower(?) LIMIT 1", [EMPRESA, cli.full_name]);
  if (p) return p.id;
  return (await run("INSERT INTO financas_pessoas (empresa_slug, tipo, nome, documento, email, telefone, cidade, uf, cep, logradouro, bairro, pix_chave, origem, criado_em) " +
    "VALUES (?, 'ambos', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'condominios', ?)",
  [EMPRESA, cli.full_name, cli.cpf || "", cli.email || "", cli.phone || "", cli.address_city || "", cli.address_state || "", cli.address_zip || "",
    cli.address_street || "", cli.address_district || "", cli.pix_key || "", agora()])).lastrowid;
}

async function lancar(tipo: "receber" | "pagar", desc: string, pessoa_id: number, categoria_id: number, valor: number, venc: string, doc: string, obs: string, grupo: string, parcela = 1, parcelas = 1) {
  const a = agora();
  let uid: number | null = null;
  try { uid = g().portal_user?.id ?? null; } catch { uid = null; }
  return (await run("INSERT INTO financas_lancamentos (empresa_slug, tipo, descricao, pessoa_id, categoria_id, valor, competencia, vencimento, previsao, " +
    "documento, obs, parcela, parcelas, grupo, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  [EMPRESA, tipo, desc, pessoa_id, categoria_id, valor, venc, venc, venc, doc, obs, parcela, parcelas, grupo, uid, a, a])).lastrowid;
}

/** Previsão de rendimentos de uma cota: [{data_pagamento, valor, mes}] do primeiro período até o mês do vencimento. */
export function previsao_rendimentos(cota: any, code: string, dia_pagamento: number) {
  const acq = PyDate.strptime(String(cota.acquisition_date).slice(0, 10), "%Y-%m-%d");
  let fim: PyDate;
  try { fim = PyDate.strptime(String(cota.maturity_date || "").slice(0, 10), "%Y-%m-%d"); } catch { fim = acq.addDays(365); }
  const out: { data: string; valor: number; mes: string; tipo: string }[] = [];
  let y = acq.year, m = acq.month;
  for (let i = 0; i < 400 && (y < fim.year || (y === fim.year && m <= fim.month)); i++) {
    const it = calculate_share_income({ ...cota, status: "ativa" }, code, y, m, AGRO_TAXA_PREVISTA);
    if (it && it.income_value > 0) {
      const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let pg = new PyDate(y, m, Math.min(dia_pagamento, ultimo));
      if (pg.weekday() >= 5) pg = next_business_day(pg);
      out.push({ data: pg.isoformat(), valor: it.income_value, mes: `${MESES[m - 1]}/${y}`, tipo: it.calc_type });
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export async function lancamentos_do_contrato(cid: number) {
  return q("SELECT id, tipo, descricao, valor, vencimento, cancelado FROM financas_lancamentos WHERE empresa_slug = ? AND grupo = ? ORDER BY vencimento, id", [EMPRESA, `ct${cid}`]);
}

/** Gera (uma vez) os lançamentos do Termo de Aquisição no Finanças. Devolve o resumo do que foi criado. */
export async function gerar_lancamentos_aquisicao(cid: number, data_deposito?: string) {
  const c = await q1("SELECT * FROM contratos WHERE id = ?", [cid]);
  if (!c || c.tipo !== "aquisicao" || c.status !== "concluido") throw new Error("Só termos de aquisição com depósito confirmado geram lançamentos.");
  const grupo = `ct${cid}`;
  if ((await lancamentos_do_contrato(cid)).length) return { criados: 0, ja_existia: true };
  const ids = (String(c.share_ids || "").match(/\d+/g) ?? []).map(Number).filter(Boolean);
  if (!ids.length) throw new Error("O contrato não tem cotas.");
  const cotas = await q(`SELECT s.*, cd.code, cd.payment_day FROM shares s JOIN condominiums cd ON cd.id = s.condominium_id WHERE s.id IN (${ids.map(() => "?").join(",")}) ORDER BY s.share_number`, ids);
  const cli = await q1("SELECT * FROM clients WHERE id = ?", [c.client_id]);
  if (!cli || !cotas.length) throw new Error("Cliente ou cotas do contrato não encontrados.");
  const code = cotas[0].code;
  const cat = CATEGORIAS[code] ?? CATEGORIAS.civil;
  const produto = NOME_PRODUTO[code] ?? code;
  const [pid, cat_ap, cat_rd, cat_rt] = await Promise.all([
    pessoa(cli), categoria("receita", cat.aporte, "receita_bruta"),
    categoria("despesa", cat.rendimento, "despesas_operacionais"), categoria("despesa", cat.retirada, "despesas_operacionais")]);
  const doc = c.codigo;
  const nums = cotas.map((x: any) => x.share_number).join(", ");
  const rotulo_cotas = cotas.length > 1 ? `cotas ${nums}` : `cota ${nums}`;
  const dep = (data_deposito || String(c.concluido_em || "").slice(0, 10) || PyDate.today().isoformat()).slice(0, 10);
  let criados = 0;

  // 1) Entrada do aporte no dia do depósito
  const total = cotas.reduce((s: number, x: any) => s + Number(x.share_value || 0), 0);
  await lancar("receber", `Aporte ${produto} — ${rotulo_cotas} · ${cli.full_name}`, pid, cat_ap, centavos(total), dep, doc,
    `Termo de Aquisição ${doc}. Depósito confirmado na ativação das cotas.`, grupo);
  criados++;

  // 2) Rendimentos previstos (somando as cotas do contrato que pagam no mesmo dia)
  const por_data = new Map<string, { valor: number; mes: string; cotas: Set<string>; tipos: Set<string> }>();
  for (const x of cotas) {
    for (const r of previsao_rendimentos(x, x.code, Number(x.payment_day || 6))) {
      const e = por_data.get(r.data) ?? { valor: 0, mes: r.mes, cotas: new Set(), tipos: new Set() };
      e.valor += r.valor; e.cotas.add(x.share_number); e.tipos.add(r.tipo);
      por_data.set(r.data, e);
    }
  }
  const datas = [...por_data.keys()].sort();
  let n = 0;
  for (const dt of datas) {
    const e = por_data.get(dt)!;
    n++;
    await lancar("pagar", `Rendimento ${produto} ${e.mes} — ${rotulo_cotas} · ${cli.full_name}`, pid, cat_rd, centavos(e.valor), dt, doc,
      `Previsão gerada pelo Termo ${doc} (${[...e.tipos].join(", ")}). O valor é confirmado na apuração do mês.` +
      (code === "agro" && [...e.tipos].some((t) => t.includes("Especial")) ? " Mês do vencimento: taxa prevista de 4,00% (cenário realista)." : ""),
      grupo, n, datas.length);
    criados++;
  }

  // 3) Retirada do valor no vencimento de cada cota (agrupada por data)
  const ret = new Map<string, { valor: number; cotas: string[] }>();
  for (const x of cotas) {
    const v = String(x.maturity_date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    const e = ret.get(v) ?? { valor: 0, cotas: [] };
    e.valor += Number(x.share_value || 0); e.cotas.push(x.share_number);
    ret.set(v, e);
  }
  for (const [v, e] of [...ret.entries()].sort()) {
    await lancar("pagar", `Retirada ${produto} — ${e.cotas.length > 1 ? "cotas" : "cota"} ${e.cotas.join(", ")} · ${cli.full_name}`, pid, cat_rt, centavos(e.valor), v, doc,
      `Previsão de devolução do valor no vencimento (Termo ${doc}). Se a cota for renovada, ajuste ou cancele este lançamento.`, grupo);
    criados++;
  }
  return { criados, ja_existia: false, rendimentos: datas.length, retiradas: ret.size };
}
