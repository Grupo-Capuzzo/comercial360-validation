/* eslint-disable @typescript-eslint/no-explicit-any */
// Porte de app/bank_files_itau.py — remessa CNAB240 SISPAG (Itaú), crédito em conta.
// Mesmas regras e o mesmo disclaimer do original (layout Febraban público, conferir
// com o manual do Itaú antes de produção). Arquivos ficam em erp_arquivos.
import { PyDate } from "../core/py";
import { salvarArquivo } from "../core/arquivos";
import {
  get_bank_config, get_monthly_calculation_detail, get_client_by_id, increment_bank_remittance_sequence,
  create_bank_remittance_file, add_bank_remittance_items,
} from "./database";
import { consolidate_by_client } from "./calculations";
import { Dec, asciiReplace, csvLinha, pyFloatRepr, utf8Sig } from "./dec";

export const EXPORTS_DIR = "exports/remessas_bancarias/itau";

export const BANK_CODE = "341";
export const BANK_NAME = "BANCO ITAU SA";
export const LAYOUT_VERSAO_ARQUIVO = "080";
export const LAYOUT_VERSAO_LOTE = "040";
export const DENSIDADE_GRAVACAO = "01600";
export const FORMA_LANCAMENTO_CREDITO_CC = "01";
export const TIPO_SERVICO = "10";

export class BankFileValidationError extends Error {
  details: Record<string, any>;
  constructor(message: string, details: Record<string, any> | null = null) {
    super(message);
    this.details = details ?? {};
  }
}

export function get_itau_status() { return { layout_configured: true, message: "" }; }

// ── Helpers de formatação CNAB (cópias independentes, como no original) ──
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
export function documento(value: any, size = 14): string { return only_digits(value).padStart(size, "0").slice(-size); }
export function money_to_cents(value: any, size: number): string {
  if (value === null || value === undefined) value = 0;
  const cents = Dec.de(value).quantize(2, "up").n;
  if (cents < BigInt(0)) throw new Error("Valor de pagamento nao pode ser negativo.");
  return cents.toString().padStart(size, "0");
}
export const branco = (size: number) => " ".repeat(size);
export const zeros = (size: number) => "0".repeat(size);

export function validate_line_length(line: string, expected = 240): string {
  const n = Array.from(line).length;
  if (n !== expected) {
    throw new BankFileValidationError(`Erro interno: registro CNAB com ${n} posicoes (esperado ${expected}). Geracao interrompida por seguranca.`);
  }
  return line;
}

// ── Resolução do banco do favorecido ─────────────────────────────────────
export const _BANK_NAME_TO_CODE: Record<string, string> = {
  "BANCO DO BRASIL": "001", "BB": "001",
  "BRADESCO": "237",
  "ITAU": "341", "ITAU UNIBANCO": "341", "BANCO ITAU": "341",
  "CAIXA": "104", "CAIXA ECONOMICA": "104", "CAIXA ECONOMICA FEDERAL": "104", "CEF": "104",
  "SANTANDER": "033",
  "INTER": "077", "BANCO INTER": "077",
  "NUBANK": "260", "NU PAGAMENTOS": "260",
  "SICOOB": "756",
  "SICREDI": "748",
  "BANRISUL": "041",
  "SAFRA": "422",
  "C6": "336", "C6 BANK": "336",
  "ORIGINAL": "212", "BANCO ORIGINAL": "212",
  "BTG": "208", "BTG PACTUAL": "208",
  "PAGSEGURO": "290", "PAGBANK": "290",
  "MERCADO PAGO": "323",
  "NEON": "655",
  "NEXT": "237",
  "VOTORANTIM": "655",
};

export function resolve_bank_code(bank_name_raw: string): string | null {
  const texto = (bank_name_raw || "").trim();
  if (!texto) return null;
  const digits = only_digits(texto);
  if (digits && digits.length <= 3 && digits === texto.trim()) return digits.padStart(3, "0");
  const chave = remove_accents(texto).toUpperCase().trim();
  return _BANK_NAME_TO_CODE[chave] ?? null;
}

