/* eslint-disable @typescript-eslint/no-explicit-any */
// Banco de dados do módulo Finanças (porte de financas/dados.py): tabelas próprias (prefixo financas_),
// regras e cálculos. Valores em CENTAVOS (inteiros). Tudo separado por empresa (empresa_slug).
// As tabelas já existem no schema `erp` — preparar_banco/ESQUEMA não se aplicam aqui.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { Conn, PyDate, getConnection as conexaoNova, pyRound, ultimoDiaMes } from "../../core/flask";
import { apagarArquivo, salvarArquivo } from "../../core/arquivos";
import { ArquivoEnviado } from "../../core/http";

export const TIPOS_SALDO = ["corrente", "poupanca", "aplicacao", "caixa"]; // tipos que compõem o saldo do painel
export const TIPOS_CONTA: Record<string, string> = {
  corrente: "Conta corrente", poupanca: "Poupança", aplicacao: "Aplicação",
  caixa: "Caixa (dinheiro)", cartao: "Cartão de crédito", outros: "Outros",
};
export const TIPOS_PESSOA: Record<string, string> = { cliente: "Cliente", fornecedor: "Fornecedor", ambos: "Cliente e fornecedor" };
export const FORMAS = ["Pix", "Boleto", "Transferência", "Cartão de crédito", "Cartão de débito", "Dinheiro",
  "Débito automático", "Cheque", "Outros"];

// Grupos da DRE gerencial (ordem de apresentação)
export const GRUPOS_DRE: [string, string, string][] = [
  ["receita_bruta", "Receita bruta", "receita"],
  ["deducoes", "Deduções da receita (impostos sobre vendas)", "despesa"],
  ["custos", "Custos dos serviços / produtos", "despesa"],
  ["despesas_operacionais", "Despesas operacionais", "despesa"],
  ["pessoal", "Despesas com pessoal", "despesa"],
  ["receitas_financeiras", "Receitas financeiras", "receita"],
  ["despesas_financeiras", "Despesas financeiras", "despesa"],
  ["outras_receitas", "Outras receitas", "receita"],
  ["outras_despesas", "Outras despesas", "despesa"],
  ["impostos_lucro", "IRPJ e CSLL", "despesa"],
  ["investimentos", "Investimentos (não entra no resultado)", "despesa"],
];
export const NOME_GRUPO: Record<string, string> = Object.fromEntries(GRUPOS_DRE.map(([k, n]) => [k, n]));

// Plano de categorias inicial (inspirado no Conta Azul / Omie)
export const CATEGORIAS_PADRAO: [string, string, string[]][] = [
  ["receita", "receita_bruta", ["Venda de serviços", "Venda de produtos", "Honorários", "Mensalidades"]],
  ["receita", "receitas_financeiras", ["Rendimentos de aplicações", "Juros recebidos", "Descontos obtidos"]],
  ["receita", "outras_receitas", ["Reembolsos", "Outras receitas"]],
  ["despesa", "deducoes", ["Simples Nacional / DAS", "ISS", "PIS", "COFINS", "ICMS"]],
  ["despesa", "custos", ["Custo dos serviços prestados", "Compra de mercadorias", "Serviços de terceiros"]],
  ["despesa", "pessoal", ["Salários", "Pró-labore", "FGTS", "INSS", "Vale-transporte", "Vale-refeição",
    "Férias e 13º", "Benefícios"]],
  ["despesa", "despesas_operacionais", ["Aluguel", "Condomínio", "Energia elétrica", "Água", "Internet e telefone",
    "Softwares e sistemas", "Material de escritório", "Contabilidade",
    "Marketing e publicidade", "Combustível e deslocamento", "Manutenção",
    "Taxas e licenças"]],
  ["despesa", "despesas_financeiras", ["Tarifas bancárias", "Juros pagos", "Multas", "IOF"]],
  ["despesa", "outras_despesas", ["Outras despesas"]],
  ["despesa", "impostos_lucro", ["IRPJ", "CSLL"]],
  ["despesa", "investimentos", ["Equipamentos", "Móveis e utensílios", "Obras e reformas"]],
];

// ───────────────────────── conexão ─────────────────────────
// A importação pelo navegador (integracao_omie) usa UMA conexão para a importação inteira, com commit
// em blocos — como o `_local.conn` (threading.local) do Python. Aqui o equivalente é um AsyncLocalStorage:
// enquanto a importação roda, q/ex/criar_lancamentos... usam essa conexão e commit/close viram no-op.
const conexaoUnica = new AsyncLocalStorage<Conn>();

interface ConexaoLike {
  execute(sql: string, params?: any[]): Promise<any>;
  commit(): Promise<void>;
  close(): Promise<void>;
}
class _ConexaoUnica implements ConexaoLike {
  constructor(private c: Conn) {}
  execute(sql: string, params: any[] = []) { return this.c.execute(sql, params); }
  async commit() { /* no-op: o commit é feito pela importação */ }
  async close() { /* no-op */ }
}
export async function get_connection(): Promise<ConexaoLike> {
  const c = conexaoUnica.getStore();
  return c ? new _ConexaoUnica(c) : conexaoNova();
}
/** Roda `fn` com todas as funções deste módulo usando a conexão `conn`. */
export function comConexaoUnica<T>(conn: Conn, fn: () => Promise<T>): Promise<T> {
  return conexaoUnica.run(conn, fn);
}
/** Conexão nova, ignorando a conexão única (equivale ao `_conexao_original` do Python). */
export const conexao_original = conexaoNova;

// ───────────────────────── utilidades ─────────────────────────
export function agora_iso(): string {
  return PyDate.now().isoformat("T");
}

export function hoje(): PyDate {
  return PyDate.today();
}

/** datetime.now().strftime('%y%m%d%H%M%S%f') — usado como identificador de grupo de parcelas. */
export function carimbo_micro(): string {
  const n = PyDate.now();
  const us = String(new Date().getMilliseconds() * 1000 + Math.floor(Math.random() * 1000)).padStart(6, "0");
  return n.strftime("%y%m%d%H%M%S") + us;
}

export async function q(sql: string, params: any[] = [], um = false): Promise<any> {
  const conn = await get_connection();
  try {
    const linhas = (await conn.execute(sql, params)).fetchall();
    return um ? (linhas.length ? linhas[0] : null) : linhas;
  } finally {
    await conn.close();
  }
}

export async function ex(sql: string, params: any[] = []): Promise<any> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(sql, params);
    await conn.commit();
    return cur.lastrowid;
  } finally {
    await conn.close();
  }
}

// Campos acrescentados ao cadastro de clientes/fornecedores (endereço, dados da Receita e dados bancários).
export const PESSOAS_CAMPOS_EXTRAS = [
  "nome_fantasia", "cep", "logradouro", "numero", "complemento", "bairro", "situacao_receita", "atividade",
  "banco_codigo", "banco_nome", "agencia", "agencia_dv", "conta", "conta_dv", "conta_tipo",
  "titular_nome", "titular_documento", "pix_tipo", "pix_chave",
];

