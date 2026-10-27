/* eslint-disable @typescript-eslint/no-explicit-any */
// Condomínios dentro do ERP (Finanças) — operações (porte de modulos/financas/cond_ops.py).
//
// Telas e ações que antes abriam o módulo Condomínios principal agora rodam aqui, com o layout do ERP:
//   cotistas (novo / editar / inativar / reativar), cotas (nova / editar / retirar / reativar / excluir),
//   vencimentos (renovar / marcar retirada / cancelar / finalizar, individual e em lote),
//   apuração (calcular / salvar / detalhe / editar / excluir / exportar Excel / arquivo bancário).
//
// Regra de ouro: NENHUMA regra de negócio é reescrita. Tudo usa as MESMAS funções do módulo principal
// (database, calculations, backup, arquivos bancários) e, nas ações (POST), chama a própria rota do
// módulo principal — só traduzimos o redirecionamento final para a tela equivalente aqui no ERP.
import {
  PREFIXO, PyDate, Resposta, abort, flash, makeResponse, redirect, render_template, request, route, url_for, viewFunction, get, post,
} from "../../core/flask";
import * as database from "../../base/database";
import * as calculations from "../../base/calculations";
import * as backup from "../../base/backup";
import * as flask_app from "../../base/flask_app";
import * as bank_inter from "../../base/bank_files_inter";
import * as bank_itau from "../../base/bank_files_itau";
import * as ct from "../contratos/dados";
import { F, _ctx_prod, _so_capuzzo } from "./capuzzo";
import * as d from "./dados";
import { _csrf } from "./index";

// ───────────────────────── ponte com o módulo principal ─────────────────────────
let _B: Record<string, any> | null = null;
/** Globais do módulo principal (flask_app): funções do banco, cálculos, validações, backup, bancos. */
export function B(): Record<string, any> {
  if (!_B) _B = { ...database, ...calculations, ...backup, ...flask_app, bank_inter, bank_itau };
  return _B;
}

function _u(ep: string, kw: Record<string, any> = {}) {
  return url_for("financas." + ep, { slug: "assessoria", ...kw });
}

/** Caminho interno (sem o /erp) de um destino do app; null se não for do app. */
function _interno(path: string): string {
  return path === PREFIXO || path.startsWith(PREFIXO + "/") ? path.slice(PREFIXO.length) || "/" : path;
}

/** Converte um redirecionamento do módulo principal para a tela equivalente no ERP. */
export function _traduzir(loc: string | null, voltar = ""): string {
  let u: URL;
  try { u = new URL(loc || "", "http://x"); } catch { u = new URL("http://x/"); }
  const bruto = u.pathname, qs = u.search;
  if (bruto.startsWith("/auth/contrato")) return bruto + qs; // página pública de assinatura (fora do /erp)
  const path = _interno(bruto);
  if (path.startsWith("/financas/") || path.startsWith("/contratos/assinar") || path.endsWith("/documento")) return PREFIXO + path + qs;
  let m = /^\/contratos\/(\d+)/.exec(path);
  if (m) return _u("cond_contrato", { cid: parseInt(m[1], 10) });
  if (path.startsWith("/contratos/novo")) return _u("cond_contrato_novo") + qs;
  if (path.startsWith("/contratos/configuracoes")) return _u("cond_contratos_config");
  if (path.startsWith("/contratos")) return _u("cond_contratos");
  m = /^\/historico\/(\d+)/.exec(path);
  if (m) return _u("cond_apuracao_detalhe", { calc_id: parseInt(m[1], 10) });
  if (path.startsWith("/historico")) return _u("cond_apuracao");
  if (path.startsWith("/apuracao")) return _u("cond_apuracao_nova");
  m = /^\/clientes\/(\d+)/.exec(path);
  if (m) return _u("cond_cotista", { cid: parseInt(m[1], 10) });
  if (path.startsWith("/clientes")) return _u("cond_cotistas");
  if (path.startsWith("/condominios/vencimentos")) return voltar || _u("cond_vencimentos");
  if (/^\/condominio\/(civil|agro|saude)/.test(path)) {
    return voltar || _u("cond_produto", { code: /^\/condominio\/(civil|agro|saude)/.exec(path)![1] });
  }
  return voltar || _u("cond_painel");
}

/** Destino "voltar" do formulário/URL, só se for uma tela do Finanças (no app online: /erp/financas/...). */
function _voltar(): string {
  const r = request();
  const v = String(r.form.get("voltar") || r.args.get("voltar") || "").trim();
  if (v.startsWith(PREFIXO + "/financas/")) return v;
  if (v.startsWith("/financas/")) return PREFIXO + v;
  return "";
}