// ── Montagem dos registros CNAB240 ────────────────────────────────────────
export function build_itau_file_header(config: any, sequence: number, now: PyDate | null = null): string {
  now = now ?? PyDate.now();
  const line =
    num(BANK_CODE, 3) + num("0", 4) + num("0", 1) + branco(9) + num("2", 1)
    + documento(config.company_document, 14)
    + alpha(config.agreement_code, 20)
    + num(config.agency || "0", 5)
    + alpha(config.agency_digit || "", 1)
    + num(config.account_number, 12)
    + alpha(config.account_digit || "", 1)
    + branco(1)
    + alpha(config.company_name, 30)
    + alpha(BANK_NAME, 30)
    + branco(10) + num("1", 1)
    + now.strftime("%d%m%Y") + now.strftime("%H%M%S")
    + num(sequence, 6) + num(LAYOUT_VERSAO_ARQUIVO, 3) + num(DENSIDADE_GRAVACAO, 5)
    + branco(20) + branco(20) + branco(29);
  return validate_line_length(line);
}

export function build_itau_batch_header(config: any, lote_numero = 1): string {
  const cep = only_digits(config.zip_code);
  const line =
    num(BANK_CODE, 3) + num(lote_numero, 4) + num("1", 1) + alpha("C", 1)
    + num(TIPO_SERVICO, 2) + num(FORMA_LANCAMENTO_CREDITO_CC, 2) + num(LAYOUT_VERSAO_LOTE, 3)
    + branco(1) + num("2", 1)
    + documento(config.company_document, 14)
    + alpha(config.agreement_code, 20)
    + num(config.agency || "0", 5)
    + alpha(config.agency_digit || "", 1)
    + num(config.account_number, 12)
    + alpha(config.account_digit || "", 1)
    + branco(1)
    + alpha(config.company_name, 30)
    + branco(40)
    + alpha(config.address_street, 30)
    + num(config.address_number || "0", 5)
    + alpha(config.address_complement, 15)
    + alpha(config.city, 20)
    + num(cep.slice(0, 5), 5) + num(cep.slice(5, 8), 3)
    + alpha(config.state, 2)
    + branco(2) + branco(16);
  return validate_line_length(line);
}

export function build_itau_segment_a(payment: any, lote_numero: number, seq: number): string {
  const mesmo_banco = payment.bank_code === BANK_CODE;
  const camara = mesmo_banco ? "000" : "018";
  const line =
    num(BANK_CODE, 3) + num(lote_numero, 4) + num("3", 1) + num(seq, 5) + alpha("A", 1)
    + num("0", 1) + num("00", 2) + num(camara, 3)
    + num(payment.bank_code, 3) + num(payment.bank_agency, 5) + branco(1)
    + num(payment.bank_account, 12) + alpha(payment.bank_account_digit, 1) + branco(1)
    + alpha(payment.client_name, 30)
    + branco(20)
    + payment.payment_date_ddmmaaaa
    + alpha("BRL", 3) + zeros(15)
    + money_to_cents(payment.amount, 15)
    + branco(20) + zeros(8) + zeros(15) + branco(40) + branco(13) + branco(10);
  return validate_line_length(line);
}

export function build_itau_segment_b(payment: any, lote_numero: number, seq: number): string {
  const tipo_doc_fav = only_digits(payment.client_document).length === 11 ? "1" : "2";
  const line =
    num(BANK_CODE, 3) + num(lote_numero, 4) + num("3", 1) + num(seq, 5) + alpha("B", 1)
    + branco(3) + num(tipo_doc_fav, 1) + documento(payment.client_document, 14)
    + branco(30) + branco(5) + branco(15) + branco(15) + branco(20) + branco(5) + branco(3) + branco(2)
    + zeros(8) + zeros(15) + zeros(15) + zeros(15) + zeros(15) + zeros(15)
    + branco(15) + branco(2) + branco(13);
  return validate_line_length(line);
}

