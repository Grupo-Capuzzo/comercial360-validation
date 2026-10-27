/* eslint-disable @typescript-eslint/no-explicit-any */
// Porte de app/bank_files_inter.py — remessa CNAB240 Pix (Banco Inter).
// Mesmas regras do original (ver docstring do .py): só LÊ a apuração salva, nunca
// marca nada como pago; o .REM e o CSV de conferência agora ficam em erp_arquivos
// (core/arquivos.ts) com o mesmo nome e o mesmo conteúdo byte a byte.
import { PyDate } from "../core/py";
import { salvarArquivo } from "../core/arquivos";
import {
  get_bank_config, get_monthly_calculation_detail, increment_bank_remittance_sequence,
  create_bank_remittance_file, add_bank_remittance_items,
} from "./database";
import { consolidate_by_client } from "./calculations";
import { Dec, asciiReplace, csvLinha, pyFloatRepr, utf8Sig } from "./dec";

export const EXPORTS_DIR = "exports/remessas_bancarias/inter";

export const BANK_CODE = "077";
export const BANK_NAME = "BANCO INTER";
export const LAYOUT_VERSAO_ARQUIVO = "107";
export const LAYOUT_VERSAO_LOTE = "046";
export const DENSIDADE_GRAVACAO = "01600";
export const FORMA_LANCAMENTO_PIX = "45";
// "10" = Pagamento Dividendos (ver nota no .py original).
export const TIPO_SERVICO = "10";

export class BankFileValidationError extends Error {
  details: Record<string, any>;
  constructor(message: string, details: Record<string, any> | null = null) {
    super(message);
    this.details = details ?? {};
  }
}

// ── Helpers de formatação CNAB (posicional, 240 colunas) ─────────────────
const pyStrOu = (v: any) => (v === null || v === undefined || v === "" || v === 0 || v === false ? "" : String(v));

export function only_digits(value: any): string { return pyStrOu(value).replace(/\D/g, ""); }

export function remove_accents(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
}

export function alpha(value: any, size: number): string {
  let text = remove_accents(pyStrOu(value)).toUpperCase();
  text = text.replace(/[^A-Z0-9 .,\-/]/g, " ");
  return text.slice(0, size).padEnd(size, " ");
}

export function num(value: any, size: number): string {
  let digits = only_digits(value);
  if (!digits) digits = "0";
  digits = digits.length > size ? digits.slice(-size) : digits;
  return digits.padStart(size, "0");
}

export function documento(value: any, size = 14): string {
  return only_digits(value).padStart(size, "0").slice(-size);
}

export function money_to_cents(value: any, size: number): string {
  if (value === null || value === undefined) value = 0;
  const dec = Dec.de(value).quantize(2, "up");
  const cents = dec.n;
  if (cents < BigInt(0)) throw new Error("Valor de pagamento nao pode ser negativo.");
  return cents.toString().padStart(size, "0");
}

export const branco = (size: number) => " ".repeat(size);
export const zeros = (size: number) => "0".repeat(size);

export function ensure_240(line: string): string {
  const n = Array.from(line).length;
  if (n !== 240) {
    throw new BankFileValidationError(`Erro interno: registro CNAB com ${n} posicoes (esperado 240). Geracao interrompida por seguranca.`);
  }
  return line;
}

export function detect_pix_key_type(pix_key: string): string {
  const key = (pix_key || "").trim();
  if (key.includes("@")) return "02";
  const digits = only_digits(key);
  const eh_so_numerico_formatado = /^[0-9.\-/ ]*$/.test(key) && !!digits;
  if (eh_so_numerico_formatado && (digits.length === 11 || digits.length === 14)) return "03";
  if (key.startsWith("+") || (eh_so_numerico_formatado && [10, 12, 13].includes(digits.length))) return "01";
  return "04";
}

