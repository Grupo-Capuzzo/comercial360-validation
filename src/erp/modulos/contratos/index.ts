/* eslint-disable @typescript-eslint/no-explicit-any */
// Módulo Contratos e Assinaturas (Capuzzo Assessoria) — porte de modulos/contratos/__init__.py.
//
//   /contratos/                       acompanhamento das assinaturas (painel)
//   /contratos/novo                   gerar contrato para cotas pendentes de um cliente
//   /contratos/<id>                   detalhe: documento, signatários, histórico, ações
//   /contratos/<id>/documento         documento completo (termo + regulamento + certificado) para imprimir/PDF
//   /contratos/configuracoes          link público, empresa, testemunhas, e-mail de cópia
//
//   Público (sem login): no app local era /contratos/assinar/<token>; online a página é servida em
//   /auth/contrato/<token> (fora do /erp: o proxy do site libera /auth/... sem login).
import {
  PyDate, abort, flash, get, jsonify, montarPublico, post, redirect, render_template, request, route, templateFilter, url_for,
} from "../../core/flask";
import * as db from "../../base/database";
import { ROTAS_PUBLICAS, checar_csrf } from "../portal";
import * as d from "./dados";

function _ctx(extra: Record<string, any> = {}) {
  return {
    active_page: "contratos", STATUS: d.STATUS, TIPOS: d.TIPOS, EVENTOS: d.EVENTOS,
    moeda: d.moeda, fmt_doc: d.fmt_doc, ...extra,
  };
}

function _csrf() { checar_csrf(); }

async function _contrato(cid: number) {
  const c = await d.obter(cid);
  if (!c) abort(404);
  return c;
}

/** str(exc) do Python para as mensagens mostradas ao usuário. */
function msg(e: any) { return String(e?.message ?? e); }

/** request.values.get(k, type=int): args primeiro, depois form. */
function valuesInt(k: string): number | null {
  const r = request();
  const v = r.args.has(k) ? r.args.get(k, null, "int") : r.form.get(k, null, "int");
  return v;
}

/** Códigos dos produtos que têm modelo de termo (conjunto do Python → lista). */
function codigosModelos(soTipo?: string) {
  const s = new Set<string>();
  for (const [[t, code]] of d.modelos_itens()) if (!soTipo || t === soTipo) s.add(code);
  return Array.from(s);
}