export function build_itau_batch_trailer(lote_numero: number, qtd_registros_lote: number, total_centavos: bigint | number): string {
  const line = num(BANK_CODE, 3) + num(lote_numero, 4) + num("5", 1) + branco(9)
    + num(qtd_registros_lote, 6) + num(String(total_centavos), 18)
    + zeros(18) + zeros(6) + branco(165) + branco(10);
  return validate_line_length(line);
}

export function build_itau_file_trailer(qtd_lotes: number, qtd_registros_arquivo: number): string {
  const line = num(BANK_CODE, 3) + num("9999", 4) + num("9", 1) + branco(9)
    + num(qtd_lotes, 6) + num(qtd_registros_arquivo, 6) + branco(211);
  return validate_line_length(line);
}

// ── Datas ─────────────────────────────────────────────────────────────────
export function ajustar_dia_util(d: PyDate): PyDate {
  let ajustada = d;
  while (ajustada.weekday() >= 5) ajustada = ajustada.addDays(1);
  return ajustada;
}
export function data_sugerida_pagamento(ano: number, mes: number): PyDate {
  let base = new PyDate(ano, mes, 15);
  if (!base.valid()) base = new PyDate(ano, mes, 1);
  return ajustar_dia_util(base);
}

// ── Validação ──────────────────────────────────────────────────────────────
function valor_pendente(cli: any): Dec {
  try { return Dec.de(cli.total_income || 0); } catch { return new Dec(BigInt(0), 0); }
}

export async function validate_itau_payments(calculation_id: number): Promise<Record<string, any>> {
  const detail = await get_monthly_calculation_detail(calculation_id);
  if (!detail) throw new BankFileValidationError(`Apuração #${calculation_id} não encontrada.`);
  const header = detail.header;
  const condominium_code = header.condominium_code ?? null;
  const clients: any[] = await consolidate_by_client(detail.items);

  const valid_payments: any[] = [];
  const pending_no_name: any[] = [], pending_no_document: any[] = [], pending_invalid_document: any[] = [];
  const pending_no_bank_data: any[] = [], pending_zero_amount: any[] = [];

  for (const cli of clients) {
    const nome = (cli.client_name || "").trim();
    const doc = only_digits(cli.client_cpf);
    const valor = cli.total_income || 0;
    const client_row: any = (await get_client_by_id(cli.client_id)) || {};
    const bank_name_raw = (client_row.bank_name || "").trim();
    const bank_agency = only_digits(client_row.bank_agency);
    const bank_account = only_digits(client_row.bank_account);
    const bank_account_digit = (client_row.bank_account_digit || "").trim();
    const bank_code_resolvido = resolve_bank_code(bank_name_raw);

    if (!nome) { pending_no_name.push(cli); continue; }
    if (!doc) { pending_no_document.push(cli); continue; }
    if (doc.length !== 11 && doc.length !== 14) { pending_invalid_document.push(cli); continue; }
    if (!(bank_name_raw && bank_agency && bank_account && bank_account_digit)) {
      pending_no_bank_data.push({ ...cli, _motivo_bancario: "Dados bancários incompletos (banco/agência/conta/dígito)" }); continue;
    }
    if (!bank_code_resolvido) {
      pending_no_bank_data.push({ ...cli, _motivo_bancario: `Banco do favorecido não reconhecido: '${bank_name_raw}'` }); continue;
    }
    if (Dec.de(valor).cmp(0) <= 0) { pending_zero_amount.push(cli); continue; }
    valid_payments.push({
      client_id: cli.client_id, client_name: nome, client_document: doc, bank_code: bank_code_resolvido,
      bank_name: bank_name_raw, bank_agency, bank_account, bank_account_digit, amount: Dec.de(valor),
    });
  }

  const config: any = (await get_bank_config(BANK_CODE)) || {};
  const config_missing = ["company_name", "company_document", "agency", "account_number", "account_digit"]
    .filter((campo) => !(config[campo] || "").trim());
  const pending_lists = [pending_no_name, pending_no_document, pending_invalid_document, pending_no_bank_data, pending_zero_amount];
  const pending_count = pending_lists.reduce((a, l) => a + l.length, 0);
  let pending_total_amount = new Dec(BigInt(0), 0);
  for (const l of pending_lists) for (const c of l) pending_total_amount = pending_total_amount.add(valor_pendente(c));
  let total_amount = new Dec(BigInt(0), 0);
  for (const p of valid_payments) total_amount = total_amount.add(p.amount);

  return {
    calculation_id, condominium_code, condominium_name: header.condominium_name ?? null,
    valid_payments, valid_count: valid_payments.length, total_amount,
    pending_no_name, pending_no_document, pending_invalid_document, pending_no_bank_data, pending_zero_amount,
    pending_count, pending_total_amount, total_client_count: clients.length, config_missing,
    can_generate: valid_payments.length > 0 && config_missing.length === 0,
  };
}