export const CONTA_TIPOS: Record<string, string> = { corrente: "Conta corrente", poupanca: "Poupança", pagamento: "Conta de pagamento", salario: "Conta salário" };
export const PIX_TIPOS: Record<string, string> = { cpf_cnpj: "CPF/CNPJ", email: "E-mail", telefone: "Telefone", aleatoria: "Chave aleatória" };
export const BANCOS: [string, string][] = [
  ["001", "Banco do Brasil"], ["003", "Banco da Amazônia"], ["004", "Banco do Nordeste"], ["033", "Santander"],
  ["037", "Banpará"], ["041", "Banrisul"], ["047", "Banese"], ["070", "BRB"], ["077", "Banco Inter"], ["085", "Ailos"],
  ["104", "Caixa Econômica Federal"], ["136", "Unicred"], ["197", "Stone"], ["208", "BTG Pactual"], ["212", "Banco Original"],
  ["237", "Bradesco"], ["260", "Nubank"], ["290", "PagBank (PagSeguro)"], ["318", "BMG"], ["323", "Mercado Pago"],
  ["336", "C6 Bank"], ["341", "Itaú Unibanco"], ["380", "PicPay"], ["389", "Mercantil do Brasil"], ["403", "Cora"],
  ["422", "Safra"], ["461", "Asaas"], ["623", "Banco Pan"], ["633", "Rendimento"], ["637", "Sofisa"],
  ["655", "Banco BV (Votorantim)"], ["707", "Daycoval"], ["745", "Citibank"], ["748", "Sicredi"], ["756", "Sicoob"],
];
export const NOME_BANCO: Record<string, string> = Object.fromEntries(BANCOS);

/** As tabelas já existem no Supabase (schema erp): nada a preparar. */
export async function preparar_banco() { /* não se aplica na versão online */ }

/** Na primeira vez que a empresa abre o Finanças, cria o plano de categorias padrão. */
export async function garantir_padroes(slug: string) {
  if ((await q("SELECT 1 FROM financas_categorias WHERE empresa_slug = ? LIMIT 1", [slug])).length) return;
  const conn = await get_connection();
  try {
    let ordem = 0;
    for (const [tipo, grupo, nomes] of CATEGORIAS_PADRAO) {
      for (const nome of nomes) {
        ordem += 1;
        await conn.execute("INSERT INTO financas_categorias (empresa_slug, tipo, nome, grupo_dre, ordem) VALUES (?, ?, ?, ?, ?)",
          [slug, tipo, nome, grupo, ordem]);
      }
    }
    await conn.execute("INSERT INTO financas_centros (empresa_slug, nome) VALUES (?, 'Geral')", [slug]);
    await conn.commit();
  } finally {
    await conn.close();
  }
}

/** '1.234,56' / '1234.56' / '1234' → 123456. Vazio ou inválido → null. */
export function para_centavos(texto: any): number | null {
  let s = String(texto || "").trim().split("R$").join("").split(" ").join("");
  if (!s) return null;
  const negativo = s.startsWith("-");
  s = s.replace(/^[-+]+/, "");
  if (s.includes(",")) s = s.split(".").join("").replace(/,/g, ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [inteiro, dec = ""] = s.split(".");
  const v = parseInt(inteiro, 10) * 100 + parseInt((dec + "00").slice(0, 2), 10);
  return negativo ? -v : v;
}

function milhar(n: number) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }

/** Valor do template: pode vir com kwargs do Jinja (último argumento com __keywords). */
function kw(args: any[]): [any[], Record<string, any>] {
  const u = args[args.length - 1];
  if (u && typeof u === "object" && Object.prototype.hasOwnProperty.call(u, "__keywords")) return [args.slice(0, -1), u];
  return [args, {}];
}

export function moeda(cent: any, ...resto: any[]): string {
  const [pos, k] = kw(resto);
  const sinal = k.sinal ?? pos[0] ?? false;
  const c = Math.trunc(Number(cent || 0));
  const neg = c < 0;
  const v = Math.abs(c);
  const txt = milhar(Math.floor(v / 100)) + "," + String(v % 100).padStart(2, "0");
  if (neg) return `-R$ ${txt}`;
  return sinal && c > 0 ? `+R$ ${txt}` : `R$ ${txt}`;
}

/** Centavos → texto para campo de formulário ('R$ 1.234,56'). */
export function valor_campo(cent: any): string {
  if (cent === null || cent === undefined || cent === "") return "";
  const c = Math.trunc(Number(cent));
  const inteiro = milhar(Math.floor(Math.abs(c) / 100));
  return `${c < 0 ? "-" : ""}R$ ${inteiro},${String(Math.abs(c) % 100).padStart(2, "0")}`;
}

export function data_br(iso: any): any {
  if (!iso) return "";
  const p = String(iso).slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

/** date.fromisoformat(str(texto)[:10]).isoformat() ou o padrão. */
export function data_valida(texto: any, padrao: any = null): any {
  if (texto === null || texto === undefined) return padrao;
  let s = String(texto).slice(0, 10);
  if (/^\d{8}$/.test(s)) s = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // Python 3.11+ aceita AAAAMMDD
  const d = PyDate.tryParse(s);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(s) ? d.date().isoformat() : padrao;
}

export function somar_meses(d: PyDate | string, n: number): PyDate {
  if (typeof d === "string") d = PyDate.fromisoformat(d);
  const m = d.month - 1 + n;
  const ano = d.year + Math.floor(m / 12);
  const mes = (((m % 12) + 12) % 12) + 1;
  return new PyDate(ano, mes, Math.min(d.day, ultimoDiaMes(ano, mes)));
}

export const MESES = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ───────────────────────── cadastros ─────────────────────────
/** Filtro SQL: tira lançamentos/baixas de contas marcadas como fora do sistema (considerada = 0). */
export function filtro_consideradas(alias = ""): string {
  return ` AND (${alias}conta_id IS NULL OR ${alias}conta_id NOT IN (SELECT id FROM financas_contas WHERE considerada = 0))`;
}

/** Contas da empresa. `so_ativas` já implica `so_consideradas`. */
export async function contas(slug: string, so_ativas = false, so_consideradas = false): Promise<any[]> {
  let cond = "";
  if (so_ativas) cond += " AND ativa = 1";
  if (so_ativas || so_consideradas) cond += " AND considerada = 1";
  const linhas = await q("SELECT * FROM financas_contas WHERE empresa_slug = ?" + cond +
    " ORDER BY considerada DESC, ativa DESC, nome", [slug]);
  const saldos = new Map<number, number>();
  for (const r of await q("SELECT conta_id, SUM(valor) AS s FROM financas_movimentos WHERE empresa_slug = ? GROUP BY conta_id", [slug])) {
    saldos.set(r.conta_id, r.s);
  }
  for (const c of linhas) c.saldo = c.saldo_inicial + (saldos.get(c.id) || 0);
  return linhas;
}

export async function saldo_conta_ate(conta: any, ate_iso: string): Promise<number> {
  const r = await q("SELECT COALESCE(SUM(valor), 0) AS s FROM financas_movimentos WHERE conta_id = ? AND data <= ?",
    [conta.id, ate_iso], true);
  return conta.saldo_inicial + r.s;
}

const ORDEM_GRUPO: Record<string, number> = Object.fromEntries(GRUPOS_DRE.map(([k], i) => [k, i]));

/** Compara chaves de ordenação no estilo Python (tuplas de bool/número/texto). */
export function cmpChave(a: any[], b: any[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = a[i], y = b[i];
    if (typeof x === "boolean") x = Number(x);
    if (typeof y === "boolean") y = Number(y);
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    const sx = String(x), sy = String(y);
    if (sx !== sy) return cmpTexto(sx, sy);
  }
  return a.length - b.length;
}
/** Comparação de texto por ponto de código (como o Python). */
export function cmpTexto(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (c) return c;
  }
  return x.length - y.length;
}
export function ordenar<T>(lista: T[], chave: (x: T) => any[], reverso = false): T[] {
  return lista.sort((a, b) => (reverso ? -1 : 1) * cmpChave(chave(a), chave(b)));
}

