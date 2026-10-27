/* eslint-disable @typescript-eslint/no-explicit-any */
// "Flask" do ERP: rotas, url_for, render_template, flash, sessão e ganchos.
// Os módulos portados usam estas funções exatamente como usavam as do Flask.
import { AsyncLocalStorage } from "node:async_hooks";

import { criarAmbiente, marcarSeguro, separarKwargs } from "./jinja";
import { HttpErro, MultiDict, PREFIXO, Req, Resposta, jsonify, multiDictTemplate, redirect as redir } from "./http";
import { Sessao } from "./sessao";
import { PyDate } from "./py";
import { comCacheDeLeitura } from "./db";
import { FONTES } from "../templates.gen";

export type Handler = (...params: any[]) => Promise<any> | any;

interface Conv { nome: string; tipo: string; opcoes?: string[] }
interface Rota { endpoint: string; regra: string; metodos: string[]; handler: Handler; re: RegExp; convs: Conv[]; estatica: boolean; }

const rotas: Rota[] = [];
const porEndpoint = new Map<string, Rota[]>();
const processadoresContexto: (() => Record<string, any>)[] = [];
const antesDaRequisicao: (() => Promise<any> | any)[] = [];
const tratadoresErro = new Map<number, (e: HttpErro) => Promise<any> | any>();
const filtros: [string, (...a: any[]) => any][] = [];
const globais: [string, any][] = [];
// Estáticos ficam em /login-grupo/... porque o proxy da Bia deixa passar sem login
// tudo o que começa com /login (necessário para a tela de login e páginas públicas).
export const PUBLICO = "/login-grupo";
const estaticos: Record<string, string> = { static: PUBLICO + "/static" };
/** Rotas internas servidas fora de /erp (públicas): prefixo interno → prefixo externo. */
const montagens: [string, string][] = [];
export function montarPublico(interno: string, externo: string) { montagens.push([interno, externo]); }

