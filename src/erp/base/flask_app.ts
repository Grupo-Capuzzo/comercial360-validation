/* eslint-disable @typescript-eslint/no-explicit-any */
// Porte de app/flask_app.py — App Condomínios de Investimento (Grupo Capuzzo).
// Mesmas rotas (endpoints e regras do Flask), mesmas mensagens e mesmos templates.
// Diferenças inevitáveis da versão online (ver PORT.md):
//   - backups de arquivo SQLite não existem (bkp.criar_backup() → null; tela /backup avisa);
//   - remessas/planilhas ficam em erp_arquivos (download direto) em vez de pastas;
//   - Gmail: autenticação OAuth pelo navegador com rota de retorno (configuracoes_gmail_retorno);
//   - exportação Supabase: tela igual, ação mostra que não se aplica online.
import ExcelJS from "exceljs";

import {
  PREFIXO, PyDate, Resposta, contextProcessor, flash, redirect, render_template, request, route,
  sendFile, session, url_for,
} from "../core/flask";
import { lerArquivo } from "../core/arquivos";
import { ultimoDiaMes, pyRound } from "../core/py";
import * as db from "./database";
import {
  formatar_moeda, formatar_percentual, formatar_data, calculate_monthly_income, consolidate_by_client,
  check_agro_maturing, validate_agro_special_rate, parse_data,
} from "./calculations";
import * as bkp from "./backup";
import * as rep from "./reports";
import * as gmail from "./gmail_integration";
import * as bank_inter from "./bank_files_inter";
import * as bank_itau from "./bank_files_itau";
import * as priv_calc from "./private_loans_calculations";
import * as vsc from "./validacao_sistema_calculations";
import * as sbx from "./supabase_export";
import {
  CHAVES_FLOAT, D, Decimal, ValueError, pyFloat, pyFloatRepr, pyInt, pyMax, pyMin, sortBy, strExc,
} from "./pyextra";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Valor padrão de cota por produto
export const COND_DEFAULT_VALUES: Record<string, number> = { civil: 10000.0, agro: 20000.0, saude: 50000.0 };

// Banco pagador por produto (Civil/Saúde = Inter via Pix; Agro = Itaú via dados bancários).
export const COND_BANK_INFO: Record<string, Record<string, string>> = {
  civil: { bank_code: "077", bank_name: "Banco Inter", method: "pix" },
  saude: { bank_code: "077", bank_name: "Banco Inter", method: "pix" },
  agro: { bank_code: "341", bank_name: "Banco Itaú", method: "dados_bancarios" },
};

// ─── Utilitários locais ─────────────────────────────────────
const F = () => request().form;
const A = () => request().args;
const fget = (k: string, def: any = "") => F().get(k, def) ?? def;
const aget = (k: string, def: any = "") => A().get(k, def) ?? def;
const strip = (v: any) => String(v ?? "").trim();
const pad2 = (n: number) => String(n).padStart(2, "0");
const referrer = () => request().headers.get("referer") || "";
const ehValueError = (e: any) => e instanceof ValueError;
const ehTypeOuValue = (e: any) => e instanceof ValueError || e instanceof TypeError;
/** sum() do Python sobre floats. */
const soma = (l: any[], f: (x: any) => any) => l.reduce((a, x) => a + Number(f(x)), 0);

/** JSON igual ao jsonify do Flask, incluindo floats inteiros como "10000.0". */
const FLOATS_EXTRA = new Set(["valor_padrao", "total_value", "discount_amount", "early_settlement_amount", "original_installment_amount"]);
function jsonPy(v: any, chave?: string): string {
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (Number.isInteger(v) && chave && (CHAVES_FLOAT.has(chave) || FLOATS_EXTRA.has(chave))) return pyFloatRepr(v);
    return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  }
  if (typeof v === "string") return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  if (v instanceof Decimal || v instanceof PyDate) return jsonPy(v.toString());
  if (Array.isArray(v)) return "[" + v.map((x) => jsonPy(x, chave)).join(",") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).sort().map((k) => `${jsonPy(k)}:${jsonPy(v[k], k)}`).join(",") + "}";
  return jsonPy(String(v));
}
function jsonifyPy(dados: any, status = 200): Resposta {
  return new Resposta(jsonPy(dados) + "\n", status, "application/json");
}

// ─── Helpers de validação e parsing ─────────────────────────
export function _parse_float(s: any): number {
  try {
    return pyFloat((s === null || s === undefined ? "None" : String(s)).replace(/\./g, "").replace(/,/g, ".").trim());
  } catch { return 0.0; }
}

export function _somente_digitos(valor: any): string { return String(valor || "").replace(/\D/g, ""); }

/** Decimal(str(valor or 0)) */
export function _pd(valor: any): Decimal {
  if (valor instanceof Decimal) return valor.__bool__() ? valor : D("0");
  if (!valor) return D("0");
  return D(typeof valor === "number" ? pyFloatRepr(valor) : String(valor));
}

export function _parse_int_or_none(valor: any): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  try { return pyInt(valor); } catch { return null; }
}

export function _parse_money_or_flag(valor_bruto: any, erros: string[]): Decimal {
  try { return priv_calc.parse_money_br(valor_bruto); } catch (e) {
    if (!ehValueError(e)) throw e;
    erros.push("Valor informado inválido.");
    return D("0");
  }
}

export function _parse_percent_or_flag(valor_bruto: any, erros: string[]): Decimal {
  try { return priv_calc.parse_percent_br(valor_bruto); } catch (e) {
    if (!ehValueError(e)) throw e;
    erros.push("Taxa de juros mensal inválida.");
    return D("0");
  }
}

export function formatar_documento(doc: any): string {
  const d = _somente_digitos(doc);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return doc || "—";
}

export function _campos_contrato_cliente(): Record<string, string> {
  const d: Record<string, string> = {};
  for (const k of db.CLIENT_CONTRACT_FIELDS) d[k] = strip(fget(k, ""));
  d.address_state = d.address_state.toUpperCase().slice(0, 2);
  return d;
}

export async function _validar_cliente(data: Record<string, any>, exclude_id = 0): Promise<string[]> {
  const erros: string[] = [];
  const doc = String(data.cpf ?? "").replace(/\./g, "").replace(/-/g, "").replace(/\//g, "").trim();
  if (!doc || (doc.length !== 11 && doc.length !== 14)) erros.push("CPF/CNPJ inválido (CPF: 11 dígitos, CNPJ: 14 dígitos).");
  if (!String(data.full_name ?? "").trim()) erros.push("Nome completo é obrigatório.");
  if (doc && (doc.length === 11 || doc.length === 14) && (await db.cpf_exists(doc, exclude_id))) {
    erros.push(`CPF/CNPJ ${data.cpf ?? "None"} já está cadastrado.`);
  }
  return erros;
}

function _floatOu0(v: any): number { try { return pyFloat(v || 0); } catch { return 0.0; } }

export function _validar_cotas_multiplas(data: Record<string, any>, allow_duplicate = false): string[] {
  const erros: string[] = [];
  const pendente = (data.status ?? "ativa") === "pendente";
  if (!data.condominium_id) erros.push("Produto é obrigatório.");
  if (!data.client_id) erros.push("Cliente é obrigatório.");

  const share_values: any[] = data.share_values || [];
  const nums: any[] = data.share_numbers || [];
  const acq_dates: any[] = data.acquisition_dates || [];
  const mat_dates: any[] = data.maturity_dates || [];
  const lrd_dates: any[] = data.last_renewal_dates || [];

  if (share_values.length) {
    share_values.forEach((sv_raw, idx) => {
      let sv_i = 0.0;
      try {
        sv_i = sv_raw ? pyFloat((typeof sv_raw === "number" ? pyFloatRepr(sv_raw) : String(sv_raw)).replace(/\./g, "").replace(/,/g, ".")) : 0.0;
      } catch { sv_i = 0.0; }
      if (sv_i <= 0) erros.push(`Valor da cota ${idx + 1} deve ser maior que zero.`);
    });
  } else {
    const sv = _floatOu0(data.share_value);
    if (sv <= 0) erros.push("Valor unitário da cota deve ser maior que zero.");
  }

  if (!nums.length) erros.push("Informe ao menos um número de cota.");
  else {
    const seen = new Set<string>();
    nums.forEach((n, idx) => {
      if (!n) erros.push(`Número da cota ${idx + 1} é obrigatório.`);
      else if (seen.has(n) && !allow_duplicate) erros.push(`Número de cota duplicado: ${n}. (Marque 'Lançamento histórico' para permitir.)`);
      seen.add(n);
    });
  }

  nums.forEach((n, i) => {
    const linha = i + 1;
    const acq = i < acq_dates.length ? String(acq_dates[i]).trim() : "";
    const mat = i < mat_dates.length ? String(mat_dates[i]).trim() : "";
    const lrd = i < lrd_dates.length ? String(lrd_dates[i]).trim() : "";
    const rot = n || "?";
    if (!pendente && !acq) erros.push(`Cota ${linha} (${rot}): Data de aquisição é obrigatória para cotas ativas.`);
    if (acq && mat && mat < acq) erros.push(`Cota ${linha} (${rot}): Vencimento não pode ser anterior à aquisição.`);
    if (lrd) {
      if (acq && lrd < acq) erros.push(`Cota ${linha} (${rot}): Última renovação não pode ser anterior à aquisição.`);
      if (mat && lrd > mat) erros.push(`Cota ${linha} (${rot}): Última renovação não pode ser posterior ao vencimento.`);
    }
  });
  return erros;
}

export function _validar_cota(data: Record<string, any>, _allow_duplicate = false): string[] {
  const erros: string[] = [];
  const pendente = (data.status ?? "ativa") === "pendente";
  if (!data.condominium_id) erros.push("Produto é obrigatório.");
  if (!data.client_id) erros.push("Cliente é obrigatório.");
  if (!String(data.share_number ?? "").trim()) erros.push("Número da cota é obrigatório.");
  if (!pendente && !data.acquisition_date) erros.push("Data de aquisição é obrigatória para cotas ativas.");
  const sv2 = _floatOu0(data.share_value);
  if (sv2 <= 0) erros.push("Valor unitário deve ser maior que zero.");
  if (data.maturity_date && data.acquisition_date) {
    if (data.maturity_date < data.acquisition_date) erros.push("Data de vencimento deve ser igual ou posterior à data de aquisição.");
  }
  const lrd = String(data.last_renewal_date || "").trim();
  if (lrd) {
    if (data.acquisition_date && lrd < data.acquisition_date) erros.push("Data da última renovação não pode ser anterior à data de aquisição.");
    if (data.maturity_date && lrd > data.maturity_date) erros.push("Data da última renovação não pode ser posterior à data de vencimento.");
  }
  return erros;
}

// ─── Template helpers ───────────────────────────────────────
export function inject_helpers() {
  return { formatar_moeda, formatar_percentual, formatar_data, formatar_documento };
}

// ─── Títulos Privados: validações ───────────────────────────
export function _validar_private_loan_cliente(data: Record<string, any>): string[] {
  const erros: string[] = [];
  if (!String(data.name || "").trim()) erros.push("Nome do cliente de títulos é obrigatório.");
  return erros;
}

export function _validar_private_loan(data: Record<string, any>): string[] {
  const erros: string[] = [];
  if (!data.private_client_id) erros.push("Selecione (ou cadastre) o cliente do empréstimo.");
  const original = _floatOu0(data.original_amount);
  if (original <= 0) erros.push("Valor originalmente emprestado deve ser maior que zero.");
  let taxa: number;
  try { taxa = pyFloat(data.interest_rate_monthly || 0); } catch { taxa = -1.0; }
  if (taxa < 0) erros.push("Taxa de juros mensal inválida.");
  if (!data.start_date) erros.push("Data de contratação é obrigatória.");
  const metodo = data.calculation_method;
  if (metodo === "bullet" || metodo === "manual") {
    const contratado = _floatOu0(data.contracted_amount);
    if (contratado <= 0) erros.push("Valor total contratado deve ser maior que zero.");
  }
  if (metodo === "bullet" && !data.final_due_date) erros.push("Data de vencimento é obrigatória para empréstimo de pagamento único.");
  if (metodo === "price") {
    if (!data.first_due_date) erros.push("Data da primeira parcela é obrigatória para empréstimo Price.");
    let n_parc: number;
    try { n_parc = pyInt(data.installments_count || 0); } catch { n_parc = 0; }
    if (n_parc <= 0) erros.push("Quantidade de parcelas deve ser maior que zero para empréstimo Price.");
  }
  return erros;
}

export async function _calcular_saldo_atualizado_emprestimo(loan_id: number, as_of_date: any = null): Promise<any> {
  const loan = await db.get_private_loan_by_id(loan_id);
  if (!loan) throw new ValueError(`Empréstimo #${loan_id} não encontrado.`);
  if (loan.calculation_method === "price" || loan.calculation_method === "manual") {
    const installments = await db.get_private_loan_installments(loan_id);
    if (installments.length) {
      const extensions = await db.get_private_loan_extensions(loan_id);
      return priv_calc.calculate_price_loan_open_balance(installments, loan.interest_rate_monthly, as_of_date, extensions);
    }
  }
  return priv_calc.calculate_current_loan_balance(loan_id, as_of_date);
}

function _dadosClienteTitulos() {
  return {
    linked_client_id: _parse_int_or_none(F().get("linked_client_id")),
    name: strip(fget("name")),
    document: _somente_digitos(fget("document")),
    email: strip(fget("email")),
    phone: strip(fget("phone")),
    pix_key: strip(fget("pix_key")),
    notes: strip(fget("notes")),
    status: fget("status", "ativo"),
  };
}

// ─── Importação de clientes ─────────────────────────────────
export const _COL_MAP: Record<string, string> = {
  "nome completo": "nome_completo",
  "nome": "nome_completo",
  "cpf/cnpj": "cpf_cnpj",
  "cpf": "cpf_cnpj",
  "cnpj": "cpf_cnpj",
  "email": "email",
  "telefone": "telefone",
  "chave pix": "chave_pix",
  "status": "status",
  "observações": "observacoes",
  "observacoes": "observacoes",
  "banco": "banco",
  "agência": "agencia",
  "agencia": "agencia",
  "conta": "conta",
  "dígito da conta": "digito_conta",
  "digito da conta": "digito_conta",
  "tipo de conta": "tipo_conta",
  "titular da conta": "titular_conta",
  "cpf/cnpj do titular": "cpf_cnpj_titular",
  "observações bancárias": "observacoes_bancarias",
  "observacoes bancarias": "observacoes_bancarias",
};

/** str(valor) de uma célula lida pelo openpyxl (data_only=True). */
function _strCelula(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const d = PyDate.fromDate(v, true);
    return d.isoformat(" ");
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloatRepr(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "object") {
    if ("result" in v) return _strCelula(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return String(v.error);
  }
  return String(v);
}

export async function _parse_excel_rows(dados: Uint8Array): Promise<Record<string, any>[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(dados) as any);
  } catch (exc: any) {
    throw new ValueError(`Não foi possível abrir o arquivo Excel: ${strExc(exc)}`);
  }
  const ativa = (wb as any).views?.[0]?.activeTab ?? 0;
  const ws = wb.worksheets[ativa] ?? wb.worksheets[0];
  if (!ws || ws.rowCount < 1) throw new ValueError("Planilha vazia — nenhuma linha encontrada.");
  const ncol = ws.columnCount;
  const linha = (r: number) => { const row = ws.getRow(r); const out: (string | null)[] = []; for (let c = 1; c <= ncol; c++) out.push(_strCelula(row.getCell(c).value)); return out; };
  const headers = linha(1).map((h) => (h !== null ? h.trim().toLowerCase() : ""));
  const col_keys = headers.map((h) => _COL_MAP[h] ?? h);
  const resultado: Record<string, any>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = linha(r);
    if (row.every((c) => c === null || c.trim() === "")) continue;
    const d: Record<string, any> = { _linha: r };
    col_keys.forEach((k, i) => { d[k] = row[i] !== null ? String(row[i]).trim() : ""; });
    resultado.push(d);
  }
  return resultado;
}

// ─── Vencimentos e retiradas ────────────────────────────────
export const WITHDRAWAL_SUGGESTION_DAYS: Record<string, number> = { civil: 3, agro: 30, saude: 30 };

export function _somar_anos(d: PyDate, anos = 1): PyDate {
  try { return d.replace({ year: d.year + anos }); } catch { return d.replace({ year: d.year + anos, day: 28 }); }
}

export function _sugestao_renovacao(cota: Record<string, any>, today: PyDate): [string, string] {
  const mat = parse_data(cota.maturity_date) || today;
  let novo = _somar_anos(mat, 1);
  while (novo.compare(today) <= 0) novo = _somar_anos(novo, 1);
  return [today.isoformat(), novo.isoformat()];
}

export function _sugestao_retirada(cota: Record<string, any>, today: PyDate): [string, string, number] {
  const mat = parse_data(cota.maturity_date) || today;
  const dias = WITHDRAWAL_SUGGESTION_DAYS[cota.condominium_code || ""] ?? 30;
  let eff = mat.addDays(dias);
  if (eff.compare(today) < 0) eff = today;
  return [today.isoformat(), eff.isoformat(), dias];
}