/** Página anterior (só se for do ERP), para os botões Voltar. */
function _ref(): string {
  const r = request();
  let u: URL;
  try { u = new URL(r.headers.get("referer") || "", "http://x"); } catch { return ""; }
  if (!r.headers.get("referer")) return "";
  return u.pathname.startsWith(PREFIXO + "/financas/") && u.pathname !== r.path ? u.pathname + u.search : "";
}

/** Executa a rota do módulo principal e traz o resultado de volta para o ERP. */
async function _proxy(endpoint: string, kw: Record<string, any> = {}): Promise<Resposta> {
  const resp = makeResponse(await viewFunction(endpoint)(kw));
  if ([301, 302, 303, 307, 308].includes(resp.status)) resp.headers.set("location", _traduzir(resp.headers.get("location"), _voltar()));
  return resp;
}

/** float() de um valor digitado em reais ('R$ 1.234,56'); inválido → 0. */
function _f(v: any): number {
  const s = String(v ?? "");
  if (!s.trim()) return 0.0;
  const t = s.replace("R$", "").replace(/ /g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = Number(t.trim());
  return t.trim() === "" || Number.isNaN(n) ? 0.0 : n;
}

async function _clientes_json() {
  return ((await B().get_all_clients_for_share_form()) as any[]).map((c) => ({
    id: c.id, nome: c.full_name, cpf: c.cpf || "", pix: c.pix_key || "", inativo: c.status === "inativo",
  }));
}

/** str(exc) do Python. */
function msg(e: any) { return String(e?.message ?? e); }

/** int() do Python (lança ValueError). */
function pyInt(v: any): number {
  const s = String(v ?? "").trim();
  if (!/^[-+]?\d+$/.test(s)) throw new ct.ValueError(`invalid literal for int() with base 10: '${v}'`);
  return parseInt(s, 10);
}

/** request.values.get(k): args primeiro, depois form. */
function values(k: string, def: any = null) {
  const r = request();
  return r.args.has(k) ? r.args.get(k) : r.form.get(k, def);
}

// ───────────────────────── cotistas ─────────────────────────
const CLI_CAMPOS = ["cpf", "full_name", "email", "phone", "pix_key", "notes", "bank_name", "bank_agency", "bank_account",
  "bank_account_digit", "bank_account_type", "bank_holder_name", "bank_holder_document", "bank_notes"];

async function _ler_cliente(status_padrao = "ativo") {
  const f = request().form;
  const data: Record<string, any> = Object.fromEntries(CLI_CAMPOS.map((k) => [k, String(f.get(k, "")).trim()]));
  data.status = f.get("status", status_padrao);
  Object.assign(data, await B()._campos_contrato_cliente());
  return data;
}

// ───────────────────────── apuração ─────────────────────────
const MESES = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro",
  "Novembro", "Dezembro"];

async function _detalhe(calc_id: number): Promise<[Record<string, any>, any]> {
  const b = B();
  const det = await b.get_monthly_calculation_detail(calc_id);
  if (!det) abort(404);
  return [b, det];
}

// ───────────────────────── contratos (módulo Contratos, com o layout do ERP) ─────────────────────────
async function _ctx_ct(e: any, extra: Record<string, any> = {}) {
  return {
    ...(await _ctx_prod(e, "cond_contratos")), STATUS: ct.STATUS, TIPOS: ct.TIPOS, EVENTOS: ct.EVENTOS,
    STATUS_CONCLUIDO: ct.STATUS_CONCLUIDO, fmt_doc: ct.fmt_doc, ...extra,
  };
}

const ACOES_COTA: Record<string, string> = {
  inativar: "cotas_inativar", reativar: "cotas_reativar", excluir: "cotas_excluir",
  renovar: "cotas_renovar", "renovar-rapido": "cotas_renovar_rapido", "retirar-rapido": "cotas_retirar_rapido",
  "marcar-retirada": "cotas_marcar_retirada", "retirada-data": "cotas_retirada_data",
  "cancelar-retirada": "cotas_cancelar_retirada", "inativar-retirada": "cotas_inativar_retirada",
};

