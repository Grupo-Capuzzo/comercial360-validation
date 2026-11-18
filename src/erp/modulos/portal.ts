/* eslint-disable @typescript-eslint/no-explicit-any */
// Portal do Grupo Capuzzo (porte de app/portal_grupo.py) — login, empresas e módulos.
// Diferença do original: a senha é a do Supabase Auth (o mesmo login do site da Bia).
import {
  Markup, PyDate, abort, beforeRequest, contextProcessor, errorHandler, flash, g, get, q, q1, redirect,
  render_template, request, route, run, session, url_for, montarPublico, post, sendFile,
} from "../core/flask";
import { definirUsuarioAuth, emailLogado, entrar, sair, senhaConfere } from "../core/auth";
import { ICONES_PORTAL } from "../dados/icones";
import { limparMemo, memo } from "../core/memo";
import { temAcessoJuridico, emVisaoJuridica, rotaDaVisaoJuridica } from "./juridico/acesso";
import { lerArquivo, salvarArquivo } from "../core/arquivos";

export const TEMA_GRUPO: Record<string, string> = {
  primary: "#0B0B0B", secondary: "#1C1A16", accent: "#C9A45C",
  accent_dark: "#9E7C34", on_primary: "#F5EFE2", on_accent: "#141210",
  bg: "#F4F1EA", surface: "#FFFFFF", text: "#1A1814", muted: "#6F685C",
  font_head: "Montserrat",
};

export const EMPRESAS: any[] = [
  {
    slug: "assessoria", nome: "Capuzzo Assessoria & Consultoria",
    descricao: "Assessoria e consultoria empresarial", logo: "assessoria.png",
    tema: { primary: "#0A0A0A", secondary: "#2A2418", accent: "#C7A955", accent_dark: "#9E7C34", on_primary: "#F3EBD6", on_accent: "#141210", bg: "#F5F2EA", text: "#16140F", muted: "#6E6552", font_head: "Montserrat" },
    modulos: [
      { id: "condominios", nome: "Condomínios de Investimento", icone: "apartment", desc: "Clientes, cotas, apuração, vencimentos e títulos privados.", destino: "/" },
    ],
  },
  {
    slug: "cred", nome: "Capuzzo Cred", descricao: "", logo: "cred.png",
    tema: { primary: "#0D0D0D", secondary: "#3A2E1B", accent: "#D4B26A", accent_dark: "#A68646", on_primary: "#F6EEDC", on_accent: "#15120C", bg: "#F6F3EC", text: "#15130F", muted: "#6B6250", font_head: "Nunito" },
    modulos: [],
  },
  {
    slug: "ethernexus", nome: "Ether Nexus", descricao: "Centro de Excelência Médica e Empresarial", logo: "ethernexus.png",
    tema: { primary: "#1B4D91", secondary: "#236A9D", accent: "#2F8FD8", accent_dark: "#1B4D91", on_primary: "#FFFFFF", on_accent: "#FFFFFF", bg: "#EEF3FA", text: "#10223D", muted: "#5A6B85", font_head: "Mulish" },
    modulos: [],
  },
  {
    slug: "grao", nome: "Grão", descricao: "", logo: "grao.png",
    tema: { primary: "#3F2117", secondary: "#5E3A24", accent: "#BD944F", accent_dark: "#8E6A34", on_primary: "#F3E6CF", on_accent: "#2B160E", bg: "#F6EFE3", surface: "#FFFCF7", text: "#2E1A12", muted: "#7A6250", font_head: "Oswald" },
    modulos: [],
  },
  {
    slug: "hortstufas", nome: "Hortstufas", descricao: "Soluções para crescer", logo: "hortstufas.png",
    tema: { primary: "#0F1A0C", secondary: "#24461A", accent: "#3E9B1C", accent_dark: "#2C7512", on_primary: "#EEF5E6", on_accent: "#FFFFFF", bg: "#F1F6EC", text: "#15210F", muted: "#5F6F55", font_head: "Montserrat" },
    modulos: [],
  },
  {
    slug: "terceiriza", nome: "Terceiriza Fácil", descricao: "BPO inteligente", logo: "terceiriza.png",
    tema: { primary: "#06214A", secondary: "#0458A1", accent: "#0692E7", accent_dark: "#0458A1", on_primary: "#EAF4FF", on_accent: "#FFFFFF", bg: "#EEF5FC", text: "#0B1B33", muted: "#566A86", font_head: "Raleway" },
    modulos: [],
  },
  {
    slug: "worldgym", nome: "World Gym", descricao: "Health Club", logo: "worldgym.png",
    tema: { primary: "#111111", secondary: "#2B2618", accent: "#C0A040", accent_dark: "#8C7328", on_primary: "#FFFFFF", on_accent: "#111111", bg: "#F3F2EF", text: "#141414", muted: "#66625A", font_head: "Roboto Slab" },
    modulos: [],
  },
];
// Módulo Finanças nas empresas que o utilizam.
for (const e of EMPRESAS) {
  if (["assessoria", "cred", "ethernexus", "terceiriza", "hortstufas", "worldgym", "grao"].includes(e.slug)) {
    e.modulos.push({ id: "financas", nome: "Finanças", icone: "payments", desc: "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.", destino: `/financas/${e.slug}/` });
  }
  // Orçamentos (cotações de fornecedores → aprovação → contas a pagar)
  if (["ethernexus", "grao"].includes(e.slug)) {
    e.modulos.push({ id: "orcamentos", nome: "Orçamentos", icone: "receipt_long", desc: "Cotações com fornecedores, aprovação e lançamento no contas a pagar.", destino: `/orcamentos/${e.slug}/` });
  }
}
export const EMPRESAS_POR_SLUG: Record<string, any> = Object.fromEntries(EMPRESAS.map((e) => [e.slug, e]));
const SLUGS_FIXOS = new Set(EMPRESAS.map((e) => e.slug));