export async function categorias(slug: string, tipo: string | null = null, so_ativas = true): Promise<any[]> {
  let sql = "SELECT * FROM financas_categorias WHERE empresa_slug = ?";
  const p: any[] = [slug];
  if (tipo) { sql += " AND tipo = ?"; p.push(tipo); }
  if (so_ativas) sql += " AND ativo = 1";
  const linhas = await q(sql + " ORDER BY nome, id", p);
  return ordenar(linhas, (c) => [c.tipo !== "receita", ORDEM_GRUPO[c.grupo_dre] ?? 99, c.nome]);
}

export async function pessoas(slug: string, tipo: string | null = null, busca = "", so_ativos = true): Promise<any[]> {
  let sql = "SELECT * FROM financas_pessoas WHERE empresa_slug = ?";
  const p: any[] = [slug];
  if (tipo === "cliente") sql += " AND tipo IN ('cliente','ambos')";
  else if (tipo === "fornecedor") sql += " AND tipo IN ('fornecedor','ambos')";
  if (so_ativos) sql += " AND ativo = 1";
  if (busca) {
    sql += " AND (nome LIKE ? OR documento LIKE ? OR email LIKE ?)";
    p.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  return q(sql + " ORDER BY nome, id", p);
}

export async function centros(slug: string, so_ativos = true): Promise<any[]> {
  return q("SELECT * FROM financas_centros WHERE empresa_slug = ?" + (so_ativos ? " AND ativo = 1" : "") +
    " ORDER BY nome, id", [slug]);
}

export function so_digitos(s: any): string {
  return String(s || "").replace(/\D/g, "");
}

// ───────────────────────── lançamentos ─────────────────────────
function marcas(n: number) { return Array(n).fill("?").join(","); }

export async function pago_por_lancamento(ids: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 20000) {
    const b = ids.slice(i, i + 20000);
    for (const r of await q(
      `SELECT lancamento_id, SUM(valor) AS pago, SUM(juros) AS juros, SUM(desconto) AS desconto, MAX(data) AS ultima ` +
      `FROM financas_baixas WHERE lancamento_id IN (${marcas(b.length)}) GROUP BY lancamento_id`, b)) out.set(r.lancamento_id, r);
  }
  return out;
}

/** aberto | vencido | parcial | pago | cancelado.  'pago' considera desconto como quitação. */
export function situacao(l: any, pago: any, hoje_iso: string): string {
  if (l.cancelado) return "cancelado";
  const quitado = (pago.pago || 0) + (pago.desconto || 0) - (pago.juros || 0);
  if (quitado >= l.valor) return "pago";
  if ((pago.pago || 0) > 0) return l.vencimento >= hoje_iso ? "parcial" : "vencido";
  return l.vencimento < hoje_iso ? "vencido" : "aberto";
}

/** Acrescenta pago, saldo, situação e nomes aos lançamentos. */
export async function completar(lancs: any[], slug: string): Promise<any[]> {
  const hoje_iso = hoje().isoformat();
  const pagos = await pago_por_lancamento(lancs.map((l) => l.id));
  const nomes_p = new Map<number, string>((await q("SELECT id, nome FROM financas_pessoas WHERE empresa_slug = ?", [slug])).map((p: any) => [p.id, p.nome]));
  const nomes_c = new Map<number, any>((await q("SELECT id, nome, grupo_dre FROM financas_categorias WHERE empresa_slug = ?", [slug])).map((c: any) => [c.id, c]));
  const nomes_k = new Map<number, string>((await q("SELECT id, nome FROM financas_contas WHERE empresa_slug = ?", [slug])).map((c: any) => [c.id, c.nome]));
  const ids = lancs.map((l) => l.id);
  const rat = new Map<number, number>(), anx = new Map<number, number>();
  for (let i = 0; i < ids.length; i += 800) {
    const b = ids.slice(i, i + 800);
    const ph = marcas(b.length);
    for (const r of await q(`SELECT lancamento_id, COUNT(*) n FROM financas_rateios WHERE lancamento_id IN (${ph}) GROUP BY lancamento_id`, b)) rat.set(r.lancamento_id, r.n);
    for (const r of await q(`SELECT lancamento_id, COUNT(*) n FROM financas_anexos WHERE lancamento_id IN (${ph}) GROUP BY lancamento_id`, b)) anx.set(r.lancamento_id, r.n);
  }
  for (const l of lancs) {
    const p = pagos.get(l.id) ?? {};
    l.pago = p.pago || 0;
    l.juros = p.juros || 0;
    l.desconto = p.desconto || 0;
    l.ultima_baixa = p.ultima || "";
    l.saldo = Math.max(l.valor - l.pago - l.desconto + l.juros, 0);
    l.situacao = situacao(l, p, hoje_iso);
    l.pessoa_nome = nomes_p.get(l.pessoa_id) ?? "";
    const cat = nomes_c.get(l.categoria_id);
    l.categoria_nome = cat ? cat.nome : "";
    l.conta_nome = nomes_k.get(l.conta_id) ?? "";
    l.n_rateio = rat.get(l.id) ?? 0;
    l.n_anexos = anx.get(l.id) ?? 0;
    if (l.n_rateio > 1) l.categoria_nome = `${l.categoria_nome || "Rateio"} +${l.n_rateio - 1}`;
  }
  return lancs;
}

