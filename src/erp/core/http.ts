/* eslint-disable @typescript-eslint/no-explicit-any */
// Requisição/resposta no estilo Flask/Werkzeug.
import { pyb } from "./py";

export const PREFIXO = "/erp";

export class MultiDict {
  private m = new Map<string, string[]>();
  constructor(pares: Iterable<[string, string]> = []) { for (const [k, v] of pares) this.add(k, v); }
  add(k: string, v: string) { const l = this.m.get(k); if (l) l.push(v); else this.m.set(k, [v]); }
  /** get(chave, padrão, tipo) — tipo: Number/int, float, ou função. Valor inválido → padrão. */
  get(k: string, def: any = null, tipo?: "int" | "float" | ((s: string) => any)): any {
    const l = this.m.get(k);
    if (!l || !l.length) return def;
    const v = l[0];
    if (!tipo) return v;
    try {
      if (tipo === "int") { if (!/^\s*[-+]?\d+\s*$/.test(v)) return def; return parseInt(v, 10); }
      if (tipo === "float") { const n = Number(v.trim()); return v.trim() === "" || Number.isNaN(n) ? def : n; }
      return tipo(v);
    } catch { return def; }
  }
  getlist(k: string, tipo?: "int" | "float"): any[] {
    const l = this.m.get(k) ?? [];
    if (tipo === "int") return l.filter((v) => /^\s*[-+]?\d+\s*$/.test(v)).map((v) => parseInt(v, 10));
    if (tipo === "float") return l.map(Number).filter((n) => !Number.isNaN(n));
    return [...l];
  }
  has(k: string) { return this.m.has(k); }
  keys() { return Array.from(this.m.keys()); }
  items(): [string, string][] { return Array.from(this.m.entries()).map(([k, v]) => [k, v[0]]); }
  toDict(): Record<string, string> { return Object.fromEntries(this.items()); }
  /** Para templates: request.args.get('x') e request.args['x']. */
  [k: string]: any;
}

/** Proxy para MultiDict funcionar no template (request.args.x / request.args.get). */
export function multiDictTemplate(md: MultiDict) {
  return new Proxy(md, {
    get(t, p: any) {
      if (p in t) { const v = (t as any)[p]; return typeof v === "function" ? v.bind(t) : v; }
      return t.get(p);
    },
  });
}

export class ArquivoEnviado {
  constructor(public filename: string, public mimetype: string, private dados: Uint8Array) {}
  read(): Uint8Array { return this.dados; }
  text(): string { return new TextDecoder("utf-8").decode(this.dados); }
  get size() { return this.dados.length; }
}

export class Req {
  method = "GET";
  /** Caminho interno, sem o prefixo /erp (usado para casar as rotas). */
  rota = "/";
  /** Caminho público, com o prefixo /erp (igual ao que aparece no navegador). */
  path = "/";
  query = "";
  url = "";
  host_url = "";
  args = new MultiDict();
  form = new MultiDict();
  files = new Map<string, ArquivoEnviado[]>();
  jsonBody: any = undefined;
  headers = new Headers();
  cookies = new Map<string, string>();
  endpoint: string | null = null;
  view_args: Record<string, any> = {};
  remote_addr = "";
  user_agent = "";
  /** dados por requisição (equivalente ao flask.g) */
  g: Record<string, any> = {};
  /** Cookies extras para a resposta (ex.: sessão do Supabase). */
  cookiesSaida: string[] = [];

  get full_path() { return this.path + "?" + this.query; }
  get is_json() { return (this.headers.get("content-type") ?? "").includes("application/json"); }
  get_json(_opts?: any) { return this.jsonBody ?? null; }
  get json() { return this.jsonBody ?? null; }
  file(nome: string): ArquivoEnviado | null { const l = this.files.get(nome); return l && l.length ? l[0] : null; }

