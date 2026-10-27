/* eslint-disable @typescript-eslint/no-explicit-any */
// Contratos e Assinaturas — dados, regras e e-mails (porte de modulos/contratos/dados.py).
//
// Tabelas próprias (prefixo contratos_). Não altera tabelas existentes; as cotas
// (shares) só são lidas e, na ativação, atualizadas pela função oficial
// database.update_share (com registro na auditoria).
//
// Fluxo:
//   rascunho   → contrato gerado e já assinado pela empresa
//   aguardando → enviado ao e-mail do cliente, aguardando assinatura
//   assinado   → cliente assinou; cotas continuam PENDENTES até o depósito
//   concluido  → depósito confirmado; cotas ativadas
//   cancelado
import crypto from "node:crypto";

import { Conn, PyDate, g, getConnection, pyFormat, pyRound, render_template, request, toFixedPy } from "../../core/flask";
import * as db from "../../base/database";
import * as gm from "../../base/gmail_integration";
import { ASSETS } from "./assets";

/** logging.getLogger("contratos"): aceita o formato "%s" do Python. */
function fmtLog(a: any[]) { const [m, ...r] = a; let i = 0; return String(m).replace(/%s/g, () => String(r[i++])) + (r.length > i ? " " + r.slice(i).map(String).join(" ") : ""); }
export const logger = {
  warning: (...a: any[]) => console.warn("[contratos]", fmtLog(a)),
  exception: (...a: any[]) => console.error("[contratos]", fmtLog(a)),
};

// ─────────────────────────── catálogo ───────────────────────────
export const TIPOS: Record<string, string> = {
  aquisicao: "Termo de Aquisição de Cotas",
  retirada: "Termo de Retirada de Investimento",
  renovacao: "Termo de Renovação de Cotas",
};

// Textos de cada produto usados nos termos (conforme os termos assinados no D4Sign em 2026).
// O Saúde ainda não tinha termos de renovação/retirada: segue o padrão do Agronegócio.
export const PRODUTOS_DOC: Record<string, any> = {
  civil: {
    condominio: "CONDOMÍNIO PRIVADO DE INVESTIMENTOS",
    condominio_curto: "Condomínio de Investimentos",
    regulamento: "REGULAMENTO DO CONDOMÍNIO DE INVESTIMENTO PRIVADO FECHADO",
    rentabilidade: null, // usa a taxa do produto (ex.: 1,70% a.m.)
    tipo: "Pré-fixada", dia: 6, dia_extenso: "seis", dia_corte: 20,
    prazo_credito: "em até 3 (três) dias úteis",
  },
  agro: {
    condominio: "CONDOMÍNIO PRIVADO DO AGRONEGÓCIO",
    condominio_curto: "Condomínio de Investimentos do Agronegócio",
    regulamento: "REGULAMENTO DO CONDOMÍNIO DE INVESTIMENTO PRIVADO FECHADO DO AGRONEGÓCIO",
    rentabilidade: "Pré-fixada em 1,50% nos cinco primeiros meses e variável no sexto mês, entre 3,5% e 4,50%, "
      + "de acordo com o alcance dos cenários pessimista, realista ou otimista",
    tipo: "Mista", dia: 15, dia_extenso: "quinze", dia_corte: 20,
    prazo_credito: "em até 30 (trinta) dias",
  },
  saude: {
    condominio: "CONDOMÍNIO PRIVADO DA SAÚDE",
    condominio_curto: "Condomínio de Investimentos da Saúde",
    regulamento: "REGULAMENTO DO CONDOMÍNIO DE INVESTIMENTO PRIVADO FECHADO DA SAÚDE",
    rentabilidade: null,
    tipo: "Pré-fixada", dia: 20, dia_extenso: "vinte", dia_corte: 25,
    prazo_credito: "em até 30 (trinta) dias",
  },
};

// (tipo, código do condomínio) → modelo. No Python a chave é uma tupla; aqui um Map com chave "tipo|codigo"
// (use modelo(tipo, code) / temModelo). "anexo" null na aquisição = o regulamento desse produto ainda não foi
// cadastrado: o termo é gerado sem o anexo (liberado a pedido) e a tela do contrato avisa.
export const MODELOS = new Map<string, any>([
  ["aquisicao|civil", {
    termo: "contratos/doc/termo_aquisicao_civil.html",
    anexo: "contratos/doc/regulamento_civil_2026.html",
    anexo_nome: "Regulamento do Condomínio de Investimento Privado Fechado — Construção Civil (09/01/2026)",
    arquivo: "termo-aquisicao-civil",
  }],
  ["aquisicao|agro", {
    termo: "contratos/doc/termo_aquisicao_padrao.html", anexo: null,
    anexo_nome: "Regulamento do Condomínio de Investimento Privado Fechado do Agronegócio",
    arquivo: "termo-aquisicao-agro",
  }],
  ["aquisicao|saude", {
    termo: "contratos/doc/termo_aquisicao_padrao.html", anexo: null,
    anexo_nome: "Regulamento do Condomínio de Investimento Privado Fechado da Saúde",
    arquivo: "termo-aquisicao-saude",
  }],
]);
for (const cod of ["civil", "agro", "saude"]) {
  MODELOS.set(`renovacao|${cod}`, { termo: "contratos/doc/termo_renovacao.html", anexo: null, anexo_nome: "", arquivo: `termo-renovacao-${cod}` });
  MODELOS.set(`retirada|${cod}`, { termo: "contratos/doc/termo_retirada.html", anexo: null, anexo_nome: "", arquivo: `termo-retirada-${cod}` });
}
/** MODELOS.items() do Python: [[tipo, code], modelo]. */
export function modelos_itens(): [[string, string], any][] {
  return Array.from(MODELOS.entries()).map(([k, m]) => [k.split("|") as [string, string], m]);
}

export const NOMES_PRODUTO: Record<string, string> = { civil: "Construção Civil", saude: "Saúde", agro: "Agronegócio" };

// Depois que o cliente assina: aquisição espera o depósito; renovação e retirada já ficam concluídas
// (a renovação/retirada da cota é registrada quando o termo é gerado).
export const STATUS_CONCLUIDO: Record<string, string> = {
  aquisicao: "Concluído · cotas ativas", renovacao: "Concluído · renovação assinada",
  retirada: "Concluído · retirada assinada",
};

export const STATUS: Record<string, { nome: string; cor: string }> = {
  rascunho: { nome: "Aguardando envio", cor: "#a3a3a3" },
  aguardando: { nome: "Aguardando assinatura", cor: "#fbbf24" },
  assinado: { nome: "Assinado · aguarda depósito", cor: "#60a5fa" },
  concluido: { nome: "Concluído · cotas ativas", cor: "#4ade80" },
  cancelado: { nome: "Cancelado", cor: "#f87171" },
};

