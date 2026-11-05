import { randomUUID, timingSafeEqual } from "node:crypto";
import { abort, g, get, post, request, session, render_template, redirect, url_for, makeResponse } from "../../core/flask";
import { empresas_visiveis, TEMA_GRUPO, pode_ver_modulo } from "../portal";
import { temAcessoJuridico } from "./acesso";
import { AREAS, FASES, INSTANCIAS, SITUACOES, alertaPrazo, CasoNaoEncontrado, ConflitoJuridico, ValidacaoJuridica } from "./modelo";
import { criarRepositorio } from "./repositorio";
import { registrarComplementos } from "./complementos";
import { criarComplementos } from "./complementos-repositorio";

export const AREAS_JURIDICAS = AREAS;
const campos = ["titulo", "cliente_nome", "cliente_tipo", "cliente_documento", "cliente_telefone", "cliente_email", "condicao", "area", "fase", "instancia", "situacao", "numero_processo", "vara", "comarca", "parte_contraria", "descricao", "responsavel", "prazo", "prazo_descricao", "versao", "motivo"];
campos.push("cadastro_id");
const uuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function pagina(valor: string) { const n = Number(valor || 1); if (!Number.isSafeInteger(n) || n < 1 || n > 10000) abort(400); return n; }
function csrf() {
  const a = request().form.get("_csrf") ?? "", b = session().get("_csrf") ?? "";
  if (!a || !b || Buffer.byteLength(a) !== Buffer.byteLength(b) || !timingSafeEqual(Buffer.from(a), Buffer.from(b))) abort(400, "Formulário expirado. Recarregue a página e tente novamente.");
}