function compilarRegra(regra: string): { re: RegExp; convs: Conv[] } {
  const convs: Conv[] = [];
  let re = "";
  let i = 0;
  const m = /<(?:(\w+)(?:\(([^)]*)\))?:)?(\w+)>/g;
  let x: RegExpExecArray | null;
  while ((x = m.exec(regra))) {
    re += regra.slice(i, x.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tipo = x[1] ?? "string";
    const conv: Conv = { nome: x[3], tipo };
    if (tipo === "int") re += "(\\d+)";
    else if (tipo === "float") re += "(\\d+\\.\\d+)";
    else if (tipo === "path") re += "(.+?)";
    else if (tipo === "any") { conv.opcoes = x[2].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")); re += "(" + conv.opcoes.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")"; }
    else re += "([^/]+)";
    convs.push(conv);
    i = x.index + x[0].length;
  }
  re += regra.slice(i).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { re: new RegExp("^" + re + "$"), convs };
}

/** Registra uma rota (equivalente a @app.route / @bp.route). */
export function route(endpoint: string, regra: string, metodos: string[], handler: Handler) {
  const { re, convs } = compilarRegra(regra);
  const r: Rota = { endpoint, regra, metodos: metodos.map((s) => s.toUpperCase()), handler, re, convs, estatica: convs.length === 0 };
  rotas.push(r);
  porEndpoint.set(endpoint, [...(porEndpoint.get(endpoint) ?? []), r]);
}
/** current_app.view_functions[endpoint](**kw): chama a view de outra rota passando os parâmetros pelo nome. */
export function viewFunction(endpoint: string): (kw?: Record<string, any>) => Promise<any> {
  const lista = porEndpoint.get(endpoint);
  if (!lista) throw new Error(`view_functions: endpoint desconhecido '${endpoint}'`);
  return async (kw: Record<string, any> = {}) => {
    const r = lista.filter((x) => x.convs.every((c) => kw[c.nome] !== undefined)).sort((a, b) => b.convs.length - a.convs.length)[0] ?? lista[0];
    return r.handler(...r.convs.map((c) => kw[c.nome]));
  };
}
export const get = (endpoint: string, regra: string, h: Handler) => route(endpoint, regra, ["GET"], h);
export const post = (endpoint: string, regra: string, h: Handler) => route(endpoint, regra, ["POST"], h);

export function contextProcessor(fn: () => Record<string, any>) { processadoresContexto.push(fn); }
export function beforeRequest(fn: () => Promise<any> | any) { antesDaRequisicao.push(fn); }
export function errorHandler(cod: number, fn: (e: HttpErro) => Promise<any> | any) { tratadoresErro.set(cod, fn); }
export function templateFilter(nome: string, fn: (...a: any[]) => any) { filtros.push([nome, fn]); }
export function templateGlobal(nome: string, v: any) { globais.push([nome, v]); }
/** Pasta de estáticos de um blueprint (url_for('<bp>.static')). */
export function blueprintStatic(bp: string, caminhoPublico: string) { estaticos[bp + ".static"] = caminhoPublico; }

// ── Contexto da requisição (equivalente a request/session/g do Flask) ──
interface Ctx { req: Req; sessao: Sessao; resp?: Resposta; }
const als = new AsyncLocalStorage<Ctx>();
function ctx(): Ctx {
  const c = als.getStore();
  if (!c) throw new Error("Fora de uma requisição.");
  return c;
}
export function request(): Req { return ctx().req; }
export function session(): Sessao { return ctx().sessao; }
export function g(): Record<string, any> { return ctx().req.g; }

export function flash(msg: string, categoria = "message") {
  const s = session();
  s.set("_flashes", [...(s.get("_flashes") ?? []), [categoria, msg]]);
}
export function getFlashedMessages(withCategories = false, categoryFilter: string[] = []) {
  const s = session();
  const c = ctx() as any;
  if (c.__flashes === undefined) { c.__flashes = s.get("_flashes") ?? []; if (s.has("_flashes")) s.pop("_flashes"); }
  let l: [string, string][] = c.__flashes;
  if (categoryFilter.length) l = l.filter(([cat]) => categoryFilter.includes(cat));
  return withCategories ? l.map((x) => [x[0], x[1]]) : l.map((x) => x[1]);
}

// ── url_for ─────────────────────────────────────────────────────
function valorUrl(v: any) {
  if (v instanceof PyDate) return v.isoformat();
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}
export function urlFor(endpoint: string, valores: Record<string, any> = {}): string {
  const vals: Record<string, any> = { ...valores };
  if (vals.__splat) { Object.assign(vals, vals.__splat); delete vals.__splat; }
  delete vals.__keywords;
  const ancora = vals._anchor; delete vals._anchor;
  const externo = vals._external; delete vals._external;
  delete vals._method; delete vals._scheme;
  let caminho: string;
  if (estaticos[endpoint]) {
    caminho = estaticos[endpoint] + "/" + String(vals.filename ?? "").replace(/^\//, "");
    delete vals.filename;
  } else {
    const lista = porEndpoint.get(endpoint);
    if (!lista) throw new Error(`url_for: endpoint desconhecido '${endpoint}'`);
    // escolhe a regra que consome mais valores fornecidos (como o Werkzeug)
    const cand = lista.filter((r) => r.convs.every((c) => vals[c.nome] !== undefined && vals[c.nome] !== null))
      .sort((a, b) => b.convs.length - a.convs.length);
    const r = cand[0];
    if (!r) throw new Error(`url_for('${endpoint}'): faltam parâmetros (${lista[0].convs.map((c) => c.nome).join(", ")})`);
    caminho = r.regra.replace(/<(?:(\w+)(?:\([^)]*\))?:)?(\w+)>/g, (_m, tipo, nome) => {
      const v = vals[nome]; delete vals[nome];
      const s = tipo === "int" ? String(Math.trunc(Number(v))) : valorUrl(v);
      return tipo === "path" ? s.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(s).replace(/%40/g, "@").replace(/%3A/g, ":");
    });
    const mont = montagens.find(([i]) => caminho === i || caminho.startsWith(i + "/"));
    caminho = mont ? mont[1] + caminho.slice(mont[0].length) : PREFIXO + caminho;
  }
  // query string como o Werkzeug: quote_plus com safe="!$'()*,/:;?@~"
  const enc = (t: string) => encodeURIComponent(t).replace(/%20/g, "+")
    .replace(/%(2F|3F|3A|40|24|2C|3B)/g, (m) => decodeURIComponent(m));
  const partes: string[] = [];
  for (const [k, v] of Object.entries(vals)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => partes.push(enc(k) + "=" + enc(valorUrl(x))));
    else partes.push(enc(k) + "=" + enc(valorUrl(v)));
  }
  let url = caminho + (partes.length ? "?" + partes.join("&") : "");
  if (ancora) url += "#" + encodeURIComponent(String(ancora)).replace(/%2F/g, "/");
  if (externo) url = request().host_url.replace(/\/$/, "") + url;
  return url;
}
export const url_for = urlFor;