export const EVENTOS: Record<string, string> = {
  criado: "Documento criado",
  assinado_empresa: "Assinado pela empresa",
  enviado: "Enviado para assinatura",
  reenviado: "Reenviado para assinatura",
  visualizado: "Documento visualizado pelo cliente",
  codigo_enviado: "Código de verificação enviado",
  codigo_invalido: "Código de verificação incorreto",
  assinado_cliente: "Assinado pelo cliente",
  ativado: "Depósito confirmado e cotas ativadas",
  cancelado: "Contrato cancelado",
  aviso_cancelamento: "Cliente avisado do cancelamento",
  substitui: "Gerado em substituição a contrato cancelado",
  substituido: "Substituído por novo contrato",
  email_erro: "Falha no envio de e-mail",
};

export const CONFIG_PADRAO: Record<string, string> = {
  url_publica: "http://127.0.0.1:5000",
  empresa_nome: "CAPUZZO ASSESSORIA EMPRESARIAL LTDA",
  empresa_cnpj: "28.803.522/0001-40",
  empresa_endereco: "R. 25 Sul, 30 Bloco A, sala 110 - Águas Claras, Brasília - DF, 71927-180",
  empresa_assinante: "Capuzzo Assessoria Empresarial",
  empresa_email: "financeiro@capuzzoassessoria.com",
  cidade_assinatura: "Brasília-DF",
  testemunha1_nome: "Beatriz Alves de Sousa",
  testemunha1_cpf: "043.122.781-05",
  testemunha2_nome: "Fernando Ferreira dos Santos Silva",
  testemunha2_cpf: "066.672.451-25",
  email_copia: "financeiro@grupocapuzzo.com",
  envio_automatico: "0", // 1 = termos de renovação/retirada vão para o cliente assim que são gerados
  instrucoes_deposito: "",
};

export const CAMPOS_OBRIGATORIOS_CLIENTE: [string, string][] = [
  ["full_name", "nome completo"], ["cpf", "CPF/CNPJ"], ["email", "e-mail"],
  ["nationality", "nacionalidade"], ["marital_status", "estado civil"], ["profession", "profissão"],
  ["address_street", "endereço"], ["address_city", "cidade"], ["address_state", "UF"],
  ["address_zip", "CEP"],
];

export const CODIGO_VALIDADE_MIN = 15;
export const CODIGO_MAX_TENTATIVAS = 5;
export const CODIGO_INTERVALO_SEG = 45;

// preparar_banco(): as tabelas já existem no schema `erp` (não se aplica).
export function preparar_banco() { /* não se aplica online */ }

// ─────────────────────────── utilidades ───────────────────────────
export function agora() { return PyDate.now().strftime("%Y-%m-%d %H:%M:%S"); }

export function so_digitos(s: any) { return String(s ?? "").replace(/\D/g, ""); }

export function fmt_doc(doc: any) {
  const d = so_digitos(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return doc || "";
}

export function fmt_cep(cep: any) {
  const d = so_digitos(cep);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (cep || "");
}

export function valor_br(v: any) {
  const s = pyFormat("{:,.2f}", Number(v || 0));
  return s.replace(/,/g, "X").replace(/\./g, ",").replace(/X/g, ".");
}

export function moeda(v: any) { return "R$ " + valor_br(v); }

export function pct_br(taxa: any) { return toFixedPy(Number(taxa || 0) * 100, 2).replace(".", ",") + "% a.m."; }

export function data_br(s: any, com_hora = false) {
  if (!s) return "—";
  s = String(s);
  let dt: PyDate;
  try {
    dt = s.length > 10 ? PyDate.strptime(s.slice(0, 19), "%Y-%m-%d %H:%M:%S") : PyDate.strptime(s.slice(0, 10), "%Y-%m-%d");
  } catch { return s; }
  return dt.strftime(com_hora && s.length > 10 ? "%d/%m/%Y %H:%M:%S" : "%d/%m/%Y");
}

export const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO",
  "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

export function data_extenso(d: PyDate) { return `${d.day} DE ${MESES[d.month - 1]} DE ${d.year}`; }

const _UN_F = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze",
  "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const _DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const _CEN_F = ["", "cento", "duzentas", "trezentas", "quatrocentas", "quinhentas", "seiscentas", "setecentas",
  "oitocentas", "novecentas"];

/** Número por extenso no feminino (cotas): 1 → 'uma', 22 → 'vinte e duas'. */
export function extenso_feminino(n: any): string {
  n = Math.trunc(Number(n));
  if (n < 20) return _UN_F[n];
  if (n < 100) { const d = Math.floor(n / 10), u = n % 10; return _DEZ[d] + (u ? ` e ${_UN_F[u]}` : ""); }
  if (n === 100) return "cem";
  if (n < 1000) { const c = Math.floor(n / 100), r = n % 100; return _CEN_F[c] + (r ? ` e ${extenso_feminino(r)}` : ""); }
  const m = Math.floor(n / 1000), r = n % 1000;
  const pre = m === 1 ? "mil" : `${extenso_feminino(m)} mil`;
  return pre + (r ? (r < 100 || r % 100 === 0 ? " e " : " ") + extenso_feminino(r) : "");
}

const _UN_M = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
  "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const _CEN_M = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
  "oitocentos", "novecentos"];

function _extenso_m(n: number): string {
  if (n < 20) return _UN_M[n];
  if (n < 100) { const d = Math.floor(n / 10), u = n % 10; return _DEZ[d] + (u ? ` e ${_UN_M[u]}` : ""); }
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  return _CEN_M[c] + (r ? ` e ${_extenso_m(r)}` : "");
}

/** Inteiro por extenso no masculino (até bilhões). */
function _extenso_inteiro(n: number): string {
  if (n < 1000) return _extenso_m(n);
  const nomes: any[] = [null, ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const grupos: number[] = [];
  while (n) { grupos.push(n % 1000); n = Math.floor(n / 1000); }
  const partes: [number, string][] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const gr = grupos[i];
    if (!gr) continue;
    if (i === 0) partes.push([gr, _extenso_m(gr)]);
    else if (i === 1) partes.push([gr, gr === 1 ? "mil" : `${_extenso_m(gr)} mil`]);
    else partes.push([gr, `${_extenso_m(gr)} ${gr === 1 ? nomes[i][0] : nomes[i][1]}`]);
  }
  let out = partes[0][1];
  for (let k = 1; k < partes.length; k++) {
    const [gr, txt] = partes[k];
    const ultimo = k === partes.length - 1;
    out += (ultimo && (gr < 100 || gr % 100 === 0) ? " e " : " ") + txt;
  }
  return out;
}

/** 2000000 → 'dois milhões de reais'; 20000 → 'vinte mil reais'; 1500,50 → 'mil e quinhentos reais e cinquenta centavos'. */
export function extenso_reais(v: any) {
  const cent = pyRound(Number(v || 0) * 100);
  const r = Math.floor(cent / 100), c = cent % 100;
  let txt = "";
  if (r) {
    txt = _extenso_inteiro(r);
    txt += r % 1_000_000 === 0 && r >= 1_000_000 ? " de reais" : (r === 1 ? " real" : " reais");
  }
  if (c) txt += (txt ? " e " : "") + _extenso_m(c) + (c === 1 ? " centavo" : " centavos");
  return txt || "zero reais";
}

