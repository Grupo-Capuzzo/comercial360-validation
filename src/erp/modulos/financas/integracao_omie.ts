/* eslint-disable @typescript-eslint/no-explicit-any */
// Integrações por API (Cadastros → Integrações) — por enquanto, o Omie (porte de financas/integracao_omie.py).
//
// O que faz:
//   • lê do Omie as contas correntes, as categorias, os clientes/fornecedores e o EXTRATO de cada conta;
//   • traz para o ERP só o que está CONCILIADO no Omie (linhas do extrato com data de conciliação):
//       entrada → conta a receber já recebida · saída → conta a pagar já paga · transferência → só o movimento;
//   • roda sozinho de tempos em tempos (agendador interno), sem ninguém pedir;
//   • nada é duplicado: cada linha do Omie fica ligada ao registro criado aqui (tabela financas_api_map);
//     se mudar no Omie, atualiza; se deixar de estar conciliada, o lançamento importado é removido.
//
// Também recebe o "pacote" lido no navegador pelo favorito "Enviar ao ERP" (sem a API paga).
// Threads do Python → funções async disparadas sem await; o andamento fica gravado em financas_api_config.
import { gunzipSync } from "node:zlib";

import { PyDate, abort, flash, g, jsonify, pyRound, redirect, render_template, request, route, url_for, get } from "../../core/flask";
import * as d from "./dados";
import { _csrf, _ctx, _empresa } from "./index";
import { COLETOR_JS } from "./omie_coletor";

export const OMIE_URL = "https://app.omie.com.br/api/v1/";
export const INTERVALOS = [1, 3, 6, 12, 24];
const PAUSA = 0.35; // segundos entre chamadas (o Omie limita chamadas por minuto)
export const _rodando = new Set<string>(); // empresas sincronizando neste processo

const dormir = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

/** str() do Python para valores vindos de JSON. */
function pstr(v: any): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

/** json.dumps(v, ensure_ascii=False) do Python (separadores ", " e ": ", sem ordenar chaves). */
export function dumps(v: any): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : (Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity");
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof PyDate) return JSON.stringify(v.isoformat());
  if (Array.isArray(v)) return "[" + v.map(dumps).join(", ") + "]";
  if (v instanceof Set) return dumps(Array.from(v));
  if (typeof v === "object") return "{" + Object.keys(v).map((k) => JSON.stringify(k) + ": " + dumps(v[k])).join(", ") + "}";
  return JSON.stringify(String(v));
}

/** Igualdade de dicionários/listas como no Python (ordem das chaves não importa; True == 1). */
function igual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) === Number(b) && typeof a !== "string" && typeof b !== "string" && a !== null && b !== null;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => igual(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && igual(a[k], b[k]));
  }
  return false;
}

function cortar(s: string, n: number) { return Array.from(s).slice(0, n).join(""); }