// ── Templates ───────────────────────────────────────────────────
let ambiente: any = null;
function amb() {
  if (!ambiente) {
    ambiente = criarAmbiente(FONTES);
    for (const [n, f] of filtros) ambiente.addFilter(n, f);
    for (const [n, v] of globais) ambiente.addGlobal(n, v);
  }
  return ambiente;
}

export function csrfToken(): string {
  const s = session();
  if (!s.get("_csrf")) s.set("_csrf", Math.random().toString(16).slice(2) + Date.now().toString(16) + Math.random().toString(16).slice(2));
  return s.get("_csrf");
}

function contextoPadrao(): Record<string, any> {
  const req = request();
  const base: Record<string, any> = {
    request: {
      path: req.path, full_path: req.full_path, url: req.url, method: req.method, endpoint: req.endpoint,
      args: multiDictTemplate(req.args), form: multiDictTemplate(req.form), view_args: req.view_args, host_url: req.host_url,
    },
    session: new Proxy({}, { get: (_t, p: any) => session().get(p) }),
    g: req.g,
    config: {},
    // no template, valor indefinido (Undefined do Jinja) vira "" no url_for; None (null) é omitido
    url_for: (endpoint: string, ...a: any[]) => {
      const [, kw] = separarKwargs(a);
      const ind = (o: any) => { const r: any = {}; for (const k of Object.keys(o)) r[k] = o[k] === undefined ? "" : o[k]; return r; };
      const k2 = ind(kw);
      if (kw.__splat) k2.__splat = ind(kw.__splat);
      return urlFor(endpoint, k2);
    },
    get_flashed_messages: (...a: any[]) => { const [pos, kw] = separarKwargs(a); return getFlashedMessages(kw.with_categories ?? pos[0] ?? false, kw.category_filter ?? pos[1] ?? []); },
    csrf_token: csrfToken,
  };
  for (const p of processadoresContexto) Object.assign(base, p());
  return base;
}

export function renderTemplate(nome: string, contexto: Record<string, any> = {}): string {
  const tudo = { ...contextoPadrao(), ...contexto };
  return amb().render(nome, tudo);
}
export const render_template = renderTemplate;
export function renderTemplateString(src: string, contexto: Record<string, any> = {}): string {
  return amb().renderString(src, { ...contextoPadrao(), ...contexto });
}
export function Markup(html: string) { return marcarSeguro(html); }

export function redirect(url: string, status = 302) { return redir(url, status); }

// ── Despacho ────────────────────────────────────────────────────
function peso(r: Rota) {
  const estatico = r.regra.replace(/<[^>]+>/g, "").length;
  const path = r.convs.some((c) => c.tipo === "path") ? 1 : 0;
  return [path, r.convs.length, -estatico];
}
function casar(req: Req): { rota: Rota; params: Record<string, any> } | "405" | null {
  let metodoErrado = false;
  const achadas: { rota: Rota; m: RegExpExecArray }[] = [];
  for (const r of rotas) {
    const m = r.re.exec(req.rota);
    if (!m) continue;
    const metodos = r.metodos.includes("GET") ? [...r.metodos, "HEAD"] : r.metodos;
    if (!metodos.includes(req.method)) { metodoErrado = true; continue; }
    achadas.push({ rota: r, m });
  }
  if (!achadas.length) return metodoErrado ? "405" : null;
  achadas.sort((a, b) => { const pa = peso(a.rota), pb = peso(b.rota); for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]; return 0; });
  const { rota: r, m } = achadas[0];
  const params: Record<string, any> = {};
  r.convs.forEach((c, i) => { params[c.nome] = c.tipo === "int" ? parseInt(m[i + 1], 10) : c.tipo === "float" ? parseFloat(m[i + 1]) : decodeURIComponent(m[i + 1]); });
  return { rota: r, params };
}