export const SITUACOES: Record<string, string> = {
  aberto: "Em aberto", vencido: "Vencido", parcial: "Pago parcial", pago: "Pago", cancelado: "Cancelado",
};

export async function listar_lancamentos(slug: string, tipo: string, de: string, ate: string, situacao_f = "", busca = "",
  categoria_id: number | null = null, pessoa_id: number | null = null, conta_id: number | null = null): Promise<any[]> {
  let sql = "SELECT * FROM financas_lancamentos WHERE empresa_slug = ? AND tipo = ? AND vencimento BETWEEN ? AND ?" + filtro_consideradas();
  const p: any[] = [slug, tipo, de, ate];
  if (busca) {
    sql += " AND (descricao LIKE ? OR documento LIKE ? OR pessoa_id IN (SELECT id FROM financas_pessoas WHERE nome LIKE ?))";
    p.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  if (categoria_id) {
    sql += " AND (categoria_id = ? OR id IN (SELECT lancamento_id FROM financas_rateios WHERE categoria_id = ?))";
    p.push(categoria_id, categoria_id);
  }
  if (pessoa_id) { sql += " AND pessoa_id = ?"; p.push(pessoa_id); }
  if (conta_id) { sql += " AND conta_id = ?"; p.push(conta_id); }
  let lancs = await completar(await q(sql + " ORDER BY vencimento, id", p), slug);
  if (situacao_f === "abertos") lancs = lancs.filter((l) => ["aberto", "vencido", "parcial"].includes(l.situacao));
  else if (situacao_f) lancs = lancs.filter((l) => l.situacao === situacao_f);
  else lancs = lancs.filter((l) => l.situacao !== "cancelado");
  return lancs;
}

/** Cria 1 lançamento, ou N parcelas (parcelamento) ou N meses (recorrência). */
export async function criar_lancamentos(slug: string, tipo: string, dados: any, uid: any): Promise<number[]> {
  const agora = agora_iso();
  const n = Math.max(1, Math.min(Math.trunc(Number(dados.parcelas || 1)), 120));
  const modo = dados.modo; // 'unico' | 'parcelado' | 'recorrente'
  const venc = PyDate.fromisoformat(dados.vencimento);
  const comp = PyDate.fromisoformat(dados.competencia);
  const grupo = n > 1 ? `g${carimbo_micro()}` : "";
  let valores = Array(n).fill(dados.valor);
  if (modo === "parcelado" && n > 1) { // divide o total em N parcelas (sobra de centavos na 1ª)
    const base = Math.floor(dados.valor / n);
    valores = Array(n).fill(base);
    valores[0] += dados.valor - base * n;
  }
  const ids: number[] = [];
  const conn = await get_connection();
  try {
    for (let i = 0; i < n; i++) {
      let desc = dados.descricao;
      if (n > 1 && modo === "parcelado") desc = `${desc} (${i + 1}/${n})`;
      const cur = await conn.execute(
        "INSERT INTO financas_lancamentos (empresa_slug, tipo, descricao, pessoa_id, categoria_id, centro_id, conta_id, " +
        "valor, competencia, vencimento, previsao, forma_pagamento, documento, obs, parcela, parcelas, grupo, criado_por, " +
        "criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [slug, tipo, desc, dados.pessoa_id ?? null, dados.categoria_id ?? null, dados.centro_id ?? null,
          dados.conta_id ?? null, valores[i], somar_meses(comp, i).isoformat(), somar_meses(venc, i).isoformat(),
          somar_meses(venc, i).isoformat(),
          dados.forma_pagamento ?? "", dados.documento ?? "", dados.obs ?? "",
          i + 1, n, grupo, uid, agora, agora]);
      ids.push(cur.lastrowid);
    }
    await conn.commit();
  } finally {
    await conn.close();
  }
  return ids;
}

