/* eslint-disable @typescript-eslint/no-explicit-any */
// Acesso ao banco (schema `erp` do Supabase) com a mesma "cara" do sqlite3 do Python:
// conn.execute(sql, params) → cursor (fetchone/fetchall/lastrowid/rowcount), commit/close.
// O SQL do app original é traduzido na hora (placeholders ?, LIKE, datetime('now')...).
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

import { PyDate } from "./py";

type Sql = ReturnType<typeof postgres>;
const g = globalThis as any;

function criar(): Sql {
  const url = process.env.ERP_DATABASE_URL;
  if (!url) throw new Error("ERP_DATABASE_URL não configurada.");
  const num = { to: 20, from: [20, 1700], serialize: (x: any) => String(x), parse: (x: string) => Number(x) };
  return postgres(url, {
    prepare: false,
    max: Number(process.env.ERP_DB_POOL ?? 5),
    idle_timeout: 600,      // mantém as conexões abertas (abrir conexão TLS com o Supabase é lento)
    max_lifetime: 60 * 30,
    connect_timeout: 15,
    types: { bigint: num } as any,
    onnotice: () => {},
    connection: { application_name: "erp-capuzzo" } as any,
  });
}
export function sql(): Sql {
  if (!g.__erpSql) g.__erpSql = criar();
  return g.__erpSql;
}

// ── Tradução do SQL do SQLite para PostgreSQL ───────────────────
const AGORA_SP = "to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI:SS')";
const HOJE_SP = "to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD')";
const AGORA_UTC = "to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')";
const HOJE_UTC = "to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')";
const cache = new Map<string, string>();

/** Separa trechos entre aspas simples para não mexer em literais. */
function foraDeAspas(sqlText: string, fn: (trecho: string) => string): string {
  let out = "", buf = "", i = 0;
  while (i < sqlText.length) {
    const c = sqlText[i];
    if (c === "'") {
      out += fn(buf); buf = "";
      let j = i + 1;
      while (j < sqlText.length) { if (sqlText[j] === "'" && sqlText[j + 1] === "'") { j += 2; continue; } if (sqlText[j] === "'") break; j++; }
      out += sqlText.slice(i, j + 1); i = j + 1; continue;
    }
    buf += c; i++;
  }
  return out + fn(buf);
}