// ───────────── Empresas cadastradas pela Administração (tabela portal_empresas) ─────────────
// Nascem com os módulos padrão: Finanças no modelo padrão (contas a pagar/receber, extrato,
// conciliação, fluxo, DRE — sem os módulos específicos da Capuzzo), Comercial e Jurídico (o Jurídico
// aparece para quem tem acesso ao Jurídico Geral, como nas outras empresas).
export const MODULOS_PADRAO: Record<string, (slug: string) => any> = {
  financas: (slug) => ({ id: "financas", nome: "Finanças", icone: "payments", desc: "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.", destino: `/financas/${slug}/` }),
  comercial: () => ({ id: "comercial", nome: "Comercial", icone: "handshake", desc: "Clientes, oportunidades e funil de vendas da empresa. Em preparação: será ligado ao Comercial (CRM) do Grupo.", destino: null, status: "construcao" }),
  orcamentos: (slug) => ({ id: "orcamentos", nome: "Orçamentos", icone: "receipt_long", desc: "Cotações com fornecedores, aprovação e lançamento no contas a pagar.", destino: `/orcamentos/${slug}/` }),
};
export const FONTES = ["Montserrat", "Poppins", "Nunito", "Mulish", "Raleway", "Oswald", "Roboto Slab", "Lato", "Inter"];
const COR = /^#[0-9a-f]{6}$/i;
export const CHAVES_TEMA = ["primary", "secondary", "accent", "accent_dark", "on_primary", "on_accent", "bg", "text", "muted"];

function empresa_da_linha(r: any) {
  let t: any = {};
  try { t = JSON.parse(r.tema || "{}"); } catch { t = {}; }
  const tema: Record<string, string> = {};
  for (const k of CHAVES_TEMA) if (COR.test(t[k] ?? "")) tema[k] = t[k];
  tema.font_head = FONTES.includes(t.font_head) ? t.font_head : "Montserrat";
  const mods = String(r.modulos || "").split(",").map((x) => x.trim()).filter((x) => MODULOS_PADRAO[x]);
  return {
    slug: r.slug, nome: r.nome, descricao: r.descricao || "", logo: "", logo_db: !!r.logo_caminho, logo_versao: r.logo_versao || 0,
    tema, modulos: mods.map((m) => MODULOS_PADRAO[m](r.slug)), cadastrada: true, mod_ids: mods,
  };
}
/** Junta as empresas cadastradas no banco à lista fixa (em memória, 30 s). */
export async function carregar_empresas() {
  const linhas: any[] = await memo("portal:empresas_db", 30000, async () => {
    try { return await q("SELECT * FROM portal_empresas ORDER BY ordem, nome"); } catch { return []; }
  });
  const novas = linhas.filter((r) => !SLUGS_FIXOS.has(r.slug)).map(empresa_da_linha);
  const atuais = new Set(novas.map((e) => e.slug));
  for (let i = EMPRESAS.length - 1; i >= 0; i--) if (EMPRESAS[i].cadastrada && !atuais.has(EMPRESAS[i].slug)) { delete EMPRESAS_POR_SLUG[EMPRESAS[i].slug]; EMPRESAS.splice(i, 1); }
  for (const e of novas) {
    const i = EMPRESAS.findIndex((x) => x.slug === e.slug);
    if (i >= 0) EMPRESAS[i] = e; else EMPRESAS.push(e);
    EMPRESAS_POR_SLUG[e.slug] = e;
  }
}
/** Endereço da logo: as fixas ficam nos arquivos do site; as cadastradas, no banco. */
export function logo_url(e: any) {
  if (!e) return "";
  if (e.cadastrada) return url_for("portal_logo", { slug: e.slug, v: e.logo_versao || 0 });
  return url_for("static", { filename: "portal/logos/" + e.logo });
}
export function slug_de(nome: string) {
  const base = nome.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "empresa";
  let s = base, n = 2;
  while (EMPRESAS_POR_SLUG[s] || ["grupo", "admin", "central", "login", "erp", "static"].includes(s)) s = `${base}${n++}`;
  return s;
}

export const EMPRESA_CONDOMINIOS = "assessoria";
/** Prefixo da URL → empresa dona do módulo. */
export const PREFIXOS_MODULOS: Record<string, string> = {};
/** Rotas que não exigem login (caminho interno). */
export const ROTAS_PUBLICAS: string[] = ["/login", "/grupo/logo/"];

export const STATUS: Record<string, string> = { ativo: "Ativo", pendente: "Pendente", inativo: "Inativo" };
const LOGIN_MAX_TENTATIVAS = 5;
const LOGIN_BLOQUEIO_MIN = 15;

export function ic(nome: string) {
  return Markup(`<svg class="ms" viewBox="0 0 24 24" aria-hidden="true">${ICONES_PORTAL[nome] ?? ""}</svg>`);
}
export function tema(t?: Record<string, string> | null) { return { ...TEMA_GRUPO, ...(t ?? {}) }; }
export function modulos_da_empresa(empresa: any) {
  return (empresa.modulos ?? []).map((m: any) => ({ ...m, status: m.status ?? "ativo" }));
}

function agora() { return PyDate.now().isoformat("T"); }