export function _agrupar_cotas_por_cliente(cotas: any[]): any[] {
  const grupos = new Map<string, any>();
  for (const c of cotas) {
    const chave = JSON.stringify([c.client_id ?? null, c.condominium_code ?? null]);
    let g = grupos.get(chave);
    if (!g) {
      g = {
        client_id: c.client_id ?? null, client_name: c.client_name ?? null, client_cpf: c.client_cpf ?? null,
        condominium_code: c.condominium_code ?? null, condominium_name: c.condominium_name ?? null,
        cotas: [], total_value: 0.0,
      };
      grupos.set(chave, g);
    }
    g.cotas.push(c);
    try { g.total_value += pyFloat(c.share_value || 0); } catch { /* ignora */ }
  }
  let lista = Array.from(grupos.values());
  for (const g of lista) {
    g.qty_cotas = g.cotas.length;
    g.cotas = sortBy(g.cotas, (c: any) => [c.maturity_date || "9999-99-99", String(c.share_number || "")]);
  }
  lista = sortBy(lista, (g: any) => [-g.total_value, String(g.client_name || "").toUpperCase()]);
  return lista;
}

function _redirect_vencimentos() {
  const ref = fget("referrer", "") || referrer();
  if (ref.includes("/condominios/vencimentos")) return redirect(ref);
  return redirect(url_for("condominios_vencimentos"));
}

export function _parse_share_ids_from_form(): number[] {
  let raw = F().getlist("share_ids[]");
  if (!raw.length) raw = F().getlist("share_ids");
  const ids: number[] = [];
  for (const v of raw) { try { ids.push(pyInt(v)); } catch { /* ignora */ } }
  return ids;
}

// ─── Edição em lote de cotas ────────────────────────────────
export async function _bulk_rows_from_form(cotas_por_id: Map<number, any>): Promise<any[]> {
  const fl = (k: string) => F().getlist(k);
  const ids = fl("row_id[]"), conds = fl("row_condominium_id[]"), clis = fl("row_client_id[]"), nums = fl("row_share_number[]");
  const vals = fl("row_share_value[]"), acqs = fl("row_acquisition_date[]"), lrds = fl("row_last_renewal_date[]");
  const mats = fl("row_maturity_date[]"), stats = fl("row_status[]"), wdts = fl("row_withdrawal_date[]"), notes = fl("row_notes[]");
  const _at = (lista: string[], i: number, def = "") => (i < lista.length ? lista[i] : def);
  const isdigit = (s: string) => /^\d+$/.test(s);
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i++) {
    let sid: number;
    try { sid = pyInt(ids[i]); } catch { continue; }
    const base = cotas_por_id.get(sid) || (await db.get_share_by_id(sid));
    if (!base) continue;
    const cond_id_raw = _at(conds, i).trim();
    const cli_id_raw = _at(clis, i).trim();
    const status = _at(stats, i).trim() || base.status;
    let wd = _at(wdts, i).trim();
    if (status !== "inativa") wd = "";
    rows.push({
      id: sid,
      condominium_id: isdigit(cond_id_raw) ? pyInt(cond_id_raw) : base.condominium_id,
      client_id: isdigit(cli_id_raw) ? pyInt(cli_id_raw) : base.client_id,
      share_number: _at(nums, i).trim(),
      share_value: _parse_float(_at(vals, i, "0")),
      acquisition_date: _at(acqs, i).trim(),
      last_renewal_date: _at(lrds, i).trim(),
      maturity_date: _at(mats, i).trim(),
      status,
      withdrawal_date: wd,
      notes: _at(notes, i).trim(),
      client_name: base.client_name ?? "",
      condominium_code: base.condominium_code ?? "",
      withdrawal_requested: base.withdrawal_requested ?? null,
      withdrawal_effective_date: base.withdrawal_effective_date ?? null,
    });
  }
  return rows;
}

export function _validar_lote_cotas(rows: any[], allow_duplicate = false): string[] {
  const erros: string[] = [];
  const vistos = new Map<string, string>();
  for (const row of rows) {
    const etiqueta = `Cota ${row.share_number || row.id}`;
    for (const e of _validar_cota(row, allow_duplicate)) erros.push(`${etiqueta}: ${e}`);
    if (row.status === "inativa" && !row.withdrawal_date) erros.push(`${etiqueta}: data de retirada é obrigatória para cota inativa.`);
    if (!allow_duplicate) {
      const num = String(row.share_number || "").trim().toLowerCase();
      const chave = JSON.stringify([row.condominium_id, num]);
      if (num && vistos.has(chave)) {
        erros.push(`${etiqueta}: número repetido dentro da própria seleção (igual à cota ${vistos.get(chave)}). Marque 'permitir números repetidos' se for lançamento histórico.`);
      } else if (num) vistos.set(chave, row.share_number);
    }
  }
  return erros;
}

async function _render_lote(cotas_grid: any[], referrer_ = "") {
  return render_template("cotas_editar_lote.html", {
    active_page: "cotas", cotas: cotas_grid, conds: await db.get_condominiums(true),
    clientes: await db.get_all_clients_for_share_form(), referrer: referrer_, hoje: PyDate.today().isoformat(),
  });
}

// ─── Exportação da apuração no padrão da planilha ───────────
export const COND_SHEET_NAMES: Record<string, [string, string]> = {
  agro: ["c-agro", "vencimentos_Agro"],
  civil: ["clube-C", "vencimentos_Civil"],
  saude: ["clube-saude", "vencimento_Saude"],
};

export function _data_pagamento_produto(cond: any, ano: number, mes: number): PyDate {
  const dia = pyInt(cond.payment_day || 1);
  const ultimo = ultimoDiaMes(ano, mes);
  return new PyDate(ano, mes, Math.min(dia, ultimo));
}

export async function _bloco_export_produto(cond: any, itens_produto: any[], ano: number, mes: number) {
  const [aba_cons, aba_venc] = COND_SHEET_NAMES[cond.code] ?? [cond.code, `vencimentos_${cond.code}`];
  const data_pgto = _data_pagamento_produto(cond, ano, mes);
  const cotas_ativas = await db.get_shares_filtered(cond.id, null, "ativa");

  const posicao = new Map<number, any>();
  for (const cota of cotas_ativas) {
    let p = posicao.get(cota.client_id);
    if (!p) { p = { cotas: 0, valor: 0.0, nome: cota.client_name || "", email: cota.client_email || "" }; posicao.set(cota.client_id, p); }
    p.cotas += 1;
    p.valor += pyFloat(cota.share_value || 0);
  }
  const apurado = new Map<number, any>();
  for (const cli of await consolidate_by_client(itens_produto)) apurado.set(cli.client_id, { rendimento: cli.total_income, nome: cli.client_name });
  const emails_apuracao = new Map<number, string>();
  for (const i of itens_produto) emails_apuracao.set(i.client_id, i.client_email || "");

  const ids_clientes = Array.from(new Set([...apurado.keys(), ...posicao.keys()]));
  let consolidado: any[] = [];
  for (const cid of ids_clientes) {
    const pos = posicao.get(cid);
    const apu = apurado.get(cid);
    let nome = (apu ?? {}).nome || (pos ?? {}).nome || "";
    let email = emails_apuracao.get(cid) || (pos ?? {}).email || "";
    if (!nome || !email) {
      const cadastro: any = (await db.get_client_by_id(cid)) || {};
      nome = nome || cadastro.full_name || "";
      email = email || cadastro.email || "";
    }
    consolidado.push({
      email, cliente: nome, data_pagamento: data_pgto,
      rendimento: pyRound(apu ? (apu.rendimento ?? 0.0) : 0.0, 2),
      cotas: pos ? pos.cotas : 0,
      valor_ativo: pyRound(pos ? pos.valor : 0.0, 2),
    });
  }
  consolidado = sortBy(consolidado, (l) => String(l.cliente || "").toLowerCase());

  const grupos = new Map<string, any>();
  for (const cota of cotas_ativas) {
    const chave = JSON.stringify([cota.client_id, cota.maturity_date || ""]);
    if (!grupos.has(chave)) {
      grupos.set(chave, { email: cota.client_email || "", investidor: cota.client_name || "", valor: 0.0, vencimento: cota.maturity_date || "" });
    }
    grupos.get(chave).valor += pyFloat(cota.share_value || 0);
  }
  const vencimentos: any[] = [];
  for (const g of sortBy(Array.from(grupos.values()), (g: any) => [String(g.investidor || "").toLowerCase(), g.vencimento || "9999-12-31"])) {
    let venc_val: PyDate | null = null;
    if (g.vencimento) { try { venc_val = PyDate.fromisoformat(g.vencimento); } catch { venc_val = null; } }
    vencimentos.push({ email: g.email, investidor: g.investidor, valor: pyRound(g.valor, 2), vencimento: venc_val });
  }
  return { aba_consolidado: aba_cons, aba_vencimentos: aba_venc, consolidado, vencimentos };
}

// ─── Validação Sistema ──────────────────────────────────────
export function _vs_parse_filtros() {
  const hoje = PyDate.today();
  const inicio_txt = strip(A().get("inicio") || "");
  let inicio: PyDate | null = null;
  if (inicio_txt) {
    const alvo = inicio_txt.length > 7 ? inicio_txt : `${inicio_txt}-01`;
    inicio = vsc.month_start(alvo);
  }
  if (inicio === null || inicio === undefined) inicio = vsc.month_start(hoje)!;
  let meses: number;
  try { meses = pyInt(A().get("meses") || 24); } catch { meses = 24; }
  meses = Math.max(1, Math.min(meses, 60));
  const cliente = strip(A().get("cliente") || "");
  const produto = strip(A().get("produto") || "");
  const busca = strip(A().get("q") || "");
  return {
    inicio, meses, cliente, produto, q: busca,
    client_filter: cliente || busca || null,
    condominium_filter: produto || null,
  };
}

// ─── Exportação Supabase (área temporária) ──────────────────
export function _sbx_config_do_form(form: any): Record<string, any> {
  const ajustes: Record<string, any> = {};
  for (const b of sbx.BASES) {
    const chave = b.chave;
    ajustes[chave] = {
      tabela: strip(form.get(`tabela_${chave}`) || ""),
      estrategia: strip(form.get(`estrategia_${chave}`) || ""),
      coluna_corte: strip(form.get(`corte_${chave}`) || ""),
    };
  }
  return ajustes;
}

export function _sbx_opcoes_do_form(form: any): Record<string, any> {
  return {
    percentual_como_fracao: (form.get("percentual_formato") || "fracao") !== "percentual",
    cadastro_somente_alteradas: (form.get("escopo_cadastral") || "tudo") === "alteradas",
    fluxo_tipo: strip(form.get("fluxo_tipo") || "") || sbx.FLUXO_TIPO,
    fluxo_grupo: strip(form.get("fluxo_grupo") || "") || sbx.FLUXO_GRUPO,
    status_civil_ativa: strip(form.get("status_civil_ativa") || ""),
    status_civil_inativa: strip(form.get("status_civil_inativa") || ""),
    status_saude_ativa: strip(form.get("status_saude_ativa") || ""),
    status_saude_inativa: strip(form.get("status_saude_inativa") || ""),
  };
}

export function _sbx_config_bases(ajustes: Record<string, any> | null = null): Record<string, any> {
  ajustes = ajustes || {};
  const saida: Record<string, any> = {};
  for (const b of sbx.BASES) {
    const chave = b.chave;
    try { saida[chave] = sbx.resolver_config(chave, ajustes[chave]); } catch {
      const padrao = sbx.resolver_config(chave);
      const digitado = ajustes[chave] || {};
      padrao.tabela = digitado.tabela || padrao.tabela;
      padrao.estrategia = digitado.estrategia || padrao.estrategia;
      padrao.coluna_corte = "coluna_corte" in digitado ? digitado.coluna_corte : padrao.coluna_corte;
      saida[chave] = padrao;
    }
  }
  return saida;
}

export function _sbx_render(resultado: any = null, cutoff: any = null, bases_sel: any = null, ajustes: any = null, opcoes: any = null) {
  const op = { ...sbx.OPCOES_PADRAO, ...(opcoes || {}) };
  return render_template("exportacao_supabase.html", {
    active_page: "exportacao_supabase",
    bases: sbx.BASES,
    config_bases: _sbx_config_bases(ajustes),
    opcoes: op,
    cutoff_padrao: sbx.CUTOFF_PADRAO.isoformat(),
    cutoff_minimo: sbx.CUTOFF_MINIMO.isoformat(),
    cutoff_selecionado: cutoff || sbx.CUTOFF_PADRAO.isoformat(),
    bases_selecionadas: bases_sel !== null && bases_sel !== undefined ? bases_sel : sbx.BASES.map((b) => b.chave),
    pontos_confirmar: sbx.pontos_a_confirmar(op),
    resultado,
    exports_anteriores: sbx.listar_exports_supabase(),
  });
}