// lower() do SQLite só converte A-Z; para não casar nomes diferentes no Postgres, imitamos isso.
const LOWER_ASCII = (x: string) => `translate(${x}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;

// ───────────────────────── banco ─────────────────────────
/** As tabelas financas_api_* já existem no Supabase. */
export async function preparar() { /* não se aplica na versão online */ }

export function agora(): string {
  return PyDate.now().isoformat(" ");
}

export async function config(slug: string, provedor = "omie"): Promise<any> {
  let c = await d.q("SELECT * FROM financas_api_config WHERE empresa_slug = ? AND provedor = ?", [slug, provedor], true);
  if (!c) {
    await d.ex("INSERT OR IGNORE INTO financas_api_config (empresa_slug, provedor, data_inicial) VALUES (?, ?, ?)",
      [slug, provedor, `${PyDate.today().year - 1}-01-01`]);
    c = await d.q("SELECT * FROM financas_api_config WHERE empresa_slug = ? AND provedor = ?", [slug, provedor], true);
  }
  return c;
}

export function mascarar(s: any): string {
  s = s || "";
  const t = Array.from(String(s));
  return t.length > 8 ? t.slice(0, 4).join("") + "•".repeat(8) + t.slice(-3).join("") : "•".repeat(t.length);
}

export async function mapa(slug: string, tipo: string, externo: any, provedor = "omie"): Promise<any> {
  return d.q("SELECT * FROM financas_api_map WHERE empresa_slug = ? AND provedor = ? AND tipo = ? AND externo_id = ?",
    [slug, provedor, tipo, pstr(externo)], true);
}

export async function gravar_mapa(slug: string, tipo: string, externo: any, local_id: any, local_mov_id: any = null, info: any = null, provedor = "omie") {
  await d.ex(`INSERT INTO financas_api_map (empresa_slug, provedor, tipo, externo_id, local_id, local_mov_id, info, atualizado_em)
            VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(empresa_slug, provedor, tipo, externo_id) DO UPDATE SET
            local_id = excluded.local_id, local_mov_id = excluded.local_mov_id, info = excluded.info, atualizado_em = excluded.atualizado_em`,
  [slug, provedor, tipo, pstr(externo), local_id ?? null, local_mov_id ?? null, dumps(info && Object.keys(info).length ? info : {}), agora()]);
}

// ───────────────────────── cliente da API do Omie ─────────────────────────
export class OmieErro extends Error {}

export class Omie {
  key: string;
  secret: string;
  log: any[];
  chamadas = 0;
  constructor(app_key: any, app_secret: any, log: any[] | null = null) {
    this.key = String(app_key || "").trim();
    this.secret = String(app_secret || "").trim();
    this.log = log !== null ? log : [];
  }

  async chamar(servico: string, call: string, param: any): Promise<any> {
    const corpo = JSON.stringify({ call, app_key: this.key, app_secret: this.secret, param: [param] });
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      await dormir(PAUSA);
      this.chamadas += 1;
      let resp: any;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 90000);
        let r: Response;
        try {
          r = await fetch(OMIE_URL + servico, {
            method: "POST", body: corpo, signal: ctl.signal,
            headers: { "Content-Type": "application/json", "User-Agent": "PortalGrupoCapuzzo/1.0" },
          });
        } finally { clearTimeout(t); }
        const txt = await r.text();
        if (r.ok) resp = JSON.parse(txt || "{}");
        else {
          try { resp = JSON.parse(txt || "{}"); } catch { resp = { faultstring: `HTTP ${r.status}`, faultcode: String(r.status) }; }
        }
      } catch (exc: any) {
        if (exc instanceof SyntaxError) throw exc;
        if (tentativa < 4) { await dormir(3 * (tentativa + 1)); continue; }
        throw new OmieErro(`Sem conexão com o Omie: ${exc?.message ?? exc}`);
      }
      if (resp && typeof resp === "object" && !Array.isArray(resp) && resp.faultstring) {
        const msg = String(resp.faultstring);
        const low = msg.toLowerCase();
        if (low.includes("não existem registros") || low.includes("nao existem registros") || low.includes("não há registros")) return {};
        if (["redundante", "redundant", "consumo indevido", "aguarde", "misuse", "bloqueada"].some((t) => low.includes(t))) {
          await dormir(10 * (tentativa + 1)); // o Omie pede para esperar antes de repetir a mesma chamada
          continue;
        }
        if (low.includes("addon") || low.includes("omie store") || low.includes("store.omie")) {
          throw new OmieErro("ADDON: o Omie exige o add-on “APIs Omie” ativo na Omie.Store para liberar a API desta conta. "
            + "Sem ele, nenhuma integração consegue ler os dados (" + msg + ")");
        }
        throw new OmieErro(`${call}: ${msg}`);
      }
      if (this.log.length < 12) this.log.push({ call, param, amostra: cortar(dumps(resp), 1500) });
      return resp;
    }
    throw new OmieErro(`${call}: o Omie continuou recusando por excesso de chamadas. Tente mais tarde.`);
  }

  static _lista(resp: any, chaves: string[]): any[] {
    resp = resp || {};
    for (const k of chaves) if (Array.isArray(resp[k])) return resp[k];
    for (const v of Object.values(resp)) { // se o nome mudar, pega a primeira lista da resposta
      if (Array.isArray(v) && (!v.length || (v[0] && typeof v[0] === "object" && !Array.isArray(v[0])))) return v;
    }
    return [];
  }

  async paginar(servico: string, call: string, param: any, chaves: string[], por_pagina = 100): Promise<any[]> {
    const out: any[] = [];
    let pagina = 1;
    for (;;) {
      const resp = await this.chamar(servico, call, { ...param, pagina, registros_por_pagina: por_pagina });
      const itens = Omie._lista(resp, chaves);
      out.push(...itens);
      const total = resp.total_de_paginas || resp.nTotPaginas || 1;
      if (pagina >= parseInt(String(total || 1), 10) || !itens.length) break;
      pagina += 1;
    }
    return out;
  }

  contas() {
    return this.paginar("geral/contacorrente/", "ListarContasCorrentes", { apenas_importado_api: "N" },
      ["ListarContasCorrentes", "conta_corrente_lista"]);
  }
  categorias() { return this.paginar("geral/categorias/", "ListarCategorias", {}, ["categoria_cadastro"], 100); }
  clientes() { return this.paginar("geral/clientes/", "ListarClientes", { apenas_importado_api: "N" }, ["clientes_cadastro"], 100); }
  extrato(nCodCC: any, ini: PyDate, fim: PyDate) {
    return this.chamar("financas/extrato/", "ListarExtrato",
      { nCodCC: parseInt(String(nCodCC), 10), cCodIntCC: "", dPeriodoInicial: ini.strftime("%d/%m/%Y"), dPeriodoFinal: fim.strftime("%d/%m/%Y") });
  }
}

// ───────────────────────── leitura defensiva dos campos ─────────────────────────
export function _v(obj: any, nomes: string[], padrao: any = null): any {
  for (const n of nomes) {
    if (obj && typeof obj === "object" && !Array.isArray(obj) && obj[n] !== null && obj[n] !== undefined && obj[n] !== "") return obj[n];
  }
  return padrao;
}

export function _data_br(s: any): PyDate | null {
  s = s === null || s === undefined ? "" : String(s).trim();
  if (s === "None") s = "";
  for (const fmt of ["%d/%m/%Y", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S"]) {
    try {
      return PyDate.strptime(fmt.includes("%H") ? s.slice(0, 19) : s.slice(0, 10), fmt).date();
    } catch { continue; }
  }
  return null;
}

export function _num(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return Number(v);
  const s = pstr(v).replace(/,/g, ".").trim();
  if (/^[-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return parseFloat(s.replace(/_/g, ""));
  if (/^[-+]?(inf|infinity)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
  return 0.0;
}

export function _cent(v: any): number {
  return pyRound(_num(v) * 100);
}

export function conta_info(c: any) {
  return {
    id: _v(c, ["nCodCC", "codigo", "nCodCc"]), nome: _v(c, ["descricao", "cDescricao"], "Conta Omie"),
    banco: pstr(_v(c, ["codigo_banco", "cCodBanco"], "")), agencia: pstr(_v(c, ["codigo_agencia", "cCodAgencia"], "")),
    numero: pstr(_v(c, ["numero_conta_corrente", "cNumCC"], "")),
    tipo: pstr(_v(c, ["tipo_conta_corrente", "tipo", "cTipo"], "")),
    inativa: pstr(_v(c, ["inativo", "cInativo"], "N")).toUpperCase() === "S",
  } as any;
}

export function linha_conciliada(m: any): boolean {
  const dc = pstr(_v(m, ["dDataConciliacao", "dDtConcilia", "dDataConcilia"], "")).trim();
  if (dc && dc !== "00/00/0000" && dc !== "0000-00-00") return true;
  return ["S", "SIM", "TRUE", "1"].includes(pstr(_v(m, ["cConciliado", "conciliado"], "")).toUpperCase());
}

export function linha_saldo(m: any): boolean {
  const txt = ["cDesCliente", "cRazCliente", "cDesCategoria"].map((k) => pstr(_v(m, [k], ""))).join(" ").toUpperCase();
  return !_v(m, ["nCodLancamento", "nCodLanc"]) || (txt.includes("SALDO") && !_v(m, ["cCodCategoria"]));
}

export function saldo_anterior(resp: any, linhas: any[]): number | null {
  for (const [k, v] of Object.entries(resp || {})) {
    if (k.toLowerCase().replace(/_/g, "").includes("saldoanterior")) return _num(v);
  }
  for (const m of linhas) {
    if (pstr(_v(m, ["cDesCliente", "cRazCliente"], "")).toUpperCase().includes("SALDO ANTERIOR")) return _num(_v(m, ["nSaldo", "nValorDocumento"], 0));
  }
  return null;
}

// ───────────────────────── sincronização ─────────────────────────
function* _meses(ini: PyDate, fim: PyDate): Generator<[PyDate, PyDate]> {
  let a = new PyDate(ini.year, ini.month, 1);
  while (a.compare(fim) <= 0) {
    const prox = new PyDate(a.year + Math.floor(a.month / 12), (a.month % 12) + 1, 1);
    const ult = prox.addDays(-1);
    yield [a.compare(ini) >= 0 ? a : ini, ult.compare(fim) <= 0 ? ult : fim];
    a = prox;
  }
}

async function _pessoa(slug: string, m: any, tipo_lanc: string, cache: Map<any, any>): Promise<any> {
  const cod = _v(m, ["nCodCliente", "nCodCli"]);
  if (!cod) return null;
  if (cache.has(cod)) return cache.get(cod);
  const mp = await mapa(slug, "pessoa", cod);
  if (mp && (await d.q("SELECT 1 FROM financas_pessoas WHERE id = ?", [mp.local_id], true))) {
    cache.set(cod, mp.local_id);
    return mp.local_id;
  }
  const nome = cortar(pstr(_v(m, ["cRazCliente", "cDesCliente"], "Sem nome")).trim(), 160);
  const doc = d.so_digitos(pstr(_v(m, ["cDocCliente"], "")));
  const tipo = tipo_lanc === "receber" ? "cliente" : "fornecedor";
  let ja = doc ? await d.q("SELECT id, tipo FROM financas_pessoas WHERE empresa_slug = ? AND documento = ? AND documento <> '' ORDER BY id", [slug, doc], true) : null;
  ja = ja || await d.q(`SELECT id, tipo FROM financas_pessoas WHERE empresa_slug = ? AND ${LOWER_ASCII("nome")} = ${LOWER_ASCII("?")} ORDER BY id`, [slug, nome], true);
  let pid: number;
  if (ja) {
    pid = ja.id;
    if (ja.tipo !== tipo && ja.tipo !== "ambos") await d.ex("UPDATE financas_pessoas SET tipo = 'ambos' WHERE id = ?", [pid]);
  } else {
    pid = await d.ex(`INSERT INTO financas_pessoas (empresa_slug, tipo, nome, documento, origem, externo_id, criado_em)
                      VALUES (?, ?, ?, ?, 'omie', ?, ?)`, [slug, tipo, nome, doc, pstr(cod), d.agora_iso()]);
  }
  await gravar_mapa(slug, "pessoa", cod, pid);
  cache.set(cod, pid);
  return pid;
}

async function _categoria(slug: string, m: any, tipo_lanc: string, cache: Map<any, any>): Promise<any> {
  const cod = pstr(_v(m, ["cCodCategoria", "cCodCateg"], "")).trim();
  let nome = pstr(_v(m, ["cDesCategoria"], "")).trim();
  if (!cod && !nome) return null;
  const chave = cod || nome;
  if (cache.has(chave)) return cache.get(chave);
  const mp = await mapa(slug, "categoria", chave);
  if (mp && (await d.q("SELECT 1 FROM financas_categorias WHERE id = ?", [mp.local_id], true))) {
    cache.set(chave, mp.local_id);
    return mp.local_id;
  }
  const tipo = tipo_lanc === "receber" ? "receita" : "despesa";
  nome = nome || `Categoria Omie ${cod}`;
  const ja = await d.q(`SELECT id FROM financas_categorias WHERE empresa_slug = ? AND tipo = ? AND ${LOWER_ASCII("nome")} = ${LOWER_ASCII("?")} ORDER BY id`, [slug, tipo, nome], true);
  let cid: number;
  if (ja) cid = ja.id;
  else {
    const sug = (await d.sugerir_grupo(slug, nome, tipo)) || {};
    cid = await d.ex("INSERT INTO financas_categorias (empresa_slug, tipo, nome, grupo_dre, ativo, ordem) VALUES (?, ?, ?, ?, 1, 0)",
      [slug, tipo, cortar(nome, 120), sug.grupo || (tipo === "receita" ? "outras_receitas" : "despesas_operacionais")]);
  }
  await gravar_mapa(slug, "categoria", chave, cid);
  cache.set(chave, cid);
  return cid;
}

/** Desfaz um registro importado que deixou de estar conciliado (ou foi excluído) no Omie. */
async function _remover_importado(mp: any) {
  if (mp.local_id) {
    for (const b of await d.q("SELECT id FROM financas_baixas WHERE lancamento_id = ? ORDER BY id", [mp.local_id])) await d.estornar_baixa(b.id);
    await d.ex("DELETE FROM financas_rateios WHERE lancamento_id = ?", [mp.local_id]);
    await d.ex("DELETE FROM financas_lancamentos WHERE id = ?", [mp.local_id]);
  } else if (mp.local_mov_id) {
    await d.ex("DELETE FROM financas_movimentos WHERE id = ?", [mp.local_mov_id]);
  }
  await d.ex("DELETE FROM financas_api_map WHERE id = ?", [mp.id]);
}

function jsonCarregar(s: any): any {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

/** Grava UMA linha conciliada do extrato do Omie. Retorna o externo_id usado. */
async function _importar_linha(slug: string, conta_id: number, nCodCC: any, m: any, caches: any, cont: Record<string, number>): Promise<string | null> {
  const ext = `${pstr(nCodCC)}:${pstr(_v(m, ["nCodLancamento", "nCodLanc"]))}`;
  const dt = _data_br(_v(m, ["dDataLancamento", "dDtLanc", "dDataConciliacao"]));
  if (!dt) return null;
  const bruto = _num(_v(m, ["nValorDocumento", "nValor"], 0));
  const nat = pstr(_v(m, ["cNatureza"], "")).toUpperCase();
  const saida = bruto < 0 || nat.startsWith("P");
  const valor = Math.abs(_cent(bruto));
  if (valor === 0) return null;
  const origem = pstr(_v(m, ["cOrigem"], "")).toUpperCase();
  const descat = pstr(_v(m, ["cDesCategoria"], ""));
  const transf = origem === "TRAP" || origem === "TRAR" || origem.includes("TRANSF") || descat.toUpperCase().startsWith("TRANSFER");
  const tipo = saida ? "pagar" : "receber";
  const pessoa = transf ? null : await _pessoa(slug, m, tipo, caches.pessoa);
  const cat = transf ? null : await _categoria(slug, m, tipo, caches.categoria);
  const nome_pessoa = pstr(_v(m, ["cRazCliente", "cDesCliente"], "")).trim();
  const obs = pstr(_v(m, ["cObservacoes"], "")).trim();
  let desc = cortar(obs || ((descat && nome_pessoa) ? `${descat} — ${nome_pessoa}` : (descat || nome_pessoa)) || "Lançamento Omie", 200);
  if (transf) desc = cortar("Transferência entre contas" + (obs ? ` — ${obs}` : ""), 200);
  const doc = cortar(pstr(_v(m, ["cNumero", "cDocumentoFiscal"], "")), 60);
  const assinatura = { data: dt.isoformat(), valor, saida, cat, pessoa, desc, conta: conta_id };
  const mp = await mapa(slug, "extrato", ext);
  if (mp) {
    const info = jsonCarregar(mp.info);
    if (igual(info, assinatura)) return ext; // nada mudou
    await _remover_importado(mp); // mudou no Omie → refaz
    cont.atualizados += 1;
  } else {
    cont.novos += 1;
  }
  const iso = dt.isoformat();
  if (transf) {
    const mov = await d.ex(`INSERT INTO financas_movimentos (empresa_slug, conta_id, data, descricao, valor, origem, conciliado, fitid, criado_em)
                      VALUES (?, ?, ?, ?, ?, 'omie', 1, ?, ?)`, [slug, conta_id, iso, desc, saida ? -valor : valor, "omie:" + ext, d.agora_iso()]);
    await gravar_mapa(slug, "extrato", ext, null, mov, assinatura);
    cont.transferencias += 1;
    return ext;
  }
  const cab = {
    descricao: desc, pessoa_id: pessoa, conta_id, documento: doc,
    obs: "Importado do Omie (conciliado)", forma_pagamento: "", repeticao: "",
  };
  const [ids] = await d.criar_lancamento_completo(slug, tipo, cab, [{ vencimento: iso, previsao: iso, valor, competencia: iso.slice(0, 7) }],
    [{ categoria_id: cat, centro_id: null, valor }], null);
  const lanc = await d.q("SELECT * FROM financas_lancamentos WHERE id = ?", [ids[0]], true);
  const [, mov] = await d.registrar_baixa(slug, lanc, conta_id, iso, valor, 0, 0, null);
  await d.ex("UPDATE financas_movimentos SET origem = 'omie', conciliado = 1, fitid = ? WHERE id = ?", ["omie:" + ext, mov]);
  await gravar_mapa(slug, "extrato", ext, ids[0], mov, assinatura);
  cont[tipo === "receber" ? "recebimentos" : "pagamentos"] += 1;
  return ext;
}

/** Conta do ERP ligada à conta do Omie (escolhida na tela ou criada automaticamente). */
async function _conta_local(slug: string, cfg: any, info: any, contas_map: Map<any, any>): Promise<any> {
  const mp = await mapa(slug, "conta", info.id);
  if (mp && mp.local_id === 0) return null; // marcada para não importar
  if (mp && mp.local_id && (await d.q("SELECT 1 FROM financas_contas WHERE id = ?", [mp.local_id], true))) return mp.local_id;
  if (info.inativa) return null;
  // mesma conta já cadastrada aqui (mesmo banco e número)? liga nela em vez de criar outra
  const num = d.so_digitos(info.numero);
  if (num) {
    for (const c of await d.q("SELECT id, banco, numero FROM financas_contas WHERE empresa_slug = ? ORDER BY id", [slug])) {
      if (d.so_digitos(c.numero) === num && (!info.banco || String(c.banco).replace(/^0+/, "") === String(info.banco).replace(/^0+/, ""))) {
        await gravar_mapa(slug, "conta", info.id, c.id, null, { saldo_ajustado: false });
        return c.id;
      }
    }
  }
  if (!cfg.criar_contas) return null;
  const nome = cortar(pstr(info.nome), 80);
  const cid = await d.ex(`INSERT INTO financas_contas (empresa_slug, nome, tipo, banco, agencia, numero, saldo_inicial, data_saldo_inicial, ativa, criado_em)
                  VALUES (?, ?, ?, ?, ?, ?, 0, '', 1, ?)`, [slug, nome, info.tipo_erp || "corrente", info.banco, info.agencia,
    info.numero, d.agora_iso()]);
  await gravar_mapa(slug, "conta", info.id, cid, null, { saldo_ajustado: false });
  contas_map.set(info.id, cid);
  return cid;
}

function novaContagem(): Record<string, number> {
  return {
    contas: 0, categorias: 0, clientes: 0, novos: 0, atualizados: 0, removidos: 0, recebimentos: 0,
    pagamentos: 0, transferencias: 0, nao_conciliadas: 0, chamadas: 0,
  };
}

/** Executa a sincronização da empresa pela API. Seguro contra duas execuções ao mesmo tempo. */
export async function sincronizar(slug: string, origem = "automática", completa: boolean | null = null, periodo: [PyDate, PyDate] | null = null) {
  const cfg = await config(slug);
  if (!cfg.app_key || !cfg.app_secret) throw new OmieErro("Informe a App Key e o App Secret do Omie.");
  // trava (vale entre processos)
  const lim = PyDate.now().addSeconds(40 * 60).isoformat(" ");
  const conn = await d.conexao_original();
  try {
    const cur = await conn.execute("UPDATE financas_api_config SET lock_ate = ? WHERE id = ? AND (lock_ate IS NULL OR lock_ate < ?)",
      [lim, cfg.id, agora()]);
    await conn.commit();
    if (cur.rowcount !== 1) throw new OmieErro("Já existe uma sincronização em andamento. Aguarde terminar.");
  } finally {
    await conn.close();
  }
  _rodando.add(slug);
  const inicio = agora();
  const log_id = await d.ex("INSERT INTO financas_api_log (empresa_slug, provedor, inicio, origem, status, resumo) VALUES (?, 'omie', ?, ?, 'rodando', '')",
    [slug, inicio, origem]);
  await d.ex("UPDATE financas_api_config SET status = 'rodando', mensagem = 'Sincronizando…' WHERE id = ?", [cfg.id]);
  const amostras: any[] = [];
  const cont = novaContagem();
  const om = new Omie(cfg.app_key, cfg.app_secret, amostras);
  let status = "ok", msg = "";
  try {
    completa = completa === null ? !cfg.carga_completa : completa;
    const hoje = PyDate.today();
    const ini_hist = _data_br(cfg.data_inicial) || new PyDate(hoje.year, 1, 1);
    // janela_dias = 0 → "manualmente": as atualizações automáticas só olham a última semana
    const janela = parseInt(String(cfg.janela_dias || 0), 10) || 7;
    let fim = hoje, ini: PyDate;
    if (periodo) {
      completa = false;
      [ini, fim] = periodo;
    } else {
      const ha = hoje.addDays(-janela);
      ini = completa ? ini_hist : (ini_hist.compare(ha) >= 0 ? ini_hist : ha);
    }
    const caches = { pessoa: new Map(), categoria: new Map() };
    // 1) categorias (mantém o plano igual ao do Omie)
    for (const c of await om.categorias()) {
      if (pstr(_v(c, ["totalizadora"], "N")).toUpperCase() === "S" || pstr(_v(c, ["conta_inativa"], "N")).toUpperCase() === "S") continue;
      const cod = pstr(_v(c, ["codigo"], "")), nome = pstr(_v(c, ["descricao", "descricao_padrao"], "")).trim();
      if (!cod || !nome || (await mapa(slug, "categoria", cod))) continue;
      const receita = pstr(_v(c, ["conta_receita"], "")).toUpperCase() === "S" || cod.startsWith("1.");
      await _categoria(slug, { cCodCategoria: cod, cDesCategoria: nome }, receita ? "receber" : "pagar", caches.categoria);
      cont.categorias += 1;
    }
    // 2) clientes e fornecedores (cadastro completo)
    if (cfg.importar_clientes) {
      for (const c of await om.clientes()) {
        const cod = _v(c, ["codigo_cliente_omie", "codigo_cliente"]);
        if (!cod) continue;
        const tags = (c.tags || []).map((t: any) => (t && typeof t === "object" && !Array.isArray(t) ? pstr(_v(t, ["tag"], "")) : pstr(t))).join(" ").toUpperCase();
        const forn = tags.includes("FORNECEDOR"), cli = tags.includes("CLIENTE");
        const pid = await _pessoa(slug, {
          nCodCliente: cod, cRazCliente: _v(c, ["razao_social", "nome_fantasia"], ""),
          cDocCliente: _v(c, ["cnpj_cpf"], ""),
        }, forn && !cli ? "pagar" : "receber", caches.pessoa);
        if (forn && cli) await d.ex("UPDATE financas_pessoas SET tipo = 'ambos' WHERE id = ?", [pid]);
        const tel = `${pstr(_v(c, ["telefone1_ddd"], ""))} ${pstr(_v(c, ["telefone1_numero"], ""))}`.trim();
        await d.ex(`UPDATE financas_pessoas SET email = CASE WHEN email = '' THEN ? ELSE email END,
                        telefone = CASE WHEN telefone = '' THEN ? ELSE telefone END,
                        cidade = CASE WHEN cidade = '' THEN ? ELSE cidade END, uf = CASE WHEN uf = '' THEN ? ELSE uf END
                        WHERE id = ?`, [cortar(pstr(_v(c, ["email"], "")), 160), cortar(tel, 40), cortar(pstr(_v(c, ["cidade"], "")), 80),
          cortar(pstr(_v(c, ["estado"], "")), 2), pid]);
        cont.clientes += 1;
      }
    }
    // 3) contas correntes + extrato conciliado
    const contas_map = new Map();
    for (const c of await om.contas()) {
      const info = conta_info(c);
      if (!info.id) continue;
      await gravar_mapa(slug, "conta_omie", info.id, null, null, info); // lista para a tela de ligação
      const conta_id = await _conta_local(slug, cfg, info, contas_map);
      if (!conta_id) continue;
      cont.contas += 1;
      const vistos = new Set<string>();
      let ajustar = completa;
      for (const [a, b] of _meses(ini!, fim)) {
        const resp = await om.extrato(info.id, a, b);
        const linhas = Omie._lista(resp, ["listaMovimentos"]);
        if (ajustar && ((resp && Object.keys(resp).length) || linhas.length)) { // saldo inicial = saldo do Omie antes da data inicial
          const sa = saldo_anterior(resp, linhas);
          if (sa !== null) {
            const mpc = await mapa(slug, "conta", info.id);
            const infoc = mpc ? jsonCarregar(mpc.info) : {};
            if (!infoc.saldo_ajustado) {
              await d.ex("UPDATE financas_contas SET saldo_inicial = ?, data_saldo_inicial = ? WHERE id = ?",
                [_cent(sa), ini!.addDays(-1).isoformat(), conta_id]);
              await gravar_mapa(slug, "conta", info.id, conta_id, null, { ...infoc, saldo_ajustado: true, saldo: sa });
            }
            ajustar = false;
          }
        }
        for (const m of linhas) {
          if (linha_saldo(m)) continue;
          if (!linha_conciliada(m)) { cont.nao_conciliadas += 1; continue; }
          const ext = await _importar_linha(slug, conta_id, info.id, m, caches, cont);
          if (ext) vistos.add(ext);
        }
      }
      // o que foi importado nesse período e não veio mais conciliado → remove
      for (const mp of await d.q("SELECT * FROM financas_api_map WHERE empresa_slug = ? AND provedor = 'omie' AND tipo = 'extrato' AND externo_id LIKE ? ORDER BY id",
        [slug, `${pstr(info.id)}:%`])) {
        const inf = jsonCarregar(mp.info);
        const dt = inf.data ?? "";
        if (ini!.isoformat() <= dt && dt <= fim.isoformat() && !vistos.has(mp.externo_id)) {
          await _remover_importado(mp);
          cont.removidos += 1;
        }
      }
    }
    if (completa) await d.ex("UPDATE financas_api_config SET carga_completa = 1 WHERE id = ?", [cfg.id]);
    cont.chamadas = om.chamadas;
    msg = `${cont.novos} novo(s), ${cont.atualizados} atualizado(s), ${cont.removidos} removido(s) · `
      + `${cont.contas} conta(s) · período ${ini!.strftime("%d/%m/%Y")} a ${fim.strftime("%d/%m/%Y")}`;
  } catch (exc: any) {
    status = "erro";
    msg = cortar(String(exc?.message ?? exc), 500);
    amostras.push({ erro: String(exc?.stack ?? exc).slice(-3000) });
  } finally {
    const prox = PyDate.now().addSeconds(3600 * (parseInt(String(cfg.intervalo_horas || 6), 10) || 6)).isoformat(" ");
    await d.ex("UPDATE financas_api_config SET status = ?, mensagem = ?, ultima_sync = ?, proxima_sync = ?, lock_ate = NULL WHERE id = ?",
      [status, msg, agora(), prox, cfg.id]);
    await d.ex("UPDATE financas_api_log SET fim = ?, status = ?, resumo = ?, detalhe = ? WHERE id = ?",
      [agora(), status, msg, cortar(dumps({ contagem: cont, chamadas: amostras }), 60000), log_id]);
    _rodando.delete(slug);
  }
  return { status, mensagem: msg, ...cont };
}

export function sincronizar_em_segundo_plano(slug: string, origem: string, completa: boolean | null = null, periodo: [PyDate, PyDate] | null = null) {
  void (async () => {
    try {
      await sincronizar(slug, origem, completa, periodo);
    } catch (exc: any) {
      await d.ex("UPDATE financas_api_config SET status = 'erro', mensagem = ? WHERE empresa_slug = ? AND provedor = 'omie'",
        [cortar(String(exc?.message ?? exc), 500), slug]);
    }
  })().catch(console.error);
}

// ───────────────────────── Omie pelo navegador (sem a API paga) ─────────────────────────
// O favorito "Enviar ao ERP" roda na tela Finanças → Movimentação da Conta Corrente do Omie, lê todas as
// páginas da grade e abre o ERP com os dados compactados no endereço (#...). A importação usa as mesmas regras.

export function tipo_conta_erp(nome: any): string {
  const n = String(nome || "").toLowerCase();
  if (/cart[aã]o|amex|\belo\b|latam|mastercard|platinum|grafite|azul|dinners|visa/.test(n)) return "cartao";
  if (/invest|renda|cdb|aplica|binance|bybit|\bxp\b|xm-|corretora|cripto/.test(n)) return "aplicacao";
  if (/caixinha|caixa\b/.test(n) && !n.includes("cef")) return "caixa";
  return "corrente";
}

/** Datas do Omie chegam como ISO em UTC ao meio-dia de Brasília (…T15:00:00Z) → o dia é o prefixo. */
export function _iso_dia(v: any): string {
  const s = v === null || v === undefined || v === "" || v === false || v === 0 ? "" : pstr(v);
  return /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : "";
}

/** "[SG]Conciliado" e "[SG]Conciliado (bloqueado)" sim; "[SR]Não Conciliado", "Atrasado" etc. não. */
export function situacao_conciliada(sit: any): boolean {
  return (sit ? pstr(sit) : "").replace(/^\[\w+\]/, "").trim().startsWith("Conciliado");
}

const ou = (v: any, def: any) => (v === null || v === undefined || v === "" || v === 0 || v === false ? def : v);

/** Linha da grade do Omie → o mesmo formato que a importação da API usa. */
function _linha_web(x: any) {
  const orig = pstr(ou(x.DESCR_ORIG, ""));
  const doc = d.so_digitos(pstr(ou(x.CGC, "")));
  const nome = pstr(ou(x.RAZAO, ou(x.NOME, ""))).trim();
  return {
    nCodLancamento: `${pstr(x.CHAVE)}.${pstr(ou(x.REG_EXTR, 0))}`, dDataLancamento: _iso_dia(x.DATA_PAGA),
    nValorDocumento: ou(x.VALOR_DOC, 0), cNatureza: pstr(ou(x.TIP, "")),
    cOrigem: orig.startsWith("Débito de Transf") ? "TRAP" : (orig.startsWith("Crédito de Transf") ? "TRAR" : cortar(orig, 20)),
    cCodCategoria: pstr(ou(x.COD_PAG, "")), cDesCategoria: pstr(ou(x.DESCR_PAG, "")),
    nCodCliente: doc ? "doc:" + doc : (nome ? "nome:" + nome.toUpperCase() : null),
    cRazCliente: nome, cDocCliente: doc, cObservacoes: pstr(ou(x.OBS, "")).trim(),
    cNumero: pstr(ou(x.NUMERO, "")),
  };
}

async function _travar(cfg: any) {
  const lim = PyDate.now().addSeconds(60 * 60).isoformat(" ");
  const conn = await d.conexao_original();
  try {
    const cur = await conn.execute("UPDATE financas_api_config SET lock_ate = ? WHERE id = ? AND (lock_ate IS NULL OR lock_ate < ?)",
      [lim, cfg.id, agora()]);
    await conn.commit();
    if (cur.rowcount !== 1) throw new OmieErro("Já existe uma sincronização em andamento. Aguarde terminar.");
  } finally {
    await conn.close();
  }
}

/** Pacote do favorito: JSON compactado (gzip) em base64 de URL. */
export function ler_pacote(texto: any): any {
  let s = String(texto || "").trim().replace(/^#+/, "");
  s += "=".repeat((4 - (s.length % 4)) % 4);
  if (/[^A-Za-z0-9\-_=]/.test(s)) throw new OmieErro("Incorrect padding");
  const bruto = gunzipSync(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  const p = JSON.parse(bruto.toString("utf-8"));
  if (!p || typeof p !== "object" || Array.isArray(p) || !("F" in p) || !("rows" in p)) throw new OmieErro("Pacote do Omie inválido.");
  const campos: string[] = p.F;
  p.linhas = (p.rows as any[]).map((r) => {
    const o: Record<string, any> = {};
    for (let i = 0; i < Math.min(campos.length, r.length); i++) o[campos[i]] = r[i];
    return o;
  });
  return p;
}

/** Importa as linhas lidas da tela do Omie. Mesmas regras da API: só o conciliado, sem duplicar,
 *  atualiza o que mudou e remove o que deixou de estar conciliado no período lido. */
export async function importar_web(slug: string, pacote: any, origem = "navegador") {
  const cfg = await config(slug);
  await _travar(cfg);
  _rodando.add(slug);
  const log_id = await d.ex("INSERT INTO financas_api_log (empresa_slug, provedor, inicio, origem, status, resumo) VALUES (?, 'omie', ?, ?, 'rodando', '')",
    [slug, agora(), origem]);
  await d.ex("UPDATE financas_api_config SET status = 'rodando', mensagem = 'Importando os dados lidos do Omie…' WHERE id = ?", [cfg.id]);
  const cont: Record<string, number> = { ...novaContagem(), saldos_iniciais: 0 };
  let status = "ok", msg = "";
  const amostras: any[] = [];
  // uma conexão só para a importação inteira (commit em blocos, não a cada comando)
  const conn = await d.conexao_original();
  try {
    await d.comConexaoUnica(conn, async () => {
      try {
        const linhas: any[] = pacote.linhas;
        const datas = linhas.map((x) => _iso_dia(x.DATA_PAGA)).filter((x) => x).sort();
        const ini = _data_br(pacote.de ?? null) || (datas.length ? PyDate.fromisoformat(datas[0]) : PyDate.today());
        const fim = _data_br(pacote.ate ?? null) || (datas.length ? PyDate.fromisoformat(datas[datas.length - 1]) : PyDate.today());
        const todas = pstr(ou(pacote.filtro, "")).toLowerCase().includes("todas");
        const numeros = new Map<string, any>();
        for (const c of ou(pacote.contas, [])) numeros.set(pstr(ou(c.nome, "")).trim().toLowerCase(), c);
        const caches = { pessoa: new Map(), categoria: new Map() };
        const contas_map = new Map(), vistos = new Set<string>(), contas_lidas = new Map<string, any>();
        // só entram as contas com algo a importar (lançamento conciliado ou saldo inicial diferente de zero)
        const uteis = new Set(linhas.filter((x) => situacao_conciliada(x.SITUACAO)
          || (x.NOME === "Saldo Inicial" && Math.abs(_num(x.VALOR_DOC)) >= 0.005)).map((x) => pstr(x.ID_CONTA)));
        const ordenadas = d.ordenar([...linhas], (r) => [_iso_dia(r.DATA_PAGA), pstr(r.CHAVE)]);
        for (const [i, x] of ordenadas.entries()) {
          const cc = pstr(ou(x.ID_CONTA, ""));
          if (!cc || cc === "0" || !uteis.has(cc)) continue;
          if (!contas_lidas.has(cc)) {
            const nome = pstr(ou(x.DESCR_CC, "Conta Omie")).trim();
            const tipo = tipo_conta_erp(nome);
            const n = numeros.get(nome.toLowerCase()) || {};
            const info = {
              id: cc, nome, banco: "", agencia: pstr(ou(n.ag, "")),
              numero: tipo !== "cartao" ? pstr(ou(n.conta, "")) : "", tipo: "", inativa: false, tipo_erp: tipo,
            };
            await gravar_mapa(slug, "conta_omie", cc, null, null, info);
            contas_lidas.set(cc, await _conta_local(slug, cfg, info, contas_map));
            if (contas_lidas.get(cc)) cont.contas += 1;
          }
          const conta_id = contas_lidas.get(cc);
          if (!conta_id) continue;
          if (x.NOME === "Saldo Inicial" && !x.SITUACAO) {
            const dia = _iso_dia(x.DATA_PAGA);
            if (dia && dia >= ini.isoformat()) { // o período lido começa antes do saldo inicial → vale
              await d.ex("UPDATE financas_contas SET saldo_inicial = ?, data_saldo_inicial = ? WHERE id = ?",
                [_cent(x.VALOR_DOC), dia, conta_id]);
              const mpc = await mapa(slug, "conta", cc);
              const infoc = mpc ? jsonCarregar(mpc.info) : {};
              await gravar_mapa(slug, "conta", cc, conta_id, null, { ...infoc, saldo_ajustado: true, saldo: x.VALOR_DOC ?? null });
              cont.saldos_iniciais += 1;
            }
            continue;
          }
          if (!situacao_conciliada(x.SITUACAO)) { cont.nao_conciliadas += 1; continue; }
          const ext = await _importar_linha(slug, conta_id, cc, _linha_web(x), caches, cont);
          if (ext) vistos.add(ext);
          if (i % 250 === 0) {
            await conn.commit();
            await d.ex("UPDATE financas_api_config SET mensagem = ? WHERE id = ?",
              [`Importando os dados lidos do Omie… ${i} de ${linhas.length} linha(s)`, cfg.id]);
            await conn.commit();
          }
        }
        // removidos: o que foi importado no período lido (das contas lidas) e não veio mais conciliado
        const escopo = todas ? null : new Set(contas_lidas.keys());
        for (const mp of await d.q("SELECT * FROM financas_api_map WHERE empresa_slug = ? AND provedor = 'omie' AND tipo = 'extrato' ORDER BY id", [slug])) {
          const cc = String(mp.externo_id).split(":")[0];
          if (escopo !== null && !escopo.has(cc)) continue;
          const inf = jsonCarregar(mp.info);
          const dt = inf.data ?? "";
          if (ini.isoformat() <= dt && dt <= fim.isoformat() && !vistos.has(mp.externo_id)) {
            await _remover_importado(mp);
            cont.removidos += 1;
          }
        }
        await conn.commit();
        msg = `Pelo navegador: ${cont.novos} novo(s), ${cont.atualizados} atualizado(s), ${cont.removidos} removido(s) · `
          + `${cont.contas} conta(s) · período ${ini.strftime("%d/%m/%Y")} a ${fim.strftime("%d/%m/%Y")}`;
        if (pacote.conferencia && pacote.conferencia !== "ok") msg += ` · ATENÇÃO: conferência dos saldos ${pstr(pacote.conferencia)}`;
        if (pacote.saldo_atual) msg += ` · saldo no Omie ${pstr(pacote.saldo_atual)}`;
      } catch (exc: any) {
        await conn.rollback();
        status = "erro";
        msg = cortar(`Importação pelo navegador falhou: ${exc?.message ?? exc}`, 500);
        amostras.push({ erro: String(exc?.stack ?? exc).slice(-3000) });
      }
    });
  } finally {
    await conn.close();
    await d.ex("UPDATE financas_api_config SET status = ?, mensagem = ?, ultima_sync = ?, lock_ate = NULL WHERE id = ?",
      [status, msg, agora(), cfg.id]);
    await d.ex("UPDATE financas_api_log SET fim = ?, status = ?, resumo = ?, detalhe = ? WHERE id = ?",
      [agora(), status, msg, cortar(dumps({ contagem: cont, chamadas: amostras }), 60000), log_id]);
    _rodando.delete(slug);
  }
  return { status, mensagem: msg, ...cont };
}

export function importar_web_em_segundo_plano(slug: string, pacote: any) {
  void (async () => {
    try {
      await importar_web(slug, pacote);
    } catch (exc: any) {
      await d.ex("UPDATE financas_api_config SET status = 'erro', mensagem = ? WHERE empresa_slug = ? AND provedor = 'omie'",
        [cortar(String(exc?.message ?? exc), 500), slug]);
    }
  })().catch(console.error);
}

/** urllib.parse.quote(s, safe="") do Python. */
function quote(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Código do favorito (bookmarklet) com o endereço desta empresa no ERP. */
export function favorito_js(destino: string): string {
  let src = COLETOR_JS.replace(/\/\*[\s\S]*?\*\//g, "").split("__DESTINO__").join(destino);
  src = src.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/).map((l) => l.trim()).filter((l) => l).join("\n");
  return "javascript:" + quote(src);
}

// ───────────────────────── agendador (atualiza sozinho) ─────────────────────────
const _agendador = { iniciado: false };

async function _rodada() {
  try {
    for (const c of await d.q("SELECT * FROM financas_api_config WHERE ativo = 1 AND app_key <> '' AND app_secret <> ''")) {
      const vence = c.proxima_sync || "";
      if ((!vence || vence <= agora()) && !_rodando.has(c.empresa_slug)) {
        try {
          await sincronizar(c.empresa_slug, "automática");
        } catch (exc) {
          if (!(exc instanceof OmieErro)) throw exc;
        }
      }
    }
  } catch { /* o agendador nunca pode derrubar o app */ }
}

export function iniciar_agendador() {
  if (_agendador.iniciado) return;
  _agendador.iniciado = true;
  // Em ambiente serverless o processo pode não ficar vivo; aí a sincronização automática só roda
  // enquanto houver uma instância ativa (a manual funciona sempre).
  const laco = async () => {
    await _rodada();
    const t = setTimeout(laco, 120 * 1000);
    (t as any).unref?.();
  };
  const t0 = setTimeout(laco, 30 * 1000);
  (t0 as any).unref?.();
}

// ───────────────────────── telas (só administradores) ─────────────────────────
function _admin() {
  const u = g().portal_user;
  if (!u || !u.admin) abort(403);
}

export function registrar() {
  if (!process.env.ERP_SEM_AGENDADOR) iniciar_agendador();

  route("financas.cad_integracoes", "/financas/<slug>/cadastros/integracoes", ["GET", "POST"], async (slug: string) => {
    const e = await _empresa(slug);
    _admin();
    let cfg = await config(slug);
    const req = request();
    if (req.method === "POST") {
      _csrf();
      const f = req.form;
      const acao = f.get("acao", "salvar");
      const campos: Record<string, any> = {
        intervalo_horas: f.get("intervalo_horas", null, "int") || 6, janela_dias: Math.max(f.get("janela_dias", null, "int") || 0, 0),
        data_inicial: f.get("data_inicial") || cfg.data_inicial, ativo: f.get("ativo") === "1" ? 1 : 0,
        importar_clientes: f.get("importar_clientes") === "1" ? 1 : 0, criar_contas: f.get("criar_contas") === "1" ? 1 : 0,
      };
      if (f.get("app_key", "").trim()) campos.app_key = f.get("app_key").trim();
      if (f.get("app_secret", "").trim()) campos.app_secret = f.get("app_secret").trim();
      if (campos.data_inicial !== cfg.data_inicial) campos.carga_completa = 0; // mudou o começo do histórico → traz tudo de novo
      await d.ex("UPDATE financas_api_config SET " + Object.keys(campos).map((k) => `${k} = ?`).join(", ") + " WHERE id = ?", [...Object.values(campos), cfg.id]);
      // ligação das contas do Omie com as contas do ERP
      for (const [k, v] of f.items()) {
        if (!k.startsWith("conta_")) continue;
        const ext = k.slice(6);
        const mp = await mapa(slug, "conta", ext);
        const info = mp ? jsonCarregar(mp.info) : {};
        if (v === "") {
          if (mp) await d.ex("DELETE FROM financas_api_map WHERE id = ?", [mp.id]);
        } else {
          if (!/^\s*[-+]?\d+\s*$/.test(v)) throw new Error(`invalid literal for int() with base 10: '${v}'`);
          const novo = parseInt(v, 10);
          if (!mp || mp.local_id !== novo) info.saldo_ajustado = false;
          await gravar_mapa(slug, "conta", ext, novo, null, info);
        }
      }
      if (acao === "testar") {
        cfg = await config(slug);
        try {
          const om = new Omie(cfg.app_key, cfg.app_secret);
          const lista = (await om.contas()).map(conta_info);
          for (const i of lista) await gravar_mapa(slug, "conta_omie", i.id, null, null, i);
          flash(`Conexão com o Omie OK: ${lista.length} conta(s) corrente(s) encontrada(s). Confira a ligação das contas abaixo.`, "success");
          await d.ex("UPDATE financas_api_config SET status = 'ok', mensagem = ? WHERE id = ?",
            [`Conexão testada: ${lista.length} conta(s) corrente(s) no Omie.`, cfg.id]);
        } catch (exc: any) {
          if (!(exc instanceof OmieErro)) throw exc;
          await d.ex("UPDATE financas_api_config SET status = 'erro', mensagem = ? WHERE id = ?", [cortar(exc.message, 500), cfg.id]);
          flash("Não foi possível conectar ao Omie — veja o motivo abaixo.", "error");
        }
      } else if (acao === "reprocessar") {
        const de = _data_br(f.get("rep_de")), ate = _data_br(f.get("rep_ate"));
        if (!de || !ate || de.compare(ate) > 0) flash("Informe o período a reprocessar (data inicial e final).", "error");
        else if (_rodando.has(slug)) flash("Já existe uma sincronização em andamento.", "warning");
        else {
          sincronizar_em_segundo_plano(slug, "manual · reprocessar", null, [de, ate]);
          flash(`Reprocessando de ${de.strftime("%d/%m/%Y")} a ${ate.strftime("%d/%m/%Y")}. O resultado aparece no histórico.`, "success");
        }
      } else if (acao === "sincronizar" || acao === "completa") {
        if (_rodando.has(slug)) flash("Já existe uma sincronização em andamento.", "warning");
        else {
          sincronizar_em_segundo_plano(slug, "manual", acao === "completa" ? true : null);
          flash("Sincronização iniciada. Pode continuar usando o sistema — o resultado aparece aqui.", "success");
        }
      } else {
        flash("Configuração salva." + (campos.ativo ? " A atualização automática está ligada." : ""), "success");
      }
      return redirect(url_for("financas.cad_integracoes", { slug }));
    }
    const contas_omie = (await d.q(`SELECT * FROM financas_api_map WHERE empresa_slug = ? AND provedor = 'omie'
                                                                  AND tipo = 'conta_omie' ORDER BY externo_id`, [slug])).map((m: any) => jsonCarregar(m.info));
    const ligadas = new Map<string, any>();
    for (const m of await d.q("SELECT * FROM financas_api_map WHERE empresa_slug = ? AND tipo = 'conta' ORDER BY id", [slug])) ligadas.set(m.externo_id, m.local_id);
    for (const c of contas_omie) c.local_id = ligadas.get(pstr(c.id ?? null)) ?? null;
    const totais = await d.q(`SELECT COUNT(*) n, SUM(CASE WHEN local_id IS NULL THEN 1 ELSE 0 END) transf FROM financas_api_map
                    WHERE empresa_slug = ? AND provedor = 'omie' AND tipo = 'extrato'`, [slug], true);
    const logs = await d.q("SELECT * FROM financas_api_log WHERE empresa_slug = ? ORDER BY id DESC LIMIT 15", [slug]);
    for (const l of logs) l.det = jsonCarregar(l.detalhe);
    const destino = req.host_url.replace(/\/+$/, "") + url_for("financas.cad_integracoes_web", { slug });
    const hoje = PyDate.today();
    return render_template("financas/cad_integracoes.html", {
      ...(await _ctx(e, "cad_integracoes")), cfg, contas_omie,
      favorito: favorito_js(destino),
      contas: await d.contas(slug), mascarar, INTERVALOS, logs, totais,
      rep_de: hoje.replace({ day: 1 }).addDays(-1).replace({ day: 1 }).isoformat(),
      rodando: _rodando.has(slug) || (cfg.status === "rodando" && (cfg.lock_ate || "") > agora()),
    });
  });

  get("financas.cad_integracoes_status", "/financas/<slug>/cadastros/integracoes/status", async (slug: string) => {
    await _empresa(slug);
    _admin();
    const c = await config(slug);
    return jsonify({ mensagem: c.mensagem, rodando: _rodando.has(slug), status: c.status, ultima: c.ultima_sync });
  });

  /** Recebe o pacote lido no Omie pelo favorito (vem no endereço, depois do #, e esta página o envia). */
  route("financas.cad_integracoes_web", "/financas/<slug>/cadastros/integracoes/omie-web", ["GET", "POST"], async (slug: string) => {
    const e = await _empresa(slug);
    _admin();
    const req = request();
    if (req.method === "POST") {
      _csrf();
      let pacote: any;
      try {
        pacote = ler_pacote(req.form.get("pacote"));
      } catch (exc: any) {
        return [jsonify({ erro: `Não consegui ler os dados do Omie (${exc?.message ?? exc}). Use o favorito de novo.`, ok: false }), 400];
      }
      const cfg = await config(slug);
      if (_rodando.has(slug) || (cfg.status === "rodando" && (cfg.lock_ate || "") > agora())) {
        return [jsonify({ erro: "Já existe uma importação em andamento. Aguarde terminar.", ok: false }), 409];
      }
      await d.ex("UPDATE financas_api_config SET status = 'rodando', mensagem = 'Importando os dados lidos do Omie…' WHERE id = ?", [cfg.id]);
      importar_web_em_segundo_plano(slug, pacote);
      const contas = Array.from(new Set((pacote.linhas as any[]).filter((x) => x.DESCR_CC).map((x) => pstr(x.DESCR_CC)))).sort(d.cmpTexto);
      return jsonify({
        ate: pacote.ate ?? null, contas, de: pacote.de ?? null, empresa: pacote.empresa ?? null, filtro: pacote.filtro ?? null,
        linhas: pacote.linhas.length, ok: true, saldo: pacote.saldo_atual ?? null, total: pacote.total ?? null,
      });
    }
    return render_template("financas/cad_integracoes_web.html", await _ctx(e, "cad_integracoes"));
  });
}