// Leituras feitas em toda página ficam 30 s em memória; as telas de administração limpam o cache.
const TTL = 30000;
export async function status_empresas(): Promise<Record<string, any>> {
  return memo("portal:status", TTL, async () => Object.fromEntries((await q("SELECT slug, status, obs FROM portal_empresa_status")).map((r) => [r.slug, r])));
}
export async function empresas_com_status() {
  const st = await status_empresas();
  return EMPRESAS.map((e) => {
    const s = st[e.slug] ?? {};
    return { ...e, status: s.status ?? "ativo", obs: s.obs ?? "", tema_full: tema(e.tema) };
  });
}
export async function empresas_liberadas(usuario_id: number): Promise<Set<string>> {
  const l = await memo(`portal:emp:${usuario_id}`, TTL, async () => (await q("SELECT empresa_slug FROM portal_usuario_empresas WHERE usuario_id = ?", [usuario_id])).map((r) => r.empresa_slug as string));
  return new Set(l);
}
/** Admin (gestor) com empresas marcadas trabalha só nelas; sem nenhuma marcada, vê todas. */
export async function pode_ver(user: any, slug: string) {
  const lib = await empresas_liberadas(user.id);
  if (user.perfil === "admin") return lib.size === 0 || lib.has(slug);
  return lib.has(slug);
}

/** Setores dos chamados. Cada usuário recebe os chamados dos setores marcados em Administração. */
export const SETORES = ["Financeiro", "Comercial", "Processos", "Contábil", "Jurídico"];
export async function setores_do_usuario(uid: number): Promise<string[]> {
  return memo(`portal:set:${uid}`, TTL, async () => (await q("SELECT setor FROM portal_usuario_setores WHERE usuario_id = ?", [uid])).map((r) => r.setor as string));
}
/** Filtro SQL dos chamados que o usuário vê: administrador vê todos; usuário sem setor marcado também
 *  (como era antes); com setores, vê os desses setores e os que ele abriu ou dos quais é responsável. */
export async function filtro_chamados(user: any, alias = ""): Promise<[string, any[]]> {
  if (user.admin) return ["", []];
  const set = await setores_do_usuario(user.id);
  if (!set.length) return ["", []];
  return [` AND (${alias}setor IN (${set.map(() => "?").join(",")}) OR ${alias}aberto_por = ? OR ${alias}responsavel_id = ?)`, [...set, user.id, user.id]];
}

/** Hierarquia gestor → equipe (portal_usuarios.gestor_id), em cache de 30 s. */
async function hierarquia(): Promise<Map<number, number[]>> {
  const linhas = await memo("portal:hier", TTL, async () => await q("SELECT id, gestor_id FROM portal_usuarios WHERE ativo = 1"));
  const filhos = new Map<number, number[]>();
  for (const r of linhas) if (r.gestor_id) (filhos.get(r.gestor_id) ?? filhos.set(r.gestor_id, []).get(r.gestor_id)!).push(r.id);
  return filhos;
}
/** Todos abaixo do gestor (equipe direta e a equipe dos gestores dela), sem ele próprio. */
export async function equipe_ids(gestor_id: number): Promise<number[]> {
  const filhos = await hierarquia();
  const vistos = new Set<number>([gestor_id]);
  const fila = [gestor_id];
  while (fila.length) for (const f of filhos.get(fila.shift()!) ?? []) if (!vistos.has(f)) { vistos.add(f); fila.push(f); }
  vistos.delete(gestor_id);
  return [...vistos];
}
/** De quem são as demandas que o usuário acompanha: ele próprio + a equipe (se for gestor). */
export async function escopo_demandas(user: any): Promise<number[]> {
  return user.admin ? [user.id, ...(await equipe_ids(user.id))] : [user.id];
}
/** Módulos liberados para o usuário numa empresa (null = todos). Admin vê todos; sem nenhuma
 *  linha em portal_usuario_modulos para a empresa, também vê todos (como era antes). */
export async function modulos_liberados(user: any, slug: string): Promise<Set<string> | null> {
  if (!user || user.perfil === "admin") return null;
  const todos = await memo(`portal:mod:${user.id}`, TTL, async () => await q("SELECT empresa_slug, modulo_id FROM portal_usuario_modulos WHERE usuario_id = ?", [user.id]));
  const l = todos.filter((r) => r.empresa_slug === slug && r.empresa_slug !== "_grupo");
  return l.length ? new Set(l.map((r) => r.modulo_id)) : null;
}
/** CRM Geral (Comercial da Bia): administradores e usuários com o acesso liberado em Administração. */
export const CRM_DESTINO = "/comercial/40ca9f00-a17c-4605-9323-a15974c52817";
export async function tem_crm(user: any): Promise<boolean> {
  if (!user) return false;
  if (user.perfil === "admin") return true;
  const todos = await memo(`portal:mod:${user.id}`, TTL, async () => await q("SELECT empresa_slug, modulo_id FROM portal_usuario_modulos WHERE usuario_id = ?", [user.id]));
  return todos.some((r) => r.empresa_slug === "_grupo" && r.modulo_id === "crm");
}

/** Jurídico Geral liberado em Administração para um usuário comum (administrador já tem). */
export async function tem_juridico_geral(user: any): Promise<boolean> {
  if (!user || user.perfil === "admin") return false;
  const todos = await memo(`portal:mod:${user.id}`, TTL, async () => await q("SELECT empresa_slug, modulo_id FROM portal_usuario_modulos WHERE usuario_id = ?", [user.id]));
  return todos.some((r) => r.empresa_slug === "_grupo" && r.modulo_id === "juridico");
}