export function registrar() {
  // ───────────────────────── cotistas ─────────────────────────
  route("financas.cond_cotista_novo", "/financas/<slug>/condominios/cotistas/novo", ["GET", "POST"], async (slug: string) => {
    const e = await _so_capuzzo(slug);
    let cli: Record<string, any> = { status: "ativo", nationality: "brasileira" };
    if (request().method === "POST") {
      _csrf();
      cli = await _ler_cliente();
      let erros: string[] = await B()._validar_cliente(cli);
      if (!erros.length) {
        try {
          const cid = await B().insert_client(cli);
          flash("Cotista cadastrado com sucesso.", "success");
          if (_voltar()) {
            const sep = _voltar().includes("?") ? "&" : "?";
            return redirect(`${_voltar()}${sep}client_id=${cid}`);
          }
          return redirect(_u("cond_cotista", { cid }));
        } catch (exc: any) {
          if (!ct.ehValueError(exc)) throw exc;
          erros = [msg(exc)];
        }
      }
      for (const x of erros) flash(x, "error");
    }
    return render_template("financas/cap/cond_cotista_form.html", await _ctx_prod(e, "cond_cotistas", { cli, modo: "novo", voltar: _voltar() }));
  });

  route("financas.cond_cotista_editar", "/financas/<slug>/condominios/cotistas/<int:cid>/editar", ["GET", "POST"], async (slug: string, cid: number) => {
    const e = await _so_capuzzo(slug);
    let cli: any = await B().get_client_by_id(cid);
    if (!cli) abort(404);
    if (request().method === "POST") {
      _csrf();
      const data = await _ler_cliente(cli.status);
      let erros: string[] = await B()._validar_cliente(data, cid);
      if (!erros.length) {
        try {
          await B().update_client(cid, data);
          flash("Cadastro atualizado com sucesso.", "success");
          return redirect(_u("cond_cotista", { cid }));
        } catch (exc: any) {
          if (!ct.ehValueError(exc)) throw exc;
          erros = [msg(exc)];
        }
      }
      for (const x of erros) flash(x, "error");
      cli = { ...cli, ...data };
    }
    return render_template("financas/cap/cond_cotista_form.html", await _ctx_prod(e, "cond_cotistas", { cli, modo: "editar", voltar: "" }));
  });

  post("financas.cond_cotista_acao", "/financas/<slug>/condominios/cotistas/<int:cid>/<any(inativar, reativar, excluir):acao>",
    async (slug: string, cid: number, acao: string) => {
      await _so_capuzzo(slug);
      _csrf();
      const ep = ({ inativar: "clientes_inativar", reativar: "clientes_reativar", excluir: "clientes_excluir" } as any)[acao];
      const resp = await _proxy(ep, { cid });
      if (acao === "excluir" && (await B().get_client_by_id(cid)) === null) resp.headers.set("location", _u("cond_cotistas"));
      return resp;
    });

  // ───────────────────────── cotas ─────────────────────────
  get("financas.cond_cotas_sugerir", "/financas/<slug>/condominios/cotas/sugerir/<int:cond_id>/<int:qty>", async (slug: string, cond_id: number, qty: number) => {
    await _so_capuzzo(slug);
    return viewFunction("api_sugerir_numeros")({ cond_id, qty });
  });

  route("financas.cond_cota_nova", "/financas/<slug>/condominios/cotas/nova", ["GET", "POST"], async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const b = B();
    const conds: any[] = await b.get_condominiums(true);
    const code_pre = values("produto", "") ?? "";
    const cond_pre = conds.find((c) => c.code === code_pre) ?? null;
    let cota: Record<string, any> = {
      condominium_id: cond_pre ? cond_pre.id : "", client_id: request().args.get("client_id", null, "int") || "",
      linhas: [], share_value: F(b.COND_DEFAULT_VALUES[code_pre] ?? 0.0), status: "ativa", gerar_contrato: true,
    };
    if (request().method === "POST") {
      _csrf();
      const f = request().form;
      const nums = f.getlist("share_numbers");
      const vals = f.getlist("share_values"), acqs = f.getlist("acquisition_dates"), lrds = f.getlist("last_renewal_dates"), mats = f.getlist("maturity_dates");
      let linhas = nums.map((n: string, i: number) => ({
        n: String(n || "").trim(), v: _f(i < vals.length ? vals[i] : 0),
        acq: String(i < acqs.length ? acqs[i] : "").trim(), lrd: String(i < lrds.length ? lrds[i] : "").trim(),
        mat: String(i < mats.length ? mats[i] : "").trim(),
      }));
      linhas = linhas.filter((x: any) => x.n);
      const gerar = f.get("gerar_contrato") === "on";
      const allow_dup = f.get("allow_duplicate_share_number") === "on";
      const data: Record<string, any> = {
        condominium_id: f.get("condominium_id") ? pyInt(f.get("condominium_id")) : null,
        client_id: f.get("client_id") ? pyInt(f.get("client_id")) : null,
        share_numbers: linhas.map((x: any) => x.n), share_value: _f(f.get("share_value")),
        share_values: linhas.map((x: any) => x.v),
        acquisition_dates: linhas.map((x: any) => x.acq), maturity_dates: linhas.map((x: any) => x.mat),
        last_renewal_dates: linhas.map((x: any) => x.lrd),
        status: gerar ? "pendente" : f.get("status", "ativa"), notes: String(f.get("notes", "")).trim(),
      };
      cota = { ...data, share_value: F(data.share_value), linhas: linhas.map((x: any) => ({ ...x, v: F(x.v) })), gerar_contrato: gerar, allow_dup };
      let erros: string[] = await b._validar_cotas_multiplas(data, allow_dup);
      if (!erros.length) {
        try {
          const ids: number[] = await b.create_multiple_shares(
            data.condominium_id, data.client_id, data.share_numbers, data.share_value, "", "", "",
            data.status, data.notes, allow_dup, data.share_values.length ? data.share_values : null,
            data.acquisition_dates, data.maturity_dates, data.last_renewal_dates);
          const n = ids.length;
          flash(`${n} cota${n > 1 ? "s" : ""} cadastrada${n > 1 ? "s" : ""} com sucesso.`, "success");
          if (gerar) {
            try {
              const ct_id = await ct.criar_contrato_aquisicao(data.client_id, data.condominium_id, ids);
              flash("Contrato gerado e assinado pela empresa. Confira e clique em \"Enviar para assinatura\".", "success");
              return redirect(_u("cond_contrato", { cid: ct_id }));
            } catch (exc: any) { // o contrato não pode travar o cadastro das cotas
              flash(`As cotas ficaram pendentes, mas o contrato não foi gerado: ${msg(exc)}`, "warning");
              return redirect(_u("cond_contratos"));
            }
          }
          const code = conds.find((c) => c.id === data.condominium_id)?.code ?? "";
          return redirect(_voltar() || (code ? _u("cond_produto", { code }) : _u("cond_painel")));
        } catch (exc: any) {
          if (!ct.ehValueError(exc)) throw exc;
          erros = [msg(exc)];
        }
      }
      for (const x of erros) flash(x, "error");
    }
    const modelos_aq: Record<string, boolean> = {};
    for (const [[t, code], m] of ct.modelos_itens()) if (t === "aquisicao") modelos_aq[code] = Boolean(m.anexo);
    return render_template("financas/cap/cond_cota_nova.html", await _ctx_prod(e, cond_pre ? `cond_${code_pre}` : "cond_painel", {
      cota, conds, clientes: await _clientes_json(),
      padroes: Object.fromEntries(Object.entries(b.COND_DEFAULT_VALUES).map(([k, v]) => [k, F(v)])),
      voltar: _voltar() || _ref(), modelos_aq,
    }));
  });

  route("financas.cond_cota_editar", "/financas/<slug>/condominios/cotas/<int:sid>/editar", ["GET", "POST"], async (slug: string, sid: number) => {
    const e = await _so_capuzzo(slug);
    const b = B();
    let cota: any = await b.get_share_by_id(sid);
    if (!cota) abort(404);
    const conds = await b.get_condominiums(true);
    if (request().method === "POST") {
      _csrf();
      const f = request().form;
      const allow_dup = f.get("allow_duplicate_share_number") === "on";
      const data: Record<string, any> = {
        condominium_id: f.get("condominium_id") ? pyInt(f.get("condominium_id")) : cota.condominium_id,
        client_id: f.get("client_id") ? pyInt(f.get("client_id")) : cota.client_id,
        share_number: String(f.get("share_number", "")).trim(), share_value: _f(f.get("share_value")),
        acquisition_date: String(f.get("acquisition_date", "")).trim(), maturity_date: String(f.get("maturity_date", "")).trim(),
        status: f.get("status", cota.status), last_renewal_date: String(f.get("last_renewal_date", "")).trim(),
        withdrawal_date: String(f.get("withdrawal_date", "")).trim(),
        accrual_until_withdrawal: f.get("accrual_until_withdrawal") === "on" ? 1 : 0,
        notes: String(f.get("notes", "")).trim(),
      };
      let erros: string[] = await b._validar_cota(data, allow_dup);
      if (!erros.length) {
        try {
          await b.update_share(sid, data, allow_dup);
          flash("Cota atualizada com sucesso.", "success");
          return redirect(_voltar() || _u("cond_produto", { code: cota.condominium_code }));
        } catch (exc: any) {
          if (!ct.ehValueError(exc)) throw exc;
          erros = [msg(exc)];
        }
      }
      for (const x of erros) flash(x, "error");
      cota = { ...cota, ...data };
    }
    const hist = await d.q("SELECT * FROM audit_logs WHERE entity_type = 'shares' AND entity_id = ? ORDER BY id DESC LIMIT 30", [sid]);
    return render_template("financas/cap/cond_cota_editar.html", await _ctx_prod(e, `cond_${cota.condominium_code ?? ""}`, {
      cota, conds, clientes: await _clientes_json(), voltar: _voltar() || _ref(), hist, hoje: PyDate.today().isoformat(),
    }));
  });

  post("financas.cond_cota_acao", "/financas/<slug>/condominios/cotas/<int:sid>/acao/<acao>", async (slug: string, sid: number, acao: string) => {
    await _so_capuzzo(slug);
    _csrf();
    if (!(acao in ACOES_COTA)) abort(404);
    const cota = await B().get_share_by_id(sid);
    const resp = await _proxy(ACOES_COTA[acao], { sid });
    if (acao === "excluir" && cota) { // a cota deixou de existir: volta para a lista do produto
      const v = _voltar();
      if (!v || v.includes(`/cotas/${sid}/`)) resp.headers.set("location", _u("cond_produto", { code: cota.condominium_code }));
    }
    return resp;
  });

  post("financas.cond_cotas_lote", "/financas/<slug>/condominios/cotas/lote/<any(renovar, retirar):acao>", async (slug: string, acao: string) => {
    await _so_capuzzo(slug);
    _csrf();
    return _proxy(acao === "renovar" ? "cotas_renovar_lote" : "cotas_marcar_retirada_lote");
  });

  // ───────────────────────── apuração ─────────────────────────
  route("financas.cond_apuracao_nova", "/financas/<slug>/condominios/apuracoes/nova", ["GET", "POST"], async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const b = B();
    const conds: any[] = await b.get_condominiums(true);
    const hoje = PyDate.today();
    let mes = hoje.month, ano = hoje.year, prod = request().args.get("produto", ""), erro: string | null = null, resultado: any = null;
    let agro_txt = "";
    if (request().method === "POST") {
      _csrf();
      const f = request().form;
      try {
        mes = Math.min(Math.max(f.get("mes") ? pyInt(f.get("mes")) : hoje.month, 1), 12);
        ano = f.get("ano") ? pyInt(f.get("ano")) : hoje.year;
      } catch { mes = hoje.month; ano = hoje.year; }
      prod = f.get("produto", "");
      agro_txt = String(f.get("agro_special_rate", "")).trim();
      const cond = prod ? conds.find((c) => c.code === prod) ?? null : null;
      const cond_id = cond ? cond.id : null;
      try {
        const shares = await b.get_active_shares_for_calculation(cond_id);
        const agro_venc = await b.check_agro_maturing(shares, ano, mes);
        const agro_rate = agro_txt ? await b.validate_agro_special_rate(agro_txt) : null;
        if (agro_venc && (!prod || prod === "agro") && agro_rate === null) {
          throw new ct.ValueError("Há cotas do Agronegócio vencendo neste mês. Informe a taxa especial.");
        }
        const items: any[] = await b.calculate_monthly_income(ano, mes, shares, prod || null, agro_rate);
        if (!items.length) throw new ct.ValueError("Nenhuma cota ativa encontrada para o período e produto selecionados.");
        const cons: any[] = await b.consolidate_by_client(items);
        const tot = (c: string) => items.filter((i) => i.condominium_code === c).reduce((s, i) => s + Number(i.income_value), 0);
        const por_produto: Record<string, number> = {};
        for (const c of ["civil", "saude", "agro"]) if (tot(c)) por_produto[c] = tot(c);
        resultado = {
          mes, ano, produto: prod, agro_rate, items, consolidado: cons,
          total_geral: items.reduce((s, i) => s + Number(i.income_value), 0), qty_cotas: items.length,
          por_produto, capital: cons.reduce((s, c) => s + Number(c.total_share_value), 0),
          duplicata: await b.check_duplicate_calculation(ano, mes, cond_id), agro_venc,
        };
      } catch (exc: any) {
        if (ct.ehValueError(exc)) erro = msg(exc);
        else { // mostra o erro sem derrubar a tela
          console.error("Erro na apuração (ERP)", exc);
          erro = `Erro no cálculo: ${msg(exc)}`;
        }
      }
    }
    return render_template("financas/cap/cond_apuracao_nova.html", await _ctx_prod(e, "cond_apuracao", {
      conds, mes, ano, prod, erro, r: resultado, MESES, agro_txt,
    }));
  });

  post("financas.cond_apuracao_salvar", "/financas/<slug>/condominios/apuracoes/salvar", async (slug: string) => {
    await _so_capuzzo(slug);
    _csrf();
    return _proxy("apuracao_salvar");
  });

  get("financas.cond_apuracao_detalhe", "/financas/<slug>/condominios/apuracoes/<int:calc_id>", async (slug: string, calc_id: number) => {
    const e = await _so_capuzzo(slug);
    const [b, det] = await _detalhe(calc_id);
    const meta = det.header, items: any[] = det.items;
    const clients: any[] = await b.consolidate_by_client(items);
    const code = meta.condominium_code;
    let data_sug: string | null = null;
    try {
      if (code === "civil" || code === "saude") data_sug = b.bank_inter.data_sugerida_pagamento(code, meta.calculation_year, meta.calculation_month).isoformat();
      else if (code === "agro") data_sug = b.bank_itau.data_sugerida_pagamento(meta.calculation_year, meta.calculation_month).isoformat();
    } catch { data_sug = null; }
    return render_template("financas/cap/cond_apuracao_detalhe.html", await _ctx_prod(e, "cond_apuracao", {
      calc_id, meta, clients, total_geral: items.reduce((s, i) => s + Number(i.income_value), 0),
      total_cotas: clients.reduce((s, c) => s + c.shares_count, 0), bank: b.COND_BANK_INFO[code] ?? {},
      data_sug, remessas: await b.get_bank_remittance_files(calc_id), MESES,
    }));
  });

  route("financas.cond_apuracao_editar", "/financas/<slug>/condominios/apuracoes/<int:calc_id>/editar", ["GET", "POST"], async (slug: string, calc_id: number) => {
    const e = await _so_capuzzo(slug);
    const [b, det0] = await _detalhe(calc_id);
    let det = det0;
    let erro: string | null = null;
    if (request().method === "POST") {
      _csrf();
      const resp = makeResponse(await viewFunction("historico_editar")({ calculation_id: calc_id }));
      if ([301, 302, 303].includes(resp.status)) {
        resp.headers.set("location", _traduzir(resp.headers.get("location")));
        return resp;
      }
      erro = "Não foi possível salvar. Confira os valores informados.";
      det = await b.get_monthly_calculation_detail(calc_id);
    }
    return render_template("financas/cap/cond_apuracao_editar.html", await _ctx_prod(e, "cond_apuracao", { calc_id, det, erro, MESES }));
  });

  post("financas.cond_apuracao_excluir", "/financas/<slug>/condominios/apuracoes/<int:calc_id>/excluir", async (slug: string, calc_id: number) => {
    await _so_capuzzo(slug);
    _csrf();
    return _proxy("historico_excluir", { calculation_id: calc_id });
  });

  get("financas.cond_apuracao_exportar", "/financas/<slug>/condominios/apuracoes/<int:calc_id>/exportar", async (slug: string, calc_id: number) => {
    await _so_capuzzo(slug);
    return _proxy("historico_exportar_planilha", { calc_id });
  });

  post("financas.cond_apuracao_banco_validar", "/financas/<slug>/condominios/apuracoes/<int:calc_id>/banco/validar", async (slug: string, calc_id: number) => {
    await _so_capuzzo(slug);
    _csrf();
    return viewFunction("historico_banco_validar")({ calc_id });
  });

  post("financas.cond_apuracao_banco_gerar", "/financas/<slug>/condominios/apuracoes/<int:calc_id>/banco/gerar", async (slug: string, calc_id: number) => {
    await _so_capuzzo(slug);
    _csrf();
    return _proxy("historico_banco_gerar", { calc_id });
  });

  get("financas.cond_apuracao_banco_baixar", "/financas/<slug>/condominios/apuracoes/<int:calc_id>/banco/baixar/<int:rid>/<any(rem, csv):tipo>",
    async (slug: string, calc_id: number, rid: number, tipo: string) => {
      await _so_capuzzo(slug);
      return _proxy("historico_banco_baixar", { calc_id, remittance_id: rid, tipo });
    });

  // ───────────────────────── contratos (módulo Contratos, com o layout do ERP) ─────────────────────────
  get("financas.cond_contrato", "/financas/<slug>/condominios/contratos/<int:cid>", async (slug: string, cid: number) => {
    const e = await _so_capuzzo(slug);
    const c = await ct.obter(cid);
    if (!c) abort(404);
    const cfg = await ct.config();
    const hoje = PyDate.today().isoformat();
    const [aq, venc] = ct.datas_sugeridas(c, hoje);
    const cli = c.signatarios.find((s: any) => s.papel === "cliente");
    const link = await ct.link_assinatura(c, cfg);
    const msg_wpp = `Olá, ${String(cli.nome).trim().split(/\s+/)[0]}! Segue o link para assinatura eletrônica do seu `
      + `${ct.TIPOS[c.tipo]} (${c.dados.qtd} cota(s) — ${ct.moeda(ct.valor_doc(c.dados))}): ${link}`;
    const fone = ct.so_digitos(c.cliente_fone);
    return render_template("financas/cap/cond_contrato.html", await _ctx_ct(e, {
      c, cli, cfg, link, hoje, aq_sugerida: aq, venc_sugerido: venc, msg_wpp,
      fone_wpp: [10, 11].includes(fone.length) ? "55" + fone : "",
      link_local: cfg.url_publica.includes("127.0.0.1") || cfg.url_publica.includes("localhost"),
    }));
  });

  post("financas.cond_contrato_acao", "/financas/<slug>/condominios/contratos/<int:cid>/<any(enviar, 'enviado-manual', cancelar, excluir, ativar):acao>",
    async (slug: string, cid: number, acao: string) => {
      await _so_capuzzo(slug);
      const ep = "contratos." + acao.replace(/-/g, "_");
      if (acao === "enviado-manual") return viewFunction(ep)({ cid });
      return _proxy(ep, { cid });
    });

  route("financas.cond_contrato_novo", "/financas/<slug>/condominios/contratos/novo", ["GET", "POST"], async (slug: string) => {
    const e = await _so_capuzzo(slug);
    const r = request();
    if (r.method === "POST") {
      _csrf();
      try {
        const cid = await ct.criar_contrato_aquisicao(r.form.get("client_id"), r.form.get("condominium_id"), r.form.getlist("share_ids"));
        flash("Contrato gerado e assinado pela empresa. Confira e envie para assinatura.", "success");
        return redirect(_u("cond_contrato", { cid }));
      } catch (exc: any) {
        if (!ct.ehValueError(exc)) throw exc;
        const s = msg(exc);
        flash(s.slice(0, 1).toUpperCase() + s.slice(1), "error");
      }
    }
    const client_id = r.args.has("client_id") ? r.args.get("client_id", null, "int") : r.form.get("client_id", null, "int");
    const cotas = await ct.cotas_pendentes_sem_contrato();
    const m = new Map<number, string>();
    for (const c of cotas) if (!m.has(c.client_id)) m.set(c.client_id, c.cliente_nome);
    const clientes = Array.from(m.entries()).sort((a, b) => { const x = a[1].toLowerCase(), y = b[1].toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
    const cliente: any = client_id ? await B().get_client_by_id(client_id) : null;
    const modelos = Array.from(new Set(ct.modelos_itens().filter(([[t]]) => t === "aquisicao").map(([[, code]]) => code)));
    return render_template("financas/cap/cond_contrato_novo.html", await _ctx_ct(e, {
      clientes, cliente, cotas: client_id ? cotas.filter((c: any) => c.client_id === client_id) : [],
      falta: cliente ? ct.pendencias_cliente(cliente) : [], modelos,
    }));
  });

  route("financas.cond_contratos_config", "/financas/<slug>/condominios/contratos/configuracoes", ["GET", "POST"], async (slug: string) => {
    const e = await _so_capuzzo(slug);
    if (request().method === "POST") {
      _csrf();
      await ct.salvar_config(request().form);
      flash("Configurações dos contratos salvas.", "success");
      return redirect(_u("cond_contratos_config"));
    }
    return render_template("financas/cap/cond_contratos_config.html", await _ctx_ct(e, { cfg: await ct.config() }));
  });

  // ───────────────────────── renovação / retirada com termo para assinatura ─────────────────────────
  // Renovar ou marcar retirada de cotas e já gerar o termo para o cliente assinar.
  // Sempre passa por esta tela de conferência: mostra TODAS as cotas ativas do cliente no produto
  // (as clicadas já vêm marcadas) para escolher exatamente o que entra antes de gerar.
  route("financas.cond_termo", "/financas/<slug>/condominios/termos/<any(renovacao, retirada):tipo>", ["GET", "POST"], async (slug: string, tipo: string) => {
    const e = await _so_capuzzo(slug);
    const b = B();
    const hoje = PyDate.today();
    let ref = String(values("referrer") || "").trim();
    if (ref.startsWith("/financas/")) ref = PREFIXO + ref;
    const voltar = _voltar() || (ref.startsWith(PREFIXO + "/financas/") ? ref : _u("cond_vencimentos"));
    if (request().method === "POST") {
      _csrf();
      const f = request().form;
      const cfg = await ct.config();
      const criados: number[] = [], avisos: string[] = [];
      const ngrupos = f.get("grupos") ? pyInt(f.get("grupos")) : 0;
      for (let gi = 0; gi < ngrupos; gi++) {
        const ids = f.getlist(`g${gi}_ids`).filter((x: string) => /^\d+$/.test(x)).map((x: string) => parseInt(x, 10));
        if (!ids.length) continue;
        const client_id = pyInt(f.get(`g${gi}_cliente`)), cond_id = pyInt(f.get(`g${gi}_produto`));
        const cliente: any = await b.get_client_by_id(client_id);
        const gerar = f.get(`g${gi}_termo`) === "1";
        const notas = String(f.get(`g${gi}_obs`) || "").trim();
        if (gerar) { // confere antes de mexer nas cotas: o termo precisa poder ser gerado
          const falta = ct.pendencias_cliente(cliente || {});
          if (falta.length) {
            flash(`${(cliente || {}).full_name ?? "Cliente"}: nada foi feito — complete o cadastro `
              + `(falta ${falta.join(", ")}) para gerar o termo.`, "error");
            continue;
          }
        }
        let res: any, extras: Record<string, any>;
        if (tipo === "renovacao") {
          const ren = f.get(`g${gi}_data`, ""), venc = f.get(`g${gi}_venc`, "");
          res = await b.renew_shares_batch(ids, ren, venc, notas || "Renovação com termo para assinatura (ERP)");
          extras = { data_renovacao: ren, novo_vencimento: venc };
        } else {
          const ped = f.get(`g${gi}_data`, ""), eff = f.get(`g${gi}_venc`, "");
          res = await b.mark_withdrawal_batch(ids, ped, eff, notas || "Retirada com termo para assinatura (ERP)");
          const valor = String(f.get(`g${gi}_valor`) || "").replace(/\./g, "").replace(/,/g, ".").replace("R$", "").trim();
          let v: number | null = null;
          if (valor) { v = Number(valor); if (Number.isNaN(v)) throw new ct.ValueError(`could not convert string to float: '${valor}'`); }
          extras = { data_pedido: ped, data_efetiva: eff, valor: v };
        }
        const erros = new Set(res.errors.map((x: any) => x.share_id));
        for (const x of res.errors) flash(`Cota ${x.share_number}: ${x.error}`, "error");
        const ok_ids = ids.filter((i: number) => !erros.has(i));
        if (!ok_ids.length) continue;
        if (!gerar) { avisos.push(`${ok_ids.length} cota(s) de ${cliente.full_name} sem termo`); continue; }
        try {
          const cid = await ct.criar_termo(tipo, client_id, cond_id, ok_ids, extras);
          criados.push(cid);
          if (cfg.envio_automatico === "1") {
            try { await ct.enviar_para_assinatura(cid); } catch (exc: any) { // o termo fica pronto para enviar à mão
              flash(`Termo gerado, mas o e-mail não foi enviado: ${msg(exc)}`, "warning");
            }
          }
        } catch (exc: any) {
          if (!ct.ehValueError(exc)) throw exc;
          flash(`${cliente.full_name}: cotas atualizadas, mas o termo não foi gerado — ${msg(exc)}`, "error");
        }
      }
      const acao = tipo === "renovacao" ? "renovada(s)" : "marcada(s) em retirada"; // "Cota(s) …"
      if (criados.length) {
        flash(`Cota(s) ${acao}. ${criados.length} termo(s) gerado(s)`
          + (cfg.envio_automatico === "1" ? " e enviado(s) ao cliente." : " — confira e clique em Enviar para assinatura."), "success");
      }
      for (const a of avisos) flash(`Cota(s) ${acao}: ${a}.`, "success");
      if (criados.length === 1) return redirect(_u("cond_contrato", { cid: criados[0] }));
      if (criados.length) return redirect(_u("cond_contratos", { tipo }));
      return redirect(voltar);
    }

    // ── tela de conferência ──
    const marcadas = String(request().args.get("ids", "")).split(",").filter((x) => /^\d+$/.test(x.trim())).map((x) => parseInt(x.trim(), 10));
    const ocupadas = await ct.cotas_em_termo_aberto(tipo);
    const grupos = new Map<string, any>();
    for (const sid of marcadas) {
      const cota: any = await b.get_share_by_id(sid);
      if (!cota) continue;
      const k = `${cota.client_id}|${cota.condominium_id}`;
      if (!grupos.has(k)) {
        const cli = (await b.get_client_by_id(cota.client_id)) || {};
        const cond = ((await b.get_condominiums()) as any[]).find((c) => c.id === cota.condominium_id) ?? {};
        if (!("condominium_code" in cota)) cota.condominium_code = cond.code ?? null;
        let d1: string, d2: string;
        if (tipo === "renovacao") [d1, d2] = await b._sugestao_renovacao(cota, hoje);
        else [d1, d2] = await b._sugestao_retirada(cota, hoje);
        grupos.set(k, {
          cliente: cli, cond, data: d1, venc: d2, marcadas: new Set<number>(),
          falta: ct.pendencias_cliente(cli),
          cotas: await ct.cotas_ativas_cliente(cota.client_id, cota.condominium_id),
          modelo: ct.MODELOS.has(`${tipo}|${cond.code}`),
        });
      }
      grupos.get(k).marcadas.add(sid);
    }
    for (const gr of grupos.values()) {
      for (const c of gr.cotas) {
        c.share_value = F(c.share_value);
        c.bloqueio = c.withdrawal_requested ? "já tem retirada marcada" : ocupadas.has(c.id) ? "já está em outro termo em andamento" : "";
      }
    }
    return render_template("financas/cap/cond_termo.html", await _ctx_ct(e, {
      tipo, grupos: Array.from(grupos.values()), voltar, hoje: hoje.isoformat(),
      auto: (await ct.config()).envio_automatico === "1", PRODUTOS_DOC: ct.PRODUTOS_DOC,
    }));
  });
}