  static async deRequest(r: Request): Promise<Req> {
    const req = new Req();
    const u = new URL(r.url);
    const proto = r.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
    const host = r.headers.get("x-forwarded-host") ?? r.headers.get("host") ?? u.host;
    req.method = r.method.toUpperCase();
    req.path = u.pathname;
    req.rota = u.pathname.startsWith(PREFIXO) ? u.pathname.slice(PREFIXO.length) || "/" : u.pathname;
    req.query = u.search.replace(/^\?/, "");
    req.host_url = `${proto}://${host}/`;
    req.url = `${proto}://${host}${u.pathname}${u.search}`;
    req.args = new MultiDict(u.searchParams.entries());
    req.headers = r.headers;
    for (const parte of (r.headers.get("cookie") ?? "").split(";")) {
      const i = parte.indexOf("=");
      if (i > 0) req.cookies.set(parte.slice(0, i).trim(), decodeURIComponent(parte.slice(i + 1).trim()));
    }
    req.remote_addr = (r.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || r.headers.get("x-real-ip") || "";
    req.user_agent = r.headers.get("user-agent") ?? "";
    if (req.method !== "GET" && req.method !== "HEAD") {
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
        const fd = await r.formData();
        for (const [k, v] of fd.entries()) {
          if (typeof v === "string") req.form.add(k, v);
          else {
            const f = v as File;
            if (!f.name && f.size === 0) { req.files.set(k, [...(req.files.get(k) ?? []), new ArquivoEnviado("", f.type, new Uint8Array())]); continue; }
            const a = new ArquivoEnviado(f.name, f.type, new Uint8Array(await f.arrayBuffer()));
            req.files.set(k, [...(req.files.get(k) ?? []), a]);
          }
        }
      } else if (ct.includes("application/json")) {
        try { req.jsonBody = await r.json(); } catch { req.jsonBody = null; }
      }
    }
    return req;
  }
}

export class Resposta {
  headers = new Headers();
  constructor(public body: BodyInit | null = "", public status = 200, tipo = "text/html; charset=utf-8") {
    if (tipo) this.headers.set("content-type", tipo);
  }
  set_cookie(nome: string, valor: string, opts: { max_age?: number; httponly?: boolean; path?: string } = {}) {
    const partes = [`${nome}=${encodeURIComponent(valor)}`, `Path=${opts.path ?? "/"}`, "SameSite=Lax"];
    if (opts.max_age !== undefined) partes.push(`Max-Age=${opts.max_age}`);
    if (opts.httponly !== false) partes.push("HttpOnly");
    this.headers.append("set-cookie", partes.join("; "));
  }
}

export class HttpErro extends Error {
  constructor(public codigo: number, public descricao = "", public resposta?: Resposta) { super(`${codigo} ${descricao}`); }
}

export function abort(codigo: number, descricao = ""): never { throw new HttpErro(codigo, descricao); }

export function redirect(url: string, status = 302): Resposta {
  const e = url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&#34;");
  const r = new Resposta(`<!doctype html>\n<html lang=en>\n<title>Redirecting...</title>\n<h1>Redirecting...</h1>\n<p>You should be redirected automatically to the target URL: <a href="${e}">${e}</a>. If not, click the link.\n`, status);
  r.headers.set("location", url);
  return r;
}

/** Igual ao jsonify do Flask 3: chaves ordenadas (sort_keys), compacto, ensure_ascii e "\n" no final. */
function ordenarChaves(v: any): any {
  if (Array.isArray(v)) return v.map(ordenarChaves);
  if (v && typeof v === "object") {
    const ks = Object.keys(v);
    // dict com chaves int no Python ordena numericamente; com chaves str, por código
    const numericas = ks.length > 0 && ks.every((k) => /^-?\d+$/.test(k));
    ks.sort(numericas ? (a, b) => Number(a) - Number(b) : (a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const o: Record<string, any> = {};
    for (const k of ks) o[k] = ordenarChaves(v[k]);
    return o;
  }
  return v;
}
export function jsonify(dados: any, status = 200): Resposta {
  const txt = JSON.stringify(dados, (_k, v) => (v && typeof v === "object" && typeof v.toJSON === "function" ? v.toJSON() : v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? Array.from(v) : v));
  const corpo = txt === undefined ? "null" : JSON.stringify(ordenarChaves(JSON.parse(txt))).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  return new Resposta(corpo + "\n", status, "application/json");
}

/** send_file: devolve bytes para download. */
export function sendFile(dados: Uint8Array | string, opts: { download_name?: string; mimetype?: string; as_attachment?: boolean } = {}): Resposta {
  const corpo = typeof dados === "string" ? new TextEncoder().encode(dados) : dados;
  const r = new Resposta(corpo as any, 200, opts.mimetype ?? "application/octet-stream");
  if (opts.download_name) {
    const nome = opts.download_name;
    const ascii = nome.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
    r.headers.set("content-disposition", `${opts.as_attachment === false ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  }
  return r;
}

export { pyb };
