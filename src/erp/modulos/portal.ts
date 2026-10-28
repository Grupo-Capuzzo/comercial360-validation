/* eslint-disable @typescript-eslint/no-explicit-any */
// Portal do Grupo Capuzzo (porte de app/portal_grupo.py) — login, empresas e módulos.
// Diferença do original: a senha é a do Supabase Auth (o mesmo login do site da Bia).
import {
  Markup, PyDate, abort, beforeRequest, contextProcessor, errorHandler, flash, g, get, q, q1, redirect,
  render_template, request, route, run, session, url_for, montarPublico, post,
} from "../core/flask";
import { definirUsuarioAuth, emailLogado, entrar, sair, senhaConfere } from "../core/auth";
import { ICONES_PORTAL } from "../dados/icones";

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
      { id: "comercial", nome: "Comercial", icone: "handshake", desc: "Gestão comercial da Capuzzo Assessoria.", destino: "/comercial/40ca9f00-a17c-4605-9323-a15974c52817" },
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
    modulos: [
      { id: "comercial", nome: "Comercial", icone: "handshake", desc: "Gestão comercial da Ether Nexus.", destino: "/comercial/eedb1f91-0f95-4072-a80c-ff216f97e8de" },
    ],
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
    modulos: [
      { id: "comercial", nome: "Comercial", icone: "handshake", desc: "Gestão comercial da World Gym.", destino: "/comercial/05cf491e-d9ad-4dd5-93da-6a3ffef74241" },
    ],
  },
];
// Módulo Finanças nas empresas que o utilizam.
for (const e of EMPRESAS) {
  if (["assessoria", "cred", "ethernexus", "terceiriza", "hortstufas"].includes(e.slug)) {
    e.modulos.push({ id: "financas", nome: "Finanças", icone: "payments", desc: "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.", destino: `/financas/${e.slug}/` });
  }
}
export const EMPRESAS_POR_SLUG: Record<string, any> = Object.fromEntries(EMPRESAS.map((e) => [e.slug, e]));

export const EMPRESA_CONDOMINIOS = "assessoria";
/** Prefixo da URL → empresa dona do módulo. */
export const PREFIXOS_MODULOS: Record<string, string> = {};
/** Rotas que não exigem login (caminho interno). */
export const ROTAS_PUBLICAS: string[] = ["/login"];

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

export async function status_empresas(): Promise<Record<string, any>> {
  return Object.fromEntries((await q("SELECT slug, status, obs FROM portal_empresa_status")).map((r) => [r.slug, r]));
}
export async function empresas_com_status() {
  const st = await status_empresas();
  return EMPRESAS.map((e) => {
    const s = st[e.slug] ?? {};
    return { ...e, status: s.status ?? "ativo", obs: s.obs ?? "", tema_full: tema(e.tema) };
  });
}
export async function empresas_liberadas(usuario_id: number): Promise<Set<string>> {
  return new Set((await q("SELECT empresa_slug FROM portal_usuario_empresas WHERE usuario_id = ?", [usuario_id])).map((r) => r.empresa_slug));
}
export async function pode_ver(user: any, slug: string) {
  return user.perfil === "admin" || (await empresas_liberadas(user.id)).has(slug);
}
/** Módulos liberados para o usuário numa empresa (null = todos). Admin vê todos; sem nenhuma
 *  linha em portal_usuario_modulos para a empresa, também vê todos (como era antes). */
export async function modulos_liberados(user: any, slug: string): Promise<Set<string> | null> {
  if (!user || user.perfil === "admin") return null;
  const l = await q("SELECT modulo_id FROM portal_usuario_modulos WHERE usuario_id = ? AND empresa_slug = ?", [user.id, slug]);
  return l.length ? new Set(l.map((r) => r.modulo_id)) : null;
}
export async function pode_ver_modulo(user: any, slug: string, modulo: string) {
  if (!(await pode_ver(user, slug))) return false;
  const lib = await modulos_liberados(user, slug);
  return lib === null || lib.has(modulo);
}
async function modulos_visiveis(user: any, e: any) {
  const lib = await modulos_liberados(user, e.slug);
  return modulos_da_empresa(e).filter((m: any) => lib === null || lib.has(m.id));
}