/** ['199','200','201'] → '199 a 201'; ['142','3.82','3.85'] → '142, 3.82 e 3.85'. */
export function faixa_cotas(numeros: any[]) {
  const nums = numeros.map((n) => String(n));
  if (nums.length > 2 && nums.every((n) => /^\d+$/.test(n))) {
    const v = nums.map((n) => parseInt(n, 10)).sort((a, b) => a - b);
    if (v.every((x, i) => x === v[0] + i)) return `${v[0]} a ${v[v.length - 1]}`;
  }
  return nums.length === 1 ? nums[0] : nums.slice(0, -1).join(", ") + " e " + nums[nums.length - 1];
}

export function somar_meses(d: PyDate, meses: number) {
  const m = d.month - 1 + meses;
  const ano = d.year + Math.floor(m / 12), mes = (((m % 12) + 12) % 12) + 1;
  const dias = [31, ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0) ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31][mes - 1];
  return new PyDate(ano, mes, Math.min(d.day, dias));
}

/** Regulamento, Art. 16: até 25 cotas → 6 meses; 26 ou mais → 12 meses. */
export function prazo_minimo_meses(qtd_cotas: any) { return Math.trunc(Number(qtd_cotas)) <= 25 ? 6 : 12; }

export function mascarar_email(e: any) {
  if (!e || !String(e).includes("@")) return e || "";
  const s = String(e);
  const i = s.indexOf("@");
  const u = s.slice(0, i), dom = s.slice(i + 1);
  return u.slice(0, 2) + "•".repeat(Math.max(1, [...u].length - 2)) + "@" + dom;
}

export function sha256(...partes: any[]) {
  const h = crypto.createHash("sha256");
  for (const p of partes) h.update(Buffer.from(String(p || ""), "utf8"));
  return h.digest("hex");
}

function _ip_ua(): [string, string] {
  let req;
  try { req = request(); } catch { return ["", ""]; }
  const ip = req.headers.get("CF-Connecting-IP") || (req.headers.get("X-Forwarded-For") || "").split(",")[0].trim()
    || req.remote_addr || "";
  return [ip, (req.headers.get("User-Agent") || "").slice(0, 300)];
}

function _usuario_nome(): string {
  let u: any = null;
  try { u = g().portal_user; } catch { u = null; }
  return (u || {}).nome || (u || {}).email || "sistema";
}

export function asset_data_uri(nome: string) {
  return "data:image/png;base64," + ASSETS[nome];
}

