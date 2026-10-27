/* eslint-disable @typescript-eslint/no-explicit-any */
// Sessão em cookie assinado (como a do Flask): CSRF, mensagens (flash) e preferências.
import crypto from "node:crypto";

const NOME = "erp_sess";
const DURACAO = 12 * 3600;

function segredo(): string {
  const s = process.env.ERP_SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("ERP_SESSION_SECRET não configurada.");
  return "dev-somente-local";
}
function assinar(v: string) { return crypto.createHmac("sha256", segredo()).update(v).digest("base64url"); }

export class Sessao {
  dados: Record<string, any> = {};
  alterada = false;
  static ler(cookie: string | undefined): Sessao {
    const s = new Sessao();
    if (!cookie) return s;
    const i = cookie.lastIndexOf(".");
    if (i < 0) return s;
    const corpo = cookie.slice(0, i), ass = cookie.slice(i + 1);
    const esperado = assinar(corpo);
    if (ass.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(ass), Buffer.from(esperado))) return s;
    try {
      const d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
      if (d && typeof d === "object" && (!d.__exp || d.__exp > Date.now() / 1000)) { delete d.__exp; s.dados = d; }
    } catch { /* cookie inválido */ }
    return s;
  }
  get(k: string, def: any = null) { return k in this.dados ? this.dados[k] : def; }
  set(k: string, v: any) { this.dados[k] = v; this.alterada = true; }
  pop(k: string, def: any = null) { const v = this.get(k, def); if (k in this.dados) { delete this.dados[k]; this.alterada = true; } return v; }
  has(k: string) { return k in this.dados; }
  clear() { this.dados = {}; this.alterada = true; }
  cookie(): string {
    const corpo = Buffer.from(JSON.stringify({ ...this.dados, __exp: Math.floor(Date.now() / 1000) + DURACAO }), "utf8").toString("base64url");
    const seguro = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `${NOME}=${corpo}.${assinar(corpo)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACAO}${seguro}`;
  }
  static nomeCookie = NOME;
}

export function tokenAleatorio(n = 16) { return crypto.randomBytes(n).toString("hex"); }