export async function empresas_visiveis(user: any) {
  const todas = await empresas_com_status();
  if (user.perfil === "admin") return todas;
  const lib = await empresas_liberadas(user.id);
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

  contextProcessor(() => ({ portal_user: g().portal_user ?? null, STATUS, tema_grupo: TEMA_GRUPO, ic }));

  // ── Porteiro: nenhuma página abre sem login ──
  beforeRequest(async () => {
    const G = g();
    G.portal_user = null;
    const email = await emailLogado();
    if (email) {
      const u = await q1("SELECT id, nome, email, perfil, ativo FROM portal_usuarios WHERE lower(email) = ?", [email]);
      if (u && u.ativo) {
        const visao = session().get("portal_visao") ?? (u.perfil === "admin" ? "admin" : "usuario");
        u.admin = u.perfil === "admin" && visao === "admin";
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
    if (caminho === "/central") return redirect(url_for("portal_grupo"));
    if (caminho.startsWith("/grupo") || caminho.startsWith("/logout")) return null;
    if (caminho.startsWith("/central/")) return G.portal_user.admin ? null : abort(403);
    for (const [prefixo, slug] of Object.entries(PREFIXOS_MODULOS)) {
      if (caminho === prefixo || caminho.startsWith(prefixo + "/")) return (await pode_ver(G.portal_user, slug)) ? null : abort(403);
    }
    const fin = /^\/financas\/([^/]+)/.exec(caminho);
    if (fin) return (await pode_ver_modulo(G.portal_user, fin[1], "financas")) ? null : abort(403);
    if (caminho.startsWith("/operacao/")) return null; // cada rota confere a empresa
    if (!(await pode_ver_modulo(G.portal_user, EMPRESA_CONDOMINIOS, "condominios"))) abort(403);
    return null;
  });

  // ── Login ──
  route("portal_login", "/login", ["GET", "POST"], async () => {
    const req = request();
    if (g().portal_user) return redirect(url_for("portal_grupo"));
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
        if (!destino.startsWith("/") || destino.startsWith("//")) destino = url_for("portal_grupo");
        return redirect(destino);
      }
    }
    return render_template("portal/login.html", { t: TEMA_GRUPO, erro, email, acesso, marcas: [...EMPRESAS], ano: PyDate.now().year });
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
  get("portal_admin", "/grupo/admin", async () => {
    exige_admin();
    const usuarios = await q("SELECT * FROM portal_usuarios ORDER BY nome");
    for (const u of usuarios) {
      u.empresas = await empresas_liberadas(u.id);
      u.modulos = {} as Record<string, string[]>;
      for (const r of await q("SELECT empresa_slug, modulo_id FROM portal_usuario_modulos WHERE usuario_id = ?", [u.id])) (u.modulos[r.empresa_slug] ??= []).push(r.modulo_id);
    }
    const sel = request().args.get("u", null, "int");
    const editar = usuarios.find((u) => u.id === sel) ?? null;
    return render_template("portal/admin.html", { t: TEMA_GRUPO, usuarios, editar, empresas: await empresas_com_status(), aba: request().args.get("aba", "usuarios") });
  });

  post("portal_admin_usuario", "/grupo/admin/usuario", async () => {
    exige_admin();
    checar_csrf();
    const f = request().form;
    let uid = f.get("id", null, "int");
    const nome = (f.get("nome") ?? "").trim();
    const email = (f.get("email") ?? "").trim().toLowerCase();
    let perfil = f.get("perfil") === "admin" ? "admin" : "usuario";
    let ativo = f.get("ativo") ? 1 : 0;
    const senha = f.get("senha") ?? "";
    const empresas = f.getlist("empresas").filter((s: string) => EMPRESAS_POR_SLUG[s]);
    const voltar = uid ? url_for("portal_admin", { u: uid }) : url_for("portal_admin");
    let msg: string | null;
    if (senha && (msg = validar_senha(senha))) { flash(msg, "erro"); return redirect(voltar); }
    if (uid) {
      if (uid === g().portal_user.id) { perfil = "admin"; ativo = 1; }
      await run("UPDATE portal_usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?", [nome || "Sem nome", perfil, ativo, uid]);
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
      uid = (await run("INSERT INTO portal_usuarios (nome, email, senha_hash, perfil, criado_em) VALUES (?, ?, ?, ?, ?)", [nome, email, "", perfil, agora()])).lastrowid;
      flash(`Usuário ${nome} criado.`, "ok");
    }
    await run("DELETE FROM portal_usuario_empresas WHERE usuario_id = ?", [uid]);
    for (const s of empresas) await run("INSERT INTO portal_usuario_empresas VALUES (?, ?)", [uid, s]);
    // módulos por empresa (nenhum marcado = todos os módulos da empresa)
    await run("DELETE FROM portal_usuario_modulos WHERE usuario_id = ?", [uid]);
    for (const s of empresas) {
      const validos = new Set(modulos_da_empresa(EMPRESAS_POR_SLUG[s]).map((m: any) => m.id));
      for (const m of f.getlist("mod_" + s)) if (validos.has(m)) await run("INSERT INTO portal_usuario_modulos (usuario_id, empresa_slug, modulo_id) VALUES (?, ?, ?)", [uid, s, m]);
    }
    return redirect(url_for("portal_admin", { u: uid }));
  });

  post("portal_admin_empresa", "/grupo/admin/empresa/<slug>", async (slug: string) => {
    exige_admin();
    checar_csrf();
    if (!EMPRESAS_POR_SLUG[slug]) abort(404);
    let status = request().form.get("status");
    status = STATUS[status] ? status : "ativo";
    const obs = status === "ativo" ? "" : (request().form.get("obs") ?? "").trim().slice(0, 120);
    await run("INSERT INTO portal_empresa_status (slug, status, obs) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET status = excluded.status, obs = excluded.obs", [slug, status, obs]);
    flash(`Situação de ${EMPRESAS_POR_SLUG[slug].nome} atualizada.`, "ok");
    const destino = request().form.get("voltar") || url_for("portal_grupo");
    return redirect(destino.startsWith("/") && !destino.startsWith("//") ? destino : url_for("portal_grupo"));
  });

  errorHandler(403, () => [render_template("portal/erro.html", { t: TEMA_GRUPO, codigo: 403, msg: "Você não tem acesso a esta área." }), 403]);
}

/** Destinos dos módulos: caminhos do app viram /erp/...; o Comercial é o da Bia. */
export function destinoModulo(destino: string) {
  // Comercial: módulo da Bia (rota /comercial/<empresa_id do portal_acesso>), fora do /erp.
  if (destino === "/comercial" || destino.startsWith("/comercial/")) return destino;
  return "/erp" + destino;
}