/** json.dumps do Python (separadores ", " e ": "; ensure_ascii=True escapa acentos como \\uXXXX). */
export function py_json(v: any, ensure_ascii = true): string {
  const s = (x: any): string => {
    if (x === null || x === undefined) return "null";
    if (x === true) return "true";
    if (x === false) return "false";
    if (typeof x === "number") return Number.isFinite(x) ? String(x) : (Number.isNaN(x) ? "NaN" : x > 0 ? "Infinity" : "-Infinity");
    if (typeof x === "string") {
      let t = JSON.stringify(x);
      if (ensure_ascii) t = t.replace(/[\u007f-￿]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
      return t;
    }
    if (x instanceof PyDate) return s(x.isoformat());
    if (Array.isArray(x)) return "[" + x.map(s).join(", ") + "]";
    if (x instanceof Set) return s(Array.from(x));
    return "{" + Object.entries(x).filter(([, y]) => y !== undefined).map(([k, y]) => s(k) + ": " + s(y)).join(", ") + "}";
  };
  return s(v);
}

// ─────────────────────────── configuração ───────────────────────────
export async function config(): Promise<Record<string, any>> {
  const conn = await getConnection();
  try {
    const rows: Record<string, any> = {};
    for (const r of (await conn.execute("SELECT chave, valor FROM contratos_config")).fetchall()) rows[r.chave] = r.valor;
    const out: Record<string, any> = { ...CONFIG_PADRAO };
    for (const [k, v] of Object.entries(rows)) if (v !== null && v !== undefined) out[k] = v;
    return out;
  } finally { await conn.close(); }
}

/** valores: MultiDict (request.form) ou objeto. */
export async function salvar_config(valores: any) {
  const tem = (k: string) => (typeof valores.has === "function" ? valores.has(k) : k in valores);
  const pega = (k: string) => (typeof valores.get === "function" ? valores.get(k) : valores[k]);
  const conn = await getConnection();
  try {
    for (const k of Object.keys(CONFIG_PADRAO)) {
      if (tem(k)) {
        let v = String(pega(k) || "").trim();
        if (k === "url_publica") v = v.replace(/\/+$/, "");
        await conn.execute("INSERT INTO contratos_config(chave, valor) VALUES(?,?) "
          + "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", [k, v]);
      }
    }
    await conn.commit();
  } finally { await conn.close(); }
}

// ─────────────────────────── consultas ───────────────────────────
function _row(r: any) {
  if (r === null || r === undefined) return null;
  const d = { ...r };
  if ("dados" in d && typeof d.dados === "string") d.dados = JSON.parse(d.dados || "{}");
  if ("share_ids" in d && typeof d.share_ids === "string") d.share_ids = JSON.parse(d.share_ids || "[]");
  return d;
}

export async function evento(contrato_id: number, tipo: string, descricao = "", conn: Conn | null = null) {
  const [ip, ua] = _ip_ua();
  const proprio = conn === null;
  const c = conn ?? await getConnection();
  try {
    await c.execute("INSERT INTO contratos_eventos(contrato_id, tipo, descricao, ip, user_agent, criado_em) "
      + "VALUES (?,?,?,?,?,?)", [contrato_id, tipo, descricao, ip, ua, agora()]);
    if (proprio) await c.commit();
  } finally {
    if (proprio) await c.close();
  }
}

export async function obter(cid: number): Promise<any> {
  const conn = await getConnection();
  try {
    const c: any = _row((await conn.execute(`SELECT ct.*, cl.full_name AS cliente_nome, cl.email AS cliente_email,
                                        cl.phone AS cliente_fone, cl.cpf AS cliente_cpf,
                                        cd.name AS produto_nome, cd.code AS produto_code
                                 FROM contratos ct JOIN clients cl ON cl.id = ct.client_id
                                 JOIN condominiums cd ON cd.id = ct.condominium_id WHERE ct.id = ?`, [cid])).fetchone());
    if (!c) return null;
    c.produto_nome = NOMES_PRODUTO[c.produto_code] ?? c.produto_nome;
    c.signatarios = (await conn.execute("SELECT * FROM contratos_signatarios WHERE contrato_id=? ORDER BY ordem", [cid])).fetchall();
    c.eventos = (await conn.execute("SELECT * FROM contratos_eventos WHERE contrato_id=? ORDER BY id", [cid])).fetchall();
    const ids: number[] = c.share_ids;
    const ph = ids.map(() => "?").join(",") || "NULL";
    // CAST(share_number AS INTEGER) do SQLite: no Postgres o texto não numérico daria erro → extrai o prefixo numérico
    c.cotas = (await conn.execute(
      `SELECT * FROM shares WHERE id IN (${ph}) ORDER BY ${CAST_NUM("share_number")}, share_number, id`, ids)).fetchall();
    return c;
  } finally { await conn.close(); }
}

/** Equivalente ao CAST(x AS INTEGER) do SQLite (prefixo numérico; texto sem número → 0). */
export function CAST_NUM(col: string) {
  return `COALESCE(NULLIF(substring(${col} from '^\\s*[-+]?\\d+'), '')::numeric, 0)`;
}

export async function obter_por_token(token: string) {
  if (!token || token.length < 20) return null;
  const conn = await getConnection();
  let r: any;
  try {
    r = (await conn.execute("SELECT id FROM contratos WHERE token = ?", [token])).fetchone();
  } finally { await conn.close(); }
  return r ? obter(r.id) : null;
}

export async function listar(status: string | null = null, q = "") {
  const conn = await getConnection();
  try {
    let sql = `SELECT ct.id, ct.codigo, ct.tipo, ct.status, ct.share_ids, ct.dados, ct.criado_em, ct.enviado_em,
                        ct.assinado_em, ct.concluido_em, cl.full_name AS cliente_nome, cl.cpf AS cliente_cpf,
                        cl.email AS cliente_email, cd.name AS produto_nome, cd.code AS produto_code,
                        (SELECT COUNT(*) FROM contratos_signatarios s WHERE s.contrato_id=ct.id AND s.status='assinado') AS assinaturas,
                        (SELECT COUNT(*) FROM contratos_signatarios s WHERE s.contrato_id=ct.id) AS signatarios,
                        (SELECT MAX(criado_em) FROM contratos_eventos e WHERE e.contrato_id=ct.id AND e.tipo='visualizado') AS visto_em
                 FROM contratos ct JOIN clients cl ON cl.id = ct.client_id
                 JOIN condominiums cd ON cd.id = ct.condominium_id WHERE 1=1`;
    const par: any[] = [];
    if (status) { sql += " AND ct.status = ?"; par.push(status); }
    if (q) {
      sql += " AND (cl.full_name LIKE ? OR cl.cpf LIKE ? OR ct.codigo LIKE ?)";
      par.push(`%${q}%`, `%${so_digitos(q) || q}%`, `%${q}%`);
    }
    sql += " ORDER BY ct.id DESC";
    const out = (await conn.execute(sql, par)).fetchall().map(_row) as any[];
    for (const r of out) r.produto_nome = NOMES_PRODUTO[r.produto_code] ?? r.produto_nome;
    return out;
  } finally { await conn.close(); }
}

export async function resumo() {
  const conn = await getConnection();
  try {
    const r: Record<string, number> = {};
    for (const s of Object.keys(STATUS)) r[s] = 0;
    for (const row of (await conn.execute("SELECT status, COUNT(*) n FROM contratos GROUP BY status")).fetchall()) r[row.status] = row.n;
    const mes = PyDate.today().strftime("%Y-%m");
    r.concluidos_mes = (await conn.execute(
      "SELECT COUNT(*) AS n FROM contratos WHERE status='concluido' AND substr(concluido_em,1,7)=?", [mes])).fetchone()!.n;
    return r;
  } finally { await conn.close(); }
}

/** Cotas pendentes que ainda não estão em um contrato ativo (não cancelado). */
export async function cotas_pendentes_sem_contrato(client_id: number | null = null) {
  const conn = await getConnection();
  try {
    const usadas = new Set<number>();
    for (const row of (await conn.execute("SELECT share_ids FROM contratos WHERE status != 'cancelado'")).fetchall()) {
      for (const x of JSON.parse(row.share_ids || "[]")) usadas.add(x);
    }
    let sql = `SELECT s.*, cd.name AS produto_nome, cd.code AS produto_code, cl.full_name AS cliente_nome
                 FROM shares s JOIN condominiums cd ON cd.id=s.condominium_id JOIN clients cl ON cl.id=s.client_id
                 WHERE s.status='pendente'`;
    const par: any[] = [];
    if (client_id) { sql += " AND s.client_id=?"; par.push(client_id); }
    sql += ` ORDER BY cl.full_name, cd.name, ${CAST_NUM("s.share_number")}, s.id`;
    return (await conn.execute(sql, par)).fetchall().filter((r) => !usadas.has(r.id));
  } finally { await conn.close(); }
}

export function pendencias_cliente(cliente: any) {
  const falta = CAMPOS_OBRIGATORIOS_CLIENTE.filter(([k]) => !String(cliente[k] || "").trim()).map(([, rot]) => rot);
  if (!String(cliente.pix_key || "").trim() && !String(cliente.bank_account || "").trim()) falta.push("chave PIX ou dados bancários");
  return falta;
}

// ─────────────────────────── geração ───────────────────────────
function _forma_pagamento(cl: any) {
  if (String(cl.pix_key || "").trim()) return `pela chave PIX: ${cl.pix_key.trim()}`;
  const partes = [cl.bank_name, cl.bank_agency ? `agência ${cl.bank_agency}` : "",
    (`conta ${(cl.bank_account_type || "").toLowerCase()} ${cl.bank_account || ""}`
      + `${cl.bank_account_digit ? "-" + cl.bank_account_digit : ""}`).replace(/ {2}/g, " ")];
  return "na conta bancária: " + partes.filter((p) => p && String(p).trim()).map((p) => String(p).trim()).join(", ");
}

export function montar_dados(cliente: any, cond: any, cotas: any[], cfg: any, hoje: PyDate | null = null) {
  hoje = hoje || PyDate.today();
  const qtd = cotas.length;
  const endereco = [
    String(cliente.address_street || "").trim(),
    String(cliente.address_district || "").trim(),
    [String(cliente.address_city || "").trim(), String(cliente.address_state || "").trim().toUpperCase()].filter((p) => p).join("-"),
  ].filter((p) => p).join(", ");
  return {
    investidor: {
      nome: String(cliente.full_name).trim(),
      nacionalidade: String(cliente.nationality || "brasileiro(a)").trim(),
      estado_civil: String(cliente.marital_status || "").trim(),
      profissao: String(cliente.profession || "").trim(),
      documento_tipo: so_digitos(cliente.cpf).length === 14 ? "CNPJ" : "CPF",
      documento: fmt_doc(cliente.cpf),
      endereco,
      cep: fmt_cep(cliente.address_zip),
      email: String(cliente.email || "").trim(),
      telefone: String(cliente.phone || "").trim(),
      pagamento: _forma_pagamento(cliente),
    } as any,
    produto: { nome: NOMES_PRODUTO[cond.code] ?? cond.name, codigo: cond.code },
    cotas: cotas.map((c) => ({ numero: c.share_number, valor: Number(c.share_value || 0) })),
    qtd,
    qtd_extenso: extenso_feminino(qtd).toUpperCase(),
    valor_total: cotas.reduce((s, c) => s + Number(c.share_value || 0), 0),
    rentabilidade: pct_br(cond.default_monthly_rate),
    dia_pagamento: Math.trunc(Number(cond.payment_day || 6)),
    prazo_meses: prazo_minimo_meses(qtd),
    tipo_cota: "Pré-fixada",
    local_data: `${cfg.cidade_assinatura}, ${data_extenso(hoje)}`,
    data_emissao: hoje.isoformat(),
    empresa: Object.fromEntries(["empresa_nome", "empresa_cnpj", "empresa_endereco", "empresa_assinante", "empresa_email"].map((k) => [k, cfg[k]])),
    testemunhas: [1, 2].filter((i) => cfg[`testemunha${i}_nome`]).map((i) => ({ nome: cfg[`testemunha${i}_nome`], cpf: cfg[`testemunha${i}_cpf`] })),
  } as Record<string, any>;
}

/** Gera Termo de Aquisição + Regulamento, já assinado pela empresa. Retorna o id do contrato. */
export async function criar_contrato_aquisicao(client_id: any, condominium_id: any, share_ids: any[]) {
  return criar_termo("aquisicao", client_id, condominium_id, share_ids);
}

/** ids de cotas que já estão num termo desse tipo ainda não concluído/cancelado. */
export async function cotas_em_termo_aberto(tipo: string) {
  const conn = await getConnection();
  try {
    const usadas = new Set<number>();
    for (const row of (await conn.execute("SELECT share_ids FROM contratos WHERE tipo=? AND status IN ('rascunho','aguardando','assinado')", [tipo])).fetchall()) {
      for (const x of JSON.parse(row.share_ids || "[]")) usadas.add(x);
    }
    return usadas;
  } finally { await conn.close(); }
}

export async function cotas_ativas_cliente(client_id: number, condominium_id: number) {
  const conn = await getConnection();
  try {
    return (await conn.execute(
      "SELECT * FROM shares WHERE client_id=? AND condominium_id=? AND status='ativa' "
      + `ORDER BY ${CAST_NUM("share_number")}, share_number, id`, [client_id, condominium_id])).fetchall();
  } finally { await conn.close(); }
}

/** int() do Python: aceita número ou texto inteiro; senão ValueError. */
function pyInt(v: any): number {
  if (typeof v === "number") return Math.trunc(v);
  const s = String(v ?? "").trim();
  if (!/^[-+]?\d+$/.test(s)) throw new ValueError(`invalid literal for int() with base 10: '${v}'`);
  return parseInt(s, 10);
}

/** Equivalente ao ValueError do Python (mensagem mostrada ao usuário). */
export class ValueError extends Error { name = "ValueError"; }
/** `except ValueError`: aceita esta classe e qualquer erro de nome "ValueError" (outros arquivos portados). */
export function ehValueError(e: any) { return e instanceof ValueError || e?.name === "ValueError" || e?.constructor?.name === "ValueError"; }

/** Gera o termo (aquisição, renovação ou retirada). Aquisição e renovação já saem assinadas pela empresa;
 *  a retirada é assinada só pelo investidor. Retorna o id do contrato. */
export async function criar_termo(tipo: string, client_id: any, condominium_id: any, share_ids_in: any[], extras: Record<string, any> | null = null) {
  extras = extras || {};
  if (!(tipo in TIPOS)) throw new ValueError("Tipo de termo inválido.");
  const share_ids = share_ids_in.map(pyInt);
  if (!share_ids.length) throw new ValueError("Selecione ao menos uma cota.");
  const cliente: any = await db.get_client_by_id(pyInt(client_id));
  if (!cliente) throw new ValueError("Cliente não encontrado.");
  const condId = pyInt(condominium_id);
  const cond: any = ((await db.get_condominiums()) as any[]).find((c) => c.id === condId) ?? null;
  if (!cond) throw new ValueError("Produto não encontrado.");
  const modelo = MODELOS.get(`${tipo}|${cond.code}`);
  if (!modelo) throw new ValueError(`Ainda não há modelo de ${TIPOS[tipo]} para ${cond.name}.`);
  const falta = pendencias_cliente(cliente);
  if (falta.length) throw new ValueError("complete o cadastro do cliente — falta: " + falta.join(", ") + ".");

  let livres: Map<number, any>, motivo: string;
  if (tipo === "aquisicao") {
    livres = new Map((await cotas_pendentes_sem_contrato(cliente.id)).map((c: any) => [c.id, c]));
    motivo = "não está pendente para este cliente ou já está em outro contrato";
  } else {
    const ocupadas = await cotas_em_termo_aberto(tipo);
    livres = new Map((await cotas_ativas_cliente(cliente.id, cond.id)).filter((c: any) => !ocupadas.has(c.id)).map((c: any) => [c.id, c]));
    motivo = `não está ativa para este cliente ou já está em outro ${TIPOS[tipo]} em andamento`;
  }
  const cotas: any[] = [];
  for (const sid of share_ids) {
    const c = livres.get(sid);
    if (!c) throw new ValueError(`A cota id ${sid} ${motivo}.`);
    if (c.condominium_id !== cond.id) throw new ValueError(`A cota ${c.share_number} é de outro produto.`);
    cotas.push(c);
  }
  cotas.sort((a, b) => {
    const sa = String(a.share_number), sb = String(b.share_number);
    return sa.length - sb.length || (sa < sb ? -1 : sa > sb ? 1 : 0);
  });

  const cfg = await config();
  const dados = montar_dados(cliente, cond, cotas, cfg);
  dados.tipo = tipo;
  dados.faixa = faixa_cotas(cotas.map((c) => c.share_number));
  const p = { ...(PRODUTOS_DOC[cond.code] ?? PRODUTOS_DOC.civil) };
  p.rentabilidade = p.rentabilidade || dados.rentabilidade;
  dados.produto_doc = p;
  if (tipo === "retirada") {
    const valor = Number(extras.valor || dados.valor_total);
    dados.retirada = { valor, valor_extenso: extenso_reais(valor), data_pedido: extras.data_pedido ?? "", data_efetiva: extras.data_efetiva ?? "" };
    dados.testemunhas = [];
  } else if (tipo === "renovacao") {
    dados.renovacao = { data: extras.data_renovacao ?? "", vencimento: extras.novo_vencimento ?? "" };
  }
  const html_termo = render_template(modelo.termo, { d: dados, p, cab: asset_data_uri("termo_cabecalho.png"), moeda, valor_br });
  const html_anexo = modelo.anexo ? render_template(modelo.anexo, {
    cab: asset_data_uri("regulamento_cabecalho.png"), marca: asset_data_uri("regulamento_marca.png"),
  }) : "";
  dados.anexo_nome = modelo.anexo ? modelo.anexo_nome : "";
  dados.sem_regulamento = tipo === "aquisicao" && !modelo.anexo; // liberado antes de o regulamento chegar
  dados.arquivo = `${modelo.arquivo}-${String(cliente.full_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  const agora_s = agora();
  const [ip, ua] = _ip_ua();
  const usuario = _usuario_nome();
  const resumo_val = tipo === "retirada" ? moeda(dados.retirada.valor) : moeda(dados.valor_total);

  const conn = await getConnection();
  let cid: number;
  try {
    const cur = await conn.execute(
      `INSERT INTO contratos (codigo, tipo, condominium_id, client_id, share_ids, dados, html_termo,
                   html_anexo, hash_original, token, status, criado_por, criado_em)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), tipo, cond.id, cliente.id, py_json(cotas.map((c) => c.id)),
        py_json(dados, false), html_termo, html_anexo, sha256(html_termo, html_anexo),
        crypto.randomBytes(32).toString("base64url"), "rascunho", usuario, agora_s]);
    cid = cur.lastrowid!;
    if (tipo !== "retirada") {
      await conn.execute(`INSERT INTO contratos_signatarios (contrato_id, papel, ordem, nome, email, cpf, status,
                                assinatura_tipo, assinatura_texto, ip, user_agent, verificacao, assinado_em)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [cid, "empresa", 1, cfg.empresa_nome, cfg.empresa_email, cfg.empresa_cnpj,
          "assinado", "texto", cfg.empresa_assinante, ip, ua, `Login no portal (${usuario})`, agora_s]);
    }
    await conn.execute(`INSERT INTO contratos_signatarios (contrato_id, papel, ordem, nome, email, cpf)
                        VALUES (?,?,?,?,?,?)`,
      [cid, "cliente", 2, String(cliente.full_name).trim(), String(cliente.email || "").trim(), fmt_doc(cliente.cpf)]);
    await evento(cid, "criado", `${TIPOS[tipo]} criado por ${usuario} · ${cotas.length} cota(s) · ${resumo_val}`, conn);
    if (tipo !== "retirada") {
      await evento(cid, "assinado_empresa", `${cfg.empresa_assinante} (${cfg.empresa_email}) — assinado por ${usuario}`, conn);
    }
    await conn.commit();
  } finally { await conn.close(); }
  return cid;
}

// ─────────────────────────── e-mail ───────────────────────────
function cabecalhoMime(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?b?${Buffer.from(s, "utf8").toString("base64")}?=`;
}
function base64Linhas(s: string) {
  return (Buffer.from(s, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Envia e-mail HTML pela conta Gmail já autenticada em Configurações. */
export async function enviar_email(para: string, assunto: string, html: string, texto: string, cc: string | null = null) {
  const token = await gm._get_valid_access_token();
  const fronteira = "===============" + crypto.randomBytes(10).toString("hex") + "==";
  const linhas = [`To: ${para}`];
  if (cc) linhas.push(`Cc: ${cc}`);
  linhas.push(`Subject: ${cabecalhoMime(assunto)}`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${fronteira}"`, "",
    `--${fronteira}`, 'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", base64Linhas(texto),
    `--${fronteira}`, 'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", base64Linhas(html),
    `--${fronteira}--`, "");
  const raw = Buffer.from(linhas.join("\r\n"), "utf8").toString("base64url");
  let resp: Response;
  try {
    resp = await fetch(gm.SEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (exc: any) {
    throw new Error(`Sem conexão com o Gmail: ${exc?.message ?? exc}`);
  }
  const corpo = await resp.text();
  if (!resp.ok) throw new Error(`Gmail recusou o envio (${resp.status}): ${corpo.slice(0, 300)}`);
  try { return JSON.parse(corpo).id ?? ""; } catch { return ""; }
}

/** Valor que aparece no termo: o da retirada ou o total das cotas. */
export function valor_doc(d: any) {
  return (d.retirada || {}).valor || d.valor_total || 0;
}

/** Link público de assinatura. Online a página fica fora do /erp, em /auth/contrato/<token>
 *  (o proxy do site deixa /auth/... abrir sem login); no app local era /contratos/assinar/<token>. */
export async function link_assinatura(c: any, cfg: any = null) {
  cfg = cfg || await config();
  return `${String(cfg.url_publica).replace(/\/+$/, "")}/auth/contrato/${c.token}`;
}

function _email(modelo: string, ctx: Record<string, any>) {
  return render_template(`contratos/email/${modelo}.html`, { TIPOS, ...ctx });
}

export async function enviar_para_assinatura(cid: number) {
  const c = await obter(cid);
  if (!c) throw new ValueError("Contrato não encontrado.");
  if (!["rascunho", "aguardando"].includes(c.status)) throw new ValueError("Este contrato não está aguardando assinatura.");
  const cli = c.signatarios.find((s: any) => s.papel === "cliente");
  if (!cli.email) throw new ValueError("O cliente não tem e-mail cadastrado.");
  const cfg = await config();
  const link = await link_assinatura(c, cfg);
  const d = c.dados;
  const assunto = `Assinatura pendente: ${TIPOS[c.tipo]} — ${d.produto.nome}`;
  const html = _email("convite", { c, d, link, cfg, moeda });
  const texto = `Olá, ${cli.nome}.\n\nA ${cfg.empresa_assinante} enviou o ${TIPOS[c.tipo]} `
    + `(${d.qtd} cota(s), ${moeda(valor_doc(d))})` + (c.html_anexo ? " e o Regulamento" : "")
    + " para sua assinatura eletrônica.\n\n"
    + `Acesse para ler e assinar: ${link}\n\nDúvidas: ${cfg.email_copia}`;
  await enviar_email(cli.email, assunto, html, texto);
  const reenvio = c.status === "aguardando";
  const conn = await getConnection();
  try {
    await conn.execute("UPDATE contratos SET status='aguardando', enviado_em=COALESCE(enviado_em, ?) WHERE id=?", [agora(), cid]);
    await evento(cid, reenvio ? "reenviado" : "enviado", `E-mail para ${cli.email}`, conn);
    await conn.commit();
  } finally { await conn.close(); }
  return link;
}

/** Quando o link é enviado por WhatsApp/cópia (sem e-mail). */
export async function marcar_enviado_manual(cid: number, canal: string) {
  const c = await obter(cid);
  if (!c || !["rascunho", "aguardando"].includes(c.status)) return;
  const conn = await getConnection();
  try {
    await conn.execute("UPDATE contratos SET status='aguardando', enviado_em=COALESCE(enviado_em, ?) WHERE id=?", [agora(), cid]);
    await evento(cid, "enviado", `Link compartilhado por ${canal}`, conn);
    await conn.commit();
  } finally { await conn.close(); }
}

// ─────────────────────────── assinatura do cliente ───────────────────────────
export async function registrar_visualizacao(c: any) {
  const ultimo = [...c.eventos].reverse().find((e: any) => e.tipo === "visualizado") ?? null;
  const [ip] = _ip_ua();
  if (ultimo && ultimo.ip === ip && String(ultimo.criado_em).slice(0, 13) === agora().slice(0, 13)) return; // evita repetir o mesmo acesso na mesma hora
  await evento(c.id, "visualizado", "Abriu o link de assinatura");
}

export async function enviar_codigo(c: any) {
  if (c.status !== "aguardando") throw new ValueError("Este documento não está disponível para assinatura.");
  const cli = c.signatarios.find((s: any) => s.papel === "cliente");
  const conn = await getConnection();
  let codigo: string;
  try {
    const ult = (await conn.execute("SELECT criado_em FROM contratos_codigos WHERE contrato_id=? ORDER BY id DESC LIMIT 1", [c.id])).fetchone();
    if (ult && PyDate.now().diffSeconds(PyDate.strptime(ult.criado_em, "%Y-%m-%d %H:%M:%S")) < CODIGO_INTERVALO_SEG) {
      throw new ValueError("Aguarde alguns segundos antes de pedir um novo código.");
    }
    codigo = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const agora_dt = PyDate.now();
    await conn.execute("UPDATE contratos_codigos SET usado=1 WHERE contrato_id=? AND usado=0", [c.id]);
    await conn.execute("INSERT INTO contratos_codigos(contrato_id, codigo_hash, criado_em, expira_em) VALUES(?,?,?,?)",
      [c.id, sha256(c.token, codigo), agora_dt.strftime("%Y-%m-%d %H:%M:%S"),
        agora_dt.addSeconds(CODIGO_VALIDADE_MIN * 60).strftime("%Y-%m-%d %H:%M:%S")]);
    await conn.commit();
  } finally { await conn.close(); }
  const cfg = await config();
  const html = _email("codigo", { c, codigo, cfg, validade: CODIGO_VALIDADE_MIN, nome: cli.nome });
  const texto = `Seu código para assinar o documento é: ${codigo}\nVálido por ${CODIGO_VALIDADE_MIN} minutos.\n`
    + "Se você não solicitou, ignore este e-mail.";
  await enviar_email(cli.email, `Código de verificação: ${codigo}`, html, texto);
  await evento(c.id, "codigo_enviado", `Para ${mascarar_email(cli.email)}`);
  return mascarar_email(cli.email);
}

async function _validar_codigo(c: any, codigo: string) {
  codigo = so_digitos(codigo);
  const conn = await getConnection();
  try {
    const r = (await conn.execute("SELECT * FROM contratos_codigos WHERE contrato_id=? AND usado=0 ORDER BY id DESC LIMIT 1", [c.id])).fetchone();
    if (!r) throw new ValueError("Peça um código de verificação para o seu e-mail.");
    if (r.expira_em < agora()) throw new ValueError("O código expirou. Peça um novo código.");
    if (r.tentativas >= CODIGO_MAX_TENTATIVAS) throw new ValueError("Muitas tentativas. Peça um novo código.");
    if (sha256(c.token, codigo) !== r.codigo_hash) {
      await conn.execute("UPDATE contratos_codigos SET tentativas=tentativas+1 WHERE id=?", [r.id]);
      await conn.commit();
      await evento(c.id, "codigo_invalido", `Tentativa ${r.tentativas + 1} de ${CODIGO_MAX_TENTATIVAS}`);
      throw new ValueError("Código incorreto.");
    }
    await conn.execute("UPDATE contratos_codigos SET usado=1 WHERE id=?", [r.id]);
    await conn.commit();
  } finally { await conn.close(); }
}

export async function assinar_cliente(c: any, cpf: string, codigo: string, tipo: string, imagem: string, texto_assinatura: string, aceite: boolean) {
  if (c.status !== "aguardando") throw new ValueError("Este documento não está disponível para assinatura.");
  const cli = c.signatarios.find((s: any) => s.papel === "cliente");
  if (!aceite) throw new ValueError("Confirme que leu e concorda com o termo" + (c.html_anexo ? " e o Regulamento." : "."));
  if (so_digitos(cpf) !== so_digitos(cli.cpf)) throw new ValueError("O CPF/CNPJ informado não confere com o do contrato.");
  if (tipo === "desenho") {
    if (!(imagem || "").startsWith("data:image/png;base64,") || imagem.length > 400_000 || imagem.length < 1500) {
      throw new ValueError("Desenhe sua assinatura no quadro.");
    }
    texto_assinatura = "";
  } else {
    tipo = "texto"; imagem = "";
    texto_assinatura = [...String(texto_assinatura || "").trim()].slice(0, 80).join("");
    if ([...texto_assinatura].length < 3) throw new ValueError("Digite seu nome para gerar a assinatura.");
  }
  await _validar_codigo(c, codigo);

  const [ip, ua] = _ip_ua();
  const momento = agora();
  const hash_final = sha256(c.hash_original, cli.cpf, momento, ip, imagem || texto_assinatura);
  const conn = await getConnection();
  try {
    await conn.execute(`UPDATE contratos_signatarios SET status='assinado', assinatura_tipo=?, assinatura_img=?,
                            assinatura_texto=?, ip=?, user_agent=?, verificacao=?, assinado_em=? WHERE id=?`,
      [tipo, imagem, texto_assinatura, ip, ua,
        `Código enviado para ${mascarar_email(cli.email)} + confirmação de ${fmt_doc(cli.cpf)}`, momento, cli.id]);
    if (c.tipo === "aquisicao") { // aquisição: aguarda o depósito para ativar as cotas
      await conn.execute("UPDATE contratos SET status='assinado', assinado_em=?, hash_final=? WHERE id=?", [momento, hash_final, c.id]);
    } else { // renovação/retirada: a cota já foi tratada ao gerar o termo
      await conn.execute("UPDATE contratos SET status='concluido', assinado_em=?, concluido_em=?, hash_final=? WHERE id=?",
        [momento, momento, hash_final, c.id]);
    }
    await evento(c.id, "assinado_cliente", `${cli.nome} (${cli.email}) — ${fmt_doc(cli.cpf)}`, conn);
    await conn.commit();
  } finally { await conn.close(); }

  // Comprovante por e-mail (falha no envio não desfaz a assinatura)
  try {
    const cfg = await config();
    const c2 = await obter(c.id);
    const link = await link_assinatura(c2, cfg);
    const html = _email("assinado", { c: c2, d: c2.dados, link, cfg, moeda });
    const texto = `Documento assinado com sucesso em ${data_br(momento, true)}.\n`
      + `Consulte ou baixe em: ${link}\n`;
    await enviar_email(cli.email, `Documento assinado: ${TIPOS[c.tipo]}`, html, texto, cfg.email_copia || null);
  } catch (exc: any) {
    logger.warning("Falha ao enviar comprovante de assinatura: %s", exc?.message ?? exc);
    await evento(c.id, "email_erro", `Comprovante: ${exc?.message ?? exc}`.slice(0, 300));
  }
}

// ─────────────────────────── ativação / cancelamento ───────────────────────────
/** datas: {share_id: [aquisicao_iso, vencimento_iso]} */
export async function ativar_cotas(cid: number, data_deposito: string, datas: Map<number, [string, string]>) {
  const c = await obter(cid);
  if (!c || c.status !== "assinado") throw new ValueError("Só é possível ativar cotas de contratos assinados pelo cliente.");
  try { PyDate.strptime(data_deposito, "%Y-%m-%d"); } catch { throw new ValueError("Informe a data do depósito."); }
  for (const cota of c.cotas) {
    const [aq, venc] = datas.get(cota.id) ?? ["", ""];
    if (!aq) throw new ValueError(`Informe a data de aquisição da cota ${cota.share_number}.`);
    await db.update_share(cota.id, { status: "ativa", acquisition_date: aq, maturity_date: venc || "" }, true);
  }
  const conn = await getConnection();
  try {
    await conn.execute("UPDATE contratos SET status='concluido', concluido_em=? WHERE id=?", [agora(), cid]);
    await evento(cid, "ativado", `Depósito em ${data_br(data_deposito)} · ${c.cotas.length} cota(s) ativada(s) `
      + `por ${_usuario_nome()}`, conn);
    await conn.commit();
  } finally { await conn.close(); }
}

/** Cancela o contrato: o link deixa de aceitar assinatura, os códigos pendentes são invalidados e
 *  o documento passa a exibir a marca CANCELADO. Assinaturas já feitas perdem a validade. */
export async function cancelar(cid: number, motivo: string, avisar_cliente = false, substituido_por: any = null) {
  const c = await obter(cid);
  if (!c || ["concluido", "cancelado"].includes(c.status)) throw new ValueError("Este contrato não pode ser cancelado.");
  motivo = [...String(motivo || "").trim()].slice(0, 300).join("");
  const conn = await getConnection();
  try {
    await conn.execute("UPDATE contratos SET status='cancelado', cancelado_em=?, motivo_cancelamento=? WHERE id=?", [agora(), motivo, cid]);
    await conn.execute("UPDATE contratos_codigos SET usado=1 WHERE contrato_id=?", [cid]);
    let desc = `Por ${_usuario_nome()}` + (motivo ? ` — ${motivo}` : "");
    if (c.status === "assinado") desc += " · assinatura do cliente invalidada";
    await evento(cid, "cancelado", desc, conn);
    await conn.commit();
  } finally { await conn.close(); }

  const cli = c.signatarios.find((s: any) => s.papel === "cliente");
  if (avisar_cliente && ["aguardando", "assinado"].includes(c.status) && cli.email) {
    try {
      const cfg = await config();
      const html = _email("cancelado", { c, d: c.dados, cfg, motivo, moeda, substituido: Boolean(substituido_por) });
      const texto = `Olá, ${cli.nome}.\n\nO ${TIPOS[c.tipo]} enviado anteriormente foi cancelado pela `
        + `${cfg.empresa_assinante} e não tem mais validade`
        + (substituido_por ? " — você receberá uma nova versão corrigida para assinar." : ".")
        + (motivo ? `\nMotivo: ${motivo}` : "") + `\n\nDúvidas: ${cfg.email_copia}`;
      await enviar_email(cli.email, `Documento cancelado: ${TIPOS[c.tipo]}`, html, texto);
      await evento(cid, "aviso_cancelamento", `E-mail para ${cli.email}`);
    } catch (exc: any) {
      logger.warning("Falha ao avisar cancelamento: %s", exc?.message ?? exc);
      await evento(cid, "email_erro", `Aviso de cancelamento: ${exc?.message ?? exc}`.slice(0, 300));
    }
  }
}

/** Cancela e gera um novo contrato com as mesmas cotas, relendo o cadastro atual do cliente
 *  (use depois de corrigir os dados). Retorna o id do novo contrato. */
export async function cancelar_e_gerar_novo(cid: number, motivo: string, avisar_cliente = false) {
  const c = await obter(cid);
  if (!c || ["concluido", "cancelado"].includes(c.status)) throw new ValueError("Este contrato não pode ser cancelado.");
  const falta = pendencias_cliente((await db.get_client_by_id(c.client_id)) || {});
  if (falta.length) throw new ValueError("Corrija o cadastro do cliente antes de gerar o novo contrato — falta: " + falta.join(", ") + ".");
  const esperado = c.tipo === "aquisicao" ? "pendente" : "ativa";
  const fora = c.cotas.filter((ct: any) => ct.status !== esperado).map((ct: any) => ct.share_number);
  if (fora.length) throw new ValueError(`As cotas ${fora.join(", ")} não estão mais ${esperado}s; gere o novo contrato manualmente.`);
  await cancelar(cid, motivo || "Correção de dados", avisar_cliente, true);
  const d0 = c.dados;
  const extras = {
    valor: (d0.retirada || {}).valor, data_pedido: (d0.retirada || {}).data_pedido,
    data_efetiva: (d0.retirada || {}).data_efetiva,
    data_renovacao: (d0.renovacao || {}).data, novo_vencimento: (d0.renovacao || {}).vencimento,
  };
  const novo_id = await criar_termo(c.tipo, c.client_id, c.condominium_id, c.share_ids, extras);
  await evento(novo_id, "substitui", `Substitui o contrato nº ${cid}` + (motivo ? ` — ${motivo}` : ""));
  await evento(cid, "substituido", `Substituído pelo contrato nº ${novo_id}`);
  return novo_id;
}

/** Apaga o contrato e todo o seu histórico (uso: contratos de teste ou gerados por engano).
 *  Contratos concluídos (cotas ativas) não podem ser apagados. Com excluir_cotas=true, apaga também
 *  as cotas PENDENTES do contrato pela função oficial database.delete_share (fica na auditoria). */
export async function excluir(cid: number, excluir_cotas = false): Promise<[string[], string[]]> {
  const c = await obter(cid);
  if (!c) throw new ValueError("Contrato não encontrado.");
  if (c.status === "concluido") throw new ValueError("Contrato concluído (cotas ativas) não pode ser apagado.");
  const conn = await getConnection();
  try {
    for (const t of ["contratos_codigos", "contratos_eventos", "contratos_signatarios"]) {
      await conn.execute(`DELETE FROM ${t} WHERE contrato_id=?`, [cid]);
    }
    await conn.execute("DELETE FROM contratos WHERE id=?", [cid]);
    await db._log(conn, "contratos", cid, "DELETE",
      py_json({ codigo: c.codigo, cliente: c.cliente_nome, status: c.status, cotas: c.cotas.map((x: any) => x.share_number) }, false),
      null, `Contrato apagado por ${_usuario_nome()}`);
    await conn.commit();
  } finally { await conn.close(); }
  const apagadas: string[] = [], mantidas: string[] = [];
  if (excluir_cotas) {
    for (const ct of c.cotas) {
      if (ct.status !== "pendente") { mantidas.push(ct.share_number); continue; }
      try {
        await db.delete_share(ct.id, `Cota pendente apagada junto com o contrato ${c.codigo}`);
        apagadas.push(ct.share_number);
      } catch (e: any) {
        if (ehValueError(e)) mantidas.push(ct.share_number);
        else throw e;
      }
    }
  }
  return [apagadas, mantidas];
}

/** Aquisição = data do depósito; vencimento = aquisição + prazo mínimo do termo. */
export function datas_sugeridas(c: any, data_deposito: string): [string, string] {
  let dep: PyDate;
  try { dep = PyDate.strptime(data_deposito, "%Y-%m-%d"); } catch { dep = PyDate.today(); }
  const venc = somar_meses(dep, Math.trunc(Number(c.dados.prazo_meses || 6)));
  return [dep.isoformat(), venc.isoformat()];
}