export function is_valid_pix_email_key(pix_key: string): boolean {
  const key = (pix_key || "").trim();
  if (!key.includes("@")) return false;
  const i = key.indexOf("@");
  const local = key.slice(0, i), dominio = key.slice(i + 1);
  if (!local || !dominio) return false;
  if (!dominio.includes(".")) return false;
  const j = dominio.lastIndexOf(".");
  if (!dominio.slice(0, j) || !dominio.slice(j + 1)) return false;
  return true;
}

export function pix_key_field(pix_key: string, tipo_chave: string, size = 99): string {
  let key = (pix_key || "").trim();
  if (tipo_chave === "02") key = key.toLowerCase();
  const cps = Array.from(key).slice(0, size);
  return cps.join("") + " ".repeat(size - cps.length);
}

// ── Datas ─────────────────────────────────────────────────────────────────
export function ajustar_dia_util(d: PyDate): PyDate {
  let ajustada = d;
  while (ajustada.weekday() >= 5) ajustada = ajustada.addDays(1);
  return ajustada;
}

export function data_sugerida_pagamento(condominium_code: string, ano: number, mes: number): PyDate {
  const dia = ({ civil: 6, saude: 20 } as Record<string, number>)[condominium_code] ?? 1;
  let base = new PyDate(ano, mes, dia);
  if (!base.valid()) base = new PyDate(ano, mes, 1);
  return ajustar_dia_util(base);
}

// ── Montagem dos registros CNAB240 ────────────────────────────────────────
export function build_inter_file_header(config: any, sequence: number, now: PyDate): string {
  const line =
    num(BANK_CODE, 3) + num("0", 4) + num("0", 1) + branco(9) + num("2", 1)
    + alpha(documento(config.company_document, 14), 14)
    + branco(20)
    + num(config.agency || "00001", 5)
    + alpha(config.agency_digit || "9", 1)
    + num(config.account_number, 12)
    + num(config.account_digit, 1)
    + branco(1)
    + alpha(config.company_name, 30)
    + alpha(BANK_NAME, 30)
    + branco(10)
    + num("1", 1)
    + now.strftime("%d%m%Y")
    + now.strftime("%H%M%S")
    + num(sequence, 6)
    + num(LAYOUT_VERSAO_ARQUIVO, 3)
    + num(DENSIDADE_GRAVACAO, 5)
    + branco(20) + branco(20) + branco(29);
  return ensure_240(line);
}

export function build_inter_pix_batch_header(config: any, lote_numero: number): string {
  const cep = only_digits(config.zip_code);
  const line =
    num(BANK_CODE, 3) + num(lote_numero, 4) + num("1", 1) + alpha("C", 1)
    + num(TIPO_SERVICO, 2) + num(FORMA_LANCAMENTO_PIX, 2) + num(LAYOUT_VERSAO_LOTE, 3)
    + branco(1) + num("2", 1)
    + alpha(documento(config.company_document, 14), 14)
    + branco(20)
    + num(config.agency || "00001", 5)
    + num(config.agency_digit || "9", 1)
    + num(config.account_number, 12)
    + num(config.account_digit, 1)
    + branco(1)
    + alpha(config.company_name, 30)
    + branco(40)
    + alpha(config.address_street, 30)
    + num(config.address_number || "0", 5)
    + alpha(config.address_complement, 15)
    + alpha(config.city, 20)
    + num(cep.slice(0, 5), 5)
    + num(cep.slice(5, 8), 3)
    + alpha(config.state, 2)
    + branco(8) + branco(10);
  return ensure_240(line);
}

export function build_inter_pix_segment_a(payment: any, lote_numero: number, seq: number): string {
  const line =
    num(BANK_CODE, 3) + num(lote_numero, 4) + num("3", 1) + num(seq, 5) + alpha("A", 1)
    + num("0", 1) + num("00", 2) + num("000", 3)
    + zeros(3) + zeros(5) + zeros(1) + zeros(12) + zeros(1)
    + branco(1) + branco(30) + branco(20)
    + payment.payment_date_ddmmaaaa
    + alpha("BRL", 3)
    + zeros(15)
    + money_to_cents(payment.amount, 15)
    + branco(20) + zeros(8) + zeros(15)
    + documento(payment.client_document, 14)
    + zeros(8) + zeros(2) + branco(29) + branco(10);
  return ensure_240(line);
}