// ── Geração ────────────────────────────────────────────────────────────────
const strRend = (cli: any) => { const v = cli.total_income || 0; return v === 0 ? "0" : typeof v === "number" ? pyFloatRepr(v) : String(v); };
const ouVazio = (v: any) => (v === null || v === undefined ? "" : v);

export async function generate_itau_remittance(calculation_id: number, payment_date: string): Promise<Record<string, any>> {
  if (!payment_date) throw new BankFileValidationError("Data de pagamento é obrigatória para gerar o arquivo.");
  let pay_date: PyDate;
  try { pay_date = PyDate.strptime(payment_date, "%Y-%m-%d"); } catch {
    throw new BankFileValidationError("Data de pagamento inválida (formato esperado AAAA-MM-DD).");
  }
  const validation = await validate_itau_payments(calculation_id);
  if (!validation.valid_payments.length) {
    throw new BankFileValidationError("Nenhum pagamento válido para gerar remessa (todos os clientes estão pendentes).", validation);
  }
  if (validation.config_missing.length) {
    throw new BankFileValidationError("Configuração do Banco Itaú incompleta em Configurações: " + validation.config_missing.join(", "), validation);
  }
  const config: any = await get_bank_config(BANK_CODE);
  const payments: any[] = validation.valid_payments;
  for (const p of payments) p.payment_date_ddmmaaaa = pay_date.strftime("%d%m%Y");

  const sequence = Number(await increment_bank_remittance_sequence(BANK_CODE));
  const now = PyDate.now();
  const lote_numero = 1;
  const lines: string[] = [build_itau_file_header(config, sequence, now), build_itau_batch_header(config, lote_numero)];
  let seq_detalhe = 0;
  let total_centavos = BigInt(0);
  for (const p of payments) {
    seq_detalhe += 1;
    lines.push(build_itau_segment_a(p, lote_numero, seq_detalhe));
    seq_detalhe += 1;
    lines.push(build_itau_segment_b(p, lote_numero, seq_detalhe));
    total_centavos += Dec.de(p.amount).quantize(2, "even").n;
  }
  const qtd_registros_lote = 2 + 2 * payments.length;
  lines.push(build_itau_batch_trailer(lote_numero, qtd_registros_lote, total_centavos));
  lines.push(build_itau_file_trailer(1, 2 + qtd_registros_lote));
  for (const line of lines) validate_line_length(line);

  const seq7 = String(sequence).padStart(7, "0");
  const file_name = `IT240_001_${seq7}.REM`;
  const file_path = `${EXPORTS_DIR}/${file_name}`;
  const conference_path = `${EXPORTS_DIR}/IT240_001_${seq7}_conferencia.csv`;

  await salvarArquivo(file_path, asciiReplace(lines.join("\r\n") + "\r\n"), "application/octet-stream");

  let csv = csvLinha(["cliente", "documento", "banco", "agencia", "conta", "valor", "status", "motivo"]);
  for (const p of payments) {
    csv += csvLinha([p.client_name, p.client_document, p.bank_code, p.bank_agency, `${p.bank_account}-${p.bank_account_digit}`, p.amount.fixed(2), "included", ""]);
  }
  for (const cli of validation.pending_no_name) csv += csvLinha(["(sem nome)", only_digits(cli.client_cpf), "", "", "", strRend(cli), "skipped", "Cliente sem nome cadastrado"]);
  for (const cli of validation.pending_no_document) csv += csvLinha([ouVazio(cli.client_name), "", "", "", "", strRend(cli), "skipped", "CPF/CNPJ ausente"]);
  for (const cli of validation.pending_invalid_document) csv += csvLinha([ouVazio(cli.client_name), only_digits(cli.client_cpf), "", "", "", strRend(cli), "skipped", "CPF/CNPJ inválido (quantidade de dígitos incorreta)"]);
  for (const cli of validation.pending_no_bank_data) csv += csvLinha([ouVazio(cli.client_name), only_digits(cli.client_cpf), "", "", "", strRend(cli), "skipped", cli._motivo_bancario ?? "Dados bancários incompletos"]);
  for (const cli of validation.pending_zero_amount) csv += csvLinha([ouVazio(cli.client_name), only_digits(cli.client_cpf), "", "", "", strRend(cli), "skipped", "Valor inválido (zerado ou negativo)"]);
  await salvarArquivo(conference_path, utf8Sig(csv), "text/csv");

  const total_amount: Dec = validation.total_amount;
  const remittance_id = await create_bank_remittance_file(
    calculation_id, validation.condominium_code, BANK_CODE, BANK_NAME, file_name, file_path, conference_path,
    payment_date, total_amount.toNumber(), payments.length, "generated", `Sequencial Itaú: ${sequence}`,
  );

  const pulado = (cli: any, notes: string) => ({
    client_id: cli.client_id ?? null, client_name: cli.client_name ?? null, client_document: only_digits(cli.client_cpf),
    pix_key: "", pix_key_type: "", amount: Number(cli.total_income || 0), status: "skipped", notes,
  });
  const items_to_log: any[] = payments.map((p) => ({
    client_id: p.client_id, client_name: p.client_name, client_document: p.client_document,
    pix_key: `AG ${p.bank_agency} CC ${p.bank_account}-${p.bank_account_digit} (banco ${p.bank_code})`,
    pix_key_type: "dados_bancarios", amount: p.amount.toNumber(), status: "included", notes: "",
  }));
  for (const [lista, motivo] of [
    [validation.pending_no_name, "Cliente sem nome cadastrado"],
    [validation.pending_no_document, "CPF/CNPJ ausente"],
    [validation.pending_invalid_document, "CPF/CNPJ inválido (quantidade de dígitos incorreta)"],
    [validation.pending_zero_amount, "Valor inválido (zerado ou negativo)"],
  ] as [any[], string][]) for (const cli of lista) items_to_log.push(pulado(cli, motivo));
  for (const cli of validation.pending_no_bank_data) items_to_log.push(pulado(cli, cli._motivo_bancario ?? "Dados bancários incompletos"));
  await add_bank_remittance_items(remittance_id, items_to_log);

  return {
    remittance_id, file_name, file_path, conference_file_path: conference_path,
    total_payments: payments.length, total_amount: total_amount.toNumber(), sequence,
    total_client_count: validation.total_client_count, pending_count: validation.pending_count,
    pending_total_amount: validation.pending_total_amount.toNumber(),
  };
}