export async function pode_ver_modulo(user: any, slug: string, modulo: string) {
  if (!(await pode_ver(user, slug))) return false;
  const lib = await modulos_liberados(user, slug);
  return lib === null || lib.has(modulo);
}
async function modulos_visiveis(user: any, e: any) {
  const lib = await modulos_liberados(user, e.slug);
  const modulos = emVisaoJuridica(user) ? [] : modulos_da_empresa(e).filter((m: any) => lib === null || lib.has(m.id));
  if (temAcessoJuridico(user)) modulos.push({ id: "juridico", nome: "Jurídico", icone: "account_balance", desc: "Casos, movimentações e prazos jurídicos da empresa.", status: "ativo", destino: `/juridico/empresa/${e.slug}` });
  return modulos;
}

export async function empresas_visiveis(user: any) {
  const todas = await empresas_com_status();
  const lib = await empresas_liberadas(user.id);
  if (user.perfil === "admin") return lib.size ? todas.filter((e) => lib.has(e.slug)) : todas;
  return todas.filter((e) => lib.has(e.slug) && e.status !== "inativo");
}
export function validar_senha(senha: string) {
  if ((senha ?? "").length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (/^\p{L}+$/u.test(senha) || /^\d+$/.test(senha)) return "Use letras e números na senha.";
  return null;
}
async function falhas_recentes(email: string) {
  const limite = PyDate.now().addSeconds(-LOGIN_BLOQUEIO_MIN * 60).isoformat("T");
  const ok = await q1("SELECT MAX(momento) AS m FROM portal_login_tentativas WHERE email = ? AND sucesso = 1", [email]);
  const m = ok?.m;
  const desde = m && m > limite ? m : limite;
  const r = await q1("SELECT COUNT(*) AS n FROM portal_login_tentativas WHERE email = ? AND sucesso = 0 AND momento > ?", [email, desde]);
  return r!.n;
}
async function tentativa(email: string, sucesso: boolean) {
  await run("INSERT INTO portal_login_tentativas (email, momento, sucesso) VALUES (?, ?, ?)", [email, agora(), sucesso ? 1 : 0]);
}

export function checar_csrf() {
  if (request().form.get("_csrf") !== session().get("_csrf")) abort(400, "Formulário expirado. Recarregue a página e tente de novo.");
}
export function exige_admin() {
  const u = g().portal_user;
  if (!u || !u.admin) abort(403);
}

export function registrar() {
  montarPublico("/login", "/login-grupo");

  contextProcessor(() => ({ portal_user: g().portal_user ?? null, acesso_juridico: temAcessoJuridico(g().portal_user), visao_juridica: emVisaoJuridica(g().portal_user), STATUS, tema_grupo: TEMA_GRUPO, ic, logo_url }));

  // ── Porteiro: nenhuma página abre sem login ──
  beforeRequest(async () => {
    const G = g();
    G.portal_user = null;
    await carregar_empresas();
    const email = await emailLogado();
    if (email) {
      const u0 = await memo(`portal:user:${email}`, TTL, async () => await q1("SELECT id, nome, email, perfil, ativo FROM portal_usuarios WHERE lower(email) = ?", [email]));
      const u = u0 ? { ...u0 } : null;
      if (u && u.ativo) {
        const visao = session().get("portal_visao") ?? (u.perfil === "admin" ? "admin" : "usuario");
        u.admin = u.perfil === "admin" && visao === "admin";
        u.modo_juridico = visao === "juridico" && u.perfil === "admin";
        u.crm = emVisaoJuridica(u) ? false : await tem_crm(u);
        u.juridico_geral = await tem_juridico_geral(u);
        G.portal_user = u;
      }
    }
    const caminho = request().rota;
    if (ROTAS_PUBLICAS.some((p) => caminho === p || (p.endsWith("/") && caminho.startsWith(p)))) return null;
    if (!G.portal_user) {
      if (email) {
        // logado no Supabase, mas sem cadastro no portal
        return [render_template("portal/erro.html", { t: TEMA_GRUPO, codigo: 403, msg: "Seu usuário não tem acesso ao portal. Fale com o administrador." }), 403];
      }
      return redirect(url_for("portal_login", { next: caminho !== "/" ? request().path : null }));
    }
    if (emVisaoJuridica(G.portal_user)) {
      if (caminho === "/inicio" || caminho === "/central") return redirect(url_for("juridico.geral"));
      if (!rotaDaVisaoJuridica(caminho)) abort(403);
    }
    if (caminho === "/central") return redirect(url_for("portal_grupo"));
    if (caminho === "/juridico/pedidos" || caminho.startsWith("/juridico/pedidos/") || caminho.startsWith("/juridico/documento/") || caminho === "/juridico/encaminhar") return null; // handlers conferem autor/empresa/perfil
    if (caminho === "/juridico" || caminho.startsWith("/juridico/")) return temAcessoJuridico(G.portal_user) ? null : abort(403);
    if (caminho.startsWith("/grupo") || caminho.startsWith("/logout") || caminho.startsWith("/inicio") || caminho.startsWith("/treinamentos") || caminho === "/crm-geral") return null;
    if (caminho.startsWith("/central/")) return G.portal_user.admin ? null : abort(403);
    for (const [prefixo, slug] of Object.entries(PREFIXOS_MODULOS)) {
      if (caminho === prefixo || caminho.startsWith(prefixo + "/")) return (await pode_ver(G.portal_user, slug)) ? null : abort(403);
    }
    const orc = /^\/orcamentos\/([^/]+)/.exec(caminho);
    if (orc) return (await pode_ver_modulo(G.portal_user, orc[1], "orcamentos")) ? null : abort(403);
    const fin = /^\/financas\/([^/]+)/.exec(caminho);
    if (fin) return (await pode_ver_modulo(G.portal_user, fin[1], "financas")) ? null : abort(403);
    if (caminho.startsWith("/operacao/")) return null; // cada rota confere a empresa
    if (!(await pode_ver_modulo(G.portal_user, EMPRESA_CONDOMINIOS, "condominios"))) abort(403);
    return null;
  });

  post("portal_visao_juridico", "/grupo/visao-juridico", async () => {
    if (g().portal_user?.perfil !== "admin") abort(403);
    if (!request().form.get("_csrf") || !session().get("_csrf")) abort(400,"Recarregue a página antes de trocar a visão.");
    checar_csrf();
    const ativar = request().form.get("ativar") === "1";
    session().set("portal_visao", ativar ? "juridico" : "admin");
    return redirect(url_for(ativar ? "juridico.geral" : "portal_inicio"), 303);
  });

  // ── Login ──
  route("portal_login", "/login", ["GET", "POST"], async () => {
    const req = request();
    if (g().portal_user) return redirect(url_for("portal_inicio"));
    let erro: string | null = null, email = "", acesso = "usuario";
    if (req.method === "POST") {
      checar_csrf();
      email = (req.form.get("email") ?? "").trim().toLowerCase();
      const senha = req.form.get("senha") ?? "";
      acesso = req.form.get("acesso") === "admin" ? "admin" : "usuario";
      const u = email ? await q1("SELECT * FROM portal_usuarios WHERE lower(email) = ?", [email]) : null;
      if (!email || !senha) erro = "Informe e-mail e senha.";
      else if ((await falhas_recentes(email)) >= LOGIN_MAX_TENTATIVAS) erro = `Muitas tentativas. Aguarde ${LOGIN_BLOQUEIO_MIN} minutos e tente novamente.`;
      else if (!u || !u.ativo || (await entrar(email, senha)) !== null) { await sair(); await tentativa(email, false); erro = "E-mail ou senha incorretos."; }
      else if (acesso === "admin" && u.perfil !== "admin") { await sair(); await tentativa(email, false); erro = "Este usuário não tem acesso de Administrador. Entre como Usuário."; }
      else {
        await tentativa(email, true);
        await run("UPDATE portal_usuarios SET ultimo_login = ? WHERE id = ?", [agora(), u.id]);
        const s = session();
        s.clear();
        s.set("portal_visao", acesso);
        let destino = req.args.get("next") ?? "";
        if (!destino.startsWith("/") || destino.startsWith("//")) destino = url_for("portal_inicio");
        return redirect(destino);
      }
    }
    return render_template("portal/login.html", { t: TEMA_GRUPO, erro, email, acesso, marcas: [...EMPRESAS], ano: PyDate.now().year, senha_alterada: req.args.get("message") === "password-updated" });
  });

  get("portal_logout", "/logout", async () => {
    await sair();
    session().clear();
    return redirect(url_for("portal_login"));
  });

  // ── Página inicial do Grupo ──
  get("portal_grupo", "/grupo", async () => {
    const user = g().portal_user;
    const empresas = await empresas_visiveis(user);
    const favs = new Set((await q("SELECT empresa_slug FROM portal_favoritos WHERE usuario_id = ?", [user.id])).map((r) => r.empresa_slug));
    const ordem = Object.fromEntries(EMPRESAS.map((e, i) => [e.slug, i]));
    empresas.sort((a, b) => (Number(!favs.has(a.slug)) - Number(!favs.has(b.slug))) || ordem[a.slug] - ordem[b.slug]);
    return render_template("portal/grupo.html", {
      t: TEMA_GRUPO, empresas, favs,
      ativas: empresas.filter((e) => e.status === "ativo").length,
      pendentes: empresas.filter((e) => e.status === "pendente").length,
    });
  });

  post("portal_favorito", "/grupo/favorito/<slug>", async (slug: string) => {
    checar_csrf();
    const uid = g().portal_user.id;
    if (EMPRESAS_POR_SLUG[slug] && (await pode_ver(g().portal_user, slug))) {
      if ((await q("SELECT 1 FROM portal_favoritos WHERE usuario_id = ? AND empresa_slug = ?", [uid, slug])).length) {
        await run("DELETE FROM portal_favoritos WHERE usuario_id = ? AND empresa_slug = ?", [uid, slug]);
      } else {
        await run("INSERT INTO portal_favoritos VALUES (?, ?)", [uid, slug]);
      }
    }
    return redirect(url_for("portal_grupo") + `#emp-${slug}`);
  });

  async function empresa_ou_404(slug: string) {
    if (!EMPRESAS_POR_SLUG[slug]) abort(404);
    if (!(await pode_ver(g().portal_user, slug))) abort(403);
    const e = (await empresas_com_status()).find((x) => x.slug === slug)!;
    if (e.status === "inativo" && !g().portal_user.admin) abort(403);
    return e;
  }

  get("portal_empresa", "/grupo/empresa/<slug>", async (slug: string) => {
    const e = await empresa_ou_404(slug);
    return render_template("portal/empresa.html", { t: e.tema_full, empresa: e, modulos: await modulos_visiveis(g().portal_user, e) });
  });

  get("portal_modulo", "/grupo/empresa/<slug>/modulo/<modulo_id>", async (slug: string, modulo_id: string) => {
    const e = await empresa_ou_404(slug);
    const mods = await modulos_visiveis(g().portal_user, e);
    const mod = mods.find((m: any) => m.id === modulo_id);
    if (!mod) abort(404);
    if (mod.destino) return redirect(destinoModulo(mod.destino));
    return render_template("portal/modulo.html", { t: e.tema_full, empresa: e, modulos: mods, modulo: mod });
  });

  // ── CRM Geral: o Comercial (Bia) para administradores e quem tem o acesso liberado ──
  get("portal_crm", "/crm-geral", async () => {
    if (!g().portal_user.crm) abort(403);
    return redirect(CRM_DESTINO);
  });

  // ── Alterar a própria senha ──
  route("portal_minha_senha", "/grupo/minha-senha", ["GET", "POST"], async () => {
    const req = request();
    if (req.method === "POST") {
      checar_csrf();
      const u = g().portal_user;
      const [atual, nova, conf] = ["atual", "nova", "conf"].map((k) => req.form.get(k) ?? "");
      let msg: string | null;
      if (!(await senhaConfere(u.email, atual))) flash("Senha atual incorreta.", "erro");
      else if (nova !== conf) flash("A confirmação não confere.", "erro");
      else if ((msg = validar_senha(nova))) flash(msg, "erro");
      else {
        await definirUsuarioAuth(u.email, nova);
        flash("Senha alterada com sucesso.", "ok");
        return redirect(url_for("portal_grupo"));
      }
    }
    return render_template("portal/minha_senha.html", { t: TEMA_GRUPO });
  });

  // ── Administração ──
  async function usuarios_admin() {
    const usuarios = await q("SELECT * FROM portal_usuarios ORDER BY nome");
    const [emps, mods, sets] = await Promise.all([
      q("SELECT usuario_id, empresa_slug FROM portal_usuario_empresas"),
      q("SELECT usuario_id, empresa_slug, modulo_id FROM portal_usuario_modulos"),
      q("SELECT usuario_id, setor FROM portal_usuario_setores")]);
    const nomes = new Map(usuarios.map((u) => [u.id, u.nome]));
    for (const u of usuarios) {
      u.empresas = new Set(emps.filter((r) => r.usuario_id === u.id).map((r) => r.empresa_slug));
      u.modulos = {} as Record<string, string[]>;
      for (const r of mods.filter((x) => x.usuario_id === u.id)) (u.modulos[r.empresa_slug] ??= []).push(r.modulo_id);
      u.crm = u.perfil === "admin" || (u.modulos["_grupo"] ?? []).includes("crm");
      u.juridico = u.perfil === "admin" || u.perfil === "juridico" || (u.modulos["_grupo"] ?? []).includes("juridico");
      u.gestor_nome = u.gestor_id ? (nomes.get(u.gestor_id) ?? "") : "";
      u.equipe_n = usuarios.filter((x) => x.gestor_id === u.id).length;
      u.emp_lista = EMPRESAS.filter((e) => u.empresas.has(e.slug));
      u.setores = sets.filter((r) => r.usuario_id === u.id).map((r) => r.setor);
    }
    return usuarios;
  }

  get("portal_admin", "/grupo/admin", async () => {
    exige_admin();
    const sel = request().args.get("u", null, "int");
    if (sel) return redirect(url_for("portal_admin_editar", { uid: sel }));
    const aba = request().args.get("aba", "usuarios");
    const usuarios = await usuarios_admin();
    return render_template("portal/admin.html", { t: TEMA_GRUPO, usuarios, empresas: await empresas_com_status(), aba, FONTES, MODULOS_PADRAO_LISTA: Object.entries(MODULOS_PADRAO).map(([k, f]) => ({ id: k, ...f("x") })) });
  });

  async function tela_usuario(uid: number | null) {
    const usuarios = await usuarios_admin();
    const u = uid ? usuarios.find((x) => x.id === uid) : null;
    if (uid && !u) abort(404);
    const gestores = usuarios.filter((x) => x.perfil === "admin" && x.ativo && (!u || x.id !== u.id));
    const empresas = (await empresas_com_status()).map((e) => ({ ...e, mods: modulos_da_empresa(e) }));
    return render_template("portal/admin_usuario.html", { t: TEMA_GRUPO, u, gestores, SETORES, empresas });
  }
  get("portal_admin_novo", "/grupo/admin/usuario/novo", async () => { exige_admin(); return tela_usuario(null); });
  get("portal_admin_editar", "/grupo/admin/usuario/<int:uid>", async (uid: number) => { exige_admin(); return tela_usuario(uid); });

  post("portal_admin_usuario", "/grupo/admin/usuario", async () => {
    exige_admin();
    checar_csrf();
    const f = request().form;
    let uid = f.get("id", null, "int");
    const nome = (f.get("nome") ?? "").trim();
    const email = (f.get("email") ?? "").trim().toLowerCase();
    let perfil = f.get("perfil") === "admin" ? "admin" : f.get("perfil") === "juridico" ? "juridico" : "usuario";
    let ativo = f.get("ativo") ? 1 : 0;
    const senha = f.get("senha") ?? "";
    const empresas = f.getlist("empresas").filter((s: string) => EMPRESAS_POR_SLUG[s]);
    let gestor_id: number | null = f.get("gestor_id", null, "int") || null;
    const voltar = uid ? url_for("portal_admin_editar", { uid }) : url_for("portal_admin_novo");
    let msg: string | null;
    if (senha && (msg = validar_senha(senha))) { flash(msg, "erro"); return redirect(voltar); }
    if (gestor_id) {
      const gt = await q1("SELECT id FROM portal_usuarios WHERE id = ? AND perfil = 'admin' AND ativo = 1", [gestor_id]);
      if (!gt) gestor_id = null;
      else if (uid && (gestor_id === uid || (await equipe_ids(uid)).includes(gestor_id))) {
        flash("Esse gestor faz parte da equipe deste usuário. Escolha outro gestor.", "erro");
        return redirect(voltar);
      }
    }
    if (uid) {
      if (uid === g().portal_user.id) { perfil = "admin"; ativo = 1; }
      await run("UPDATE portal_usuarios SET nome = ?, perfil = ?, ativo = ?, gestor_id = ? WHERE id = ?", [nome || "Sem nome", perfil, ativo, gestor_id, uid]);
      if (senha) {
        const u = await q1("SELECT email FROM portal_usuarios WHERE id = ?", [uid]);
        try { await definirUsuarioAuth(u!.email, senha); } catch (e: any) { flash(`Não foi possível definir a senha: ${e.message}`, "erro"); return redirect(voltar); }
      }
      flash("Usuário atualizado.", "ok");
    } else {
      if (!nome || !email.includes("@") || !email.split("@").pop()!.includes(".")) { flash("Informe nome e um e-mail válido.", "erro"); return redirect(voltar); }
      if (!senha) { flash("Informe uma senha provisória.", "erro"); return redirect(voltar); }
      if ((await q("SELECT 1 FROM portal_usuarios WHERE lower(email) = ?", [email])).length) { flash("Já existe um usuário com esse e-mail.", "erro"); return redirect(voltar); }
      try { await definirUsuarioAuth(email, senha); } catch (e: any) { flash(`Não foi possível criar o login: ${e.message}`, "erro"); return redirect(voltar); }
      uid = (await run("INSERT INTO portal_usuarios (nome, email, senha_hash, perfil, criado_em, gestor_id) VALUES (?, ?, ?, ?, ?, ?)", [nome, email, "", perfil, agora(), gestor_id])).lastrowid;
      flash(`Usuário ${nome} criado.`, "ok");
    }
    limparMemo("portal:");
    await run("DELETE FROM portal_usuario_setores WHERE usuario_id = ?", [uid]);
    for (const st of f.getlist("setores").filter((x: string) => SETORES.includes(x))) await run("INSERT INTO portal_usuario_setores (usuario_id, setor) VALUES (?, ?)", [uid, st]);
    await run("DELETE FROM portal_usuario_empresas WHERE usuario_id = ?", [uid]);
    for (const s of empresas) await run("INSERT INTO portal_usuario_empresas VALUES (?, ?)", [uid, s]);
    // módulos por empresa (nenhum marcado = todos os módulos da empresa) + CRM Geral
    const crmAntes = !!(await q1("SELECT 1 AS x FROM portal_usuario_modulos WHERE usuario_id = ? AND empresa_slug = '_grupo' AND modulo_id = 'crm'", [uid]));
    await run("DELETE FROM portal_usuario_modulos WHERE usuario_id = ?", [uid]);
    const crmAgora = !!f.get("crm");
    if (crmAgora) await run("INSERT INTO portal_usuario_modulos (usuario_id, empresa_slug, modulo_id) VALUES (?, '_grupo', 'crm')", [uid]);
    if (f.get("juridico") && perfil === "usuario") await run("INSERT INTO portal_usuario_modulos (usuario_id, empresa_slug, modulo_id) VALUES (?, '_grupo', 'juridico')", [uid]);
    if (crmAntes !== crmAgora && perfil !== "admin") {
      const em = (await q1("SELECT email FROM portal_usuarios WHERE id = ?", [uid]))?.email;
      const erro = em ? await sincronizar_acesso_comercial(em, crmAgora) : null;
      if (erro) flash(`CRM Geral salvo no portal, mas não foi possível ajustar o acesso no sistema Comercial: ${erro}`, "erro");
    }
    // Todos os módulos marcados = nenhuma linha (assim a pessoa ganha os módulos novos que a empresa vier a ter).
    if (perfil !== "admin") for (const s of empresas) {
      const validos = modulos_da_empresa(EMPRESAS_POR_SLUG[s]).map((m: any) => m.id);
      const marcados = f.getlist("mod_" + s).filter((m: string) => validos.includes(m));
      if (marcados.length && marcados.length < validos.length)
        for (const m of marcados) await run("INSERT INTO portal_usuario_modulos (usuario_id, empresa_slug, modulo_id) VALUES (?, ?, ?)", [uid, s, m]);
    }
    limparMemo("portal:");
    return redirect(url_for("portal_admin"));
  });

  post("portal_admin_empresa", "/grupo/admin/empresa/<slug>", async (slug: string) => {
    exige_admin();
    checar_csrf();
    if (!EMPRESAS_POR_SLUG[slug]) abort(404);
    let status = request().form.get("status");
    status = STATUS[status] ? status : "ativo";
    const obs = status === "ativo" ? "" : (request().form.get("obs") ?? "").trim().slice(0, 120);
    await run("INSERT INTO portal_empresa_status (slug, status, obs) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET status = excluded.status, obs = excluded.obs", [slug, status, obs]);
    limparMemo("portal:status");
    flash(`Situação de ${EMPRESAS_POR_SLUG[slug].nome} atualizada.`, "ok");
    const destino = request().form.get("voltar") || url_for("portal_grupo");
    return redirect(destino.startsWith("/") && !destino.startsWith("//") ? destino : url_for("portal_grupo"));
  });

  // ── Empresas cadastradas pela Administração ──
  get("portal_logo", "/grupo/logo/<slug>", async (slug: string) => {
    const e = EMPRESAS_POR_SLUG[slug];
    if (!e) abort(404);
    const r = e.cadastrada ? await q1("SELECT logo_caminho FROM portal_empresas WHERE slug = ?", [slug]) : null;
    const dados = r?.logo_caminho ? await lerArquivo(r.logo_caminho) : null;
    let resp;
    if (dados) {
      const tipo = r!.logo_caminho.endsWith(".png") ? "image/png" : r!.logo_caminho.endsWith(".webp") ? "image/webp" : "image/jpeg";
      resp = sendFile(dados, { mimetype: tipo });
    } else {
      // sem logo: círculo com as iniciais nas cores da empresa
      const t = tema(e.tema);
      const ini = String(e.nome).split(/\s+/).filter((w: string) => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase() || "?";
      resp = sendFile(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${t.primary}"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="38" fill="${t.accent}">${ini.replace(/[<&>"]/g, "")}</text></svg>`, { mimetype: "image/svg+xml" });
    }
    resp.headers.set("cache-control", "public, max-age=86400");
    resp.headers.set("x-content-type-options", "nosniff");
    return resp;
  });

  async function dados_empresa_form(slug: string, nova: boolean) {
    const f = request().form;
    const nome = (f.get("nome") ?? "").trim().slice(0, 80);
    if (!nome) return { erro: "Informe o nome da empresa." };
    const t: Record<string, string> = {};
    for (const k of CHAVES_TEMA) { const v = (f.get("cor_" + k) ?? "").trim(); if (COR.test(v)) t[k] = v.toLowerCase(); }
    t.font_head = FONTES.includes(f.get("fonte") ?? "") ? f.get("fonte")! : "Montserrat";
    const mods = (f.getlist("modulos") as string[]).filter((m) => MODULOS_PADRAO[m]);
    const arq = request().file("logo");
    let logo: { caminho: string; dados: Uint8Array } | null = null;
    if (arq && arq.filename && arq.size) {
      const ext = (arq.filename.toLowerCase().match(/\.(png|jpe?g|webp)$/) ?? [])[1];
      if (!ext) return { erro: "A logo precisa ser PNG, JPG ou WEBP." };
      if (arq.size > 3 * 1024 * 1024) return { erro: "A logo pode ter no máximo 3 MB." };
      logo = { caminho: `portal/logos/${slug}.${ext === "jpeg" ? "jpg" : ext}`, dados: arq.read() };
    } else if (nova && f.get("logo_obrigatoria")) return { erro: "Envie a logo da empresa." };
    return { nome, descricao: (f.get("descricao") ?? "").trim().slice(0, 120), tema: JSON.stringify(t), modulos: (mods.length ? mods : ["financas", "comercial"]).join(","), logo };
  }

  post("portal_admin_empresa_nova", "/grupo/admin/empresas/nova", async () => {
    exige_admin();
    checar_csrf();
    const volta = url_for("portal_admin", { aba: "empresas" });
    const slug = slug_de((request().form.get("nome") ?? "").trim());
    const d: any = await dados_empresa_form(slug, true);
    if (d.erro) { flash(d.erro, "erro"); return redirect(volta + "#nova"); }
    if (d.logo) await salvarArquivo(d.logo.caminho, d.logo.dados, "image/*");
    const ordem = Number((await q1("SELECT COALESCE(MAX(ordem), 0) AS m FROM portal_empresas"))?.m || 0) + 1;
    await run("INSERT INTO portal_empresas (slug, nome, descricao, tema, logo_caminho, logo_versao, modulos, ordem, criado_em, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [slug, d.nome, d.descricao, d.tema, d.logo?.caminho ?? "", 1, d.modulos, ordem, agora(), g().portal_user.id]);
    limparMemo("portal:");
    await carregar_empresas();
    flash(`Empresa ${d.nome} criada com os módulos padrão. Libere o acesso aos usuários em Administração → Usuários.`, "ok");
    return redirect(volta + `#emp-${slug}`);
  });

  post("portal_admin_empresa_editar", "/grupo/admin/empresas/<slug>/editar", async (slug: string) => {
    exige_admin();
    checar_csrf();
    const volta = url_for("portal_admin", { aba: "empresas" }) + `#emp-${slug}`;
    const atual = await q1("SELECT * FROM portal_empresas WHERE slug = ?", [slug]);
    if (!atual) abort(404);
    const d: any = await dados_empresa_form(slug, false);
    if (d.erro) { flash(d.erro, "erro"); return redirect(volta); }
    let caminho = atual.logo_caminho, versao = atual.logo_versao || 0;
    if (d.logo) { await salvarArquivo(d.logo.caminho, d.logo.dados, "image/*"); caminho = d.logo.caminho; versao++; }
    else versao++; // cores mudam o círculo de iniciais
    await run("UPDATE portal_empresas SET nome = ?, descricao = ?, tema = ?, modulos = ?, logo_caminho = ?, logo_versao = ? WHERE slug = ?",
      [d.nome, d.descricao, d.tema, d.modulos, caminho, versao, slug]);
    limparMemo("portal:");
    await carregar_empresas();
    flash(`Empresa ${d.nome} atualizada.`, "ok");
    return redirect(volta);
  });

  errorHandler(403, () => [render_template("portal/erro.html", { t: TEMA_GRUPO, codigo: 403, msg: "Você não tem acesso a esta área." }), 403]);
}

/** Libera (ou retira) a leitura do Comercial da Bia (portal_acesso.permissoes) — via função erp.acesso_comercial. */
async function sincronizar_acesso_comercial(email: string, liberar: boolean): Promise<string | null> {
  try {
    const r = await q1("SELECT erp.acesso_comercial(?, ?) AS erro", [email, liberar]);
    return r?.erro ?? null;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

/** Destinos dos módulos: caminhos do app viram /erp/...; o Comercial é o da Bia. */
export function destinoModulo(destino: string) {
  // Comercial: módulo da Bia (rota /comercial/<empresa_id do portal_acesso>), fora do /erp.
  if (destino === "/comercial" || destino.startsWith("/comercial/")) return destino;
  return "/erp" + destino;
}