export function build_inter_pix_segment_b(payment: any, lote_numero: number, seq: number): string {
  const tipo_chave = payment.pix_key_type;
  const tipo_doc_fav = only_digits(payment.client_document).length === 11 ? "1" : "2";
  const doc_field = documento(payment.client_document, 14);
  const chave_field = ["01", "02", "04"].includes(tipo_chave) ? pix_key_field(payment.pix_key, tipo_chave, 99) : branco(99);
  const line =
    num(BANK_CODE, 3) + num(lote_numero, 4) + num("3", 1) + num(seq, 5) + alpha("B", 1)
    + alpha(tipo_chave, 3)
    + num(tipo_doc_fav, 1)
    + doc_field
    + branco(35) + branco(60)
    + chave_field
    + branco(6) + zeros(8);
  return ensure_240(line);
}

export function build_inter_batch_trailer(lote_numero: number, qtd_registros_lote: number, total_centavos: bigint | number): string {
  const line =
    num(BANK_CODE, 3) + num(lote_numero, 4) + num("5", 1) + branco(9)
    + num(qtd_registros_lote, 6) + num(String(total_centavos), 18)
    + zeros(18) + zeros(6) + branco(165) + branco(10);
  return ensure_240(line);
}

export function build_inter_file_trailer(qtd_lotes: number, qtd_registros_arquivo: number): string {
  const line = num(BANK_CODE, 3) + num("9999", 4) + num("9", 1) + branco(9)
    + num(qtd_lotes, 6) + num(qtd_registros_arquivo, 6) + branco(211);
  return ensure_240(line);
}

// ── Validação dos pagamentos (sem gerar nada) ────────────────────────────
function valor_pendente(cli: any): Dec {
  try { return Dec.de(cli.total_income || 0); } catch { return new Dec(BigInt(0), 0); }
}

export async function validate_inter_pix_payments(calculation_id: number): Promise<Record<string, any>> {
  const detail = await get_monthly_calculation_detail(calculation_id);
  if (!detail) throw new BankFileValidationError(`Apuração #${calculation_id} não encontrada.`);

  const header = detail.header;
  const condominium_code = header.condominium_code ?? null;
  const clients: any[] = await consolidate_by_client(detail.items);

  const valid_payments: any[] = [];
  const pending_no_pix: any[] = [], pending_no_document: any[] = [], pending_invalid_document: any[] = [];
  const pending_no_name: any[] = [], pending_zero_amount: any[] = [], pending_invalid_pix_email: any[] = [];

  for (const cli of clients) {
    const nome = (cli.client_name || "").trim();
    const doc = only_digits(cli.client_cpf);
    const pix = (cli.client_pix || "").trim();
    const valor = cli.total_income || 0;
    if (!nome) { pending_no_name.push(cli); continue; }
    if (!doc) { pending_no_document.push(cli); continue; }
    if (doc.length !== 11 && doc.length !== 14) { pending_invalid_document.push(cli); continue; }
    if (!pix) { pending_no_pix.push(cli); continue; }
    if (pix.includes("@") && !is_valid_pix_email_key(pix)) { pending_invalid_pix_email.push(cli); continue; }
    if (Dec.de(valor).cmp(0) <= 0) { pending_zero_amount.push(cli); continue; }
    valid_payments.push({
      client_id: cli.client_id, client_name: nome, client_document: doc,
      pix_key: pix, pix_key_type: detect_pix_key_type(pix), amount: Dec.de(valor),
    });
  }

  const config: any = (await get_bank_config(BANK_CODE)) || {};
  const config_missing = ["company_name", "company_document", "account_number", "account_digit"]
    .filter((campo) => !(config[campo] || "").trim());

  const pending_lists = [pending_no_pix, pending_no_document, pending_invalid_document, pending_no_name, pending_zero_amount, pending_invalid_pix_email];
  const pending_count = pending_lists.reduce((a, l) => a + l.length, 0);
  let pending_total_amount = new Dec(BigInt(0), 0);
  for (const l of pending_lists) for (const c of l) pending_total_amount = pending_total_amount.add(valor_pendente(c));
  let total_amount = new Dec(BigInt(0), 0);
  for (const p of valid_payments) total_amount = total_amount.add(p.amount);

  return {
    calculation_id, condominium_code, condominium_name: header.condominium_name ?? null,
    valid_payments, valid_count: valid_payments.length, total_amount,
    pending_no_pix, pending_no_document, pending_invalid_document, pending_no_name,
    pending_zero_amount, pending_invalid_pix_email, pending_count, pending_total_amount,
    total_client_count: clients.length, config_missing,
    can_generate: valid_payments.length > 0 && config_missing.length === 0,
  };
}

