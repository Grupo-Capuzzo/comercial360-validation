/* eslint-disable @typescript-eslint/no-explicit-any */
// Login: o mesmo do Supabase Auth usado no site da Bia. Os dados do usuário
// (perfil, empresas liberadas) continuam em erp.portal_usuarios, ligados pelo e-mail.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { supabaseConfig } from "@/lib/supabase/config";

import { request } from "./app";

type CookieSet = { name: string; value: string; options?: Record<string, any> };

function serializar({ name, value, options = {} }: CookieSet) {
  const p = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined) p.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) p.push(`Expires=${new Date(options.expires).toUTCString()}`);
  if (options.domain) p.push(`Domain=${options.domain}`);
  if (options.httpOnly) p.push("HttpOnly");
  if (options.secure) p.push("Secure");
  p.push(`SameSite=${typeof options.sameSite === "string" ? options.sameSite[0].toUpperCase() + options.sameSite.slice(1) : "Lax"}`);
  return p.join("; ");
}

/** Cliente Supabase da requisição atual (lê e grava os cookies de sessão). */
export function supabaseDaRequisicao() {
  const req = request();
  return createServerClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    cookies: {
      getAll() { return Array.from(req.cookies.entries()).map(([name, value]) => ({ name, value })); },
      setAll(lista: CookieSet[]) {
        for (const c of lista) { req.cookiesSaida.push(serializar(c)); req.cookies.set(c.name, c.value); }
      },
    },
  });
}

/** Cliente administrativo (chave secreta, só no servidor): criar usuários, trocar senhas. */
export function supabaseAdmin() {
  const chave = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave) throw new Error("SUPABASE_SECRET_KEY não configurada.");
  return createClient(supabaseConfig.url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** E-mail do usuário logado no Supabase (ou null). */
export async function emailLogado(): Promise<string | null> {
  if (process.env.NODE_ENV !== "production" && process.env.ERP_TESTE_USUARIO) return process.env.ERP_TESTE_USUARIO;
  try {
    const sb = supabaseDaRequisicao();
    const { data } = await sb.auth.getClaims();
    const email = (data?.claims as any)?.email;
    return email ? String(email).toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function entrar(email: string, senha: string): Promise<string | null> {
  const sb = supabaseDaRequisicao();
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  return error ? error.message : null;
}

export async function sair() {
  try { await supabaseDaRequisicao().auth.signOut(); } catch { /* ignora */ }
}

/** Confere a senha sem alterar a sessão atual. */
export async function senhaConfere(email: string, senha: string): Promise<boolean> {
  const sb = createClient(supabaseConfig.url, supabaseConfig.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  return !error;
}

/** Cria ou atualiza o usuário no Supabase Auth. */
export async function definirUsuarioAuth(email: string, senha?: string) {
  const adm = supabaseAdmin();
  const { data } = await adm.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existente = data?.users?.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  if (existente) {
    if (senha) {
      const { error } = await adm.auth.admin.updateUserById(existente.id, { password: senha });
      if (error) throw error;
    }
    return existente.id;
  }
  if (!senha) throw new Error("Informe uma senha provisória.");
  const { data: novo, error } = await adm.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (error) throw error;
  return novo.user?.id;
}