function paraResposta(v: any): Resposta {
  if (v instanceof Resposta) return v;
  if (Array.isArray(v) && v.length >= 2 && typeof v[1] === "number") {
    const r = paraResposta(v[0]); r.status = v[1];
    if (v[2]) for (const [k, x] of Object.entries(v[2])) r.headers.set(k, String(x));
    return r;
  }
  if (typeof v === "string" || (v && typeof v === "object" && v.constructor?.name === "SafeString")) return new Resposta(String(v), 200);
  if (v === null || v === undefined) throw new Error("A view não retornou resposta.");
  return jsonify(v);
}

/** current_app.make_response(v): converte o retorno de uma view em Resposta. */
export function makeResponse(v: any): Resposta { return paraResposta(v); }

const PAGINA_ERRO: Record<number, [string, string]> = {
  400: ["Bad Request", "The browser (or proxy) sent a request that this server could not understand."],
  403: ["Forbidden", "You don't have the permission to access the requested resource. It is either read-protected or not readable by the server."],
  404: ["Not Found", "The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again."],
  405: ["Method Not Allowed", "The method is not allowed for the requested URL."],
  500: ["Internal Server Error", "The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application."],
};
function paginaErro(cod: number, desc?: string) {
  const [t, d] = PAGINA_ERRO[cod] ?? ["Erro", ""];
  return new Resposta(`<!doctype html>\n<html lang=en>\n<title>${cod} ${t}</title>\n<h1>${t}</h1>\n<p>${(desc || d).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>\n`, cod);
}

async function tratarErro(e: HttpErro): Promise<Resposta> {
  if (e.resposta) return e.resposta;
  const h = tratadoresErro.get(e.codigo);
  if (h) { const v = await h(e); const r = paraResposta(v); if (!(v instanceof Resposta) && !Array.isArray(v)) r.status = e.codigo; return r; }
  return paginaErro(e.codigo, e.descricao);
}

export interface OpcoesDespacho { usuarioTeste?: string }

/** Processa uma requisição do Next.js como o Flask faria. */
export async function despachar(r: Request, preparar?: (req: Req) => Promise<void> | void): Promise<Response> {
  const req = await Req.deRequest(r);
  const mont = montagens.find(([, e]) => req.path === e || req.path.startsWith(e + "/"));
  if (mont) req.rota = mont[0] + req.path.slice(mont[1].length);
  const sessao = Sessao.ler(req.cookies.get(Sessao.nomeCookie));
  return als.run({ req, sessao }, () => comCacheDeLeitura(async () => {
    let resp: Resposta;
    try {
      if (preparar) await preparar(req);
      const m = casar(req);
      if (m && m !== "405") { req.endpoint = m.rota.endpoint; req.view_args = m.params; }
      let antes: any = undefined;
      for (const f of antesDaRequisicao) { antes = await f(); if (antes !== undefined && antes !== null) break; }
      if (antes !== undefined && antes !== null) resp = paraResposta(antes);
      else if (m === null) {
        // como o Werkzeug: /x sem a barra final redireciona para /x/ quando essa regra existe
        const comBarra = req.rota.endsWith("/") ? null : casar(Object.assign(Object.create(Object.getPrototypeOf(req)), req, { rota: req.rota + "/" }));
        if (comBarra && comBarra !== "405") resp = redir(req.path + "/" + (req.query ? "?" + req.query : ""), 308);
        else throw new HttpErro(404);
      }
      else if (m === "405") throw new HttpErro(405);
      else {
        const nomes = m.rota.convs.map((c) => c.nome);
        resp = paraResposta(await m.rota.handler(...nomes.map((n) => m.params[n])));
      }
    } catch (e: any) {
      if (e instanceof HttpErro) resp = await tratarErro(e);
      else {
        console.error("[erp]", req.method, req.path, e);
        resp = paginaErro(500);
      }
    }
    for (const c of req.cookiesSaida) resp.headers.append("set-cookie", c);
    if (sessao.alterada) resp.headers.append("set-cookie", sessao.cookie());
    if (req.method === "HEAD") return new Response(null, { status: resp.status, headers: resp.headers });
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  }));
}

export { MultiDict };