// ── Geração do arquivo ────────────────────────────────────────────────────
const PIX_KEY_TYPE_LABELS: Record<string, string> = { "01": "telefone", "02": "email", "03": "cpf_cnpj", "04": "aleatoria" };
const strRend = (cli: any) => { const v = cli.total_income || 0; return v === 0 ? "0" : typeof v === "number" ? pyFloatRepr(v) : String(v); };
const ouVazio = (v: any) => (v === null || v === undefined ? "" : v);

export async function generate_inter_pix_remittance(calculation_id: number, payment_date: string): Promise<Record<string, any>> {
  if (!payment_date) throw new BankFileValidationError("Data de pagamento é obrigatória para gerar o arquivo.");
  let pay_date: PyDate;
  try { pay_date = PyDate.strptime(payment_date, "%Y-%m-%d"); } catch {
    throw new BankFileValidationError("Data de pagamento inválida (formato esperado AAAA-MM-DD).");
  }

  const validation = await validate_inter_pix_payments(calculation_id);
  if (!validation.valid_payments.length) {
    throw new BankFileValidationError("Nenhum pagamento válido para gerar remessa (todos os clientes estão pendentes).", validation);
  }
  if (validation.config_missing.length) {
    throw new BankFileValidationError("Configuração do Banco Inter incompleta em Configurações: " + validation.config_missing.join(", "), validation);
  }

  const config: any = await get_bank_config(BANK_CODE);
  const payments: any[] = validation.valid_payments;
  for (const p of payments) p.payment_date_ddmmaaaa = pay_date.strftime("%d%m%Y");

  const sequence = Number(await increment_bank_remittance_sequence(BANK_CODE));
  const now = PyDate.now();

  const lote_numero = 1;
  const lines: string[] = [];
  lines.push(build_inter_file_header(config, sequence, now));
  lines.push(build_inter_pix_batch_header(config, lote_numero));
  let seq_detalhe = 0;
  let total_centavos = BigInt(0);
  for (const p of payments) {
    seq_detalhe += 1;
    lines.push(build_inter_pix_segment_a(p, lote_numero, seq_detalhe));
    seq_detalhe += 1;
    lines.push(build_inter_pix_segment_b(p, lote_numero, seq_detalhe));
    total_centavos += Dec.de(p.amount).quantize(2, "even").n;
  }
  const qtd_registros_lote = 2 + 2 * payments.length;
  lines.push(build_inter_batch_trailer(lote_numero, qtd_registros_lote, total_centavos));
  const qtd_registros_arquivo = 2 + qtd_registros_lote;
  lines.push(build_inter_file_trailer(1, qtd_registros_arquivo));
  for (const line of lines) ensure_240(line);

  const seq7 = String(sequence).padStart(7, "0");
  const file_name = `CI240_001_${seq7}.REM`;
  const file_path = `${EXPORTS_DIR}/${file_name}`;
  const conference_name = `CI240_001_${seq7}_conferencia.csv`;
  const conference_path = `${EXPORTS_DIR}/${conference_name}`;

  await salvarArquivo(file_path, asciiReplace(lines.join("\r\n") + "\r\n"), "application/octet-stream");

  let csv = csvLinha(["cliente", "cpf_cnpj", "chave_pix", "tipo_chave", "forma_iniciacao", "valor", "status", "motivo"]);
  for (const p of payments) {
    csv += csvLinha([p.client_name, p.client_document, p.pix_key, PIX_KEY_TYPE_LABELS[p.pix_key_type] ?? p.pix_key_type, p.pix_key_type, p.amount.fixed(2), "included", ""]);
  }
  for (const cli of validation.pending_no_name) csv += csvLinha(["(sem nome)", only_digits(cli.client_cpf), cli.client_pix || "", "", "", strRend(cli), "skipped", "Cliente sem nome cadastrado"]);
  for (const cli of validation.pending_no_document) csv += csvLinha([ouVazio(cli.client_name), "", cli.client_pix || "", "", "", strRend(cli), "skipped", "CPF/CNPJ ausente"]);
  for (const cli of validation.pending_invalid_document) csv += csvLinha([ouVazio(cli.client_name), only_digits(cli.client_cpf), cli.client_pix || "", "", "", strRend(cli), "skipped", "CPF/CNPJ inválido (quantidade de dígitos incorreta)"]);
  for (const cli of validation.pending_no_pix) csv += csvLinha([ouVazio(cli.client_name), only_digits(cli.client_cpf), "", "", "", strRend(cli), "skipped", "Chave Pix ausente"]);
  for (const cli of validation.pending_invalid_pix_email) csv += csvLinha([ouVazio(cli.client_name), only_digits(cli.client_cpf), cli.client_pix || "", "email", "02", strRend(cli), "skipped", "Chave Pix e-mail inválida"]);
  for (const cli of validation.pending_zero_amount) csv += csvLinha([ouVazio(cli.client_name), only_digits(cli.client_cpf), cli.client_pix || "", "", "", strRend(cli), "skipped", "Valor inválido (zerado ou negativo)"]);
  await salvarArquivo(conference_path, utf8Sig(csv), "text/csv");

  const total_amount: Dec = validation.total_amount;
  const remittance_id = await create_bank_remittance_file(
    calculation_id, validation.condominium_code, BANK_CODE, BANK_NAME, file_name, file_path, conference_path,
    payment_date, total_amount.toNumber(), payments.length, "generated", `Sequencial Inter: ${sequence}`,
  );

  const items_to_log: any[] = payments.map((p) => ({
    client_id: p.client_id, client_name: p.client_name, client_document: p.client_document,
    pix_key: p.pix_key, pix_key_type: p.pix_key_type, amount: p.amount.toNumber(), status: "included", notes: "",
  }));
  const pendentes: [any[], string][] = [
    [validation.pending_no_name, "Cliente sem nome cadastrado"],
    [validation.pending_no_document, "CPF/CNPJ ausente"],
    [validation.pending_invalid_document, "CPF/CNPJ inválido (quantidade de dígitos incorreta)"],
    [validation.pending_no_pix, "Chave Pix ausente"],
    [validation.pending_invalid_pix_email, "Chave Pix e-mail inválida"],
    [validation.pending_zero_amount, "Valor inválido (zerado ou negativo)"],
  ];
  for (const [lista, motivo] of pendentes) {
    for (const cli of lista) {
      items_to_log.push({
        client_id: cli.client_id ?? null, client_name: cli.client_name ?? null, client_document: only_digits(cli.client_cpf),
        pix_key: cli.client_pix || "", pix_key_type: "", amount: Number(cli.total_income || 0), status: "skipped", notes: motivo,
      });
    }
  }
  await add_bank_remittance_items(remittance_id, items_to_log);

  return {
    remittance_id, file_name, file_path, conference_file_path: conference_path,
    total_payments: payments.length, total_amount: total_amount.toNumber(), sequence,
    total_client_count: validation.total_client_count, pending_count: validation.pending_count,
    pending_total_amount: validation.pending_total_amount.toNumber(),
  };
}
