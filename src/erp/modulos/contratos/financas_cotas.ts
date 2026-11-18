/* eslint-disable @typescript-eslint/no-explicit-any */
// Cotas dos Condomínios → Finanças da Capuzzo Assessoria.
//   • Termo de Aquisição concluído: a entrada (aporte) vai para o contas a receber no dia do depósito
//     (grupo "ct<id do contrato>").
//   • Rendimentos e retiradas são previsões no contas a pagar, CONSOLIDADAS POR CLIENTE E PRODUTO: num mesmo
//     dia de pagamento o cliente tem um único lançamento de rendimento (soma de todas as cotas dele) e um
//     único lançamento de retirada (soma das cotas que vencem/saem naquele dia) — base para o arquivo remessa.
//   • Sempre que algo muda numa cota (aquisição, renovação, marcação/cancelamento/finalização de retirada,
//     edição), as previsões FUTURAS do cliente são recalculadas: valores somados, lançamentos que deixaram de
//     existir são cancelados e os novos são criados. Lançamentos já pagos (com baixa) e datas passadas não
//     são alterados. O vínculo previsão → lançamento fica em cotas_previsoes_lanc.
import { PyDate, q, q1, run, g } from "../../core/flask";
import { calculate_share_income, next_business_day } from "../../base/calculations";
import { D } from "../../base/pyextra";
import * as db from "../../base/database";

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