export function registrar(repo = criarRepositorio(), complementos = criarComplementos()) {
  async function contexto() {
    const user = g().portal_user;
    if (!temAcessoJuridico(user) || user.id == null) abort(403);
    const empresas = await empresas_visiveis(user);
    return { user, empresas, slugs: empresas.map(e => String(e.slug)), autor: String(user.id) };
  }
  async function seguro(fn: () => Promise<unknown>) {
    const resp = makeResponse(await executarSeguro(fn));
    resp.headers.set("cache-control", "private, no-store");
    resp.headers.set("referrer-policy", "same-origin");
    return resp;
  }
  async function executarSeguro(fn: () => Promise<unknown>) {
    try { return await fn(); }
    catch (e) {
      if (e instanceof CasoNaoEncontrado) abort(404);
      if (e instanceof ConflitoJuridico) return [render_template("juridico/erro.html", { t: TEMA_GRUPO, mensagem: e.message }), 409];
      if (e instanceof ValidacaoJuridica) return [render_template("juridico/erro.html", { t: TEMA_GRUPO, mensagem: e.message }), 400];
      if (e && typeof e === "object" && "codigo" in e) throw e;
      const codigo = e && typeof e === "object" && "code" in e ? String(e.code) : "indisponivel";
      console.error("[erp][juridico] operação indisponível", { codigo: /^[A-Z0-9_]{1,30}$/.test(codigo) ? codigo : "indisponivel" });
      const mensagem = ["42P01", "3F000"].includes(codigo)
        ? "A estrutura do Jurídico ainda não foi aplicada ao banco. Solicite a aplicação da migration revisada antes de cadastrar casos."
        : "Não foi possível concluir a operação no Jurídico. Nenhuma confirmação de gravação foi recebida. Reabra a ficha para conferir o estado antes de tentar novamente.";
      return [render_template("juridico/erro.html", { t: TEMA_GRUPO, mensagem }), 503];
    }
  }
  async function painel(slug?: string) {
    const ctx = await contexto();
    const empresa = slug ? ctx.empresas.find(e => e.slug === slug) : null;
    if (slug && !empresa) abort(404);
    const filtros = { busca: String(request().args.get("busca") ?? "").trim().slice(0, 200), area: String(request().args.get("area") ?? ""), situacao: String(request().args.get("situacao") ?? "ativo"), pagina: pagina(request().args.get("pagina")) };
    if ((filtros.area && !AREAS.includes(filtros.area)) || !SITUACOES.includes(filtros.situacao)) abort(400);
    const casos = await repo.listar(slug ? [slug] : ctx.slugs, ctx.autor, filtros);
    return render_template("juridico/painel.html", {
      t: empresa?.tema_full ?? TEMA_GRUPO, empresas: ctx.empresas, empresa, areas: AREAS, situacoes: SITUACOES, filtros,
      casos: casos.slice(0, 50).map(c => ({ ...c, alerta: alertaPrazo(c.prazo) })), proxima: casos.length > 50,
      nomes_empresas: Object.fromEntries(ctx.empresas.map(e => [e.slug, e.nome])),
    });
  }
  get("juridico.geral", "/juridico", () => seguro(() => painel()));
  get("juridico.empresa", "/juridico/empresa/<slug>", (slug: string) => seguro(() => painel(slug)));
  async function formulario(id?: string) {
    const ctx = await contexto(); if (id && !uuid(id)) abort(404);
    const atual = id ? (await repo.consultar(ctx.slugs, ctx.autor, id)).caso : null;
    return render_template("juridico/formulario.html", { t: TEMA_GRUPO, empresas: ctx.empresas, empresa_selecionada: atual?.empresa ?? request().args.get("empresa"), caso: atual,
      valores: atual ?? { cadastro_id: randomUUID(), fase: "Triagem", instancia: "Não se aplica", situacao: "ativo", cliente_tipo: "PF", condicao: "devedor" }, areas: AREAS, fases: FASES, instancias: INSTANCIAS, situacoes: SITUACOES });
  }
  get("juridico.novo", "/juridico/novo", () => seguro(() => formulario()));
  get("juridico.editar", "/juridico/caso/<id>/editar", (id: string) => seguro(() => formulario(id)));
  async function salvar(id?: string) {
    const ctx = await contexto(); csrf(); if (id && !uuid(id)) abort(404);
    const entrada = Object.fromEntries(campos.map(k => [k, String(request().form.get(k) ?? "")]));
    const empresa = String(request().form.get("empresa") ?? "");
    if (!ctx.slugs.includes(empresa)) abort(404);
    if (id && (await repo.consultar(ctx.slugs, ctx.autor, id)).caso.empresa !== empresa) abort(404);
    try {
      const salvo = await repo.salvar(ctx.slugs, ctx.autor, empresa, entrada, id);
      return redirect(url_for("juridico.ficha", { id: salvo }), 303);
    } catch (e) {
      if (!(e instanceof ValidacaoJuridica)) throw e;
      return [render_template("juridico/formulario.html", { t: TEMA_GRUPO, empresas: ctx.empresas, empresa_selecionada: empresa, caso: id ? { id } : null, valores: entrada, erro: e.message, areas: AREAS, fases: FASES, instancias: INSTANCIAS, situacoes: SITUACOES }), 400];
    }
  }
  post("juridico.criar", "/juridico/novo", () => seguro(() => salvar()));
  post("juridico.salvar", "/juridico/caso/<id>/editar", (id: string) => seguro(() => salvar(id)));
  get("juridico.ficha", "/juridico/caso/<id>", (id: string) => seguro(async () => {
    const ctx = await contexto(); if (!uuid(id)) abort(404);
    const p = pagina(request().args.get("pagina"));
    const { caso, eventos } = await repo.consultar(ctx.slugs, ctx.autor, id, p);
    return render_template("juridico/ficha.html", { t: ctx.empresas.find(e => e.slug === caso.empresa)?.tema_full ?? TEMA_GRUPO, caso, eventos: eventos.slice(0, 50), proxima: eventos.length > 50, pagina: p, alerta: alertaPrazo(caso.prazo), empresa_nome: ctx.empresas.find(e => e.slug === caso.empresa)?.nome });
  }));
  post("juridico.anotar", "/juridico/caso/<id>/movimentacao", (id: string) => seguro(async () => {
    const ctx = await contexto(); csrf(); if (!uuid(id)) abort(404);
    await repo.anotar(ctx.slugs, ctx.autor, id, String(request().form.get("tipo") ?? ""), String(request().form.get("descricao") ?? ""));
    return redirect(url_for("juridico.ficha", { id }), 303);
  }));
  registrarComplementos(seguro,csrf,{empresas_visiveis,TEMA_GRUPO,pode_ver_modulo},complementos,repo);
}
