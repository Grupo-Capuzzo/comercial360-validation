/* eslint-disable @typescript-eslint/no-explicit-any */
// Consulta de CPF/CNPJ para o cadastro de clientes e fornecedores (porte de financas/consulta_doc.py).
//
// CNPJ → dados públicos da Receita Federal por serviços gratuitos (BrasilAPI → CNPJ.ws → ReceitaWS).
// CPF  → a Receita não divulga dados de pessoa física; valida os dígitos e procura nos cadastros do app.
import * as d from "./dados";

const TIMEOUT = 8;

export function so_digitos(s: any): string {
  return String(s ?? "").replace(/\D/g, "");
}

export function cpf_valido(cpf: any): boolean {
  const c = so_digitos(cpf);
  if (c.length !== 11 || c === c[0].repeat(11)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(c[n])) return false;
  }
  return true;
}

export function cnpj_valido(cnpj: any): boolean {
  const c = so_digitos(cnpj);
  if (c.length !== 14 || c === c[0].repeat(14)) return false;
  for (const tam of [12, 13]) {
    const pesos: number[] = [];
    for (let x = tam - 7; x > 1; x--) pesos.push(x);
    for (let x = 9; x > 1; x--) pesos.push(x);
    let soma = 0;
    for (let i = 0; i < tam; i++) soma += Number(c[i]) * pesos[i];
    const dv = 11 - (soma % 11);
    if ((dv >= 10 ? 0 : dv) !== Number(c[tam])) return false;
  }
  return true;
}

export function fmt_doc(doc: any): string {
  const c = so_digitos(doc);
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  if (c.length === 14) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  return doc || "";
}

export function fmt_cep(cep: any): string {
  const c = so_digitos(cep);
  return c.length === 8 ? `${c.slice(0, 5)}-${c.slice(5)}` : (cep || "");
}

export function fmt_fone(ddd_num: any): string {
  const c = so_digitos(ddd_num);
  if (c.length === 10) return `(${c.slice(0, 2)}) ${c.slice(2, 6)}-${c.slice(6)}`;
  if (c.length === 11) return `(${c.slice(0, 2)}) ${c.slice(2, 7)}-${c.slice(7)}`;
  return ddd_num || "";
}

class HttpErroConsulta extends Error { constructor(public code: number) { super(`HTTP Error ${code}`); } }

async function _get(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT * 1000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "GrupoCapuzzo-ERP/1.0", Accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new HttpErroConsulta(r.status);
    return JSON.parse(await r.text());
  } finally {
    clearTimeout(t);
  }
}

/** 'RUA DAS FLORES' → 'Rua das Flores' (mantém siglas curtas como DF, SP). */
function _titulo(s: any): string {
  s = String(s ?? "").trim();
  if (!s) return "";
  const minus = new Set(["de", "da", "do", "das", "dos", "e"]);
  const out: string[] = [];
  s.toLowerCase().split(/\s+/).forEach((p: string, i: number) => {
    if (minus.has(p) && i) out.push(p);
    else if (p.length <= 2 && /^\p{L}+$/u.test(p) && !minus.has(p)) out.push(p.toUpperCase());
    else out.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  });
  return out.join(" ");
}

// ── leitores de cada serviço → formato único ──
function _de_brasilapi(j: any) {
  const tel = j.ddd_telefone_1 || "";
  const tipo_log = String(j.descricao_tipo_de_logradouro || "").trim();
  let logr = String(j.logradouro || "").trim();
  if (tipo_log && !logr.toUpperCase().startsWith(tipo_log.toUpperCase())) logr = `${tipo_log} ${logr}`;
  return {
    nome: j.razao_social, nome_fantasia: j.nome_fantasia, logradouro: logr,
    numero: j.numero, complemento: j.complemento, bairro: j.bairro,
    cidade: j.municipio, uf: j.uf, cep: j.cep, telefone: tel,
    email: j.email, situacao: j.descricao_situacao_cadastral,
    atividade: j.cnae_fiscal_descricao,
  };
}

function _de_cnpjws(j: any) {
  const e = j.estabelecimento || {};
  const tel = (e.ddd1 || "") + (e.telefone1 || "");
  const logr = [e.tipo_logradouro || "", e.logradouro || ""].filter((x: string) => x).join(" ");
  return {
    nome: j.razao_social, nome_fantasia: e.nome_fantasia, logradouro: logr,
    numero: e.numero, complemento: e.complemento, bairro: e.bairro,
    cidade: (e.cidade || {}).nome, uf: (e.estado || {}).sigla, cep: e.cep,
    telefone: tel, email: e.email, situacao: e.situacao_cadastral,
    atividade: (e.atividade_principal || {}).descricao,
  };
}

function _de_receitaws(j: any) {
  if (j.status === "ERROR") throw new Error(j.message || "não encontrado");
  const ativ = ((j.atividade_principal && j.atividade_principal.length ? j.atividade_principal : [{}])[0] || {}).text;
  return {
    nome: j.nome, nome_fantasia: j.fantasia, logradouro: j.logradouro,
    numero: j.numero, complemento: j.complemento, bairro: j.bairro,
    cidade: j.municipio, uf: j.uf, cep: j.cep,
    telefone: String(j.telefone || "").split("/")[0], email: j.email, situacao: j.situacao,
    atividade: ativ,
  };
}

export const SERVICOS: [string, string, (j: any) => any][] = [
  ["BrasilAPI", "https://brasilapi.com.br/api/cnpj/v1/{}", _de_brasilapi],
  ["CNPJ.ws", "https://publica.cnpj.ws/cnpj/{}", _de_cnpjws],
  ["ReceitaWS", "https://receitaws.com.br/v1/cnpj/{}", _de_receitaws],
];