/** MAX(a, b) / MIN(a, b) escalares do SQLite → GREATEST / LEAST. */
function minMaxEscalar(s: string): string {
  const re = /\b(MAX|MIN)\s*\(/gi;
  let m: RegExpExecArray | null;
  let res = "", ult = 0;
  while ((m = re.exec(s))) {
    let nivel = 1, j = m.index + m[0].length, virgula = false;
    while (j < s.length && nivel > 0) {
      const c = s[j];
      if (c === "(") nivel++;
      else if (c === ")") nivel--;
      else if (c === "," && nivel === 1) virgula = true;
      else if (c === "'") { j++; while (j < s.length && s[j] !== "'") j++; }
      j++;
    }
    if (virgula) {
      res += s.slice(ult, m.index) + (m[1].toUpperCase() === "MAX" ? "GREATEST(" : "LEAST(");
      ult = m.index + m[0].length;
    }
  }
  return res + s.slice(ult);
}

export function traduzir(original: string): string {
  const c = cache.get(original);
  if (c !== undefined) return c;
  let s = original.trim().replace(/;\s*$/, "");
  // funções de data com literais — antes de separar aspas
  s = s.replace(/datetime\(\s*'now'\s*,\s*'localtime'\s*\)/gi, AGORA_SP)
    .replace(/date\(\s*'now'\s*,\s*'localtime'\s*\)/gi, HOJE_SP)
    .replace(/datetime\(\s*'now'\s*\)/gi, AGORA_UTC)
    .replace(/date\(\s*'now'\s*\)/gi, HOJE_UTC);
  let n = 0;
  s = foraDeAspas(s, (t) => {
    t = t.replace(/\?/g, () => `$${++n}`);
    t = t.replace(/\bLIKE\b/gi, (m, off, str) => (/\bI$/i.test(str.slice(0, off)) ? m : "ILIKE"));
    t = t.replace(/\bNOT\s+ILIKE\b/gi, "NOT ILIKE");
    t = t.replace(/\bIFNULL\s*\(/gi, "COALESCE(");
    t = t.replace(/\s+COLLATE\s+NOCASE\b/gi, "");
    t = t.replace(/\bAS\s+REAL\s*\)/gi, "AS double precision)");
    t = t.replace(/\bROUND\s*\(/gi, "sqlround(");
    t = t.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT /*IGNORE*/ INTO");
    t = t.replace(/\bAS\s+([A-Za-z_]\w*)/g, (m, nome) => (/[A-Z]/.test(nome) && !/^(INTEGER|TEXT|REAL|NUMERIC|BIGINT|DOUBLE)$/i.test(nome) ? `AS "${nome}"` : m));
    return t;
  });
  s = minMaxEscalar(s);
  if (/INSERT \/\*IGNORE\*\/ INTO/.test(s)) s = s.replace("/*IGNORE*/ ", "") + (/\bON\s+CONFLICT\b/i.test(s) ? "" : " ON CONFLICT DO NOTHING");
  if (/^\s*INSERT\b/i.test(s) && !/\bRETURNING\b/i.test(s)) s += " RETURNING *";
  cache.set(original, s);
  return s;
}

function param(v: any): any {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (v instanceof PyDate) return v.isoformat();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

export type Row = Record<string, any>;

export class Cursor {
  constructor(public rows: Row[], public rowcount: number, public lastrowid: number | null) {}
  private pos = 0;
  fetchone(): Row | null { return this.pos < this.rows.length ? this.rows[this.pos++] : null; }
  fetchall(): Row[] { const r = this.rows.slice(this.pos); this.pos = this.rows.length; return r; }
  [Symbol.iterator]() { return this.fetchall()[Symbol.iterator](); }
}

type Exec = { unsafe: (q: string, p?: any[]) => Promise<any> };

// Cache de leitura por requisição: a mesma consulta SELECT (fora de transação) repetida na
// mesma página é respondida da memória; qualquer gravação limpa o cache. Reduz idas ao banco.
interface EstadoReq { cache: Map<string, Cursor>; n: number; ms: number }
const reqAls = new AsyncLocalStorage<EstadoReq>();
const cacheReq = { getStore: () => reqAls.getStore()?.cache };
export function comCacheDeLeitura<T>(fn: () => Promise<T>): Promise<T> { return reqAls.run({ cache: new Map(), n: 0, ms: 0 }, fn); }
/** Quantas consultas e quanto tempo de banco a requisição atual gastou. */
export function medidasBanco() { const e = reqAls.getStore(); return e ? { n: e.n, ms: Math.round(e.ms) } : { n: 0, ms: 0 }; }

async function executar(alvo: Exec, q: string, params: any[] = []): Promise<Cursor> {
  const t = traduzir(q);
  const ps = (Array.isArray(params) ? params : [params]).map(param);
  const cache = cacheReq.getStore();
  const leitura = /^\s*SELECT\b/i.test(t);
  const chave = cache && leitura && alvo === (sql() as any) ? t + "\u0000" + JSON.stringify(ps) : null;
  if (cache && !leitura) cache.clear();
  if (chave && cache!.has(chave)) { const c = cache!.get(chave)!; return new Cursor(c.rows.map((r) => ({ ...r })), c.rowcount, c.lastrowid); }
  (globalThis as any).__erpSqlCount = ((globalThis as any).__erpSqlCount ?? 0) + 1;
  if ((globalThis as any).__erpSqlLog) (globalThis as any).__erpSqlLog.push(t + " " + JSON.stringify(params));
  const t0 = performance.now();
  const res: any = await alvo.unsafe(t, ps);
  const est = reqAls.getStore();
  if (est) { est.n++; est.ms += performance.now() - t0; }
  const rows: Row[] = Array.from(res as any[]).map((r: any) => ({ ...r }));
  const ins = /^\s*INSERT\b/i.test(t);
  const lastrowid = ins && rows.length && rows[rows.length - 1].id !== undefined ? Number(rows[rows.length - 1].id) : null;
  const cur = new Cursor(ins ? [] : rows, Number(res.count ?? rows.length), lastrowid);
  if (chave) cache!.set(chave, new Cursor(rows.map((r) => ({ ...r })), cur.rowcount, null));
  return cur;
}

/** Conexão com transação implícita, como o sqlite3 do Python: nada vale até commit(). */
export class Conn {
  private res: any = null;
  private emTx = false;
  private fechada = false;
  private async garantir() {
    if (this.fechada) throw new Error("Conexão fechada.");
    if (!this.res) this.res = await sql().reserve();
    if (!this.emTx) { await this.res.unsafe("BEGIN"); this.emTx = true; }
  }
  async execute(q: string, params: any[] = []): Promise<Cursor> {
    if (this.fechada) throw new Error("Conexão fechada.");
    // Como o sqlite3 do Python: a transação só começa na primeira gravação. Leituras antes
    // disso vão direto ao pool (uma ida ao banco só, e podem usar o cache da requisição).
    if (!this.emTx && /^\s*(SELECT|WITH)\b/i.test(q) && !/\bFOR\s+UPDATE\b/i.test(q)) return executar(sql(), q, params);
    await this.garantir();
    return executar(this.res, q, params);
  }
  /** Igual a execute, mas um erro não estraga a transação (para código que trata o erro e continua). */
  async tentar(q: string, params: any[] = []): Promise<Cursor> {
    await this.garantir();
    await this.res.unsafe("SAVEPOINT sp");
    try {
      const c = await executar(this.res, q, params);
      await this.res.unsafe("RELEASE SAVEPOINT sp");
      return c;
    } catch (e) {
      await this.res.unsafe("ROLLBACK TO SAVEPOINT sp");
      throw e;
    }
  }
  async executemany(q: string, lista: any[][]) {
    let n = 0;
    for (const p of lista) n += (await this.execute(q, p)).rowcount;
    return n;
  }
  private liberar() { if (this.res) { this.res.release(); this.res = null; } }
  async commit() {
    if (this.res && this.emTx) { await this.res.unsafe("COMMIT"); this.emTx = false; }
    this.liberar();
  }
  async rollback() {
    if (this.res && this.emTx) { await this.res.unsafe("ROLLBACK"); this.emTx = false; }
    this.liberar();
  }
  async close() {
    if (this.fechada) return;
    this.fechada = true;
    if (this.res) {
      try { if (this.emTx) await this.res.unsafe("ROLLBACK"); } catch { /* ignora */ }
      this.res.release();
      this.res = null;
    }
  }
}

export async function getConnection(): Promise<Conn> { return new Conn(); }

/** Usa uma conexão e fecha no final (rollback do que não foi confirmado). */
export async function comConexao<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
  const c = new Conn();
  try { return await fn(c); } finally { await c.close(); }
}

// Atalhos sem transação (cada comando confirma sozinho)
export async function q(qs: string, params: any[] = []): Promise<Row[]> { return (await executar(sql(), qs, params)).rows; }
export async function q1(qs: string, params: any[] = []): Promise<Row | null> { return (await q(qs, params))[0] ?? null; }
export async function run(qs: string, params: any[] = []): Promise<Cursor> { return executar(sql(), qs, params); }

export function ehViolacaoUnica(e: any) { return e && (e.code === "23505"); }
export function ehErroIntegridade(e: any) { return e && typeof e.code === "string" && e.code.startsWith("23"); }