// ═══════════════════════════════════════════════════════════════
//  ROTAS
// ═══════════════════════════════════════════════════════════════
export function registrar() {
  contextProcessor(inject_helpers);

  // ─── DASHBOARD ──────────────────────────────────────────────
  route("dashboard", "/", ["GET"], async () => {
    const resumo = await db.get_dashboard_summary();
    const s_res = await db.get_shares_summary();
    const conds = await db.get_condominiums();
    const meses = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    const last_calc = resumo.last_calculation;
    const ultima_apuracao = last_calc ? `${meses[last_calc.calculation_month]}/${last_calc.calculation_year}` : "—";
    const por_prod: Record<string, any> = {};
    for (const p of s_res.por_produto || []) por_prod[p.code] = p;
    return render_template("dashboard.html", { active_page: "dashboard", resumo, s_res, conds, por_prod, ultima_apuracao });
  });

  // ─── TÍTULOS PRIVADOS ───────────────────────────────────────
  route("titulos_privados", "/titulos-privados", ["GET"], async () => {
    const loans = await db.get_private_loans();
    const clients_summary = await db.get_private_loan_clients_summary();
    const hoje = PyDate.today();
    let total_original = D("0");
    for (const l of loans) total_original = total_original.add(_pd(l.original_amount));
    const ativos_overdue = loans.filter((l) => l.status === "active" || l.status === "overdue");
    let saldo_atualizado_total = D("0"), total_atraso = D("0"), juros_acumulados_total = D("0");
    let emprestimos_em_atraso: any[] = [], proximos_vencimentos: any[] = [], maiores_saldos: any[] = [];
    for (const loan of ativos_overdue) {
      let calc: any;
      try { calc = await priv_calc.calculate_current_loan_balance(loan.id, hoje); } catch { continue; }
      saldo_atualizado_total = saldo_atualizado_total.add(_pd(calc.updated_amount));
      juros_acumulados_total = juros_acumulados_total.add(_pd(calc.accrued_interest));
      const item = { ...loan, calc };
      if (calc.days_overdue > 0) {
        total_atraso = total_atraso.add(_pd(calc.updated_amount));
        emprestimos_em_atraso.push(item);
      } else proximos_vencimentos.push(item);
      maiores_saldos.push(item);
    }
    emprestimos_em_atraso = sortBy(emprestimos_em_atraso, (x) => x.calc.days_overdue, true);
    proximos_vencimentos = sortBy(proximos_vencimentos, (x) => x.calc.base_date);
    maiores_saldos = sortBy(maiores_saldos, (x) => x.calc.updated_amount, true);
    const clientes_prorrogacao_ativa: any[] = [];
    for (const loan of ativos_overdue) {
      const cov = await db.get_latest_covered_until(loan.id);
      if (cov) clientes_prorrogacao_ativa.push({ ...loan, covered_until: cov });
    }
    const cards = {
      total_original: total_original.toNumber(),
      saldo_atualizado: saldo_atualizado_total.toNumber(),
      total_atraso: total_atraso.toNumber(),
      juros_acumulados: juros_acumulados_total.toNumber(),
      clientes_ativos: clients_summary.ativos,
      emprestimos_ativos: loans.filter((l) => l.status === "active").length,
      emprestimos_atraso: emprestimos_em_atraso.length,
      proximos_vencimentos: proximos_vencimentos.length,
    };
    return render_template("titulos_privados.html", {
      active_page: "titulos_privados_dashboard", cards,
      emprestimos_em_atraso: emprestimos_em_atraso.slice(0, 10),
      proximos_vencimentos: proximos_vencimentos.slice(0, 10),
      maiores_saldos: maiores_saldos.slice(0, 10),
      clientes_prorrogacao_ativa: clientes_prorrogacao_ativa.slice(0, 10),
    });
  });

  route("titulos_privados_clientes", "/titulos-privados/clientes", ["GET"], async () => {
    const q = strip(aget("q", ""));
    const status_filtro = strip(aget("status", ""));
    const clientes = await db.get_private_loan_clients(status_filtro || null, q || null);
    const resumo = await db.get_private_loan_clients_summary();
    const hoje = PyDate.today();
    for (const c of clientes) {
      let saldo = D("0");
      for (const loan of await db.get_private_loans(null, c.id)) {
        if (loan.status === "active" || loan.status === "overdue") {
          try {
            const calc = await priv_calc.calculate_current_loan_balance(loan.id, hoje);
            saldo = saldo.add(_pd(calc.updated_amount));
          } catch { /* ignora */ }
        }
      }
      c.saldo_aberto = saldo.toNumber();
    }
    return render_template("titulos_privados_clientes.html", {
      active_page: "titulos_privados_clientes", clientes, resumo, q, status_filtro,
    });
  });

  route("titulos_privados_clientes_buscar_vinculo", "/titulos-privados/clientes/buscar-vinculo", ["GET"], async () => {
    const termo = strip(aget("q", ""));
    if (termo.length < 2) return jsonifyPy({ results: [] });
    return jsonifyPy({ results: await db.search_general_clients_for_linking(termo) });
  });

  route("titulos_privados_clientes_novo", "/titulos-privados/clientes/novo", ["GET", "POST"], async () => {
    if (request().method === "POST") {
      const data = _dadosClienteTitulos();
      const erros = _validar_private_loan_cliente(data);
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return render_template("titulos_privados_cliente_form.html", { active_page: "titulos_privados_clientes", modo: "novo", cliente: data });
      }
      const new_id = await db.create_private_loan_client(data);
      flash(`Cliente de títulos '${data.name}' cadastrado com sucesso.`, "success");
      return redirect(url_for("titulos_privados_cliente_detalhe", { pcid: new_id }));
    }
    return render_template("titulos_privados_cliente_form.html", { active_page: "titulos_privados_clientes", modo: "novo", cliente: {} });
  });

  route("titulos_privados_cliente_detalhe", "/titulos-privados/clientes/<int:pcid>", ["GET"], async (pcid: number) => {
    const cliente = await db.get_private_loan_client_by_id(pcid);
    if (!cliente) {
      flash("Cliente de títulos não encontrado.", "error");
      return redirect(url_for("titulos_privados_clientes"));
    }
    const loans = await db.get_private_loans(null, pcid);
    const hoje = PyDate.today();
    const loans_ativos: any[] = [], loans_quitados: any[] = [];
    let saldo_total = D("0");
    for (let loan of loans) {
      if (loan.status === "active" || loan.status === "overdue") {
        try {
          const calc = await priv_calc.calculate_current_loan_balance(loan.id, hoje);
          loan = { ...loan, calc };
          saldo_total = saldo_total.add(_pd(calc.updated_amount));
        } catch { loan = { ...loan, calc: null }; }
        loans_ativos.push(loan);
      } else loans_quitados.push(loan);
    }
    return render_template("titulos_privados_cliente_detalhe.html", {
      active_page: "titulos_privados_clientes", cliente, loans_ativos, loans_quitados, saldo_total: saldo_total.toNumber(),
    });
  });

  route("titulos_privados_cliente_editar", "/titulos-privados/clientes/<int:pcid>/editar", ["GET", "POST"], async (pcid: number) => {
    const cliente = await db.get_private_loan_client_by_id(pcid);
    if (!cliente) {
      flash("Cliente de títulos não encontrado.", "error");
      return redirect(url_for("titulos_privados_clientes"));
    }
    if (request().method === "POST") {
      const data = _dadosClienteTitulos();
      const erros = _validar_private_loan_cliente(data);
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return render_template("titulos_privados_cliente_form.html", {
          active_page: "titulos_privados_clientes", modo: "editar", cliente: { ...cliente, ...data, id: pcid },
        });
      }
      await db.update_private_loan_client(pcid, data);
      flash("Cliente de títulos atualizado com sucesso.", "success");
      return redirect(url_for("titulos_privados_cliente_detalhe", { pcid }));
    }
    return render_template("titulos_privados_cliente_form.html", { active_page: "titulos_privados_clientes", modo: "editar", cliente });
  });

  route("titulos_privados_cliente_inativar", "/titulos-privados/clientes/<int:pcid>/inativar", ["POST"], async (pcid: number) => {
    await db.set_private_loan_client_status(pcid, "inativo");
    flash("Cliente de títulos inativado.", "success");
    return redirect(url_for("titulos_privados_cliente_detalhe", { pcid }));
  });

  route("titulos_privados_cliente_reativar", "/titulos-privados/clientes/<int:pcid>/reativar", ["POST"], async (pcid: number) => {
    await db.set_private_loan_client_status(pcid, "ativo");
    flash("Cliente de títulos reativado.", "success");
    return redirect(url_for("titulos_privados_cliente_detalhe", { pcid }));
  });

  route("titulos_privados_emprestimos", "/titulos-privados/emprestimos", ["GET"], async () => {
    const status_filtro = strip(aget("status", ""));
    const loans = await db.get_private_loans(status_filtro || null);
    const hoje = PyDate.today();
    for (const loan of loans) {
      if (loan.status === "active" || loan.status === "overdue") {
        try { loan.calc = await priv_calc.calculate_current_loan_balance(loan.id, hoje); } catch { loan.calc = null; }
      } else loan.calc = null;
    }
    return render_template("titulos_privados_emprestimos.html", { active_page: "titulos_privados_emprestimos", loans, status_filtro });
  });

  route("titulos_privados_emprestimos_novo", "/titulos-privados/emprestimos/novo", ["GET", "POST"], async () => {
    const clientes = await db.get_private_loan_clients("ativo");
    const pcid_prefill = A().get("private_client_id", null, "int");

    if (request().method === "POST") {
      const metodo = fget("calculation_method", "bullet");
      const raw_original = fget("original_amount", "");
      const raw_contracted = fget("contracted_amount", "");
      const raw_taxa = fget("interest_rate_monthly", "");
      const erros_valor: string[] = [];
      const original_amount_d = _parse_money_or_flag(raw_original, erros_valor);
      const contracted_amount_d = _parse_money_or_flag(raw_contracted, erros_valor);
      const taxa_d = _parse_percent_or_flag(raw_taxa, erros_valor);

      const data: Record<string, any> = {
        private_client_id: _parse_int_or_none(F().get("private_client_id")),
        linked_client_id: null,
        loan_number: strip(fget("loan_number", "")),
        original_amount: original_amount_d.toNumber(),
        contracted_amount: contracted_amount_d.toNumber(),
        interest_rate_monthly: taxa_d.toNumber(),
        interest_rate_daily: null,
        interest_type: "compound",
        calculation_method: metodo,
        start_date: strip(fget("start_date", "")),
        first_due_date: strip(fget("first_due_date", "")) || null,
        final_due_date: strip(fget("final_due_date", "")) || null,
        installments_count: pyInt(F().get("installments_count") || 1),
        installment_amount: null,
        status: "active",
        notes: strip(fget("notes", "")),
      };

      const erros = [...erros_valor, ..._validar_private_loan(data)];
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        const emprestimo_redisplay = { ...data, original_amount: raw_original, contracted_amount: raw_contracted, interest_rate_monthly: raw_taxa };
        return render_template("titulos_privados_emprestimo_form.html", { active_page: "titulos_privados_emprestimos", clientes, emprestimo: emprestimo_redisplay });
      }

      const daily = priv_calc.calculate_daily_rate(data.interest_rate_monthly);
      data.interest_rate_daily = pyFloat(daily);

      let schedule: any = null;
      if (metodo === "price") {
        try {
          schedule = priv_calc.generate_price_schedule(data.original_amount, data.interest_rate_monthly, data.installments_count, data.first_due_date);
        } catch (exc) {
          if (!ehValueError(exc)) throw exc;
          flash(strExc(exc), "error");
          return render_template("titulos_privados_emprestimo_form.html", { active_page: "titulos_privados_emprestimos", clientes, emprestimo: data });
        }
        data.installment_amount = schedule.installment_amount;
        data.contracted_amount = schedule.total_paid;
        data.final_due_date = schedule.schedule[schedule.schedule.length - 1].due_date;
      } else if (metodo === "bullet") {
        data.installments_count = 1;
        data.installment_amount = data.contracted_amount;
        data.first_due_date = data.final_due_date;
      } else {
        data.installment_amount = null;
      }

      const loan_id = await db.create_private_loan(data);

      if (metodo === "bullet") {
        const juros_bullet = priv_calc.round_money(contracted_amount_d.sub(original_amount_d));
        await db.create_private_loan_installments(loan_id, [{
          installment_number: 1, due_date: data.final_due_date, principal_amount: data.original_amount,
          interest_amount: pyFloat(juros_bullet), installment_amount: data.contracted_amount, status: "open",
        }]);
      } else if (metodo === "price" && schedule) {
        await db.create_private_loan_installments(loan_id, schedule.schedule.map((row: any) => ({
          installment_number: row.installment_number, due_date: row.due_date, principal_amount: row.principal,
          interest_amount: row.interest, installment_amount: row.installment_amount, status: "open",
        })));
      }
      flash(`Empréstimo #${loan_id} cadastrado com sucesso.`, "success");
      return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
    }

    const emprestimo: Record<string, any> = { calculation_method: "bullet" };
    if (pcid_prefill) emprestimo.private_client_id = pcid_prefill;
    for (const campo of ["original_amount", "contracted_amount", "interest_rate_monthly", "installments_count", "first_due_date", "calculation_method"]) {
      if (A().get(campo)) emprestimo[campo] = A().get(campo);
    }
    return render_template("titulos_privados_emprestimo_form.html", { active_page: "titulos_privados_emprestimos", clientes, emprestimo });
  });

  route("titulos_privados_emprestimo_detalhe", "/titulos-privados/emprestimos/<int:loan_id>", ["GET"], async (loan_id: number) => {
    const detail = await db.get_private_loan_detail(loan_id);
    if (!detail) {
      flash("Empréstimo não encontrado.", "error");
      return redirect(url_for("titulos_privados_emprestimos"));
    }
    const loan = detail.loan;
    const hoje = PyDate.today();
    let covered_until: PyDate | null = null;
    const datas_cobertura = detail.extensions.filter((e: any) => e.covered_until_date).map((e: any) => priv_calc._to_date(e.covered_until_date));
    if (datas_cobertura.length) covered_until = pyMax(datas_cobertura);
    const parcelas_quitadas_antecipadamente = new Set(
      detail.amortizations.filter((a: any) => a.price_action === "quitar_parcela_antecipada" && a.installment_id).map((a: any) => a.installment_id),
    );
    const installments_calc = detail.installments.map((inst: any) => ({
      ...inst,
      ...priv_calc.calculate_installment_current_amount(inst, loan.interest_rate_monthly, hoje, covered_until),
      early_settled: parcelas_quitadas_antecipadamente.has(inst.id),
    }));
    let calc: any = null;
    if (loan.status === "active" || loan.status === "overdue") {
      try { calc = await _calcular_saldo_atualizado_emprestimo(loan_id, hoje); } catch (exc) {
        flash(`Não foi possível calcular o saldo atualizado: ${strExc(exc)}`, "error");
      }
    }
    let loan_visual_status: string;
    if (loan.status === "active" || loan.status === "overdue") {
      loan_visual_status = priv_calc.calculate_loan_visual_status(installments_calc);
      if (loan_visual_status === "sem_parcelas") loan_visual_status = loan.status;
    } else loan_visual_status = loan.status;
    return render_template("titulos_privados_emprestimo_detalhe.html", {
      active_page: "titulos_privados_emprestimos", loan, installments: installments_calc,
      extensions: detail.extensions, amortizations: detail.amortizations, payments: detail.payments,
      calculations_log: detail.calculations_log, calc, loan_visual_status,
    });
  });

  route("titulos_privados_emprestimo_recalcular", "/titulos-privados/emprestimos/<int:loan_id>/recalcular", ["POST"], async (loan_id: number) => {
    try {
      const calc = await _calcular_saldo_atualizado_emprestimo(loan_id, PyDate.today());
      flash(
        `Recalculado para hoje: saldo base ${formatar_moeda(calc.base_amount)} (${calc.days_overdue} dia(s) em atraso) → valor atualizado ${formatar_moeda(calc.updated_amount)}.`,
        "success",
      );
    } catch (exc) { flash(`Erro ao recalcular: ${strExc(exc)}`, "error"); }
    return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
  });

  route("titulos_privados_emprestimo_registrar_calculo", "/titulos-privados/emprestimos/<int:loan_id>/recalcular/registrar", ["POST"], async (loan_id: number) => {
    try {
      const calc = await _calcular_saldo_atualizado_emprestimo(loan_id, PyDate.today());
      await db.create_private_loan_calculation_log({
        loan_id, base_date: calc.base_date, base_amount: calc.base_amount, days_overdue: calc.days_overdue,
        monthly_rate: calc.monthly_rate, daily_rate: calc.daily_rate, calculated_amount: calc.updated_amount,
        calculation_details: `Recalculado em ${PyDate.today().isoformat()}. Juros acumulados: ${formatar_moeda(calc.accrued_interest)}. Total amortizado considerado: ${formatar_moeda(calc.total_amortized)}.`,
      });
      flash("Cálculo registrado no histórico do empréstimo.", "success");
    } catch (exc) { flash(`Erro ao registrar cálculo: ${strExc(exc)}`, "error"); }
    return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
  });

  route("titulos_privados_emprestimo_prorrogacao", "/titulos-privados/emprestimos/<int:loan_id>/prorrogacao", ["GET", "POST"], async (loan_id: number) => {
    const loan = await db.get_private_loan_by_id(loan_id);
    if (!loan) {
      flash("Empréstimo não encontrado.", "error");
      return redirect(url_for("titulos_privados_emprestimos"));
    }
    if (request().method === "POST") {
      const erros: string[] = [];
      const valor_pago_d = _parse_money_or_flag(F().get("extension_amount"), erros);
      const data_pagamento = strip(fget("paid_date", ""));
      const cobrir_ate = strip(fget("covered_until_date", ""));
      const notes = strip(fget("notes", ""));
      const principal_amortizado_d = _parse_money_or_flag(F().get("principal_amortization_amount") || "0", erros);
      const valor_pago = valor_pago_d.toNumber();
      const principal_amortizado = principal_amortizado_d.toNumber();
      if (valor_pago <= 0) erros.push("Valor pago da prorrogação deve ser maior que zero.");
      if (!data_pagamento) erros.push("Data do pagamento é obrigatória.");
      if (!cobrir_ate) erros.push("Informe até qual data a dívida fica prorrogada.");
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return render_template("titulos_privados_prorrogacao_form.html", { active_page: "titulos_privados_emprestimos", loan });
      }
      await db.create_private_loan_extension({
        loan_id, reference_date: data_pagamento, paid_date: data_pagamento, extension_amount: valor_pago,
        covered_until_date: cobrir_ate, principal_kept_amount: loan.contracted_amount - principal_amortizado, notes,
      });
      await db.create_private_loan_payment({
        loan_id, installment_id: null, payment_date: data_pagamento, amount: valor_pago, payment_type: "extension", notes,
      });
      if (principal_amortizado > 0) {
        await db.create_private_loan_amortization({
          loan_id, payment_date: data_pagamento, amount: principal_amortizado, amortization_type: "reducao_saldo",
          applied_to: "principal", notes: `Parte da prorrogação de ${data_pagamento} marcada como amortização de principal.`,
        });
      }
      flash("Prorrogação registrada com sucesso.", "success");
      return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
    }
    return render_template("titulos_privados_prorrogacao_form.html", { active_page: "titulos_privados_emprestimos", loan });
  });

  route("titulos_privados_emprestimo_amortizacao", "/titulos-privados/emprestimos/<int:loan_id>/amortizacao", ["GET", "POST"], async (loan_id: number) => {
    const loan = await db.get_private_loan_by_id(loan_id);
    if (!loan) {
      flash("Empréstimo não encontrado.", "error");
      return redirect(url_for("titulos_privados_emprestimos"));
    }
    const is_price_like = loan.calculation_method === "price" || loan.calculation_method === "manual";
    const hoje = PyDate.today();
    let covered_until: PyDate | null = null;
    if (is_price_like) {
      const extensions = await db.get_private_loan_extensions(loan_id);
      const datas = extensions.filter((e: any) => e.covered_until_date).map((e: any) => priv_calc._to_date(e.covered_until_date));
      if (datas.length) covered_until = pyMax(datas);
    }
    let parcelas_abertas: any[] = [];
    if (is_price_like) {
      for (const inst of await db.get_private_loan_installments(loan_id)) {
        const r = priv_calc.calculate_installment_current_amount(inst, loan.interest_rate_monthly, hoje, covered_until);
        if (r.visual_status === "paid") continue;
        parcelas_abertas.push({ ...inst, ...r });
      }
      parcelas_abertas = sortBy(parcelas_abertas, (p) => p.due_date);
    }
    let calc_atual: any;
    try { calc_atual = await _calcular_saldo_atualizado_emprestimo(loan_id, hoje); } catch { calc_atual = null; }

    const tela = (price_like: boolean, abertas: any[]) => render_template("titulos_privados_amortizacao_form.html", {
      active_page: "titulos_privados_emprestimos", loan, calc_atual, is_price_like: price_like, parcelas_abertas: abertas, hoje_iso: hoje.isoformat(),
    });

    if (request().method === "POST") {
      const data_pagamento = strip(fget("payment_date", ""));
      const notes = strip(fget("notes", ""));
      let ui_tipo: string | null = is_price_like ? fget("ui_tipo", "parcela_especifica") : null;

      // ── OPÇÃO 1: Quitar parcela antecipada ──
      if (is_price_like && ui_tipo === "quitar_parcela_antecipada") {
        const erros: string[] = [];
        const installment_id = _parse_int_or_none(F().get("installment_id"));
        if (!data_pagamento) erros.push("Data do pagamento é obrigatória.");
        if (!installment_id) erros.push("Selecione a parcela que deseja quitar antecipadamente.");
        let inst_alvo: any = null;
        if (!erros.length) {
          inst_alvo = parcelas_abertas.find((i) => i.id === installment_id) ?? null;
          if (inst_alvo === null) erros.push("Parcela inválida ou já paga.");
        }
        let resultado: any = null;
        if (!erros.length) {
          try {
            resultado = priv_calc.calculate_early_installment_settlement(inst_alvo, loan.interest_rate_monthly, data_pagamento);
            if (resultado.status === "paid") erros.push("Esta parcela já está paga.");
          } catch (e) {
            if (!ehTypeOuValue(e)) throw e;
            erros.push("Data de pagamento inválida.");
          }
        }
        if (erros.length) {
          for (const e of erros) flash(e, "error");
          return tela(true, parcelas_abertas);
        }
        const valor_pago = resultado.early_settlement_amount;
        const notas_finais = `Quitação antecipada. Valor nominal ${formatar_moeda(resultado.original_installment_amount)}. `
          + `Valor pago antecipado ${formatar_moeda(valor_pago)}. `
          + `Desconto ${formatar_moeda(resultado.discount_amount)}.`
          + (notes ? ` Obs.: ${notes}` : "");
        await db.update_installment_payment(inst_alvo.id, valor_pago, data_pagamento, "paid", notas_finais);
        await db.create_private_loan_amortization({
          loan_id, installment_id: inst_alvo.id, payment_date: data_pagamento, amount: valor_pago,
          amortization_type: "antecipacao_parcela", applied_to: "mixed", target_mode: "parcela_especifica",
          price_action: "quitar_parcela_antecipada", amount_before: resultado.original_installment_amount, amount_after: 0.0,
          notes: notas_finais,
        });
        await db.create_private_loan_payment({
          loan_id, installment_id: inst_alvo.id, payment_date: data_pagamento, amount: valor_pago, payment_type: "installment", notes: notas_finais,
        });
        flash(
          `Parcela ${inst_alvo.installment_number} quitada antecipadamente por ${formatar_moeda(valor_pago)} (desconto de ${formatar_moeda(resultado.discount_amount)} sobre o valor nominal de ${formatar_moeda(resultado.original_installment_amount)}).`,
          "success",
        );
        return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
      }

      // ── OPÇÃO 2: Amortização avulsa ──
      const erros: string[] = [];
      const valor_d = _parse_money_or_flag(F().get("amount"), erros);
      const valor = valor_d.toNumber();
      if (valor <= 0) erros.push("Valor amortizado deve ser maior que zero.");
      if (!data_pagamento) erros.push("Data do pagamento é obrigatória.");

      if (!is_price_like) {
        const tipo = fget("amortization_type", "reducao_saldo");
        const aplicar_em = fget("applied_to", "principal");
        if (!erros.length && tipo === "liquidacao_total" && calc_atual && valor < calc_atual.updated_amount) {
          erros.push(
            `Valor informado (${formatar_moeda(valor)}) é menor que o saldo atualizado (${formatar_moeda(calc_atual.updated_amount)}). Para liquidação total, informe ao menos esse valor, ou use 'Redução de Saldo'/'Liquidação Parcial'.`,
          );
        }
        if (erros.length) {
          for (const e of erros) flash(e, "error");
          return tela(false, []);
        }
        const amount_before = calc_atual ? calc_atual.updated_amount : null;
        await db.create_private_loan_amortization({
          loan_id, installment_id: null, payment_date: data_pagamento, amount: valor, amortization_type: tipo,
          applied_to: aplicar_em, target_mode: "saldo_devedor", price_action: null, amount_before,
          amount_after: amount_before !== null ? Math.max(amount_before - valor, 0.0) : null, notes,
        });
        await db.create_private_loan_payment({
          loan_id, installment_id: null, payment_date: data_pagamento, amount: valor, payment_type: "amortization", notes,
        });
        if (tipo === "liquidacao_total") await db.update_private_loan_status(loan_id, "settled", "Liquidado por amortização total.");
        flash("Amortização registrada com sucesso.", "success");
        return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
      }

      ui_tipo = fget("ui_tipo", "parcela_especifica");
      const UI_TIPO_MAP: Record<string, [string, string]> = {
        parcela_especifica: ["antecipar_parcela", "parcela_especifica"],
        proximas_parcelas: ["antecipar_parcela", "proximas_parcelas"],
        reduzir_prazo: ["amortizar_principal_reduzir_prazo", "saldo_devedor"],
        reduzir_parcela: ["amortizar_principal_reduzir_parcela", "saldo_devedor"],
        liquidacao_total: ["liquidacao_total", "saldo_devedor"],
      };
      const [price_action, target_mode] = UI_TIPO_MAP[ui_tipo as string] ?? ["antecipar_parcela", "parcela_especifica"];
      const installment_id = _parse_int_or_none(F().get("installment_id"));
      let inst_alvo: any = null;

      if (price_action === "amortizar_principal_reduzir_prazo" || price_action === "amortizar_principal_reduzir_parcela") {
        erros.push("Amortização de principal com recálculo de cronograma (reduzir prazo ou reduzir parcela) ainda não está disponível nesta versão. Use 'Antecipar parcela específica', 'Aplicar nas próximas parcelas' ou 'Liquidação total'.");
      }
      if (price_action === "antecipar_parcela" && target_mode === "parcela_especifica") {
        if (!installment_id) erros.push("Selecione a parcela alvo.");
        else {
          inst_alvo = parcelas_abertas.find((i) => i.id === installment_id) ?? null;
          if (inst_alvo === null) erros.push("Parcela alvo inválida ou já paga.");
        }
      }
      if (price_action === "liquidacao_total") {
        if (calc_atual === null) erros.push("Não foi possível calcular o saldo atualizado do empréstimo.");
        else if (valor < calc_atual.updated_amount) {
          erros.push(
            `Valor informado (${formatar_moeda(valor)}) é menor que o saldo atualizado total (${formatar_moeda(calc_atual.updated_amount)}). Para liquidar totalmente é preciso pagar ao menos esse valor — para uma amortização parcial, use 'Antecipar parcela' ou 'Aplicar nas próximas parcelas'.`,
          );
        }
      }
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return tela(true, parcelas_abertas);
      }

      if (price_action === "liquidacao_total") {
        for (const inst of parcelas_abertas) {
          await db.update_installment_payment(inst.id, inst.installment_amount, data_pagamento, "paid", notes || "Liquidação total do empréstimo.");
        }
        await db.create_private_loan_amortization({
          loan_id, installment_id: null, payment_date: data_pagamento, amount: valor, amortization_type: "liquidacao_total",
          applied_to: "mixed", target_mode: "saldo_devedor", price_action: "liquidacao_total",
          amount_before: calc_atual.updated_amount, amount_after: 0.0, notes,
        });
        await db.create_private_loan_payment({
          loan_id, installment_id: null, payment_date: data_pagamento, amount: valor, payment_type: "settlement", notes,
        });
        await db.update_private_loan_status(loan_id, "settled", "Liquidado totalmente por amortização.");
        flash("Empréstimo liquidado totalmente.", "success");
        return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
      }

      if (price_action === "antecipar_parcela" && target_mode === "parcela_especifica") {
        const original = priv_calc._d(inst_alvo.installment_amount);
        const paid_before = priv_calc._d(inst_alvo.paid_amount || 0);
        const saldo_atualizado = priv_calc._d(inst_alvo.updated_amount);
        const valor_d_local = priv_calc._d(valor);
        let novo_paid: Decimal, novo_status: string;
        if (valor_d_local.ge(saldo_atualizado)) { novo_paid = original; novo_status = "paid"; } else {
          novo_paid = pyMin([paid_before.add(valor_d_local), original]);
          novo_status = novo_paid.ge(original) ? "paid" : "partial";
        }
        await db.update_installment_payment(inst_alvo.id, novo_paid.toNumber(), data_pagamento, novo_status, notes);
        await db.create_private_loan_amortization({
          loan_id, installment_id: inst_alvo.id, payment_date: data_pagamento, amount: valor,
          amortization_type: novo_status === "paid" ? "antecipacao_parcela" : "liquidacao_parcial", applied_to: "mixed",
          target_mode: "parcela_especifica", price_action: "antecipar_parcela", amount_before: saldo_atualizado.toNumber(),
          amount_after: pyMax([saldo_atualizado.sub(valor_d_local), D("0")]).toNumber(), notes,
        });
        await db.create_private_loan_payment({
          loan_id, installment_id: inst_alvo.id, payment_date: data_pagamento, amount: valor, payment_type: "installment", notes,
        });
        flash(`Amortização aplicada à parcela ${inst_alvo.installment_number}.`, "success");
        return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
      }

      if (price_action === "antecipar_parcela" && target_mode === "proximas_parcelas") {
        let restante = priv_calc._d(valor);
        const afetadas: string[] = [];
        for (const inst of parcelas_abertas) {
          if (restante.le(0)) break;
          const original = priv_calc._d(inst.installment_amount);
          const paid_before = priv_calc._d(inst.paid_amount || 0);
          const saldo_atualizado = priv_calc._d(inst.updated_amount);
          let consumido: Decimal, novo_paid: Decimal, novo_status: string;
          if (restante.ge(saldo_atualizado)) { consumido = saldo_atualizado; novo_paid = original; novo_status = "paid"; } else {
            consumido = restante;
            novo_paid = pyMin([paid_before.add(consumido), original]);
            novo_status = novo_paid.ge(original) ? "paid" : "partial";
          }
          await db.update_installment_payment(inst.id, novo_paid.toNumber(), data_pagamento, novo_status, notes);
          await db.create_private_loan_amortization({
            loan_id, installment_id: inst.id, payment_date: data_pagamento, amount: consumido.toNumber(),
            amortization_type: novo_status === "paid" ? "antecipacao_parcela" : "liquidacao_parcial", applied_to: "mixed",
            target_mode: "proximas_parcelas", price_action: "antecipar_parcela", amount_before: saldo_atualizado.toNumber(),
            amount_after: pyMax([saldo_atualizado.sub(consumido), D("0")]).toNumber(), notes,
          });
          await db.create_private_loan_payment({
            loan_id, installment_id: inst.id, payment_date: data_pagamento, amount: consumido.toNumber(), payment_type: "installment", notes,
          });
          afetadas.push(`parcela ${inst.installment_number} (${novo_status === "paid" ? "paga" : "parcial"})`);
          restante = restante.sub(consumido);
        }
        if (afetadas.length) flash(`Amortização de ${formatar_moeda(valor)} aplicada em sequência: ${afetadas.join(", ")}.`, "success");
        else flash("Nenhuma parcela em aberto para aplicar a amortização.", "error");
        return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
      }

      flash("Tipo de amortização inválido.", "error");
      return tela(true, parcelas_abertas);
    }
    return tela(is_price_like, parcelas_abertas);
  });

  route("titulos_privados_amortizacao_preview_parcela", "/titulos-privados/emprestimos/<int:loan_id>/amortizacao/preview-parcela", ["GET"], async (loan_id: number) => {
    const loan = await db.get_private_loan_by_id(loan_id);
    if (!loan || !["price", "manual"].includes(loan.calculation_method)) {
      return jsonifyPy({ success: false, error: "Empréstimo não encontrado ou não é Price/manual." }, 404);
    }
    const installment_id = _parse_int_or_none(A().get("installment_id"));
    if (!installment_id) return jsonifyPy({ success: false, error: "Informe installment_id." }, 400);
    const installments = await db.get_private_loan_installments(loan_id);
    const inst = installments.find((i: any) => i.id === installment_id);
    if (!inst) return jsonifyPy({ success: false, error: "Parcela não encontrada." }, 404);
    const payment_date_str = strip(aget("payment_date", "")) || PyDate.today().isoformat();
    try { priv_calc._to_date(payment_date_str); } catch {
      return jsonifyPy({ success: false, error: "Data de pagamento inválida." }, 400);
    }
    let resultado: any;
    try { resultado = priv_calc.calculate_early_installment_settlement(inst, loan.interest_rate_monthly, payment_date_str); } catch (exc) {
      return jsonifyPy({ success: false, error: strExc(exc) }, 400);
    }
    return jsonifyPy({ success: true, ...resultado });
  });

  route("titulos_privados_parcela_pagar", "/titulos-privados/emprestimos/<int:loan_id>/parcelas/<int:installment_id>/pagar", ["POST"], async (loan_id: number, installment_id: number) => {
    const installments = await db.get_private_loan_installments(loan_id);
    const parcela = installments.find((p: any) => p.id === installment_id);
    if (!parcela) {
      flash("Parcela não encontrada.", "error");
      return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
    }
    let valor_pago: number;
    try { valor_pago = pyFloat(priv_calc.parse_money_br(F().get("paid_amount"))); } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
      return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
    }
    const data_pagamento = strip(fget("paid_date", "")) || PyDate.today().isoformat();
    if (valor_pago <= 0) {
      flash("Valor pago deve ser maior que zero.", "error");
      return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
    }
    const total_pago_antes = _pd(parcela.paid_amount || 0);
    const total_pago_novo = total_pago_antes.add(_pd(valor_pago));
    const valor_parcela = _pd(parcela.installment_amount);
    const novo_status = total_pago_novo.ge(valor_parcela) ? "paid" : "partial";
    await db.update_installment_payment(installment_id, total_pago_novo.toNumber(), data_pagamento, novo_status, parcela.notes || "");
    await db.create_private_loan_payment({
      loan_id, installment_id, payment_date: data_pagamento, amount: valor_pago, payment_type: "installment", notes: "",
    });
    flash(`Pagamento de ${formatar_moeda(valor_pago)} registrado na parcela ${parcela.installment_number}.`, "success");
    return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
  });

  route("titulos_privados_emprestimo_quitar", "/titulos-privados/emprestimos/<int:loan_id>/quitar", ["POST"], async (loan_id: number) => {
    await db.update_private_loan_status(loan_id, "settled", "Quitado manualmente pelo usuário.");
    flash("Empréstimo marcado como quitado.", "success");
    return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
  });

  route("titulos_privados_emprestimo_observacoes", "/titulos-privados/emprestimos/<int:loan_id>/observacoes", ["POST"], async (loan_id: number) => {
    await db.update_private_loan_notes(loan_id, strip(fget("notes", "")));
    flash("Observações atualizadas.", "success");
    return redirect(url_for("titulos_privados_emprestimo_detalhe", { loan_id }));
  });

  route("titulos_privados_parcelas", "/titulos-privados/parcelas", ["GET"], async () => {
    const status_filtro = strip(aget("status", ""));
    const parcelas = await db.get_private_loan_installments_all(status_filtro || null);
    return render_template("titulos_privados_parcelas.html", { active_page: "titulos_privados_parcelas", parcelas, status_filtro });
  });

  route("titulos_privados_prorrogacoes", "/titulos-privados/prorrogacoes", ["GET"], async () => {
    return render_template("titulos_privados_prorrogacoes.html", { active_page: "titulos_privados_prorrogacoes", prorrogacoes: await db.get_private_loan_extensions_all() });
  });

  route("titulos_privados_amortizacoes", "/titulos-privados/amortizacoes", ["GET"], async () => {
    return render_template("titulos_privados_amortizacoes.html", { active_page: "titulos_privados_amortizacoes", amortizacoes: await db.get_private_loan_amortizations_all() });
  });

  route("titulos_privados_calculadora_price", "/titulos-privados/calculadora-price", ["GET", "POST"], async () => {
    let resultado: any = null;
    let entrada: Record<string, any> = {};
    if (request().method === "POST") {
      entrada = {
        principal: fget("principal", ""), monthly_rate: fget("monthly_rate", ""),
        installments: fget("installments", ""), first_due_date: fget("first_due_date", ""),
      };
      try {
        const principal = pyFloat(priv_calc.parse_money_br(entrada.principal));
        const taxa = pyFloat(priv_calc.parse_percent_br(entrada.monthly_rate));
        const parcelas = pyInt(entrada.installments || 0);
        const primeira_data = entrada.first_due_date;
        if (principal <= 0) throw new ValueError("Valor financiado deve ser maior que zero.");
        if (!primeira_data) throw new ValueError("Informe a data da primeira parcela.");
        resultado = priv_calc.generate_price_schedule(principal, taxa, parcelas, primeira_data);
      } catch (exc) {
        if (!ehTypeOuValue(exc)) throw exc;
        flash(strExc(exc), "error");
      }
    }
    return render_template("titulos_privados_calculadora_price.html", { active_page: "titulos_privados_calculadora_price", entrada, resultado });
  });

  // ─── CLIENTES ───────────────────────────────────────────────
  route("clientes_lista", "/clientes", ["GET"], async () => {
    const q = strip(aget("q", ""));
    const status = aget("status", "");
    let clientes = await db.get_clients(status ? status : null);
    if (q) {
      const ql = q.toLowerCase();
      clientes = clientes.filter((c: any) => String(c.full_name).toLowerCase().includes(ql) || String(c.cpf).includes(ql));
    }
    const resumo = await db.get_clients_summary();
    return render_template("clientes_lista.html", { active_page: "clientes", clientes, resumo, q, status_filtro: status });
  });

  const dadosCliente = (status_padrao: string) => ({
    cpf: strip(fget("cpf", "")),
    full_name: strip(fget("full_name", "")),
    email: strip(fget("email", "")),
    phone: strip(fget("phone", "")),
    pix_key: strip(fget("pix_key", "")),
    status: fget("status", status_padrao),
    notes: strip(fget("notes", "")),
    bank_name: strip(fget("bank_name", "")),
    bank_agency: strip(fget("bank_agency", "")),
    bank_account: strip(fget("bank_account", "")),
    bank_account_digit: strip(fget("bank_account_digit", "")),
    bank_account_type: strip(fget("bank_account_type", "")),
    bank_holder_name: strip(fget("bank_holder_name", "")),
    bank_holder_document: strip(fget("bank_holder_document", "")),
    bank_notes: strip(fget("bank_notes", "")),
    ..._campos_contrato_cliente(),
  });

  route("clientes_novo", "/clientes/novo", ["GET", "POST"], async () => {
    if (request().method === "POST") {
      const data = dadosCliente("ativo");
      const erros = await _validar_cliente(data);
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return render_template("clientes_form.html", { active_page: "clientes", cliente: data, modo: "novo" });
      }
      try {
        await db.insert_client(data);
        flash("Cliente cadastrado com sucesso.", "success");
        return redirect(url_for("clientes_lista"));
      } catch (exc) {
        if (!ehValueError(exc)) throw exc;
        flash(strExc(exc), "error");
        return render_template("clientes_form.html", { active_page: "clientes", cliente: data, modo: "novo" });
      }
    }
    return render_template("clientes_form.html", { active_page: "clientes", cliente: {}, modo: "novo" });
  });

  route("clientes_detalhe", "/clientes/<int:cid>", ["GET"], async (cid: number) => {
    const cliente = await db.get_client_by_id(cid);
    if (!cliente) {
      flash("Cliente não encontrado.", "error");
      return redirect(url_for("clientes_lista"));
    }
    const cotas = await db.get_client_shares(cid);
    return render_template("clientes_detalhe.html", { active_page: "clientes", cliente, cotas });
  });

  route("clientes_editar", "/clientes/<int:cid>/editar", ["GET", "POST"], async (cid: number) => {
    const cliente = await db.get_client_by_id(cid);
    if (!cliente) {
      flash("Cliente não encontrado.", "error");
      return redirect(url_for("clientes_lista"));
    }
    if (request().method === "POST") {
      const data = dadosCliente(cliente.status);
      const erros = await _validar_cliente(data, cid);
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return render_template("clientes_form.html", { active_page: "clientes", cliente: { ...cliente, ...data }, modo: "editar" });
      }
      try {
        await db.update_client(cid, data);
        flash("Cliente atualizado com sucesso.", "success");
        return redirect(url_for("clientes_detalhe", { cid }));
      } catch (exc) {
        if (!ehValueError(exc)) throw exc;
        flash(strExc(exc), "error");
        return render_template("clientes_form.html", { active_page: "clientes", cliente: { ...cliente, ...data }, modo: "editar" });
      }
    }
    return render_template("clientes_form.html", { active_page: "clientes", cliente, modo: "editar" });
  });

  route("clientes_inativar", "/clientes/<int:cid>/inativar", ["POST"], async (cid: number) => {
    await db.deactivate_client(cid);
    flash("Cliente inativado.", "warning");
    return redirect(url_for("clientes_detalhe", { cid }));
  });

  route("clientes_reativar", "/clientes/<int:cid>/reativar", ["POST"], async (cid: number) => {
    await db.reactivate_client(cid);
    flash("Cliente reativado.", "success");
    return redirect(url_for("clientes_detalhe", { cid }));
  });

  route("clientes_excluir", "/clientes/<int:cid>/excluir", ["POST"], async (cid: number) => {
    const resultado = await db.delete_client(cid);
    if (resultado.ok) {
      flash(`Cliente '${resultado.nome}' excluído com sucesso.`, "success");
      return redirect(url_for("clientes_lista"));
    }
    flash(resultado.erro, "error");
    return redirect(url_for("clientes_detalhe", { cid }));
  });

  route("clientes_modelo_importacao", "/clientes/modelo-importacao", ["GET"], async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Clientes");
    const headers = [
      "Nome Completo", "CPF/CNPJ", "Email", "Telefone", "Chave Pix",
      "Status", "Observações", "Banco", "Agência", "Conta",
      "Dígito da Conta", "Tipo de Conta", "Titular da Conta",
      "CPF/CNPJ do Titular", "Observações Bancárias",
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = h;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "001a1a2e" } };
      cell.font = { bold: true, color: { argb: "00FFFFFF" } };
      cell.alignment = { horizontal: "center" };
    });
    const exemplo = [
      "João Silva", "000.000.000-00", "joao@email.com", "(61) 99999-9999",
      "joao@pix", "ativo", "Cliente exemplo", "Banco do Brasil",
      "1234", "56789", "0", "Corrente", "João Silva",
      "000.000.000-00", "Conta principal",
    ];
    exemplo.forEach((v, i) => { ws.getCell(2, i + 1).value = v; });
    [25, 20, 28, 18, 28, 10, 25, 20, 10, 12, 10, 14, 25, 20, 25].forEach((l, i) => { ws.getColumn(i + 1).width = l; });
    const dados = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    return sendFile(dados, { download_name: "modelo_importacao_clientes.xlsx", mimetype: XLSX_MIME });
  });

  route("clientes_importar", "/clientes/importar", ["GET", "POST"], async () => {
    if (request().method === "POST") {
      const arquivo = request().file("arquivo");
      if (!arquivo || arquivo.filename === "") {
        flash("Selecione um arquivo .xlsx para importar.", "error");
        return redirect(url_for("clientes_importar"));
      }
      if (!arquivo.filename.toLowerCase().endsWith(".xlsx")) {
        flash("Apenas arquivos .xlsx são aceitos.", "error");
        return redirect(url_for("clientes_importar"));
      }
      let rows: any[];
      try { rows = await _parse_excel_rows(arquivo.read()); } catch (exc) {
        if (!ehValueError(exc)) throw exc;
        flash(strExc(exc), "error");
        return redirect(url_for("clientes_importar"));
      }
      if (!rows.length) {
        flash("Planilha sem dados (apenas cabeçalho ou vazia).", "error");
        return redirect(url_for("clientes_importar"));
      }
      const resultados = await db.import_clients_from_rows(rows);
      return render_template("clientes_importar.html", {
        active_page: "clientes", resultados, total: resultados.length,
        criados: resultados.filter((r) => r.resultado === "Criado").length,
        ignorados: resultados.filter((r) => r.resultado === "Ignorado").length,
        erros: resultados.filter((r) => r.resultado === "Erro").length,
        importado: true,
      });
    }
    return render_template("clientes_importar.html", { active_page: "clientes", importado: false });
  });

  // ─── COTAS ──────────────────────────────────────────────────
  route("cotas_lista", "/cotas", ["GET"], async () => {
    const q = strip(aget("q", ""));
    const status = aget("status", "");
    const cond_code = aget("produto", "");
    const conds = await db.get_condominiums();
    let cond_id: number | null = null;
    if (cond_code) {
      const cond = conds.find((c: any) => c.code === cond_code);
      if (cond) cond_id = cond.id;
    }
    const cotas = await db.get_shares_filtered(cond_id ? cond_id : null, null, status ? status : null, null, null, q ? q : null);
    const resumo = await db.get_shares_summary();
    return render_template("cotas_lista.html", {
      active_page: "cotas", cotas, conds, resumo, q, status_filtro: status, produto_filtro: cond_code,
    });
  });

  route("cotas_nova", "/cotas/nova", ["GET", "POST"], async () => {
    const conds = await db.get_condominiums(true);
    const clientes = await db.get_all_clients_for_share_form();
    const cond_code_pre = aget("produto", "");
    const cond_pre = conds.find((c: any) => c.code === cond_code_pre) ?? null;

    if (request().method === "POST") {
      const cond_id = fget("condominium_id", "");
      const client_id = fget("client_id", "");
      const share_numbers = F().getlist("share_numbers").map((n: string) => n.trim()).filter((n: string) => n);
      const share_values_parsed: number[] = [];
      for (const sv_raw of F().getlist("share_values")) {
        let sv_f: number;
        try { sv_f = sv_raw.trim() ? pyFloat(String(sv_raw).replace(/\./g, "").replace(/,/g, ".")) : 0.0; } catch { sv_f = 0.0; }
        share_values_parsed.push(sv_f);
      }
      const allow_dup = F().get("allow_duplicate_share_number") === "on";
      const gerar_contrato = F().get("gerar_contrato") === "on";
      const data: Record<string, any> = {
        condominium_id: cond_id ? pyInt(cond_id) : null,
        client_id: client_id ? pyInt(client_id) : null,
        share_numbers,
        share_value: _parse_float(fget("share_value", "0")),
        share_values: share_values_parsed,
        acquisition_date: "", maturity_date: "", last_renewal_date: "",
        acquisition_dates: F().getlist("acquisition_dates").map((d: string) => d.trim()),
        maturity_dates: F().getlist("maturity_dates").map((d: string) => d.trim()),
        last_renewal_dates: F().getlist("last_renewal_dates").map((d: string) => d.trim()),
        status: gerar_contrato ? "pendente" : fget("status", "ativa"),
        notes: strip(fget("notes", "")),
        gerar_contrato,
      };
      const tela = () => render_template("cotas_form.html", {
        active_page: "cotas", cota: data, conds, clientes, modo: "nova", cond_default_values: COND_DEFAULT_VALUES,
      });
      const erros = _validar_cotas_multiplas(data, allow_dup);
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return tela();
      }
      try {
        const ids = await db.create_multiple_shares(
          data.condominium_id, data.client_id, share_numbers, data.share_value, "", "", "", data.status, data.notes,
          allow_dup, share_values_parsed.length ? share_values_parsed : null,
          data.acquisition_dates, data.maturity_dates, data.last_renewal_dates,
        );
        const qty = ids.length;
        flash(`${qty} cota${qty > 1 ? "s" : ""} cadastrada${qty > 1 ? "s" : ""} com sucesso.`, "success");
        if (gerar_contrato) {
          try {
            const ct = await import("../modulos/contratos/dados");
            const ct_id = await ct.criar_contrato_aquisicao(data.client_id, data.condominium_id, ids);
            flash('Contrato gerado e assinado pela empresa. Confira e clique em "Enviar para assinatura".', "success");
            return redirect(`${PREFIXO}/contratos/${ct_id}`);
          } catch (exc) {
            if (ehValueError(exc)) {
              flash(`As cotas ficaram pendentes, mas o contrato não foi gerado: ${strExc(exc)}`, "warning");
              return redirect(`${PREFIXO}/contratos/novo?client_id=${data.client_id}`);
            }
            console.error("Falha ao gerar contrato", exc);
            flash(`As cotas ficaram pendentes, mas houve erro ao gerar o contrato: ${strExc(exc)}`, "error");
            return redirect(`${PREFIXO}/contratos/`);
          }
        }
        if (cond_code_pre) return redirect(url_for("condominio", { code: cond_code_pre }));
        return redirect(url_for("cotas_lista"));
      } catch (exc) {
        if (!ehValueError(exc)) throw exc;
        flash(strExc(exc), "error");
        return tela();
      }
    }

    const sugestoes = cond_pre ? await db.suggest_next_share_numbers(cond_pre.id, 1) : [""];
    const default_val = COND_DEFAULT_VALUES[cond_code_pre] ?? 0.0;
    const cota_inicial = { condominium_id: cond_pre ? cond_pre.id : "", share_numbers: sugestoes, share_value: default_val, status: "ativa" };
    return render_template("cotas_form.html", {
      active_page: "cotas", cota: cota_inicial, conds, clientes, modo: "nova", cond_default_values: COND_DEFAULT_VALUES,
    });
  });

  route("cotas_editar", "/cotas/<int:sid>/editar", ["GET", "POST"], async (sid: number) => {
    const cota = await db.get_share_by_id(sid);
    if (!cota) {
      flash("Cota não encontrada.", "error");
      return redirect(url_for("cotas_lista"));
    }
    const conds = await db.get_condominiums(true);
    const clientes = await db.get_all_clients_for_share_form();
    if (request().method === "POST") {
      const cond_id = fget("condominium_id", "");
      const client_id = fget("client_id", "");
      const allow_dup = F().get("allow_duplicate_share_number") === "on";
      const data: Record<string, any> = {
        condominium_id: cond_id ? pyInt(cond_id) : cota.condominium_id,
        client_id: client_id ? pyInt(client_id) : cota.client_id,
        share_number: strip(fget("share_number", "")),
        share_value: _parse_float(fget("share_value", "0")),
        acquisition_date: strip(fget("acquisition_date", "")),
        maturity_date: strip(fget("maturity_date", "")),
        status: fget("status", cota.status),
        last_renewal_date: strip(fget("last_renewal_date", "")),
        withdrawal_date: strip(fget("withdrawal_date", "")),
        accrual_until_withdrawal: F().get("accrual_until_withdrawal") === "on" ? 1 : 0,
        notes: strip(fget("notes", "")),
      };
      const tela = () => render_template("cotas_form.html", { active_page: "cotas", cota: { ...cota, ...data }, conds, clientes, modo: "editar" });
      const erros = _validar_cota(data, allow_dup);
      if (erros.length) {
        for (const e of erros) flash(e, "error");
        return tela();
      }
      try {
        await db.update_share(sid, data, allow_dup);
        flash("Cota atualizada com sucesso.", "success");
        return redirect(url_for("cotas_lista"));
      } catch (exc) {
        if (!ehValueError(exc)) throw exc;
        flash(strExc(exc), "error");
        return tela();
      }
    }
    return render_template("cotas_form.html", { active_page: "cotas", cota, conds, clientes, modo: "editar" });
  });

  route("cotas_excluir", "/cotas/<int:sid>/excluir", ["POST"], async (sid: number) => {
    const cota = await db.get_share_by_id(sid);
    if (!cota) {
      flash("Cota não encontrada.", "error");
      return redirect(url_for("cotas_lista"));
    }
    const share_num = "share_number" in cota ? cota.share_number : String(sid);
    const cond_code = cota.condominium_code ?? "";
    try {
      const resultado = await bkp.criar_backup();
      if (resultado) await db.register_backup(resultado.name, resultado.path, `pre-delete-share-${sid}`);
    } catch { /* falha de backup não bloqueia a exclusão */ }
    try {
      await db.delete_share(sid);
      flash(`Cota ${share_num} excluída com sucesso. Exclusão registrada no log de auditoria.`, "success");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
      return redirect(referrer() || url_for("cotas_lista"));
    }
    const ref = fget("referrer", "");
    if (cond_code && ref && ref.includes("/condominio/")) return redirect(url_for("condominio", { code: cond_code }));
    return redirect(url_for("cotas_lista"));
  });

  const voltarCota = (cota: any) => {
    const ref = fget("referrer", "") || referrer() || "";
    const cond_code = cota.condominium_code ?? "";
    if (cond_code && ref.includes("/condominio/")) return redirect(url_for("condominio", { code: cond_code }));
    return redirect(ref || url_for("cotas_lista"));
  };

  route("cotas_inativar", "/cotas/<int:sid>/inativar", ["POST"], async (sid: number) => {
    const cota = await db.get_share_by_id(sid);
    if (!cota) {
      flash("Cota não encontrada.", "error");
      return redirect(url_for("cotas_lista"));
    }
    const withdrawal_date = strip(fget("withdrawal_date", ""));
    const user_note = strip(fget("user_note", ""));
    const prop_retirada = F().get("accrual_until_withdrawal") === "on";
    if (!withdrawal_date) {
      flash("Data de retirada é obrigatória para inativar a cota.", "error");
      return voltarCota(cota);
    }
    try {
      await db.deactivate_share(sid, withdrawal_date, user_note || "Inativação via interface", prop_retirada);
      let msg = `Cota ${cota.share_number} inativada. Data de retirada: ${withdrawal_date}. `;
      if (prop_retirada) msg += "PROPORCIONAL ATÉ A RETIRADA LIGADO — esta cota ainda vai render na apuração do período, até o dia anterior à retirada. ";
      msg += "Registrado no log de auditoria.";
      flash(msg, "warning");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return voltarCota(cota);
  });

  route("cotas_reativar", "/cotas/<int:sid>/reativar", ["POST"], async (sid: number) => {
    const cota = await db.get_share_by_id(sid);
    if (!cota) {
      flash("Cota não encontrada.", "error");
      return redirect(url_for("cotas_lista"));
    }
    try {
      await db.reactivate_share(sid, "Reativação via interface");
      flash(`Cota ${cota.share_number} reativada. Data de retirada removida.`, "success");
    } catch (exc) { flash(strExc(exc), "error"); }
    return voltarCota(cota);
  });

  route("cotas_editar_lote", "/cotas/editar-lote", ["GET", "POST"], async () => {
    let share_ids: number[], ref: string;
    if (request().method === "POST") {
      share_ids = _parse_share_ids_from_form();
      ref = fget("referrer", "") || referrer() || "";
    } else {
      const raw = aget("ids", "");
      share_ids = String(raw).split(",").filter((p) => /^\d+$/.test(p.trim())).map((p) => pyInt(p));
      ref = aget("referrer", "");
    }
    if (!share_ids.length) {
      flash("Selecione ao menos uma cota para editar em lote.", "error");
      return redirect(ref || url_for("cotas_lista"));
    }
    const cotas_grid: any[] = [], faltando: string[] = [];
    for (const sid of share_ids) {
      const cota = await db.get_share_by_id(sid);
      if (cota) cotas_grid.push(cota); else faltando.push(String(sid));
    }
    if (faltando.length) flash(`Cota(s) não encontrada(s) e ignorada(s): ${faltando.join(", ")}`, "warning");
    if (!cotas_grid.length) {
      flash("Nenhuma das cotas selecionadas foi encontrada.", "error");
      return redirect(ref || url_for("cotas_lista"));
    }
    return _render_lote(cotas_grid, ref);
  });

  route("cotas_editar_lote_salvar", "/cotas/editar-lote/salvar", ["POST"], async () => {
    const ref = fget("referrer", "");
    const allow_dup = F().get("allow_duplicate_share_number") === "on";
    const ids_form: number[] = [];
    for (const raw of F().getlist("row_id[]")) { try { ids_form.push(pyInt(raw)); } catch { /* ignora */ } }
    const cotas_por_id = new Map<number, any>();
    for (const sid of ids_form) { const cota = await db.get_share_by_id(sid); if (cota) cotas_por_id.set(sid, cota); }
    const rows = await _bulk_rows_from_form(cotas_por_id);
    if (!rows.length) {
      flash("Nenhuma cota recebida para edição em lote.", "error");
      return redirect(ref || url_for("cotas_lista"));
    }
    const erros = _validar_lote_cotas(rows, allow_dup);
    if (erros.length) {
      for (const e of erros.slice(0, 25)) flash(e, "error");
      if (erros.length > 25) flash(`… e mais ${erros.length - 25} problema(s). Nada foi salvo.`, "error");
      else flash("Nada foi salvo — corrija os campos destacados e tente novamente.", "warning");
      return _render_lote(rows, ref);
    }
    try {
      const resultado_bkp = await bkp.criar_backup();
      if (resultado_bkp) await db.register_backup(resultado_bkp.name, resultado_bkp.path, `pre-bulk-edit-shares-${rows.length}`);
    } catch { /* falha de backup não bloqueia a edição */ }
    const payload = rows.map((row) => {
      const p: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        if (!["client_name", "condominium_code", "withdrawal_requested", "withdrawal_effective_date"].includes(k)) p[k] = v;
      }
      return p;
    });
    const resultado = await db.update_shares_batch(payload, allow_dup);
    if (resultado.success.length) {
      flash(
        `${resultado.success.length} cota(s) atualizada(s) em lote: ${resultado.success.slice(0, 12).join(", ")}${resultado.success.length > 12 ? "…" : ""}. Cada alteração foi registrada no log de auditoria.`,
        "success",
      );
    }
    for (const err of resultado.errors) flash(`Cota ${err.share_number}: ${err.error}`, "error");
    if (!resultado.success.length && !resultado.errors.length) flash("Nenhuma cota foi processada.", "error");
    if (resultado.errors.length && !resultado.success.length) return _render_lote(rows, ref);
    return redirect(ref || url_for("cotas_lista"));
  });

  route("api_sugerir_numero", "/api/sugerir-numero-cota/<int:cond_id>", ["GET"], async (cond_id: number) => {
    return jsonifyPy({ numero: await db.suggest_next_share_number(cond_id) });
  });

  route("api_sugerir_numeros", "/api/sugerir-numeros/<int:cond_id>/<int:qty>", ["GET"], async (cond_id: number, qty: number) => {
    qty = Math.max(1, Math.min(qty, 200));
    const cond = (await db.get_condominiums()).find((c: any) => c.id === cond_id) ?? null;
    const default_val = COND_DEFAULT_VALUES[cond ? cond.code : ""] ?? 0.0;
    const numeros = await db.suggest_next_share_numbers(cond_id, qty);
    return jsonifyPy({ numeros, valor_padrao: default_val });
  });

  // ─── CONDOMÍNIOS ────────────────────────────────────────────
  route("condominio", "/condominio/<code>", ["GET"], async (code: string) => {
    const cond = await db.get_condominium_by_code(code);
    if (!cond) {
      flash("Produto não encontrado.", "error");
      return redirect(url_for("dashboard"));
    }
    const todas = await db.get_shares_filtered(cond.id);
    const ativas = todas.filter((c: any) => c.status === "ativa");
    const pendentes = todas.filter((c: any) => c.status === "pendente");
    const inativas = todas.filter((c: any) => c.status === "inativa");
    const valor_total = soma(ativas, (c) => c.share_value);
    const clientes_ativos = new Set(ativas.map((c: any) => c.client_id)).size;
    return render_template("condominio.html", {
      active_page: `produto_${cond.code}`, cond, cotas: todas, ativas, pendentes, inativas, valor_total, clientes_ativos,
    });
  });

  // ─── VENCIMENTOS E RETIRADAS ────────────────────────────────
  route("condominios_vencimentos", "/condominios/vencimentos", ["GET"], async () => {
    const today = PyDate.today();
    const conds = await db.get_condominiums();
    const q = strip(aget("q", ""));
    const cond_code = strip(aget("produto", ""));
    let mes: number, ano: number;
    try {
      mes = pyInt(A().get("mes") || today.month);
      ano = pyInt(A().get("ano") || today.year);
    } catch { mes = today.month; ano = today.year; }
    mes = Math.min(Math.max(mes, 1), 12);
    const cond_obj = cond_code ? conds.find((c: any) => c.code === cond_code) ?? null : null;
    const cond_id = cond_obj ? cond_obj.id : null;
    const cotas = await db.get_shares_for_vencimentos(cond_id, q ? q : null);
    const month_start = new PyDate(ano, mes, 1);
    const vencendo_mes: any[] = [], vencidas_ativas: any[] = [], em_retirada: any[] = [], prontas_inativar: any[] = [];
    for (const cota of cotas) {
      const mat = parse_data(cota.maturity_date);
      cota.maturity_parsed = mat ? mat.isoformat() : "";
      if (cota.withdrawal_requested) {
        em_retirada.push(cota);
        const eff = parse_data(cota.withdrawal_effective_date);
        if (eff && eff.compare(today) <= 0) prontas_inativar.push(cota);
        continue;
      }
      if (!mat) continue;
      if (mat.year === ano && mat.month === mes) vencendo_mes.push(cota);
      else if (mat.compare(month_start) < 0) vencidas_ativas.push(cota);
    }
    for (const cota of [...vencendo_mes, ...vencidas_ativas]) {
      const [rd, nv] = _sugestao_renovacao(cota, today);
      cota.sug_renovacao_data = rd;
      cota.sug_novo_vencimento = nv;
      const [pd, eff, dias] = _sugestao_retirada(cota, today);
      cota.sug_retirada_pedido = pd;
      cota.sug_retirada_efetiva = eff;
      cota.sug_retirada_dias = dias;
    }
    const _soma = (lista: any[]) => { let t = 0.0; for (const c of lista) { try { t += pyFloat(c.share_value || 0); } catch { /* ignora */ } } return t; };
    const resumo_comunicacao = await db.get_renewal_email_preview(ano, mes, cond_code || null);
    return render_template("condominios_vencimentos.html", {
      active_page: "vencimentos", conds, q, produto_filtro: cond_code, mes, ano, hoje: today.isoformat(),
      vencendo_mes, vencidas_ativas, em_retirada, prontas_inativar,
      vencendo_por_cliente: _agrupar_cotas_por_cliente(vencendo_mes),
      vencidas_por_cliente: _agrupar_cotas_por_cliente(vencidas_ativas),
      total_vencendo: _soma(vencendo_mes), total_vencidas: _soma(vencidas_ativas), total_retirada: _soma(em_retirada),
      withdrawal_days: WITHDRAWAL_SUGGESTION_DAYS, resumo_comunicacao,
    });
  });

  const cotaOuVolta = async (sid: number) => {
    const cota = await db.get_share_by_id(sid);
    if (!cota) flash("Cota não encontrada.", "error");
    return cota;
  };

  route("cotas_renovar", "/cotas/<int:sid>/renovar", ["POST"], async (sid: number) => {
    const cota = await cotaOuVolta(sid);
    if (!cota) return redirect(url_for("condominios_vencimentos"));
    const renewal_date = strip(fget("renewal_date", ""));
    const maturity_date = strip(fget("new_maturity_date", ""));
    const user_note = strip(fget("user_note", ""));
    try {
      await db.renew_share(sid, renewal_date, maturity_date, user_note || "Renovação via tela Vencimentos e Retiradas");
      flash(`Cota ${cota.share_number} renovada. Renovação: ${renewal_date} · Novo vencimento: ${maturity_date}. Registrado no log de auditoria.`, "success");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return _redirect_vencimentos();
  });

  route("cotas_marcar_retirada", "/cotas/<int:sid>/marcar-retirada", ["POST"], async (sid: number) => {
    const cota = await cotaOuVolta(sid);
    if (!cota) return redirect(url_for("condominios_vencimentos"));
    const request_date = strip(fget("withdrawal_request_date", ""));
    const effective_date = strip(fget("withdrawal_effective_date", ""));
    const notes = strip(fget("withdrawal_notes", ""));
    try {
      await db.request_withdrawal(sid, request_date, effective_date, notes, "Retirada marcada via tela Vencimentos e Retiradas");
      flash(`Cota ${cota.share_number} marcada em retirada. Efetiva em ${effective_date} — a cota continua ativa e entra na apuração até lá.`, "success");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return _redirect_vencimentos();
  });

  route("cotas_renovar_rapido", "/cotas/<int:sid>/renovar-rapido", ["POST"], async (sid: number) => {
    const cota = await cotaOuVolta(sid);
    if (!cota) return redirect(url_for("condominios_vencimentos"));
    const [renewal_date, maturity_date] = _sugestao_renovacao(cota, PyDate.today());
    try {
      await db.renew_share(sid, renewal_date, maturity_date, "Renovação direta (Vai renovar) via tela Vencimentos e Retiradas");
      flash(`Cota ${cota.share_number} renovada. Última renovação: ${renewal_date} · Novo vencimento: ${maturity_date}. Registrado no log de auditoria.`, "success");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return _redirect_vencimentos();
  });

  route("cotas_retirar_rapido", "/cotas/<int:sid>/retirar-rapido", ["POST"], async (sid: number) => {
    const cota = await cotaOuVolta(sid);
    if (!cota) return redirect(url_for("condominios_vencimentos"));
    const [request_date, effective_date, dias] = _sugestao_retirada(cota, PyDate.today());
    try {
      await db.request_withdrawal(sid, request_date, effective_date, "", "Retirada direta (Vai retirar) via tela Vencimentos e Retiradas");
      flash(`Cota ${cota.share_number} marcada em retirada. Pedido: ${request_date} · Efetiva em ${effective_date} (vencimento + ${dias} dias) — a cota continua ativa e entra na apuração até lá.`, "success");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return _redirect_vencimentos();
  });

  route("cotas_retirada_data", "/cotas/<int:sid>/retirada-data", ["POST"], async (sid: number) => {
    const effective_date = strip(fget("withdrawal_effective_date", ""));
    try {
      await db.update_withdrawal_effective_date(sid, effective_date, "Data efetiva alterada via tela Vencimentos e Retiradas");
      flash(`Data efetiva da retirada alterada para ${effective_date}.`, "success");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return _redirect_vencimentos();
  });

  route("cotas_cancelar_retirada", "/cotas/<int:sid>/cancelar-retirada", ["POST"], async (sid: number) => {
    const cota = await cotaOuVolta(sid);
    if (!cota) return redirect(url_for("condominios_vencimentos"));
    try {
      await db.cancel_withdrawal(sid, "Retirada cancelada via tela Vencimentos e Retiradas");
      flash(`Pedido de retirada da cota ${cota.share_number} cancelado.`, "success");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return _redirect_vencimentos();
  });

  route("cotas_inativar_retirada", "/cotas/<int:sid>/inativar-retirada", ["POST"], async (sid: number) => {
    const cota = await cotaOuVolta(sid);
    if (!cota) return redirect(url_for("condominios_vencimentos"));
    try {
      const resultado = await bkp.criar_backup();
      if (resultado) await db.register_backup(resultado.name, resultado.path, `pre-finalize-withdrawal-${sid}`);
    } catch { /* ignora */ }
    try {
      await db.finalize_withdrawal(sid, "Retirada finalizada via tela Vencimentos e Retiradas");
      flash(`Cota ${cota.share_number} inativada. Data de retirada: ${cota.withdrawal_effective_date ?? "None"}. Registrado no log de auditoria.`, "warning");
    } catch (exc) {
      if (!ehValueError(exc)) throw exc;
      flash(strExc(exc), "error");
    }
    return _redirect_vencimentos();
  });

  route("cotas_renovar_lote", "/cotas/renovar-lote", ["POST"], async () => {
    const share_ids = _parse_share_ids_from_form();
    const renewal_date = strip(fget("renewal_date", ""));
    const maturity_date = strip(fget("new_maturity_date", ""));
    const notes = strip(fget("notes", ""));
    if (!share_ids.length) {
      flash("Nenhuma cota selecionada para renovação em lote.", "error");
      return _redirect_vencimentos();
    }
    const resultado = await db.renew_shares_batch(share_ids, renewal_date, maturity_date, notes);
    if (resultado.success.length) {
      flash(`${resultado.success.length} cota(s) renovada(s) em lote (renovação: ${renewal_date} · novo vencimento: ${maturity_date}). Registrado no log de auditoria por cota.`, "success");
    }
    for (const err of resultado.errors) flash(`Cota ${err.share_number}: ${err.error}`, "error");
    if (!resultado.success.length && !resultado.errors.length) flash("Nenhuma cota foi processada.", "error");
    return _redirect_vencimentos();
  });

  route("cotas_marcar_retirada_lote", "/cotas/marcar-retirada-lote", ["POST"], async () => {
    const share_ids = _parse_share_ids_from_form();
    const request_date = strip(fget("request_date", ""));
    const effective_date = strip(fget("effective_date", ""));
    const notes = strip(fget("notes", ""));
    if (!share_ids.length) {
      flash("Nenhuma cota selecionada para marcar retirada em lote.", "error");
      return _redirect_vencimentos();
    }
    const resultado = await db.mark_withdrawal_batch(share_ids, request_date, effective_date, notes);
    if (resultado.success.length) {
      flash(`${resultado.success.length} cota(s) marcada(s) em retirada em lote (efetiva em ${effective_date}). As cotas continuam ativas até lá. Registrado no log de auditoria por cota.`, "success");
    }
    for (const err of resultado.errors) flash(`Cota ${err.share_number}: ${err.error}`, "error");
    if (!resultado.success.length && !resultado.errors.length) flash("Nenhuma cota foi processada.", "error");
    return _redirect_vencimentos();
  });

  route("api_vencimentos_preview_email", "/api/vencimentos/preview-email", ["POST"], async () => {
    const req = request();
    const payload: any = (req.is_json ? req.get_json() : null) || {};
    let share_ids: any = payload.share_ids ?? null;
    if (share_ids === null) {
      share_ids = F().getlist("share_ids[]");
      if (!share_ids.length) share_ids = F().getlist("share_ids");
    }
    try { share_ids = share_ids && share_ids.length ? share_ids.map((i: any) => pyInt(i)) : []; } catch { share_ids = []; }
    let itens: any[];
    if (share_ids.length) itens = await db.get_renewal_email_preview(null, null, null, share_ids);
    else {
      let mes: any = payload.mes || F().get("mes") || A().get("mes");
      let ano: any = payload.ano || F().get("ano") || A().get("ano");
      const produto = payload.produto || F().get("produto") || A().get("produto");
      const today = PyDate.today();
      try {
        mes = mes ? pyInt(mes) : today.month;
        ano = ano ? pyInt(ano) : today.year;
      } catch { mes = today.month; ano = today.year; }
      itens = await db.get_renewal_email_preview(ano, mes, produto || null);
    }
    const out = itens.map((item) => ({
      client_id: item.client_id, client_name: item.client_name, email: item.email, cpf: item.cpf,
      condominium_name: item.condominium_name, condominium_code: item.condominium_code, sector_name: item.sector_name,
      renewal_term: item.renewal_term, total_shares: item.total_shares, total_value: item.total_value,
      total_value_fmt: formatar_moeda(item.total_value), maturity_dates: item.maturity_dates,
      maturity_dates_text: item.maturity_dates_text, share_numbers: item.share_numbers, share_ids: item.share_ids,
      pix_key: item.pix_key, status_email: item.status_email, email_subject: item.email_subject, email_body: item.email_body,
    }));
    return jsonifyPy({ items: out, count: out.length });
  });

  const dadosEmail = () => {
    const req = request();
    const payload: any = (req.is_json ? req.get_json() : null) || {};
    return {
      to_email: String(payload.to_email || "").trim(),
      subject: payload.subject || "",
      body: payload.body || "",
      client_id: payload.client_id ?? null,
      condominium_code: payload.condominium_code ?? null,
      reference_year: payload.reference_year ?? null,
      reference_month: payload.reference_month ?? null,
    };
  };
  const ehErroGmail = (e: any) => e instanceof gmail.GmailCredentialsNotFoundError || e instanceof gmail.GmailNotAuthenticatedError || e instanceof gmail.GmailDependencyMissingError;

  route("api_gmail_criar_rascunho_renovacao", "/api/gmail/criar-rascunho-renovacao", ["POST"], async () => {
    const p = dadosEmail();
    if (!p.to_email) return jsonifyPy({ success: false, draft_id: null, message: "Cliente sem e-mail cadastrado — não é possível criar rascunho." });
    if (!p.subject || !p.body) return jsonifyPy({ success: false, draft_id: null, message: "Assunto/corpo do e-mail não informados." });
    const _registrar = async (status: string, draft_id: string | null, notes: string) => {
      try {
        await db.log_email_attempt(p.client_id, p.condominium_code, p.reference_year, p.reference_month, p.to_email, p.subject, p.body, draft_id, status, notes);
      } catch { /* não mascara o resultado */ }
    };
    try {
      const draft_id = await gmail.create_gmail_draft(p.to_email, p.subject, p.body);
      await _registrar("draft_created", draft_id, "Rascunho criado via tela Vencimentos e Retiradas");
      return jsonifyPy({ success: true, draft_id, message: "Rascunho criado no Gmail." });
    } catch (exc) {
      if (ehErroGmail(exc)) {
        await _registrar("error", null, strExc(exc));
        return jsonifyPy({ success: false, draft_id: null, message: strExc(exc) });
      }
      await _registrar("error", null, `Erro inesperado: ${strExc(exc)}`);
      return jsonifyPy({ success: false, draft_id: null, message: "Não foi possível criar o rascunho no Gmail. Verifique a integração em Configurações." });
    }
  });

  route("api_gmail_enviar_email_renovacao", "/api/gmail/enviar-email-renovacao", ["POST"], async () => {
    const p = dadosEmail();
    if (!p.to_email) return jsonifyPy({ success: false, gmail_message_id: null, message: "Cliente sem e-mail cadastrado — não é possível enviar o e-mail." });
    if (!p.subject || !p.body) return jsonifyPy({ success: false, gmail_message_id: null, message: "Assunto/corpo do e-mail não informados." });
    const gmail_status = await gmail.get_gmail_status();
    if (!gmail_status.token_valid) {
      return jsonifyPy({ success: false, gmail_message_id: null, message: 'Gmail ainda não autenticado. Acesse Configurações e clique em "Autenticar Gmail".' });
    }
    const _registrar = async (status: string, message_id: string | null, notes: string) => {
      try {
        await db.log_email_attempt(p.client_id, p.condominium_code, p.reference_year, p.reference_month, p.to_email, p.subject, p.body, null, status, notes, message_id);
      } catch { /* não mascara o resultado */ }
    };
    try {
      const message_id = await gmail.send_gmail_message(p.to_email, p.subject, p.body);
      await _registrar("sent", message_id, "Enviado via tela Vencimentos e Retiradas");
      return jsonifyPy({ success: true, gmail_message_id: message_id, message: "E-mail enviado com sucesso." });
    } catch (exc) {
      if (ehErroGmail(exc)) {
        await _registrar("send_error", null, strExc(exc));
        return jsonifyPy({ success: false, gmail_message_id: null, message: strExc(exc) });
      }
      await _registrar("send_error", null, `Erro inesperado: ${strExc(exc)}`);
      return jsonifyPy({ success: false, gmail_message_id: null, message: "Não foi possível enviar o e-mail pelo Gmail. Verifique a integração em Configurações." });
    }
  });

  // ─── APURAÇÃO ───────────────────────────────────────────────
  route("apuracao", "/apuracao", ["GET", "POST"], async () => {
    const conds = await db.get_condominiums(true);
    const today = PyDate.today();
    const produto_pre = aget("produto", "");
    if (request().method === "GET") {
      return render_template("apuracao.html", {
        active_page: "apuracao", conds, mes: today.month, ano: today.year, produto_sel: produto_pre, resultado: null, erro: null,
      });
    }
    let mes: number, ano: number;
    try {
      mes = pyInt(F().get("mes") || today.month);
      ano = pyInt(F().get("ano") || today.year);
    } catch { mes = today.month; ano = today.year; }
    const prod = fget("produto", "");
    const agro_rate_raw = strip(fget("agro_special_rate", ""));
    const _err = (msg: string) => render_template("apuracao.html", {
      active_page: "apuracao", conds, mes, ano, produto_sel: prod, resultado: null, erro: msg,
    });
    const cond_obj = prod ? conds.find((c: any) => c.code === prod) ?? null : null;
    const cond_id = cond_obj ? cond_obj.id : null;
    let shares: any[];
    try { shares = await db.get_active_shares_for_calculation(cond_id); } catch (exc) {
      console.error(`Erro ao carregar cotas: ${strExc(exc)}`);
      return _err(`Erro ao carregar cotas do banco de dados: ${strExc(exc)}`);
    }
    const agro_maturing = check_agro_maturing(shares, ano, mes);
    const precisa_agro = agro_maturing && (!prod || prod === "agro");
    let agro_rate: any = null;
    if (agro_rate_raw) {
      try { agro_rate = validate_agro_special_rate(agro_rate_raw); } catch (exc) {
        if (!ehValueError(exc)) throw exc;
        return _err(strExc(exc));
      }
    }
    if (precisa_agro && agro_rate === null) return _err("Há cotas do Agronegócio vencendo neste mês. Informe a taxa especial.");
    let items: any[], consolidado: any[], total_geral: number, duplicata: any;
    try {
      items = calculate_monthly_income(ano, mes, shares, prod ? prod : null, agro_rate);
      consolidado = consolidate_by_client(items);
      total_geral = soma(items, (i) => i.income_value);
      duplicata = await db.check_duplicate_calculation(ano, mes, cond_id);
    } catch (exc) {
      console.error(`Erro no cálculo de apuração: ${strExc(exc)}`);
      return _err(`Erro no cálculo: ${strExc(exc)}`);
    }
    if (!items.length) return _err("Nenhuma cota ativa encontrada para o período e produto selecionados.");
    const resultado = {
      mes, ano, produto: prod, cond_id, agro_rate, items, consolidado, total_geral,
      total_civil: soma(items.filter((i) => i.condominium_code === "civil"), (i) => i.income_value),
      total_agro: soma(items.filter((i) => i.condominium_code === "agro"), (i) => i.income_value),
      total_saude: soma(items.filter((i) => i.condominium_code === "saude"), (i) => i.income_value),
      qty_clientes: consolidado.length, qty_cotas: items.length, duplicata, agro_maturing,
    };
    return render_template("apuracao.html", { active_page: "apuracao", conds, mes, ano, produto_sel: prod, resultado, erro: null });
  });

  route("apuracao_salvar", "/apuracao/salvar", ["POST"], async () => {
    const mes = pyInt(F().get("mes", 0));
    const ano = pyInt(F().get("ano", 0));
    const prod = fget("produto", "");
    const agro_raw = fget("agro_rate", "");
    const items_json = fget("items_json", "[]");
    if (!mes || !ano) {
      flash("Dados de apuração inválidos.", "error");
      return redirect(url_for("apuracao"));
    }
    const conds = await db.get_condominiums(true);
    const cond_obj = prod ? conds.find((c: any) => c.code === prod) ?? null : null;
    const cond_id = cond_obj ? cond_obj.id : null;
    const dup = await db.check_duplicate_calculation(ano, mes, cond_id);
    if (dup) {
      flash(`Já existe apuração salva para ${pad2(mes)}/${ano} — produto ${!prod ? "todos" : prod}. Consulte o histórico.`, "warning");
      return redirect(url_for("historico"));
    }
    try {
      const res = await bkp.criar_backup();
      if (res) await db.register_backup(res.name, res.path, `pre-apuracao-${pad2(mes)}-${ano}`);
    } catch { /* ignora */ }
    try {
      const items = JSON.parse(items_json);
      const agro_rate = agro_raw ? validate_agro_special_rate(agro_raw) : null;
      const calc_id = await db.save_monthly_calculation(
        ano, mes, cond_id, agro_rate && agro_rate.__bool__() ? pyFloat(agro_rate) : null, items, `Apuração ${pad2(mes)}/${ano} via interface`,
      );
      flash(`Apuração ${pad2(mes)}/${ano} salva com sucesso! ${items.length} cota(s) · ID ${calc_id}`, "success");
      return redirect(url_for("historico"));
    } catch (exc) {
      flash(`Erro ao salvar apuração: ${strExc(exc)}`, "error");
      return redirect(url_for("apuracao"));
    }
  });

  route("relatorios", "/relatorios", ["GET"], async () => render_template("relatorios.html", { active_page: "relatorios" }));

  route("historico", "/historico", ["GET"], async () => {
    return render_template("historico.html", { active_page: "historico", calcs: await db.get_monthly_calculations() });
  });

  route("historico_detalhe", "/historico/<int:calc_id>", ["GET"], async (calc_id: number) => {
    const detail = await db.get_monthly_calculation_detail(calc_id);
    if (!detail) {
      flash("Apuração não encontrada.", "error");
      return redirect(url_for("historico"));
    }
    const items = detail.items;
    const calc_meta = detail.header;
    const clients = consolidate_by_client(items);
    const total_geral = soma(items, (i) => i.income_value);
    const total_shares = soma(clients, (c) => c.shares_count);
    const cond_code = calc_meta.condominium_code ?? null;
    const bank_info = COND_BANK_INFO[cond_code] ?? {};
    let data_sugerida: string | null = null;
    if (cond_code === "civil" || cond_code === "saude") {
      try { data_sugerida = bank_inter.data_sugerida_pagamento(cond_code, calc_meta.calculation_year, calc_meta.calculation_month).isoformat(); } catch { data_sugerida = null; }
    } else if (cond_code === "agro") {
      try { data_sugerida = bank_itau.data_sugerida_pagamento(calc_meta.calculation_year, calc_meta.calculation_month).isoformat(); } catch { data_sugerida = null; }
    }
    const remittance_files = await db.get_bank_remittance_files(calc_id);
    return render_template("historico_detalhe.html", {
      active_page: "historico", calc_id, items, clients, total_geral, total_shares, calc_meta, bank_info, data_sugerida, remittance_files,
    });
  });

  route("historico_banco_validar", "/historico/<int:calc_id>/banco/validar", ["POST"], async (calc_id: number) => {
    const detail = await db.get_monthly_calculation_detail(calc_id);
    if (!detail) return jsonifyPy({ success: false, message: "Apuração não encontrada." });
    const cond_code = detail.header.condominium_code ?? null;
    const method = (COND_BANK_INFO[cond_code] ?? {}).method;
    let result: any;
    try {
      if (method === "pix") result = await bank_inter.validate_inter_pix_payments(calc_id);
      else if (method === "dados_bancarios") result = await bank_itau.validate_itau_payments(calc_id);
      else return jsonifyPy({ success: false, message: "Banco pagador não configurado para este condomínio." });
    } catch (exc) {
      if (exc instanceof bank_inter.BankFileValidationError || exc instanceof bank_itau.BankFileValidationError) return jsonifyPy({ success: false, message: strExc(exc) });
      return jsonifyPy({ success: false, message: `Erro inesperado na validação: ${strExc(exc)}` });
    }
    const nomes = (l: any[] | undefined) => (l || []).map((c) => c.client_name ?? null);
    return jsonifyPy({
      success: true,
      total_client_count: result.total_client_count,
      valid_count: result.valid_count,
      total_amount: formatar_moeda(D(result.total_amount.toString())),
      pending_count: result.pending_count,
      pending_total_amount: formatar_moeda(D(result.pending_total_amount.toString())),
      pending_no_pix: nomes(result.pending_no_pix),
      pending_no_document: nomes(result.pending_no_document),
      pending_invalid_document: nomes(result.pending_invalid_document),
      pending_no_name: result.pending_no_name.map(() => "(cliente sem nome cadastrado)"),
      pending_invalid_pix_email: nomes(result.pending_invalid_pix_email),
      pending_no_bank_data: nomes(result.pending_no_bank_data),
      pending_zero_amount: nomes(result.pending_zero_amount),
      config_missing: result.config_missing,
      can_generate: result.can_generate,
    });
  });

  route("historico_banco_gerar", "/historico/<int:calc_id>/banco/gerar", ["POST"], async (calc_id: number) => {
    const detail = await db.get_monthly_calculation_detail(calc_id);
    if (!detail) {
      flash("Apuração não encontrada.", "error");
      return redirect(url_for("historico"));
    }
    const cond_code = detail.header.condominium_code ?? null;
    const method = (COND_BANK_INFO[cond_code] ?? {}).method;
    const payment_date = String(F().get("payment_date") || "").trim();
    if (method !== "pix" && method !== "dados_bancarios") {
      flash("Banco pagador não configurado para este condomínio.", "error");
      return redirect(url_for("historico_detalhe", { calc_id }));
    }
    try {
      const result = method === "pix"
        ? await bank_inter.generate_inter_pix_remittance(calc_id, payment_date)
        : await bank_itau.generate_itau_remittance(calc_id, payment_date);
      let msg = `Arquivo ${result.file_name} gerado com sucesso (${result.total_payments} pagamento(s) incluídos, total ${formatar_moeda(result.total_amount)}).`;
      if (result.pending_count) msg += ` ${result.pending_count} cliente(s) ficaram fora por pendências cadastrais e estão detalhados na conferência CSV.`;
      flash(msg, "success");
    } catch (exc) {
      if (exc instanceof bank_inter.BankFileValidationError || exc instanceof bank_itau.BankFileValidationError) flash(strExc(exc), "error");
      else flash(`Erro inesperado ao gerar o arquivo bancário: ${strExc(exc)}`, "error");
    }
    return redirect(url_for("historico_detalhe", { calc_id }));
  });

  route("historico_banco_baixar", "/historico/<int:calc_id>/banco/baixar/<int:remittance_id>/<tipo>", ["GET"], async (calc_id: number, remittance_id: number, tipo: string) => {
    const rem = await db.get_bank_remittance_file_by_id(remittance_id);
    if (!rem || rem.calculation_id !== calc_id) {
      flash("Arquivo bancário não encontrado.", "error");
      return redirect(url_for("historico_detalhe", { calc_id }));
    }
    let caminho: string | null, nome: string;
    if (tipo === "rem") { caminho = rem.file_path; nome = rem.file_name; } else if (tipo === "csv") {
      caminho = rem.conference_file_path;
      const base = rem.file_name || "conferencia";
      const i = base.lastIndexOf(".");
      nome = (i >= 0 ? base.slice(0, i) : base) + "_conferencia.csv";
    } else {
      flash("Tipo de arquivo inválido.", "error");
      return redirect(url_for("historico_detalhe", { calc_id }));
    }
    const dados = caminho ? await lerArquivo(caminho) : null;
    if (!dados) {
      flash("Arquivo não encontrado em disco.", "error");
      return redirect(url_for("historico_detalhe", { calc_id }));
    }
    return sendFile(dados, { download_name: nome, mimetype: tipo === "csv" ? "text/csv; charset=utf-8" : "application/octet-stream" });
  });

  route("historico_exportar_planilha", "/historico/<int:calc_id>/exportar-planilha", ["GET"], async (calc_id: number) => {
    const detail = await db.get_monthly_calculation_detail(calc_id);
    if (!detail) {
      flash("Apuração não encontrada.", "error");
      return redirect(url_for("historico"));
    }
    const meta = detail.header;
    const itens = detail.items;
    if (!itens.length) {
      flash("Esta apuração não possui itens para exportar.", "error");
      return redirect(url_for("historico_detalhe", { calc_id }));
    }
    const ano = pyInt(meta.calculation_year);
    const mes = pyInt(meta.calculation_month);
    const conds_por_id = new Map<number, any>((await db.get_condominiums()).map((c: any) => [c.id, c]));
    const codigos_na_apuracao: number[] = [];
    for (const item of itens) if (!codigos_na_apuracao.includes(item.condominium_id)) codigos_na_apuracao.push(item.condominium_id);
    const blocos: any[] = [];
    for (const cond_id of codigos_na_apuracao) {
      const cond = conds_por_id.get(cond_id);
      if (!cond) continue;
      blocos.push(await _bloco_export_produto(cond, itens.filter((i: any) => i.condominium_id === cond_id), ano, mes));
    }
    if (!blocos.length) {
      flash("Não foi possível identificar o produto desta apuração.", "error");
      return redirect(url_for("historico_detalhe", { calc_id }));
    }
    const codigo = blocos.length === 1 ? conds_por_id.get(codigos_na_apuracao[0]).code : "todos";
    const nome_base = `apuracao_${codigo}_${ano}-${pad2(mes)}`;
    const caminho = await rep.exportar_apuracao_padrao_planilha(blocos, nome_base);
    if (!caminho) {
      flash("Falha ao gerar o arquivo Excel. Verifique o log em logs/app.log.", "error");
      return redirect(url_for("historico_detalhe", { calc_id }));
    }
    return sendFile(caminho.dados, { download_name: caminho.name, mimetype: XLSX_MIME });
  });

  route("historico_editar", "/historico/<int:calculation_id>/editar", ["GET", "POST"], async (calculation_id: number) => {
    let detail = await db.get_monthly_calculation_detail(calculation_id);
    if (!detail) {
      flash("Apuração não encontrada.", "error");
      return redirect(url_for("historico"));
    }
    const conds = await db.get_condominiums();
    if (request().method === "POST") {
      const notes = strip(fget("notes", ""));
      const item_updates: any[] = [];
      let erro: string | null = null;
      for (const item of detail.items) {
        const iid = item.id;
        try {
          item_updates.push({
            id: iid,
            share_value: pyFloat(F().get(`sv_${iid}`, item.share_value)),
            active_days: pyInt(F().get(`ad_${iid}`, item.active_days)),
            total_period_days: pyInt(F().get(`tpd_${iid}`, item.total_period_days)),
            applied_rate: pyFloat(F().get(`ar_${iid}`, item.applied_rate)),
            income_value: pyFloat(F().get(`iv_${iid}`, item.income_value)),
            calculation_details: F().get(`cd_${iid}`, item.calculation_details || ""),
          });
        } catch (exc) {
          if (!ehTypeOuValue(exc)) throw exc;
          erro = `Valor inválido no item ${iid}: ${strExc(exc)}`;
          break;
        }
      }
      if (!erro) {
        try {
          await db.update_monthly_calculation(calculation_id, notes, item_updates);
          flash("Apuração atualizada com sucesso.", "success");
          return redirect(url_for("historico_detalhe", { calc_id: calculation_id }));
        } catch (exc) {
          erro = ehValueError(exc) ? strExc(exc) : `Erro ao salvar: ${strExc(exc)}`;
        }
      }
      detail = await db.get_monthly_calculation_detail(calculation_id);
      return render_template("historico_editar.html", { active_page: "historico", calculation_id, detail, conds, erro });
    }
    return render_template("historico_editar.html", { active_page: "historico", calculation_id, detail, conds, erro: null });
  });

  route("historico_excluir", "/historico/<int:calculation_id>/excluir", ["POST"], async (calculation_id: number) => {
    try {
      const resumo = await db.delete_monthly_calculation(calculation_id);
      flash(`Apuração ${pad2(resumo.calculation_month)}/${resumo.calculation_year} excluída com sucesso.`, "success");
    } catch (exc) {
      if (ehValueError(exc)) flash(strExc(exc), "error");
      else flash(`Erro ao excluir apuração: ${strExc(exc)}`, "error");
    }
    return redirect(url_for("historico"));
  });

  // ─── CONFIGURAÇÕES ──────────────────────────────────────────
  route("configuracoes", "/configuracoes", ["GET"], async () => {
    return render_template("configuracoes.html", {
      active_page: "configuracoes", conds: await db.get_condominiums(), gmail_status: await gmail.get_gmail_status(),
      bank_inter_config: await db.get_bank_config("077"), bank_itau_config: await db.get_bank_config("341"),
      itau_status: bank_itau.get_itau_status(),
    });
  });

  route("configuracoes_banco_inter_salvar", "/configuracoes/banco-inter/salvar", ["POST"], async () => {
    const fields: Record<string, string> = {};
    for (const k of ["company_name", "company_document", "agency", "agency_digit", "account_number", "account_digit",
      "address_street", "address_number", "address_complement", "city", "zip_code", "state"]) fields[k] = strip(F().get(k) || "");
    try {
      await db.save_bank_config("077", fields);
      flash("Dados do Banco Inter atualizados com sucesso.", "success");
    } catch (exc) { flash(`Falha ao salvar dados do Banco Inter: ${strExc(exc)}`, "error"); }
    return redirect(url_for("configuracoes"));
  });

  route("configuracoes_banco_itau_salvar", "/configuracoes/banco-itau/salvar", ["POST"], async () => {
    const fields: Record<string, string> = {};
    for (const k of ["company_name", "company_document", "agency", "agency_digit", "account_number", "account_digit", "agreement_code"]) {
      fields[k] = strip(F().get(k) || "");
    }
    try {
      await db.save_bank_config("341", fields);
      flash("Dados do Banco Itaú atualizados com sucesso.", "success");
    } catch (exc) { flash(`Falha ao salvar dados do Banco Itaú: ${strExc(exc)}`, "error"); }
    return redirect(url_for("configuracoes"));
  });

  // Gmail: online o fluxo OAuth é pelo navegador → Google → rota de retorno abaixo.
  const retornoGmail = () => url_for("configuracoes_gmail_retorno", { _external: true });
  route("configuracoes_gmail_autenticar", "/configuracoes/gmail/autenticar", ["POST"], async () => {
    try {
      const estado = Math.random().toString(36).slice(2) + Date.now().toString(36);
      session().set("gmail_oauth_state", estado);
      return redirect(await gmail.authenticate_gmail(retornoGmail(), estado));
    } catch (exc) {
      if (exc instanceof gmail.GmailCredentialsNotFoundError || exc instanceof gmail.GmailDependencyMissingError) flash(strExc(exc), "error");
      else flash(`Falha ao autenticar o Gmail: ${strExc(exc)}`, "error");
    }
    return redirect(url_for("configuracoes"));
  });

  route("configuracoes_gmail_retorno", "/configuracoes/gmail/retorno", ["GET"], async () => {
    try {
      const estado = session().get("gmail_oauth_state");
      session().pop("gmail_oauth_state");
      if (!estado || A().get("state") !== estado) throw new gmail.GmailNotAuthenticatedError("Falha na autenticacao do Gmail: estado invalido");
      await gmail.concluir_autenticacao_gmail(A().get("code"), A().get("error"), retornoGmail());
      flash("Gmail autenticado com sucesso. Já é possível criar rascunhos.", "success");
    } catch (exc) {
      if (exc instanceof gmail.GmailCredentialsNotFoundError) flash(strExc(exc), "error");
      else flash(`Falha ao autenticar o Gmail: ${strExc(exc)}`, "error");
    }
    return redirect(url_for("configuracoes"));
  });

  // ─── BACKUP / AUDITORIA ─────────────────────────────────────
  route("backup_page", "/backup", ["GET"], async () => {
    return render_template("backup.html", { active_page: "backup", backups: await bkp.listar_backups() });
  });

  route("backup_criar", "/backup/criar", ["POST"], async () => {
    try {
      const resultado = await bkp.criar_backup();
      if (resultado) {
        await db.register_backup(resultado.name, resultado.path, "manual");
        flash(`Backup criado: ${resultado.name}`, "success");
      } else flash(bkp.MSG_ONLINE, "warning");
    } catch (exc) { flash(`Erro ao criar backup: ${strExc(exc)}`, "error"); }
    return redirect(url_for("backup_page"));
  });

  route("auditoria", "/auditoria", ["GET"], async () => {
    const entity_type = aget("entity_type", "");
    const action = aget("action", "");
    const logs = await db.get_audit_logs(500, entity_type, action);
    return render_template("auditoria.html", { active_page: "auditoria", logs, entity_type, action });
  });

  // ─── VALIDAÇÃO SISTEMA ──────────────────────────────────────
  route("condominios_validacao_sistema", "/condominios/validacao-sistema", ["GET"], async () => {
    const f = _vs_parse_filtros();
    const clientes = await vsc.calculate_all_clients_validation(f.inicio, f.meses, f.client_filter, f.condominium_filter);
    const totais = vsc.calculate_validation_totals(clientes, f.inicio, f.meses);
    return render_template("validacao_sistema.html", {
      active_page: "validacao_sistema",
      conds: await db.get_condominiums(),
      clientes_filtro: await db.get_clients_with_shares_for_validation(),
      clientes, totais, inicio: f.inicio,
      inicio_input: `${String(f.inicio.year).padStart(4, "0")}-${pad2(f.inicio.month)}`,
      inicio_label: vsc.month_label(f.inicio),
      meses: f.meses, cliente_filtro: f.cliente, produto_filtro: f.produto, q: f.q,
      agro_special_rate: vsc.AGRO_MATURITY_RATE,
      agro_special_label: vsc.rate_label(vsc.AGRO_MATURITY_RATE),
      rate_label: vsc.rate_label,
      query_export: request().query,
    });
  });

  route("condominios_validacao_sistema_cliente", "/condominios/validacao-sistema/cliente", ["GET"], async () => {
    const f = _vs_parse_filtros();
    let cliente_id: number;
    try { cliente_id = pyInt(A().get("cliente") || 0); } catch { cliente_id = 0; }
    if (!cliente_id) return ["<div style='padding:18px;color:#f87171;'>Cliente inválido.</div>", 400];
    const resultado = await vsc.calculate_all_clients_validation(f.inicio, f.meses, cliente_id, f.condominium_filter);
    if (!resultado.length) return "<div style='padding:18px;color:#888;font-size:12px;'>Nenhuma cota ativa encontrada para este cliente.</div>";
    const cli = resultado[0];
    const ordem = ["civil", "agro", "saude"];
    const codes = cli.condominiums.map((b: any) => b.condominium_code);
    const codes_cliente = [...ordem.filter((c) => codes.includes(c)), ...codes.filter((c: string) => !ordem.includes(c))];
    return render_template("_validacao_sistema_cliente.html", {
      cli, codes_cliente, meses: f.meses, inicio_label: vsc.month_label(f.inicio),
      agro_special_label: vsc.rate_label(vsc.AGRO_MATURITY_RATE),
    });
  });

  route("condominios_validacao_sistema_detalhe", "/condominios/validacao-sistema/detalhe", ["GET"], async () => {
    const f = _vs_parse_filtros();
    let cliente_id: number, cond_id: number;
    try {
      cliente_id = pyInt(A().get("cliente") || 0);
      cond_id = pyInt(A().get("condominio") || 0);
    } catch { return ["<div style='padding:18px;color:#f87171;'>Parâmetros inválidos.</div>", 400]; }
    if (!cliente_id || !cond_id) return ["<div style='padding:18px;color:#f87171;'>Parâmetros inválidos.</div>", 400];
    const cotas = await db.get_shares_for_validation(cond_id, cliente_id);
    if (!cotas.length) return "<div style='padding:18px;color:#888;font-size:12px;'>Nenhuma cota ativa encontrada para este cliente neste condomínio.</div>";
    const cond = (await db.get_condominiums()).find((c: any) => c.id === cond_id) ?? null;
    if (cond === null) return ["<div style='padding:18px;color:#f87171;'>Condomínio não encontrado.</div>", 404];
    const bloco = await vsc.calculate_client_condominium_projection(cliente_id, cond_id, f.inicio, f.meses, cotas, cond);
    return render_template("_validacao_sistema_detalhe.html", {
      b: bloco, meses: f.meses, inicio_label: vsc.month_label(f.inicio), agro_special_label: vsc.rate_label(vsc.AGRO_MATURITY_RATE),
    });
  });

  route("condominios_validacao_sistema_exportar", "/condominios/validacao-sistema/exportar", ["GET"], async () => {
    const f = _vs_parse_filtros();
    const clientes = await vsc.calculate_all_clients_validation(f.inicio, f.meses, f.client_filter, f.condominium_filter);
    const FMT_MOEDA = "#,##0.00";
    const FMT_PCT = "0.000%";
    const wb = new ExcelJS.Workbook();
    type Col = [string, number, string | null];
    const nova_aba = (titulo: string, colunas: Col[]) => {
      const ws = wb.addWorksheet(titulo.slice(0, 31));
      colunas.forEach(([nome, larg], i) => {
        const cel = ws.getCell(1, i + 1);
        cel.value = nome;
        cel.font = { bold: true, color: { argb: "00F5E080" } };
        cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "001F2937" } };
        cel.alignment = { horizontal: "left", vertical: "middle" };
        ws.getColumn(i + 1).width = larg;
      });
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2" }];
      return ws;
    };
    const escreve = (ws: ExcelJS.Worksheet, linha_idx: number, colunas: Col[], valores: any[]) => {
      colunas.forEach(([, , fmt], c) => {
        if (c >= valores.length) return;
        const val = valores[c];
        const cel = ws.getCell(linha_idx, c + 1);
        cel.value = val instanceof Decimal ? val.toNumber() : rep.valorCelula(val);
        if (fmt) cel.numFmt = fmt;
      });
    };
    const g = (o: any, k: string) => (o && k in o ? o[k] : 0);

    const COLS1: Col[] = [["Cliente", 38, null], ["CPF/CNPJ", 20, null],
      ["Total Investido", 16, FMT_MOEDA], ["Construção Civil", 16, FMT_MOEDA],
      ["Agronegócio", 16, FMT_MOEDA], ["Saúde", 16, FMT_MOEDA],
      ["Qtd. Cotas", 11, "0"], ["Próximo Vencimento", 18, null],
      ["Rend. Mês Atual", 16, FMT_MOEDA], ["Rend. Próx. Mês", 16, FMT_MOEDA],
      ["Rend. 12 Meses", 16, FMT_MOEDA], ["Rend. Horizonte", 16, FMT_MOEDA],
      ["Último Mês c/ Rendimento", 24, null]];
    const ws1 = nova_aba("Resumo por Cliente", COLS1);
    clientes.forEach((cli: any, i: number) => {
      const t = cli.total_by_condominium;
      escreve(ws1, i + 2, COLS1, [
        cli.client_name, cli.client_document, cli.total_invested, g(t, "civil"), g(t, "agro"), g(t, "saude"),
        cli.shares_count, cli.next_maturity_date || "—", cli.current_month_yield, cli.next_month_yield,
        cli.yield_12m, cli.yield_horizon, cli.last_yield_month_label,
      ]);
    });

    const COLS2: Col[] = [["Cliente", 38, null], ["CPF/CNPJ", 20, null], ["Condomínio", 20, null],
      ["Total Investido", 16, FMT_MOEDA], ["Qtd. Cotas", 11, "0"],
      ["Taxa Normal", 12, FMT_PCT], ["Rend. Mensal Atual", 18, FMT_MOEDA],
      ["Próximo Vencimento", 18, null], ["Último Mês c/ Rendimento", 24, null],
      ["Regra de Retirada", 62, null]];
    const ws2 = nova_aba("Detalhe por Condominio", COLS2);
    let linha = 2;
    for (const cli of clientes) for (const b of cli.condominiums) {
      escreve(ws2, linha++, COLS2, [
        cli.client_name, cli.client_document, b.condominium_name, b.total_invested, b.shares_count, b.normal_rate,
        b.current_month_yield, b.next_maturity_date || "—", b.last_yield_month_label, b.withdrawal_rule,
      ]);
    }

    const COLS3: Col[] = [["Cliente", 38, null], ["Condomínio", 20, null], ["Mês/Ano", 12, null],
      ["Valor Base", 16, FMT_MOEDA], ["Taxas Aplicadas", 18, null],
      ["Rendimento Previsto", 18, FMT_MOEDA],
      ["Rend. Normal", 16, FMT_MOEDA], ["Rend. Especial (Agro)", 20, FMT_MOEDA],
      ["Cotas Consideradas", 18, "0"], ["Cotas Vencendo", 15, "0"],
      ["Cotas Mês Extra", 16, "0"], ["Observação", 80, null]];
    const ws3 = nova_aba("Projecao Mensal", COLS3);
    linha = 2;
    for (const cli of clientes) for (const b of cli.condominiums) for (const m of b.monthly_projection) {
      escreve(ws3, linha++, COLS3, [
        cli.client_name, b.condominium_name, m.month_label, m.base_amount, m.rates_applied.join(" · ") || "—",
        m.yield_amount, m.normal_yield_amount, m.special_yield_amount, m.shares_included, m.shares_maturing,
        m.shares_extra, m.notes.join(" | "),
      ]);
    }

    const COLS4: Col[] = [["Cliente", 38, null], ["CPF/CNPJ", 20, null], ["Condomínio", 20, null],
      ["Nº Cota", 12, null], ["Valor da Cota", 16, FMT_MOEDA],
      ["Aquisição", 14, null], ["Vencimento", 14, null], ["Status", 12, null],
      ["Regra de Retirada", 62, null], ["Último Mês c/ Rendimento", 24, null],
      ["Observações", 70, null]];
    const ws4 = nova_aba("Cotas", COLS4);
    linha = 2;
    for (const cli of clientes) for (const b of cli.condominiums) for (const s of b.shares) {
      escreve(ws4, linha++, COLS4, [
        cli.client_name, cli.client_document, b.condominium_name, s.share_number, s.share_value,
        s.acquisition_date || "—", s.maturity_date || "—", s.status, s.withdrawal_rule, s.last_yield_month_label, s.notes.join(" | "),
      ]);
    }

    const dados = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const nome = `validacao_sistema_${String(f.inicio.year).padStart(4, "0")}-${pad2(f.inicio.month)}_${f.meses}m.xlsx`;
    return sendFile(dados, { download_name: nome, mimetype: XLSX_MIME });
  });

  // ─── EXPORTAÇÃO SUPABASE / LOVABLE (área temporária) ────────
  route("exportacao_supabase", "/sistema/exportacao-supabase", ["GET"], async () => {
    const export_id = strip(A().get("export") || "");
    const resultado = export_id ? sbx.carregar_resumo(export_id) : null;
    if (export_id && resultado === null) flash("Exportação não encontrada. Gere uma nova.", "error");
    if (resultado) {
      return _sbx_render(resultado, resultado.cutoff_iso, resultado.bases, resultado.table_mapping || {}, resultado.opcoes);
    }
    return _sbx_render();
  });

  route("exportacao_supabase_gerar", "/sistema/exportacao-supabase/gerar", ["POST"], async () => {
    const cutoff = strip(F().get("cutoff") || "");
    const bases = F().getlist("bases");
    const ajustes = _sbx_config_do_form(F());
    const opcoes = _sbx_opcoes_do_form(F());
    const _erro = (msg: string, categoria = "error") => {
      flash(msg, categoria);
      return _sbx_render(null, cutoff, bases, ajustes, opcoes);
    };
    if (!cutoff) return _erro("Informe a data de corte. Ela é obrigatória.");
    if (!bases.length) return _erro("Selecione pelo menos uma base para exportar.");
    let resumo: any;
    try {
      resumo = await sbx.generate_supabase_export(cutoff, bases, ajustes, opcoes);
    } catch (exc) {
      if (exc instanceof sbx.SQLInseguroError) return _erro(`Geração abortada por segurança: ${strExc(exc)}`);
      return _erro(strExc(exc));
    }
    const total = resumo.resumo.total_registros;
    if (total === 0) flash("Exportação gerada, mas nenhum registro foi encontrado a partir da data de corte informada.", "warning");
    else flash(`Exportação ${resumo.export_id} gerada com ${total} registro(s). Revise o CSV/Excel antes de executar o SQL no Supabase.`, "success");
    for (const alerta of resumo.alertas || []) flash(alerta, "warning");
    return redirect(url_for("exportacao_supabase", { export: resumo.export_id }));
  });

  route("exportacao_supabase_download", "/sistema/exportacao-supabase/download/<export_id>/<file_type>", ["GET"], async (export_id: string, file_type: string) => {
    const caminho = sbx.caminho_arquivo_export(export_id, file_type);
    if (caminho === null) {
      flash("Arquivo não encontrado nesta exportação.", "error");
      return redirect(url_for("exportacao_supabase"));
    }
    return redirect(url_for("exportacao_supabase"));
  });
}