function pyStrSimples(v: any): string {
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

export function normalizar(bruto: Record<string, any>) {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(bruto)) r[k] = v !== null && v !== undefined ? pyStrSimples(v).trim() : "";
  r.nome = r.nome ? r.nome.toUpperCase() : "";
  r.nome_fantasia = r.nome_fantasia ? _titulo(r.nome_fantasia) : "";
  for (const k of ["logradouro", "bairro", "cidade", "complemento"]) r[k] = _titulo(r[k]);
  r.uf = r.uf.toUpperCase().slice(0, 2);
  r.cep = fmt_cep(r.cep);
  r.telefone = fmt_fone(r.telefone);
  r.email = r.email.toLowerCase();
  r.situacao = r.situacao.toUpperCase();
  return r;
}

export async function consultar_cnpj(cnpj: any): Promise<any> {
  const c = so_digitos(cnpj);
  const erros: string[] = [];
  for (const [nome, url, leitor] of SERVICOS) {
    try {
      return { ok: true, fonte: `Receita Federal (via ${nome})`, dados: normalizar(leitor(await _get(url.replace("{}", c)))) };
    } catch (exc: any) {
      if (exc instanceof HttpErroConsulta) {
        if (exc.code === 404) return { ok: false, msg: "CNPJ não encontrado na Receita Federal." };
        erros.push(`${nome}: HTTP ${exc.code}`);
      } else {
        erros.push(`${nome}: ${exc?.message ?? exc}`); // tenta o próximo serviço
      }
    }
  }
  console.warn("Consulta CNPJ %s falhou: %s", c, erros);
  return {
    ok: false, msg: "Não foi possível consultar a Receita agora (sem internet ou serviço fora do ar). "
      + "Preencha manualmente ou tente de novo em instantes.",
  };
}

/** Colunas da tabela clients (equivalente ao PRAGMA table_info). */
async function colunas_clients(): Promise<Set<string>> {
  return new Set((await d.q("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'clients'")).map((r: any) => r.name));
}

/** Procura o documento nos cadastros que o app já tem (clientes dos Condomínios e outras empresas). */
export async function consultar_local(slug: string, doc: any): Promise<any> {
  const c = so_digitos(doc);
  const p = await d.q("SELECT * FROM financas_pessoas WHERE documento = ? AND empresa_slug <> ? ORDER BY id DESC LIMIT 1", [c, slug], true);
  if (p) {
    const chaves = ["nome", "nome_fantasia", "email", "telefone", "cep", "logradouro", "numero",
      "complemento", "bairro", "cidade", "uf",
      ...d.PESSOAS_CAMPOS_EXTRAS.filter((x) => ["banco", "agencia", "conta", "titular", "pix"].some((pre) => x.startsWith(pre)))];
    const dados: Record<string, any> = {};
    for (const k of chaves) dados[k] = p[k] || "";
    return { fonte: "cadastro de outra empresa do Grupo", dados };
  }
  const cols = await colunas_clients();
  if (!cols.size) return null;
  const cl = await d.q("SELECT * FROM clients WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),'/','') = ? LIMIT 1", [c], true);
  if (!cl) return null;
  const g = (k: string) => {
    let v: any = cols.has(k) ? cl[k] : "";
    v = v === null || v === undefined ? "" : String(v).trim();
    return ["none", "null", "nan", "-"].includes(v.toLowerCase()) ? "" : v;
  };
  const banco_txt = g("bank_name");
  const achado = d.BANCOS.find(([, n]) => banco_txt && (n.toLowerCase().includes(banco_txt.toLowerCase()) || banco_txt.toLowerCase().includes(n.toLowerCase())));
  const cod = achado ? achado[0] : "";
  return {
    fonte: "cliente dos Condomínios", dados: {
      nome: g("full_name"), email: g("email").toLowerCase(), telefone: fmt_fone(g("phone")), cep: fmt_cep(g("address_zip")),
      logradouro: g("address_street"), bairro: g("address_district"), cidade: g("address_city"),
      uf: g("address_state"), banco_codigo: cod, banco_nome: banco_txt, agencia: g("bank_agency"),
      conta: g("bank_account"), conta_dv: g("bank_account_digit"),
      conta_tipo: ({ Corrente: "corrente", "Poupança": "poupanca" } as Record<string, string>)[g("bank_account_type")] ?? "",
      titular_nome: g("bank_holder_name"), titular_documento: g("bank_holder_document"),
      pix_chave: g("pix_key"),
    },
  };
}

export async function consultar(slug: string, doc: any): Promise<any> {
  const c = so_digitos(doc);
  if (c.length === 14) {
    if (!cnpj_valido(c)) return { ok: false, msg: "CNPJ inválido — confira os dígitos." };
    let r = await consultar_cnpj(c);
    const loc = await consultar_local(slug, c);
    if (loc) { // completa com dados bancários que já existam no app
      if (r.dados === undefined) r.dados = {};
      for (const [k, v] of Object.entries(loc.dados)) {
        if (v && !r.dados[k]) r.dados[k] = v;
      }
      if (!r.ok) r = { ok: true, fonte: loc.fonte, dados: loc.dados, aviso: r.msg ?? null };
    }
    return r;
  }
  if (c.length === 11) {
    if (!cpf_valido(c)) return { ok: false, msg: "CPF inválido — confira os dígitos." };
    const loc = await consultar_local(slug, c);
    if (loc) return { ok: true, fonte: loc.fonte, dados: loc.dados };
    return {
      ok: true, cpf_sem_dados: true, dados: {},
      msg: "CPF válido. A Receita não divulga dados de pessoa física — preencha os dados manualmente "
        + "(o CEP completa o endereço).",
    };
  }
  return { ok: false, msg: "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)." };
}