/** Clientes das cotas pendentes, ordenados pelo nome em minúsculas (como no Python). */
function clientesDasCotas(cotas: any[]): [number, string][] {
  const m = new Map<number, string>();
  for (const c of cotas) if (!m.has(c.client_id)) m.set(c.client_id, c.cliente_nome);
  return Array.from(m.entries()).sort((a, b) => { const x = a[1].toLowerCase(), y = b[1].toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
}

export function registrar() {
  // Página pública de assinatura: sem login e fora do /erp.
  if (!ROTAS_PUBLICAS.includes("/contratos/assinar/")) ROTAS_PUBLICAS.push("/contratos/assinar/");
  montarPublico("/contratos/assinar", "/auth/contrato");

  templateFilter("ct_data", (s: any, hora = false) => d.data_br(s, hora));

  // ═════════════════════════ área interna (com login) ═════════════════════════
  get("contratos.painel", "/contratos/", async () => {
    const status = request().args.get("status", "");
    const q = String(request().args.get("q", "")).trim();
    return render_template("contratos/painel.html", _ctx({
      contratos: await d.listar(status || null, q), resumo: await d.resumo(), status_filtro: status, q,
      pendentes: (await d.cotas_pendentes_sem_contrato()).length, cfg: await d.config(),
    }));
  });

  route("contratos.novo", "/contratos/novo", ["GET", "POST"], async () => {
    const req = request();
    if (req.method === "POST") {
      _csrf();
      try {
        const cid = await d.criar_contrato_aquisicao(req.form.get("client_id"), req.form.get("condominium_id"), req.form.getlist("share_ids"));
        flash("Contrato gerado e assinado pela empresa. Confira e envie para assinatura.", "success");
        return redirect(url_for("contratos.detalhe", { cid }));
      } catch (exc: any) {
        if (!d.ehValueError(exc)) throw exc;
        const s = msg(exc);
        flash(s.slice(0, 1).toUpperCase() + s.slice(1), "error");
      }
    }
    const client_id = valuesInt("client_id");
    const cotas = await d.cotas_pendentes_sem_contrato();
    const cliente: any = client_id ? await db.get_client_by_id(client_id) : null;
    return render_template("contratos/novo.html", _ctx({
      clientes: clientesDasCotas(cotas), cliente,
      cotas: client_id ? cotas.filter((c: any) => c.client_id === client_id) : [],
      falta: cliente ? d.pendencias_cliente(cliente) : [],
      modelos: codigosModelos(),
    }));
  });

  get("contratos.detalhe", "/contratos/<int:cid>", async (cid: number) => {
    const c = await _contrato(cid);
    const cfg = await d.config();
    const hoje = PyDate.today().isoformat();
    const [aq, venc] = d.datas_sugeridas(c, hoje);
    const cli = c.signatarios.find((s: any) => s.papel === "cliente");
    const link = await d.link_assinatura(c, cfg);
    const msg_wpp = `Olá, ${String(cli.nome).trim().split(/\s+/)[0]}! Segue o link para assinatura eletrônica do seu `
      + `${d.TIPOS[c.tipo]} (${c.dados.qtd} cota(s) — ${d.moeda(c.dados.valor_total)}): ${link}`;
    const fone = d.so_digitos(c.cliente_fone);
    return render_template("contratos/detalhe.html", _ctx({
      c, cli, cfg, link, hoje, aq_sugerida: aq, venc_sugerido: venc, msg_wpp,
      fone_wpp: [10, 11].includes(fone.length) ? "55" + fone : "",
      link_local: cfg.url_publica.includes("127.0.0.1") || cfg.url_publica.includes("localhost"),
    }));
  });

  get("contratos.documento", "/contratos/<int:cid>/documento", async (cid: number) => {
    const c = await _contrato(cid);
    return render_template("contratos/doc/documento.html", {
      c, d: c.dados, moeda: d.moeda, fmt_doc: d.fmt_doc, TIPOS: d.TIPOS,
      mascarar: d.mascarar_email, EVENTOS: d.EVENTOS, publico: false,
      imprimir: request().args.get("imprimir") === "1",
    });
  });

  post("contratos.enviar", "/contratos/<int:cid>/enviar", async (cid: number) => {
    _csrf();
    try {
      await d.enviar_para_assinatura(cid);
      flash("Enviado para o e-mail do cliente. Acompanhe a assinatura por aqui.", "success");
    } catch (exc: any) {
      if (d.ehValueError(exc)) flash(msg(exc), "error");
      else { // Gmail não autenticado, sem internet...
        await d.evento(cid, "email_erro", msg(exc).slice(0, 300));
        flash(`Não foi possível enviar o e-mail: ${msg(exc)}. Verifique o Gmail em Configurações `
          + "ou envie o link pelo WhatsApp.", "error");
      }
    }
    return redirect(url_for("contratos.detalhe", { cid }));
  });

  post("contratos.enviado_manual", "/contratos/<int:cid>/enviado-manual", async (cid: number) => {
    _csrf();
    await d.marcar_enviado_manual(cid, request().form.get("canal", "link"));
    return jsonify({ ok: true });
  });

  post("contratos.cancelar", "/contratos/<int:cid>/cancelar", async (cid: number) => {
    _csrf();
    const f = request().form;
    const motivo = String(f.get("motivo", "")).trim();
    const avisar = f.get("avisar") === "1";
    try {
      if (f.get("acao") === "regerar") {
        const novo = await d.cancelar_e_gerar_novo(cid, motivo, avisar);
        flash("Contrato anterior cancelado e novo contrato gerado com os dados atuais do cliente. "
          + "Confira e envie para assinatura.", "success");
        return redirect(url_for("contratos.detalhe", { cid: novo }));
      }
      await d.cancelar(cid, motivo, avisar);
      flash("Contrato cancelado — o link não aceita mais assinatura. As cotas continuam pendentes "
        + "(gere um novo contrato ou inative-as em Todas as Cotas).", "warning");
    } catch (exc: any) {
      if (!d.ehValueError(exc)) throw exc;
      flash(msg(exc), "error");
    }
    return redirect(url_for("contratos.detalhe", { cid }));
  });

  post("contratos.excluir", "/contratos/<int:cid>/excluir", async (cid: number) => {
    _csrf();
    try {
      const [apagadas, mantidas] = await d.excluir(cid, request().form.get("excluir_cotas") === "1");
      let m = "Contrato apagado.";
      if (apagadas.length) m += ` Cotas apagadas: ${apagadas.join(", ")}.`;
      if (mantidas.length) m += ` Cotas mantidas (não estavam pendentes ou têm cálculos): ${mantidas.join(", ")}.`;
      flash(m, "success");
      return redirect(url_for("contratos.painel"));
    } catch (exc: any) {
      if (!d.ehValueError(exc)) throw exc;
      flash(msg(exc), "error");
      return redirect(url_for("contratos.detalhe", { cid }));
    }
  });

  post("contratos.ativar", "/contratos/<int:cid>/ativar", async (cid: number) => {
    _csrf();
    const c = await _contrato(cid);
    const f = request().form;
    const datas = new Map<number, [string, string]>();
    for (const cota of c.cotas) datas.set(cota.id, [f.get(`aq_${cota.id}`, ""), f.get(`venc_${cota.id}`, "")]);
    try {
      await d.ativar_cotas(cid, f.get("data_deposito", ""), datas);
      flash("Depósito confirmado — cotas ativadas.", "success");
    } catch (exc: any) {
      if (!d.ehValueError(exc)) throw exc;
      flash(msg(exc), "error");
    }
    return redirect(url_for("contratos.detalhe", { cid }));
  });

  route("contratos.configuracoes", "/contratos/configuracoes", ["GET", "POST"], async () => {
    if (request().method === "POST") {
      _csrf();
      await d.salvar_config(request().form);
      flash("Configurações dos contratos salvas.", "success");
      return redirect(url_for("contratos.configuracoes"));
    }
    return render_template("contratos/configuracoes.html", _ctx({ cfg: await d.config(), campos: d.CONFIG_PADRAO }));
  });

  // ═════════════════════════ área pública (cliente) ═════════════════════════
  async function _publico(token: string) {
    const c = await d.obter_por_token(token);
    if (!c) abort(404);
    return c;
  }

  get("contratos.assinar", "/contratos/assinar/<token>", async (token: string) => {
    const c = await _publico(token);
    if (c.status === "aguardando") await d.registrar_visualizacao(c);
    const cli = c.signatarios.find((s: any) => s.papel === "cliente");
    return render_template("contratos/publico/assinar.html", {
      c, d: c.dados, cli, cfg: await d.config(),
      moeda: d.moeda, email_mask: d.mascarar_email(cli.email), TIPOS: d.TIPOS,
      logo: d.asset_data_uri("regulamento_cabecalho.png"),
      ok: request().args.get("ok") === "1",
    });
  });

  get("contratos.assinar_documento", "/contratos/assinar/<token>/documento", async (token: string) => {
    const c = await _publico(token);
    return render_template("contratos/doc/documento.html", {
      c, d: c.dados, moeda: d.moeda, fmt_doc: d.fmt_doc, TIPOS: d.TIPOS,
      mascarar: d.mascarar_email, EVENTOS: d.EVENTOS, publico: true,
      imprimir: request().args.get("imprimir") === "1",
    });
  });

  post("contratos.assinar_codigo", "/contratos/assinar/<token>/codigo", async (token: string) => {
    _csrf();
    const c = await _publico(token);
    try {
      const destino = await d.enviar_codigo(c);
      return jsonify({ ok: true, msg: `Enviamos um código de 6 dígitos para ${destino}.` });
    } catch (exc: any) {
      if (d.ehValueError(exc)) return [jsonify({ ok: false, msg: msg(exc) }), 400];
      d.logger.exception("Falha ao enviar código", exc);
      await d.evento(c.id, "email_erro", `Código: ${msg(exc)}`.slice(0, 300));
      return [jsonify({ ok: false, msg: "Não foi possível enviar o código agora. Tente novamente em instantes "
        + "ou fale com a Capuzzo." }), 500];
    }
  });

  post("contratos.assinar_confirmar", "/contratos/assinar/<token>/confirmar", async (token: string) => {
    _csrf();
    const c = await _publico(token);
    const f = request().form;
    try {
      await d.assinar_cliente(c, f.get("cpf", ""), f.get("codigo", ""), f.get("tipo", "desenho"), f.get("imagem", ""),
        f.get("texto", ""), f.get("aceite") === "1");
      return jsonify({ ok: true, redirect: url_for("contratos.assinar", { token, ok: 1 }) });
    } catch (exc: any) {
      if (!d.ehValueError(exc)) throw exc;
      return [jsonify({ ok: false, msg: msg(exc) }), 400];
    }
  });
}