async function lancar(tipo: "receber" | "pagar", desc: string, pessoa_id: number, categoria_id: number, valor: number, venc: string, doc: string, obs: string, grupo: string, parcela = 1, parcelas = 1): Promise<number> {
  const a = agora();
  let uid: number | null = null;
  try { uid = g().portal_user?.id ?? null; } catch { uid = null; }
  return (await run("INSERT INTO financas_lancamentos (empresa_slug, tipo, descricao, pessoa_id, categoria_id, valor, competencia, vencimento, previsao, " +
    "documento, obs, parcela, parcelas, grupo, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  [EMPRESA, tipo, desc, pessoa_id, categoria_id, valor, venc, venc, venc, doc, obs, parcela, parcelas, grupo, uid, a, a])).lastrowid as number;
}

/** Previsão de rendimentos de uma cota: [{data_pagamento, valor, mes}] do primeiro período até o mês de `ate`. */
export function previsao_rendimentos(cota: any, code: string, dia_pagamento: number, ate?: string) {
  const acq = PyDate.strptime(String(cota.acquisition_date).slice(0, 10), "%Y-%m-%d");
  let fim: PyDate;
  try { fim = PyDate.strptime(String(ate || cota.maturity_date || "").slice(0, 10), "%Y-%m-%d"); } catch { fim = PyDate.today().addDays(365); }
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

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dia = (v: any) => String(v ?? "").slice(0, 10);

/** O que cada cota ainda vai gerar: rendimentos até o vencimento (ou até a retirada marcada) e a retirada. */
function partes_da_cota(x: any, hoje: string) {
  const partes: { tipo: "rendimento" | "retirada"; data: string; valor: number; mes?: string; especial?: boolean }[] = [];
  const valor = Number(x.share_value || 0);
  const venc = dia(x.maturity_date), ret_marcada = Number(x.withdrawal_requested || 0) ? dia(x.withdrawal_effective_date) : "";
  if (x.status === "ativa") {
    const fim = ISO.test(ret_marcada) ? ret_marcada : ISO.test(venc) ? venc : "";
    const base = Number(x.accrual_until_withdrawal || 0) && ISO.test(ret_marcada) ? { ...x, withdrawal_date: ret_marcada } : x;
    if (ISO.test(dia(x.acquisition_date))) {
      for (const r of previsao_rendimentos(base, x.code, Number(x.payment_day || 6), fim || undefined))
        if (r.data >= hoje) partes.push({ tipo: "rendimento", data: r.data, valor: r.valor, mes: r.mes, especial: r.tipo.includes("Especial") });
    }
    const data_ret = ISO.test(ret_marcada) ? ret_marcada : venc;
    if (ISO.test(data_ret) && data_ret >= hoje) partes.push({ tipo: "retirada", data: data_ret, valor });
  } else if (x.status === "inativa" && ISO.test(dia(x.withdrawal_date)) && dia(x.withdrawal_date) >= hoje) {
    partes.push({ tipo: "retirada", data: dia(x.withdrawal_date), valor }); // retirada finalizada, mas o pagamento ainda vai acontecer
  }
  return partes;
}

/** Cliente já está no controle automático (tem alguma previsão vinculada)? */
export async function cliente_no_controle(client_id: number) {
  return !!(await q1("SELECT 1 AS x FROM cotas_previsoes_lanc WHERE client_id = ? LIMIT 1", [client_id]));
}

/** Recalcula as previsões futuras de rendimento e retirada do cliente (todas as cotas, por produto). */
export async function sincronizar_cliente(client_id: number) {
  const hoje = PyDate.today().isoformat();
  const cli = await q1("SELECT * FROM clients WHERE id = ?", [client_id]);
  if (!cli) return { criados: 0, alterados: 0, cancelados: 0 };
  const cotas = await q("SELECT s.*, cd.code, cd.payment_day FROM shares s JOIN condominiums cd ON cd.id = s.condominium_id WHERE s.client_id = ? AND s.status IN ('ativa', 'inativa') ORDER BY s.share_number", [client_id]);
  // alvo: (produto, tipo, data) → soma
  const alvo = new Map<string, { code: string; tipo: "rendimento" | "retirada"; data: string; valor: number; cotas: string[]; mes?: string; especial?: boolean }>();
  for (const x of cotas) {
    for (const p of partes_da_cota(x, hoje)) {
      const k = `${x.code}|${p.tipo}|${p.data}`;
      const e = alvo.get(k) ?? { code: x.code, tipo: p.tipo, data: p.data, valor: 0, cotas: [] as string[], mes: p.mes, especial: false };
      e.valor += p.valor; e.cotas.push(String(x.share_number)); e.especial = e.especial || !!p.especial;
      alvo.set(k, e);
    }
  }
  const vinc = await q("SELECT v.*, l.valor AS l_valor, l.cancelado AS l_cancelado, l.descricao AS l_desc, l.id AS l_id, " +
    "(SELECT COUNT(*) FROM financas_baixas b WHERE b.lancamento_id = v.lancamento_id) AS n_baixas " +
    "FROM cotas_previsoes_lanc v LEFT JOIN financas_lancamentos l ON l.id = v.lancamento_id WHERE v.client_id = ? AND v.data >= ?", [client_id, hoje]);
  const por_chave = new Map(vinc.map((v: any) => [`${v.code}|${v.tipo}|${v.data}`, v]));
  const pid = alvo.size || vinc.length ? await pessoa(cli) : null;
  const cats = new Map<string, number>();
  const cat_de = async (code: string, tipo: string) => {
    const k = `${code}|${tipo}`;
    if (!cats.has(k)) { const c = CATEGORIAS[code] ?? CATEGORIAS.civil; cats.set(k, await categoria("despesa", tipo === "rendimento" ? c.rendimento : c.retirada, "despesas_operacionais")); }
    return cats.get(k)!;
  };
  let criados = 0, alterados = 0, cancelados = 0;
  const a = agora();
  for (const [k, e] of alvo) {
    const produto = NOME_PRODUTO[e.code] ?? e.code;
    const lista = [...new Set(e.cotas)].sort((x, y) => x.localeCompare(y, "pt-BR", { numeric: true }));
    const rot = `${lista.length > 1 ? "cotas" : "cota"} ${lista.join(", ")}`;
    const desc = e.tipo === "rendimento" ? `Rendimento ${produto} ${e.mes} — ${rot} · ${cli.full_name}` : `Retirada ${produto} — ${rot} · ${cli.full_name}`;
    const obs = e.tipo === "rendimento"
      ? `Previsão automática: soma dos rendimentos de todas as cotas do cliente que pagam neste dia (${rot}). O valor é confirmado na apuração do mês.` + (e.especial && e.code === "agro" ? " Mês de vencimento do Agro: taxa prevista de 4,00% (cenário realista)." : "")
      : `Previsão automática: devolução do valor das cotas que vencem ou saem neste dia (${rot}). Renovação ou retirada marcada em Vencimentos atualiza este lançamento.`;
    const cent = centavos(e.valor);
    const grupo = `cot${client_id}${e.code}`;
    const v: any = por_chave.get(k);
    por_chave.delete(k);
    if (v && v.l_id) {
      if (Number(v.n_baixas) > 0) continue; // já pago: não mexe
      if (Number(v.l_valor) !== cent || Number(v.l_cancelado) || v.l_desc !== desc) {
        await run("UPDATE financas_lancamentos SET valor = ?, descricao = ?, obs = ?, cancelado = 0, atualizado_em = ? WHERE id = ?", [cent, desc, obs, a, v.l_id]);
        alterados++;
      }
      continue;
    }
    const cat = await cat_de(e.code, e.tipo);
    // lançamento gerado antes deste controle (por contrato) na mesma data: aproveita em vez de duplicar
    const antigo = await q1("SELECT l.id FROM financas_lancamentos l WHERE l.empresa_slug = ? AND l.tipo = 'pagar' AND l.grupo LIKE 'ct%' AND l.pessoa_id = ? AND l.categoria_id = ? AND l.vencimento = ? " +
      "AND COALESCE(l.cancelado, 0) = 0 AND NOT EXISTS (SELECT 1 FROM cotas_previsoes_lanc v WHERE v.lancamento_id = l.id) AND NOT EXISTS (SELECT 1 FROM financas_baixas b WHERE b.lancamento_id = l.id) ORDER BY l.id LIMIT 1",
    [EMPRESA, pid, cat, e.data]);
    let lid: number;
    if (antigo) {
      lid = antigo.id;
      await run("UPDATE financas_lancamentos SET valor = ?, descricao = ?, obs = ?, grupo = ?, parcela = 1, parcelas = 1, atualizado_em = ? WHERE id = ?", [cent, desc, obs, grupo, a, lid]);
      alterados++;
    } else {
      lid = await lancar("pagar", desc, pid!, cat, cent, e.data, "", obs, grupo);
      criados++;
    }
    if (v) await run("UPDATE cotas_previsoes_lanc SET lancamento_id = ? WHERE id = ?", [lid, v.id]);
    else await run("INSERT INTO cotas_previsoes_lanc (client_id, code, tipo, data, lancamento_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)", [client_id, e.code, e.tipo, e.data, lid, a]);
  }
  // previsões que deixaram de existir (renovou, retirou, mudou a data): cancela o lançamento em aberto
  for (const v of por_chave.values() as Iterable<any>) {
    if (!v.l_id || Number(v.n_baixas) > 0 || Number(v.l_cancelado)) continue;
    await run("UPDATE financas_lancamentos SET cancelado = 1, obs = COALESCE(obs, '') || ?, atualizado_em = ? WHERE id = ?",
      [` [Cancelado automaticamente em ${hoje.split("-").reverse().join("/")}: a cota foi renovada, retirada ou teve a data alterada.]`, a, v.l_id]);
    cancelados++;
  }
  // os já pagos/cancelados das previsões antigas da tela de lançamentos de grupo antigo (ct) também saem do
  // controle de datas futuras: nada a fazer aqui
  return { criados, alterados, cancelados };
}

/** Chamado pelo cadastro de cotas depois de cada mudança (ver database.OUVINTES_COTA). */
export async function ao_mudar_cota(share_id: number, evento: string) {
  const s = await q1("SELECT client_id FROM shares WHERE id = ?", [share_id]);
  if (!s) return;
  if (["renovar", "retirada"].includes(evento) || (await cliente_no_controle(s.client_id))) await sincronizar_cliente(s.client_id);
}

/** Lançamentos ligados ao contrato: a entrada (aporte) e as previsões atuais do cliente. */
export async function lancamentos_do_contrato(cid: number) {
  const c = await q1("SELECT client_id FROM contratos WHERE id = ?", [cid]);
  return q("SELECT l.id, l.tipo, l.descricao, l.valor, l.vencimento, l.cancelado FROM financas_lancamentos l WHERE l.empresa_slug = ? AND (l.grupo = ? " +
    "OR l.id IN (SELECT lancamento_id FROM cotas_previsoes_lanc WHERE client_id = ?)) AND (l.tipo = 'receber' OR COALESCE(l.cancelado, 0) = 0) ORDER BY l.vencimento, l.id",
  [EMPRESA, `ct${cid}`, c?.client_id ?? 0]);
}

/** Termo de Aquisição concluído: lança a entrada (uma vez) e recalcula as previsões do cliente. */
export async function gerar_lancamentos_aquisicao(cid: number, data_deposito?: string) {
  const c = await q1("SELECT * FROM contratos WHERE id = ?", [cid]);
  if (!c || c.tipo !== "aquisicao" || c.status !== "concluido") throw new Error("Só termos de aquisição com depósito confirmado geram lançamentos.");
  const ids = (String(c.share_ids || "").match(/\d+/g) ?? []).map(Number).filter(Boolean);
  if (!ids.length) throw new Error("O contrato não tem cotas.");
  const cotas = await q(`SELECT s.*, cd.code FROM shares s JOIN condominiums cd ON cd.id = s.condominium_id WHERE s.id IN (${ids.map(() => "?").join(",")}) ORDER BY s.share_number`, ids);
  const cli = await q1("SELECT * FROM clients WHERE id = ?", [c.client_id]);
  if (!cli || !cotas.length) throw new Error("Cliente ou cotas do contrato não encontrados.");
  let aporte = false;
  if (!(await q1("SELECT 1 AS x FROM financas_lancamentos WHERE empresa_slug = ? AND grupo = ? AND tipo = 'receber'", [EMPRESA, `ct${cid}`]))) {
    const code = cotas[0].code;
    const cat = CATEGORIAS[code] ?? CATEGORIAS.civil;
    const [pid, cat_ap] = await Promise.all([pessoa(cli), categoria("receita", cat.aporte, "receita_bruta")]);
    const nums = cotas.map((x: any) => x.share_number).join(", ");
    const dep = (data_deposito || dia(c.concluido_em) || PyDate.today().isoformat()).slice(0, 10);
    const total = cotas.reduce((s: number, x: any) => s + Number(x.share_value || 0), 0);
    await lancar("receber", `Aporte ${NOME_PRODUTO[code] ?? code} — ${cotas.length > 1 ? "cotas" : "cota"} ${nums} · ${cli.full_name}`, pid, cat_ap, centavos(total), dep, c.codigo,
      `Termo de Aquisição ${c.codigo}. Depósito confirmado na ativação das cotas.`, `ct${cid}`);
    aporte = true;
  }
  const r = await sincronizar_cliente(c.client_id);
  return { aporte, ...r };
}

db.OUVINTES_COTA.push(ao_mudar_cota);