/** Baixa (pagamento/recebimento) → grava a baixa e o movimento no extrato da conta. Retorna [baixa, movimento]. */
export async function registrar_baixa(slug: string, lanc: any, conta_id: any, data_iso: string, valor: number, juros: number,
  desconto: number, uid: any): Promise<[number, number]> {
  const agora = agora_iso();
  const sinal = lanc.tipo === "receber" ? 1 : -1;
  const efetivo = valor; // o valor que entrou/saiu da conta (já com juros e desconto)
  const conn = await get_connection();
  try {
    let cur = await conn.execute("INSERT INTO financas_baixas (lancamento_id, conta_id, data, valor, juros, desconto, criado_por, criado_em) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [lanc.id, conta_id, data_iso, valor, juros, desconto, uid, agora]);
    const bid = cur.lastrowid;
    cur = await conn.execute("INSERT INTO financas_movimentos (empresa_slug, conta_id, data, descricao, valor, origem, baixa_id, " +
      "categoria_id, pessoa_id, criado_por, criado_em) VALUES (?, ?, ?, ?, ?, 'baixa', ?, ?, ?, ?, ?)",
    [slug, conta_id, data_iso, lanc.descricao, sinal * efetivo, bid, lanc.categoria_id, lanc.pessoa_id, uid, agora]);
    await conn.execute("UPDATE financas_baixas SET movimento_id = ? WHERE id = ?", [cur.lastrowid, bid]);
    await conn.execute("UPDATE financas_lancamentos SET atualizado_em = ? WHERE id = ?", [agora, lanc.id]);
    await conn.commit();
    return [bid, cur.lastrowid];
  } finally {
    await conn.close();
  }
}

export async function estornar_baixa(baixa_id: number) {
  const b = await q("SELECT * FROM financas_baixas WHERE id = ?", [baixa_id], true);
  if (!b) return;
  const conn = await get_connection();
  try {
    if (b.movimento_id) {
      await conn.execute("UPDATE financas_extrato_importado SET status = 'pendente', movimento_id = NULL WHERE movimento_id = ?", [b.movimento_id]);
      await conn.execute("DELETE FROM financas_movimentos WHERE id = ?", [b.movimento_id]);
    }
    await conn.execute("DELETE FROM financas_baixas WHERE id = ?", [baixa_id]);
    await conn.commit();
  } finally {
    await conn.close();
  }
}

// ───────────────────────── extrato (OFX) ─────────────────────────
/** Lê um arquivo OFX (SGML ou XML) e devolve [{data, valor(cent), descricao, fitid}]. */
export function ler_ofx(conteudo: Uint8Array | string): any[] {
  const texto = typeof conteudo === "string" ? conteudo : Buffer.from(conteudo).toString("latin1");
  const itens: any[] = [];
  for (const parte of texto.split(/<STMTTRN>/i).slice(1)) {
    const bloco = parte.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];
    const campo = (nome: string) => {
      const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(bloco);
      return m ? m[1].trim() : "";
    };
    const dt = campo("DTPOSTED").slice(0, 8);
    const valor = campo("TRNAMT").replace(/,/g, ".");
    if (!(dt.length === 8 && /^\d+$/.test(dt)) || !valor) continue;
    if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(valor)) continue;
    const cent = pyRound(parseFloat(valor) * 100);
    const desc = campo("MEMO") || campo("NAME") || "Lançamento do extrato";
    itens.push({ data: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`, valor: cent, descricao: Array.from(desc).slice(0, 200).join(""), fitid: campo("FITID") });
  }
  return itens;
}

/** Lançamentos em aberto do mesmo tipo e valor próximo da data da linha do extrato. */
export async function sugestoes_conciliacao(slug: string, linha: any, limite = 4): Promise<any[]> {
  const tipo = linha.valor > 0 ? "receber" : "pagar";
  const d = PyDate.fromisoformat(linha.data);
  let cands: any[] = await q("SELECT * FROM financas_lancamentos WHERE empresa_slug = ? AND tipo = ? AND cancelado = 0 " +
    "AND vencimento BETWEEN ? AND ?" + filtro_consideradas() + " ORDER BY id", [slug, tipo, d.addDays(-20).isoformat(), d.addDays(20).isoformat()]);
  cands = (await completar(cands, slug)).filter((l) => ["aberto", "vencido", "parcial"].includes(l.situacao));
  const alvo = Math.abs(linha.valor);
  for (const l of cands) {
    l.dif_valor = Math.abs(l.saldo - alvo);
    l.dif_dias = Math.abs(PyDate.fromisoformat(l.vencimento).diffDays(d));
  }
  cands = cands.filter((l) => l.dif_valor <= Math.max(alvo * 0.05, 100));
  ordenar(cands, (l) => [l.dif_valor, l.dif_dias]);
  return cands.slice(0, limite);
}

// ───────────────────────── relatórios ─────────────────────────
/** Realizado (caixa) por tipo no período, a partir das baixas. */
export async function resumo_periodo(slug: string, de: string, ate: string) {
  const r = await q("SELECT l.tipo, SUM(b.valor) AS s FROM financas_baixas b JOIN financas_lancamentos l ON l.id = b.lancamento_id " +
    "WHERE l.empresa_slug = ? AND b.data BETWEEN ? AND ?" + filtro_consideradas("b.") + " GROUP BY l.tipo", [slug, de, ate]);
  const m: Record<string, number> = {};
  for (const x of r) m[x.tipo] = x.s || 0;
  return { entradas: m.receber ?? 0, saidas: m.pagar ?? 0 };
}

/** Por mês do ano: realizado (baixas) e previsto (saldo em aberto pelo vencimento). */
export async function fluxo_mensal(slug: string, ano: number) {
  const meses: any[] = [];
  const hoje_iso = hoje().isoformat();
  const abertos = (await completar(await q(
    "SELECT * FROM financas_lancamentos WHERE empresa_slug = ? AND cancelado = 0 AND vencimento BETWEEN ? AND ?" + filtro_consideradas(),
    [slug, `${ano}-01-01`, `${ano}-12-31`]), slug)).filter((l) => ["aberto", "vencido", "parcial"].includes(l.situacao));
  const baixas = await q("SELECT l.tipo, substr(b.data, 6, 2) AS mes, SUM(b.valor) AS s FROM financas_baixas b " +
    "JOIN financas_lancamentos l ON l.id = b.lancamento_id WHERE l.empresa_slug = ? AND b.data BETWEEN ? AND ? " +
    filtro_consideradas("b.") + " GROUP BY l.tipo, mes", [slug, `${ano}-01-01`, `${ano}-12-31`]);
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const soma = (lst: any[], f: (x: any) => boolean, campo: string) => lst.filter(f).reduce((a, x) => a + x[campo], 0);
    const ent = soma(baixas, (b) => b.mes === mm && b.tipo === "receber", "s");
    const sai = soma(baixas, (b) => b.mes === mm && b.tipo === "pagar", "s");
    const mesPrev = (l: any) => String(l.previsao || l.vencimento).slice(5, 7);
    const prev_ent = soma(abertos, (l) => mesPrev(l) === mm && l.tipo === "receber", "saldo");
    const prev_sai = soma(abertos, (l) => mesPrev(l) === mm && l.tipo === "pagar", "saldo");
    meses.push({
      mes: m, nome: MESES[m], entradas: ent, saidas: sai, prev_entradas: prev_ent,
      prev_saidas: prev_sai, atrasado: `${ano}-${mm}` < hoje_iso.slice(0, 7),
    });
  }
  return meses;
}

/** DRE gerencial por grupo e categoria, mês a mês (competência ou caixa); rateio entra proporcional. */
export async function dre(slug: string, ano: number, regime = "competencia") {
  let base: any[];
  if (regime === "caixa") {
    base = await q("SELECT l.id AS lid, l.categoria_id, l.tipo, substr(b.data, 6, 2) AS mes, b.valor AS s FROM financas_baixas b " +
      "JOIN financas_lancamentos l ON l.id = b.lancamento_id WHERE l.empresa_slug = ? AND b.data BETWEEN ? AND ?" + filtro_consideradas("b.") +
      " ORDER BY b.id", [slug, `${ano}-01-01`, `${ano}-12-31`]);
  } else {
    base = await q("SELECT id AS lid, categoria_id, tipo, substr(competencia, 6, 2) AS mes, valor AS s FROM financas_lancamentos " +
      "WHERE empresa_slug = ? AND cancelado = 0 AND competencia BETWEEN ? AND ?" + filtro_consideradas() + " ORDER BY id", [slug, `${ano}-01-01`, `${ano}-12-31`]);
  }
  const partes = await partes_por_lancamento(Array.from(new Set(base.map((r) => r.lid))));
  const acum = new Map<string, [any, string, string, number]>();
  for (const r of base) {
    for (const [cat_id, frac] of partes.get(r.lid) ?? [[r.categoria_id, 1.0]]) {
      const k = JSON.stringify([cat_id, r.tipo, r.mes]);
      const a = acum.get(k);
      if (a) a[3] += r.s * frac; else acum.set(k, [cat_id, r.tipo, r.mes, 0 + r.s * frac]);
    }
  }
  const linhas = Array.from(acum.values()).map(([c, t, m, v]) => ({ categoria_id: c, tipo: t, mes: m, s: pyRound(v) }));
  const cats = new Map<number, any>((await categorias(slug, null, false)).map((c) => [c.id, c]));
  const grupos: Record<string, any> = {};
  for (const [k, n, nat] of GRUPOS_DRE) grupos[k] = { chave: k, nome: n, natureza: nat, meses: Array(12).fill(0), total: 0, cats: new Map<string, any>() };
  grupos.sem_categoria = { chave: "sem_categoria", nome: "Sem categoria", natureza: "misto", meses: Array(12).fill(0), total: 0, cats: new Map<string, any>() };
  for (const r of linhas) {
    const c = cats.get(r.categoria_id);
    const g = c && grupos[c.grupo_dre] ? grupos[c.grupo_dre] : grupos.sem_categoria;
    const v = r.tipo === "receber" ? r.s : -r.s;
    const i = parseInt(r.mes, 10) - 1;
    g.meses[i] += v;
    g.total += v;
    const nome = c ? c.nome : "Sem categoria";
    if (!g.cats.has(nome)) g.cats.set(nome, { nome, meses: Array(12).fill(0), total: 0 });
    const cat = g.cats.get(nome);
    cat.meses[i] += v;
    cat.total += v;
  }
  const ordem = [...GRUPOS_DRE.map(([k]) => grupos[k]), grupos.sem_categoria].filter((g) => g.total || g.cats.size);
  for (const g of Object.values(grupos)) {
    // em Python os grupos fora de `ordem` continuam com dict; aqui todos viram lista ordenada (nenhum template usa os outros)
    if (ordem.includes(g)) g.cats = ordenar(Array.from(g.cats.values()), (c: any) => [-Math.abs(c.total)]);
    else g.cats = Object.fromEntries(g.cats);
  }
  const soma = (chaves: string[]) => Array.from({ length: 12 }, (_, i) => chaves.reduce((a, k) => a + grupos[k].meses[i], 0));
  const rec_liq = soma(["receita_bruta", "deducoes"]);
  const lucro_bruto = rec_liq.map((x, i) => x + grupos.custos.meses[i]);
  const operacional = lucro_bruto.map((x, i) => x + grupos.despesas_operacionais.meses[i] + grupos.pessoal.meses[i]);
  const antes_ir = operacional.map((x, i) => x + ["receitas_financeiras", "despesas_financeiras", "outras_receitas", "outras_despesas", "sem_categoria"]
    .reduce((a, k) => a + grupos[k].meses[i], 0));
  const liquido = antes_ir.map((x, i) => x + grupos.impostos_lucro.meses[i]);
  const totais: Record<string, number[]> = {
    receita_liquida: rec_liq, lucro_bruto, resultado_operacional: operacional,
    resultado_antes_ir: antes_ir, resultado_liquido: liquido,
  };
  return {
    grupos, ordem,
    totais: Object.fromEntries(Object.entries(totais).map(([k, v]) => [k, { meses: v, total: v.reduce((a, b) => a + b, 0) }])),
  };
}

// ───────────────────────── sugestão do grupo da DRE ─────────────────────────
export function _norm(s: any): string {
  const t = String(s || "").toLowerCase().normalize("NFKD").replace(/\p{Mn}/gu, "");
  return " " + t.replace(/[^a-z0-9]+/g, " ").trim() + " ";
}

// (grupo, natureza exigida ou null, termos) — a ordem importa: regras mais específicas primeiro.
export const REGRAS_DRE: [string, string | null, string[]][] = [
  ["impostos_lucro", null, ["irpj", "csll", "imposto de renda", "contribuicao social sobre o lucro"]],
  ["deducoes", null, ["simples nacional", " das ", " iss ", " iss", "issqn", " pis ", "cofins", "icms", " ipi ", "devolucao de venda",
    "devolucoes de venda", "abatimento", "desconto concedido", "descontos concedidos", "impostos sobre venda"]],
  ["custos", null, ["custo", "cotista", "rendimentos pagos", "remuneracao de investidor", "remuneracao dos investidor", " cmv", " cpv", " csp", "mercadoria", "materia prima", "materias primas", "insumo",
    "servicos de terceiro", "servico de terceiro", "terceirizad", "subcontrat", "frete sobre compra",
    "embalage"]],
  ["pessoal", "despesa", ["salario", "pro labore", "prolabore", "fgts", "inss", "vale transporte", "vale refeicao",
    "vale alimentacao", " vt ", " vr ", " va ", "ferias", " 13 ", "decimo terceiro", "rescis",
    "beneficio", "plano de saude", "plano odontologico", "folha", "estagi", "bonific",
    "comissao de vend", "comissoes de vend", "hora extra", "seguro de vida", "uniforme", "pensao"]],
  ["receitas_financeiras", "receita", ["rendimento", "juros recebido", "juros ativo", "aplicac", "desconto obtido",
    "descontos obtidos", "variacao cambial ativa", "dividendo", "juros sobre capital",
    "cashback"]],
  ["despesas_financeiras", "despesa", ["tarifa", "juros", "multa", " iof", "encargo", "taxa bancaria", "boleto",
    "maquininha", "taxa de cartao", "taxas de cartao", "antecipacao", "variacao cambial passiva",
    "despesa bancaria", "despesas bancarias", "cesta de servico"]],
  ["investimentos", "despesa", ["equipamento", "maquina", "computador", "notebook", "impressora", "movei", "movel",
    "mobiliario", "utensilio", "obra", "reforma", "veiculo", "imobilizado", "benfeitoria",
    "aquisicao de software", "celular"]],
  ["outras_receitas", "receita", ["reembolso", "venda de ativo", "venda de imobilizado", "indenizacao", "aluguel recebido",
    "aluguel", "sublocacao", "outras receitas", "recuperacao", "estorno"]],
  ["receita_bruta", "receita", ["venda", "honorari", "mensalidad", "consultoria", "assessoria", "servico", "faturamento",
    "taxa de administracao", "contrato", "receita", "comissao", "projeto", "licenc", "assinatura",
    "curso", "treinamento", "mentoria"]],
  ["outras_despesas", "despesa", ["doac", "perda", "outras despesas", "indenizac", "despesa nao dedutivel", "brinde",
    "patrocinio"]],
  ["despesas_operacionais", "despesa", ["aluguel", "condominio", "energia", " luz ", "agua", "internet", "telefon",
    "software", "sistema", "assinatura", "material", "escritorio", "contab", "juridic",
    "advoca", "marketing", "publicidade", "anuncio", " ads ", "google", "facebook", "instagram", "meta ", "propaganda", "trafego",
    "combustivel", "deslocamento", "viagem", "hospedagem", "passagem", "alimentac",
    "refeic", "manutenc", "limpeza", "seguranca", "seguro", "taxa", "licenc", "alvara",
    "correio", "cartorio", "papelaria", "consultoria", "assessoria", "servico", "frete",
    "estacionamento", "pedagio", "uber", "taxi", "hosped", "dominio", "hospedagem de site",
    "nuvem", "cloud", "treinamento", "curso", "certificado digital", "sindicato",
    "associac", "mensalidad", "tecnologia", "copa", "cozinha"]],
];
export const NATUREZA_GRUPO: Record<string, string> = Object.fromEntries(GRUPOS_DRE.map(([k, , nat]) => [k, nat]));

/** Sugere o grupo da DRE para o nome de uma categoria (categorias parecidas → dicionário → padrão). */
export async function sugerir_grupo(slug: string, nome: any, natureza: any = null): Promise<any> {
  const n = _norm(nome);
  if (n.trim().length < 3) return null;
  natureza = natureza === "receita" || natureza === "despesa" ? natureza : null;
  // 1) parecida com categoria existente
  const palavras = new Set(n.split(/\s+/).filter((p) => p && p.length > 3));
  let melhor: any = null, pontos = 0;
  for (const c of await q("SELECT nome, grupo_dre FROM financas_categorias WHERE empresa_slug = ? AND grupo_dre <> '' ORDER BY id", [slug])) {
    if (natureza && NATUREZA_GRUPO[c.grupo_dre] !== natureza) continue;
    const cn = _norm(c.nome);
    if (cn === n) {
      return { grupo: c.grupo_dre, natureza: NATUREZA_GRUPO[c.grupo_dre] ?? null, confianca: "alta", motivo: `já existe a categoria “${c.nome}” neste grupo` };
    }
    const comum = new Set(cn.split(/\s+/).filter((p) => p && p.length > 3 && palavras.has(p)));
    if (comum.size > pontos) { melhor = c; pontos = comum.size; }
  }
  // 2) dicionário
  for (const [grupo, , termos] of REGRAS_DRE) {
    const nat_g = NATUREZA_GRUPO[grupo];
    if (natureza && nat_g !== natureza) continue;
    for (const t of termos) {
      if (n.includes(t)) {
        return { grupo, natureza: nat_g, confianca: t.trim().length > 4 ? "alta" : "media", motivo: `pelo termo “${t.trim()}”` };
      }
    }
  }
  if (melhor && pontos) {
    return { grupo: melhor.grupo_dre, natureza: NATUREZA_GRUPO[melhor.grupo_dre] ?? null, confianca: "media", motivo: `parecida com “${melhor.nome}”` };
  }
  // 3) sem pista: o padrão de cada natureza
  if (natureza === "receita") return { grupo: "receita_bruta", natureza: "receita", confianca: "baixa", motivo: "padrão para receitas" };
  if (natureza === "despesa") return { grupo: "despesas_operacionais", natureza: "despesa", confianca: "baixa", motivo: "padrão para despesas" };
  return null;
}

// ───────────────────────── lançamento completo (rateio, parcelas, anexos) ─────────────────────────
/** Os anexos ficam na tabela erp_arquivos com o caminho lógico "anexos/financas/<arquivo>". */
export const ANEXOS_DIR = "anexos/financas";
export const ANEXO_MAX = 20 * 1024 * 1024;
export const ANEXO_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".xml", ".txt", ".csv", ".xls", ".xlsx", ".doc", ".docx",
  ".ofx", ".rem", ".ret", ".zip", ".eml", ".msg"]);
export const FREQUENCIAS: Record<string, [string, number, number]> = {
  mensal: ["Mensal", 1, 0], semanal: ["Semanal", 0, 7], quinzenal: ["Quinzenal", 0, 15],
  bimestral: ["Bimestral", 2, 0], trimestral: ["Trimestral", 3, 0], semestral: ["Semestral", 6, 0],
  anual: ["Anual", 12, 0],
};
export const NATUREZAS_CUSTO: Record<string, string> = { fixo: "Fixo", variavel: "Variável" };

export function proxima_data(base: PyDate, i: number, freq: string): PyDate {
  const [, meses, dias] = FREQUENCIAS[freq] ?? FREQUENCIAS.mensal;
  return meses ? somar_meses(base, meses * i) : base.addDays(dias * i);
}

/** Distribui `valor` (centavos) entre as linhas de rateio, proporcional; a sobra vai para a maior linha. */
export function ratear(valor: number, partes: any[]): any[] {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  if (!partes.length || total <= 0) return [];
  // divisão inteira (//) com BigInt para não perder precisão em valores grandes
  const out = partes.map((p) => ({ ...p, valor: Number((BigInt(valor) * BigInt(p.valor)) / BigInt(total) - ((BigInt(valor) * BigInt(p.valor)) % BigInt(total) < BigInt(0) ? BigInt(1) : BigInt(0))) }));
  const sobra = valor - out.reduce((a, p) => a + p.valor, 0);
  if (sobra) {
    let maior = 0;
    out.forEach((p, i) => { if (p.valor > out[maior].valor) maior = i; });
    out[maior].valor += sobra;
  }
  return out;
}

export async function gravar_rateio(conn: ConexaoLike, lid: number, linhas: any[]) {
  await conn.execute("DELETE FROM financas_rateios WHERE lancamento_id = ?", [lid]);
  if (linhas.length <= 1) return; // uma categoria só: fica no próprio lançamento
  for (const r of linhas) {
    await conn.execute("INSERT INTO financas_rateios (lancamento_id, categoria_id, centro_id, valor) VALUES (?, ?, ?, ?)",
      [lid, r.categoria_id ?? null, r.centro_id ?? null, r.valor]);
  }
}

export async function rateio_de(lanc: any): Promise<any[]> {
  const linhas = await q("SELECT r.*, c.nome AS categoria_nome, k.nome AS centro_nome FROM financas_rateios r " +
    "LEFT JOIN financas_categorias c ON c.id = r.categoria_id LEFT JOIN financas_centros k ON k.id = r.centro_id " +
    "WHERE r.lancamento_id = ? ORDER BY r.valor DESC, r.id", [lanc.id]);
  if (linhas.length) return linhas;
  return [{ categoria_id: lanc.categoria_id ?? null, centro_id: lanc.centro_id ?? null, valor: lanc.valor }];
}

function principal_de(rateio: any[]): any {
  if (!rateio.length) return {};
  let m = rateio[0];
  for (const r of rateio) if (r.valor > m.valor) m = r;
  return m;
}

/** cab: dados comuns; parcelas: [{vencimento, valor, competencia}]; rateio: [{categoria_id, centro_id, valor}]. */
export async function criar_lancamento_completo(slug: string, tipo: string, cab: any, parcelas: any[], rateio: any[], uid: any): Promise<[number[], string]> {
  const agora = agora_iso();
  const n = parcelas.length;
  const grupo = n > 1 ? `g${carimbo_micro()}` : "";
  const principal = principal_de(rateio);
  const ids: number[] = [];
  const conn = await get_connection();
  try {
    for (const [i, p] of parcelas.entries()) {
      const desc = cab.descricao + (n > 1 && cab.repeticao === "parcelado" ? ` (${i + 1}/${n})` : "");
      const cur = await conn.execute(
        "INSERT INTO financas_lancamentos (empresa_slug, tipo, descricao, pessoa_id, categoria_id, centro_id, conta_id, " +
        "valor, competencia, vencimento, previsao, forma_pagamento, documento, obs, parcela, parcelas, grupo, natureza_custo, " +
        "repeticao, criado_por, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [slug, tipo, desc, cab.pessoa_id ?? null, principal.categoria_id ?? null,
          principal.centro_id || cab.centro_id || null, cab.conta_id ?? null, p.valor, p.competencia,
          p.vencimento, p.previsao || p.vencimento, cab.forma_pagamento ?? "", cab.documento ?? "", cab.obs ?? "", i + 1, n,
          grupo, cab.natureza_custo ?? "", cab.repeticao ?? "", uid, agora, agora]);
      const lid = cur.lastrowid;
      await gravar_rateio(conn, lid, ratear(p.valor, rateio));
      ids.push(lid);
    }
    await conn.commit();
  } finally {
    await conn.close();
  }
  return [ids, grupo];
}

export async function atualizar_lancamento(lid: number, cab: any, rateio: any[]) {
  const principal = principal_de(rateio);
  const conn = await get_connection();
  try {
    await conn.execute("UPDATE financas_lancamentos SET descricao = ?, valor = ?, vencimento = ?, previsao = ?, competencia = ?, " +
      "pessoa_id = ?, categoria_id = ?, centro_id = ?, conta_id = ?, forma_pagamento = ?, documento = ?, obs = ?, " +
      "natureza_custo = ?, atualizado_em = ? WHERE id = ?",
    [cab.descricao, cab.valor, cab.vencimento, cab.previsao || cab.vencimento,
      cab.competencia, cab.pessoa_id ?? null,
      principal.categoria_id ?? null, principal.centro_id || cab.centro_id || null, cab.conta_id ?? null,
      cab.forma_pagamento ?? "", cab.documento ?? "", cab.obs ?? "",
      cab.natureza_custo ?? "", agora_iso(), lid]);
    await gravar_rateio(conn, lid, ratear(cab.valor, rateio));
    await conn.commit();
  } finally {
    await conn.close();
  }
}

function extensao(nome: string): string {
  // Path(nome).suffix do Python
  const i = nome.lastIndexOf(".");
  if (i <= 0 || i === nome.length - 1) return "";
  return nome.slice(i);
}

/** Grava os arquivos em anexos/financas/<empresa>/<ano-mês>/ (tabela erp_arquivos). */
export async function salvar_anexos(slug: string, lid: number, grupo: string, arquivos: (ArquivoEnviado | null)[], uid: any): Promise<[number, string[]]> {
  let salvos = 0;
  const recusados: string[] = [];
  const pasta = `${slug}/${PyDate.now().strftime("%Y-%m")}`;
  for (const f of arquivos) {
    if (!f || !f.filename) continue;
    const nome = Array.from(f.filename.split("/").pop() ?? "").slice(0, 150).join("");
    const ext = extensao(nome).toLowerCase();
    if (!ANEXO_EXT.has(ext)) { recusados.push(`${nome} (tipo não permitido)`); continue; }
    const dados = f.read();
    if (dados.length > ANEXO_MAX) { recusados.push(`${nome} (maior que 20 MB)`); continue; }
    const rel = `${pasta}/${randomUUID().replace(/-/g, "")}${ext}`;
    await salvarArquivo(`${ANEXOS_DIR}/${rel}`, dados, f.mimetype || "application/octet-stream");
    await ex("INSERT INTO financas_anexos (empresa_slug, lancamento_id, grupo, nome, arquivo, tamanho, criado_por, criado_em) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [slug, lid, grupo || "", nome, rel, dados.length, uid, agora_iso()]);
    salvos += 1;
  }
  return [salvos, recusados];
}

/** Anexos do lançamento + os anexados ao grupo todo (ex.: contrato de uma recorrência). */
export async function anexos_de(lanc: any): Promise<any[]> {
  if (lanc.grupo) {
    return q("SELECT * FROM financas_anexos WHERE lancamento_id = ? OR (grupo = ? AND grupo <> '') ORDER BY id", [lanc.id, lanc.grupo]);
  }
  return q("SELECT * FROM financas_anexos WHERE lancamento_id = ? ORDER BY id", [lanc.id]);
}

/** Caminho lógico do anexo (null se tentar sair da pasta). */
export function caminho_anexo(a: any): string | null {
  const rel = String(a.arquivo ?? "").replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || rel.split("/").some((p) => p === "..")) return null;
  return `${ANEXOS_DIR}/${rel}`;
}

export async function excluir_anexo(a: any) {
  const p = caminho_anexo(a);
  await ex("DELETE FROM financas_anexos WHERE id = ?", [a.id]);
  try {
    if (p) await apagarArquivo(p);
  } catch { /* ignora */ }
}

/** {lancamento_id: [[categoria_id, fração]]} — só para os lançamentos que têm rateio. */
export async function partes_por_lancamento(ids: number[]): Promise<Map<number, [any, number][]>> {
  const bruto = new Map<number, [any, number][]>();
  if (!ids.length) return bruto;
  for (let i = 0; i < ids.length; i += 800) {
    const bloco = ids.slice(i, i + 800);
    for (const r of await q(`SELECT lancamento_id, categoria_id, valor FROM financas_rateios WHERE lancamento_id IN (${marcas(bloco.length)}) ORDER BY id`, bloco)) {
      if (!bruto.has(r.lancamento_id)) bruto.set(r.lancamento_id, []);
      bruto.get(r.lancamento_id)!.push([r.categoria_id, r.valor]);
    }
  }
  for (const [lid, linhas] of bruto) {
    const tot = linhas.reduce((a, [, v]) => a + v, 0) || 1;
    bruto.set(lid, linhas.map(([c, v]) => [c, v / tot]));
  }
  return bruto;
}

export const MESES_LONGOS = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
  "novembro", "dezembro"];

/** '2026-10-15' → 'outubro de 2026'. */
export function mes_ano(iso: any): string {
  const s = String(iso ?? "");
  const m = /^[-+]?\d+$/.test(s.slice(5, 7).trim()) ? parseInt(s.slice(5, 7), 10) : NaN;
  if (iso === null || iso === undefined || Number.isNaN(m)) return "";
  const nome = MESES_LONGOS[m < 0 ? MESES_LONGOS.length + m : m];
  return nome === undefined ? "" : `${nome} de ${s.slice(0, 4)}`;
}

/** Aceita '2026-10' (mês) ou '2026-10-15' e devolve sempre o 1º dia do mês. */
export function competencia_valida(texto: any, padrao: any = null): any {
  let t = String(texto || "").trim();
  if (t.length === 7) t += "-01";
  const v = data_valida(t);
  return v ? v.slice(0, 8) + "01" : padrao;
}
