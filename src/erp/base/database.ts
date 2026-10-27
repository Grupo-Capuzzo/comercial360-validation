/* eslint-disable @typescript-eslint/no-explicit-any */
// database.py — Banco de dados (agora PostgreSQL, schema erp)
// Sistema de Controle Financeiro de Condomínios de Investimento — Grupo Capuzzo
//
// Porte função a função do app/database.py do Flask: mesmos nomes, mesmas regras,
// mesmas mensagens. As tabelas já existem no Postgres (não há criação/migração aqui:
// init_database é um no-op). Toda função que acessa o banco é async.
import { getConnection, Conn, Row } from "../core/db";
import { PyDate, pyFormat, pyStr, pyb } from "../core/py";
import {
  Decimal, ValueError, pyRepr, pyJsonDumps, pyInt, pyFloat, pyFloatRepr, pyCmp, sortBy, dget, ou, soDigitos,
  strExc, ehTypeOuValue,
} from "./pyextra";
import { parse_data, formatar_data, formatar_moeda } from "./calculations";

export { ValueError } from "./pyextra";

// Log do Python → console
export const logger = {
  info: (m: string) => console.info(m),
  warning: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
};

// ── Apoio: parâmetros nomeados (:nome) do sqlite3 → posicionais (?) ──
/** Converte "… :nome …" + dict em "… ? …" + lista (fora de literais entre aspas). */
export function _nomeados(sql: string, dados: Record<string, any>): [string, any[]] {
  const vals: any[] = [];
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; } if (sql[j] === "'") break; j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === ":" && /[A-Za-z_]/.test(sql[i + 1] ?? "") && sql[i - 1] !== ":") {
      const m = /^[A-Za-z_]\w*/.exec(sql.slice(i + 1))!;
      const nome = m[0];
      if (!Object.prototype.hasOwnProperty.call(dados, nome) || dados[nome] === undefined) {
        const e = new Error(`You did not supply a value for binding parameter :${nome}.`);
        e.name = "ProgrammingError"; // sqlite3.ProgrammingError
        throw e;
      }
      vals.push(_param(dados[nome]));
      out += "?"; i += 1 + nome.length; continue;
    }
    out += c; i++;
  }
  return [out, vals];
}
/** Decimal não é aceito como parâmetro pelo driver → número. */
function _param(v: any) { return v instanceof Decimal ? v.toNumber() : v; }
function _params(l: any[]) { return l.map(_param); }

/** Primeiro valor da linha (row[0] do sqlite3). */
function v0(row: Row | null): any { return row ? Object.values(row)[0] : null; }

/** get_connection() — conexão com transação implícita (igual ao sqlite3). */
export async function get_connection(): Promise<Conn> { return getConnection(); }

export function share_number_sort_key(s: any): [number, number[], string] {
  const t = pyStr(s).trim();
  const ehInt = (p: string) => /^\s*[+-]?\d+(_\d+)*\s*$/.test(p);
  if (t.includes(".")) {
    const parts = t.split(".");
    if (parts.every(ehInt)) return [1, parts.map((p) => pyInt(p)), t];
    return [2, [], t.toLowerCase()];
  }
  if (ehInt(t)) return [0, [pyInt(t)], t];
  return [2, [], t.toLowerCase()];
}

export const _CONDOMINIUMS_SEED = [
  { name: "Construcao Civil", code: "civil", default_monthly_rate: 0.017, payment_day: 6, accrual_start_day: 6, accrual_end_day: 5, active: 1 },
  { name: "Saude", code: "saude", default_monthly_rate: 0.018, payment_day: 20, accrual_start_day: 20, accrual_end_day: 19, active: 1 },
  { name: "Agronegocio", code: "agro", default_monthly_rate: 0.015, payment_day: 15, accrual_start_day: 15, accrual_end_day: 14, active: 1 },
];

/** No Flask criava tabelas/migrações; no Postgres as tabelas já existem. */
export async function init_database(): Promise<void> { /* no-op */ }

export async function get_condominiums(only_active = false): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = "SELECT * FROM condominiums";
    if (only_active) sql += " WHERE active = 1";
    sql += " ORDER BY id";
    return (await conn.execute(sql)).fetchall();
  } finally { await conn.close(); }
}

export async function get_condominium_by_code(code: string): Promise<Row | null> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM condominiums WHERE code = ?", [code])).fetchone();
  } finally { await conn.close(); }
}

export async function update_condominium(cond_id: number, fields: Record<string, any>): Promise<boolean> {
  const allowed = new Set(["name", "default_monthly_rate", "payment_day", "accrual_start_day", "accrual_end_day", "active"]);
  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) if (allowed.has(k)) updates[k] = v;
  if (!Object.keys(updates).length) return false;
  const set_clause = Object.keys(updates).map((k) => `${k} = :${k}`).join(", ");
  updates.id = cond_id;
  const conn = await get_connection();
  try {
    await conn.execute(..._nomeados(`UPDATE condominiums SET ${set_clause} WHERE id = :id`, updates));
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

export async function get_clients(status: string | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    if (status) return (await conn.execute("SELECT * FROM clients WHERE status = ? ORDER BY full_name", [status])).fetchall();
    return (await conn.execute("SELECT * FROM clients ORDER BY full_name")).fetchall();
  } finally { await conn.close(); }
}

// Campos do cliente usados no preenchimento dos contratos (módulo contratos).
export const CLIENT_CONTRACT_FIELDS = ["nationality", "marital_status", "profession", "address_street",
  "address_district", "address_city", "address_state", "address_zip"] as const;

/** Grava os campos de contrato presentes em `data` (os ausentes ficam como estão). */
export async function _save_client_contract_fields(conn: Conn, client_id: number, data: Record<string, any>): Promise<void> {
  const sets: Record<string, any> = {};
  for (const k of CLIENT_CONTRACT_FIELDS) if (k in data) sets[k] = String(ou(data[k], "")).trim();
  if (!Object.keys(sets).length) return;
  const cols = Object.keys(sets).map((k) => `${k}=:${k}`).join(", ");
  await conn.execute(..._nomeados(`UPDATE clients SET ${cols} WHERE id=:id`, { ...sets, id: client_id }));
}

export async function get_client_by_id(client_id: number): Promise<Row | null> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM clients WHERE id = ?", [client_id])).fetchone();
  } finally { await conn.close(); }
}

export async function cpf_exists(cpf: string, exclude_id = 0): Promise<boolean> {
  const conn = await get_connection();
  try {
    const row = (await conn.execute("SELECT id FROM clients WHERE cpf = ? AND id != ?", [cpf, exclude_id])).fetchone();
    return row !== null;
  } finally { await conn.close(); }
}

const _limpaDoc = (s: any) => String(s).replace(/\./g, "").replace(/-/g, "").replace(/\//g, "").trim();

export async function insert_client(data: Record<string, any>): Promise<number> {
  const cpf_clean = _limpaDoc(dget(data, "cpf", ""));
  if (await cpf_exists(cpf_clean)) throw new ValueError(`CPF/CNPJ ${pyStr(data.cpf)} ja cadastrado.`);
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO clients
               (cpf, full_name, email, pix_key, phone, status, notes,
                bank_name, bank_agency, bank_account, bank_account_digit,
                bank_account_type, bank_holder_name, bank_holder_document, bank_notes)
               VALUES
               (:cpf, :full_name, :email, :pix_key, :phone, :status, :notes,
                :bank_name, :bank_agency, :bank_account, :bank_account_digit,
                :bank_account_type, :bank_holder_name, :bank_holder_document, :bank_notes)`,
      {
        cpf: cpf_clean, full_name: dget(data, "full_name", ""),
        email: dget(data, "email", ""), pix_key: dget(data, "pix_key", ""),
        phone: dget(data, "phone", ""), status: dget(data, "status", "ativo"),
        notes: dget(data, "notes", ""),
        bank_name: ou(dget(data, "bank_name", ""), ""),
        bank_agency: ou(dget(data, "bank_agency", ""), ""),
        bank_account: ou(dget(data, "bank_account", ""), ""),
        bank_account_digit: ou(dget(data, "bank_account_digit", ""), ""),
        bank_account_type: ou(dget(data, "bank_account_type", ""), ""),
        bank_holder_name: ou(dget(data, "bank_holder_name", ""), ""),
        bank_holder_document: ou(dget(data, "bank_holder_document", ""), ""),
        bank_notes: ou(dget(data, "bank_notes", ""), ""),
      },
    ));
    const new_id = cur.lastrowid!;
    await _save_client_contract_fields(conn, new_id, data);
    await conn.commit();
    await _log(conn, "clients", new_id, "INSERT", null, pyRepr(data));
    await conn.commit();
    return new_id;
  } finally { await conn.close(); }
}

export async function update_client(client_id: number, data: Record<string, any>): Promise<boolean> {
  const old = await get_client_by_id(client_id);
  if (!old) return false;
  const cpf_clean = _limpaDoc(dget(data, "cpf", old.cpf));
  if (await cpf_exists(cpf_clean, client_id)) throw new ValueError(`CPF/CNPJ ${cpf_clean} ja pertence a outro cliente.`);
  const conn = await get_connection();
  try {
    await conn.execute(..._nomeados(
      `UPDATE clients SET cpf=:cpf, full_name=:full_name, email=:email, pix_key=:pix_key,
               phone=:phone, status=:status, notes=:notes,
               bank_name=:bank_name, bank_agency=:bank_agency,
               bank_account=:bank_account, bank_account_digit=:bank_account_digit,
               bank_account_type=:bank_account_type, bank_holder_name=:bank_holder_name,
               bank_holder_document=:bank_holder_document, bank_notes=:bank_notes,
               updated_at=datetime('now','localtime')
               WHERE id=:id`,
      {
        id: client_id, cpf: cpf_clean,
        full_name: dget(data, "full_name", old.full_name),
        email: dget(data, "email", old.email),
        pix_key: dget(data, "pix_key", old.pix_key),
        phone: dget(data, "phone", old.phone),
        status: dget(data, "status", old.status),
        notes: dget(data, "notes", old.notes),
        bank_name: ou(dget(data, "bank_name", ou(dget(old, "bank_name"), "")), ""),
        bank_agency: ou(dget(data, "bank_agency", ou(dget(old, "bank_agency"), "")), ""),
        bank_account: ou(dget(data, "bank_account", ou(dget(old, "bank_account"), "")), ""),
        bank_account_digit: ou(dget(data, "bank_account_digit", ou(dget(old, "bank_account_digit"), "")), ""),
        bank_account_type: ou(dget(data, "bank_account_type", ou(dget(old, "bank_account_type"), "")), ""),
        bank_holder_name: ou(dget(data, "bank_holder_name", ou(dget(old, "bank_holder_name"), "")), ""),
        bank_holder_document: ou(dget(data, "bank_holder_document", ou(dget(old, "bank_holder_document"), "")), ""),
        bank_notes: ou(dget(data, "bank_notes", ou(dget(old, "bank_notes"), "")), ""),
      },
    ));
    await _save_client_contract_fields(conn, client_id, data);
    await conn.commit();
    await _log(conn, "clients", client_id, "UPDATE", pyRepr(old), pyRepr(data));
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

/** Exclui cliente definitivamente se não tiver cotas. */
export async function delete_client(client_id: number): Promise<Record<string, any>> {
  const cli = await get_client_by_id(client_id);
  if (!cli) return { ok: false, erro: "Cliente não encontrado." };
  if (await client_has_shares(client_id)) {
    return {
      ok: false,
      erro: "Este cliente possui cotas vinculadas. " +
        "Para preservar o histórico, inative o cliente em vez de excluir.",
    };
  }
  const conn = await get_connection();
  try {
    await _log(conn, "clients", client_id, "DELETE", pyRepr(cli), null, `Exclusão definitiva de ${cli.full_name}`);
    await conn.execute("DELETE FROM clients WHERE id = ?", [client_id]);
    await conn.commit();
    logger.info(`Cliente ${client_id} (${cli.full_name}) excluído definitivamente.`);
    return { ok: true, nome: cli.full_name };
  } catch (exc) {
    await conn.rollback();
    logger.error(`Erro ao excluir cliente ${client_id}: ${strExc(exc)}`);
    return { ok: false, erro: strExc(exc) };
  } finally { await conn.close(); }
}

export async function get_shares(condominium_id: number | null = null, client_id: number | null = null, status: string | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `SELECT s.*, c.full_name AS client_name, c.cpf AS client_cpf,
                        c.pix_key AS client_pix,
                        cd.name AS condominium_name, cd.code AS condominium_code
                 FROM shares s
                 JOIN clients c ON c.id = s.client_id
                 JOIN condominiums cd ON cd.id = s.condominium_id
                 WHERE 1=1`;
    const params: any[] = [];
    if (condominium_id) { sql += " AND s.condominium_id = ?"; params.push(condominium_id); }
    if (client_id) { sql += " AND s.client_id = ?"; params.push(client_id); }
    if (status) { sql += " AND s.status = ?"; params.push(status); }
    sql += " ORDER BY s.condominium_id, s.id";
    const result = (await conn.execute(sql, params)).fetchall();
    return sortBy(result, (r) => [r.condominium_id, share_number_sort_key(r.share_number)]);
  } finally { await conn.close(); }
}

export async function share_number_exists(condominium_id: number, share_number: string, exclude_id = 0): Promise<boolean> {
  const conn = await get_connection();
  try {
    const row = (await conn.execute(
      "SELECT id FROM shares WHERE condominium_id=? AND share_number=? AND id!=?",
      [condominium_id, share_number, exclude_id],
    )).fetchone();
    return row !== null;
  } finally { await conn.close(); }
}

export async function insert_share(data: Record<string, any>, allow_duplicate = false): Promise<number> {
  if (!allow_duplicate && await share_number_exists(data.condominium_id, data.share_number)) {
    throw new ValueError(`Cota ${pyStr(data.share_number)} ja existe no produto selecionado.`);
  }
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO shares (condominium_id, client_id, share_number, share_value,
               acquisition_date, maturity_date, status, notes)
               VALUES (:condominium_id, :client_id, :share_number, :share_value,
               :acquisition_date, :maturity_date, :status, :notes)`,
      {
        condominium_id: data.condominium_id, client_id: data.client_id,
        share_number: data.share_number, share_value: dget(data, "share_value", 0),
        acquisition_date: dget(data, "acquisition_date", ""), maturity_date: dget(data, "maturity_date", ""),
        status: dget(data, "status", "ativa"), notes: dget(data, "notes", ""),
      },
    ));
    await conn.commit();
    const new_id = cur.lastrowid!;
    await _log(conn, "shares", new_id, "INSERT", null, pyRepr(data));
    await conn.commit();
    return new_id;
  } finally { await conn.close(); }
}

export async function update_share(share_id: number, data: Record<string, any>, allow_duplicate = false): Promise<boolean> {
  const conn = await get_connection();
  try {
    const old_row = (await conn.execute("SELECT * FROM shares WHERE id=?", [share_id])).fetchone();
    if (!old_row) return false;
    const old: Row = { ...old_row };
    const cond_id = dget(data, "condominium_id", old.condominium_id);
    const share_number = dget(data, "share_number", old.share_number);
    if (!allow_duplicate && await share_number_exists(cond_id, share_number, share_id)) {
      throw new ValueError(`Cota ${pyStr(share_number)} ja existe no produto selecionado.`);
    }
    await conn.execute(..._nomeados(
      `UPDATE shares SET condominium_id=:condominium_id, client_id=:client_id,
               share_number=:share_number, share_value=:share_value,
               acquisition_date=:acquisition_date, maturity_date=:maturity_date,
               status=:status, last_renewal_date=:last_renewal_date,
               withdrawal_date=:withdrawal_date,
               accrual_until_withdrawal=:accrual_until_withdrawal, notes=:notes,
               updated_at=datetime('now','localtime') WHERE id=:id`,
      {
        id: share_id, condominium_id: cond_id,
        client_id: dget(data, "client_id", old.client_id),
        share_number, share_value: dget(data, "share_value", old.share_value),
        acquisition_date: dget(data, "acquisition_date", old.acquisition_date),
        maturity_date: dget(data, "maturity_date", old.maturity_date),
        status: dget(data, "status", old.status),
        last_renewal_date: dget(data, "last_renewal_date", old.last_renewal_date),
        withdrawal_date: dget(data, "withdrawal_date", old.withdrawal_date),
        accrual_until_withdrawal: pyb(dget(data, "accrual_until_withdrawal", ou(dget(old, "accrual_until_withdrawal"), 0))) ? 1 : 0,
        notes: dget(data, "notes", old.notes),
      },
    ));
    await conn.commit();
    let audit_note = "";
    if (allow_duplicate) audit_note = "Lançamento histórico com número de cota repetido permitido manualmente.";
    await _log(conn, "shares", share_id, "UPDATE", pyRepr(old), pyRepr(data), audit_note);
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

export async function get_monthly_calculations(year: number | null = null, month: number | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `SELECT mc.*, cd.name AS condominium_name,
                        COUNT(DISTINCT mci.client_id)  AS qty_clients,
                        COUNT(mci.id)                  AS qty_shares,
                        COALESCE(SUM(mci.income_value::numeric)::float8, 0) AS total_income
                 FROM monthly_calculations mc
                 LEFT JOIN condominiums cd  ON cd.id  = mc.condominium_id
                 LEFT JOIN monthly_calculation_items mci ON mci.monthly_calculation_id = mc.id
                 WHERE 1=1`;
    const params: any[] = [];
    if (year) { sql += " AND mc.calculation_year = ?"; params.push(year); }
    if (month) { sql += " AND mc.calculation_month = ?"; params.push(month); }
    // Postgres exige cd.name no GROUP BY (no SQLite era implícito)
    sql += " GROUP BY mc.id, cd.name ORDER BY mc.calculation_year DESC, mc.calculation_month DESC, mc.id DESC";
    return (await conn.execute(sql, params)).fetchall();
  } finally { await conn.close(); }
}

export async function get_calculation_items(monthly_calculation_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute(
      `SELECT mci.*,
                      c.full_name AS client_name, c.cpf AS client_cpf,
                      c.pix_key AS client_pix,
                      cd.name AS condominium_name, cd.code AS condominium_code,
                      s.share_number, s.acquisition_date, s.maturity_date,
                      s.last_renewal_date
               FROM monthly_calculation_items mci
               JOIN clients c ON c.id = mci.client_id
               JOIN condominiums cd ON cd.id = mci.condominium_id
               JOIN shares s ON s.id = mci.share_id
               WHERE mci.monthly_calculation_id = ?
               ORDER BY cd.name, c.full_name, mci.id`,
      [monthly_calculation_id],
    )).fetchall();
  } finally { await conn.close(); }
}

/** Registra no audit_logs; uma falha aqui não derruba a transação (savepoint). */
export async function _log(conn: Conn, entity_type: string, entity_id: any, action: string,
  old_value: any, new_value: any, user_note: any = ""): Promise<void> {
  try {
    await conn.tentar(
      "INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, user_note) VALUES (?,?,?,?,?,?)",
      [entity_type, entity_id, action, old_value, new_value, user_note],
    );
  } catch (exc) {
    logger.warning(`Falha no audit log: ${strExc(exc)}`);
  }
}

/** Inativa um cliente. */
export async function deactivate_client(client_id: number, user_note = ""): Promise<boolean> {
  const old = await get_client_by_id(client_id);
  if (!old) return false;
  const conn = await get_connection();
  try {
    await conn.execute("UPDATE clients SET status='inativo', updated_at=datetime('now','localtime') WHERE id=?", [client_id]);
    await conn.commit();
    await _log(conn, "clients", client_id, "DEACTIVATE", dget(old, "status"), "inativo", user_note);
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

/** Reativa um cliente inativo. */
export async function reactivate_client(client_id: number, user_note = ""): Promise<boolean> {
  const old = await get_client_by_id(client_id);
  if (!old) return false;
  const conn = await get_connection();
  try {
    await conn.execute("UPDATE clients SET status='ativo', updated_at=datetime('now','localtime') WHERE id=?", [client_id]);
    await conn.commit();
    await _log(conn, "clients", client_id, "REACTIVATE", dget(old, "status"), "ativo", user_note);
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

/** True se o cliente possui cotas cadastradas. */
export async function client_has_shares(client_id: number, only_active = false): Promise<boolean> {
  const conn = await get_connection();
  try {
    let sql = "SELECT COUNT(*) FROM shares WHERE client_id = ?";
    if (only_active) sql += " AND status = 'ativa'";
    const count = v0((await conn.execute(sql, [client_id])).fetchone());
    return count > 0;
  } finally { await conn.close(); }
}

/** Todas as cotas de um cliente com informações do produto. */
export async function get_client_shares(client_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute(
      `SELECT s.*,
                      cd.name AS condominium_name,
                      cd.code AS condominium_code,
                      cd.default_monthly_rate AS monthly_rate
               FROM shares s
               JOIN condominiums cd ON cd.id = s.condominium_id
               WHERE s.client_id = ?
               ORDER BY cd.name, s.share_number, s.id`,
      [client_id],
    )).fetchall();
  } finally { await conn.close(); }
}

/** Registra entrada no audit_logs (versão pública de _log). */
export async function log_audit(entity_type: string, entity_id: any, action: string,
  old_value: any = null, new_value: any = null, user_note = ""): Promise<void> {
  const conn = await get_connection();
  try {
    await _log(conn, entity_type, entity_id, action, old_value, new_value, user_note);
    await conn.commit();
  } finally { await conn.close(); }
}

/** Totais para os cards da tela de clientes. */
export async function get_clients_summary(): Promise<Record<string, number>> {
  const conn = await get_connection();
  try {
    const total = v0((await conn.execute("SELECT COUNT(*) FROM clients")).fetchone());
    const ativos = v0((await conn.execute("SELECT COUNT(*) FROM clients WHERE status='ativo'")).fetchone());
    const inativos = v0((await conn.execute("SELECT COUNT(*) FROM clients WHERE status='inativo'")).fetchone());
    const com_cotas = v0((await conn.execute("SELECT COUNT(DISTINCT client_id) FROM shares")).fetchone());
    return { total, ativos, inativos, com_cotas };
  } finally { await conn.close(); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  COTAS — funções adicionais
// ─────────────────────────────────────────────────────────────────────────────

/** Todos os clientes (ativos e inativos) para o formulário de cotas, com display_name. */
export async function get_all_clients_for_share_form(): Promise<Row[]> {
  const conn = await get_connection();
  try {
    const rows = (await conn.execute("SELECT * FROM clients ORDER BY full_name")).fetchall();
    return rows.map((r) => ({ ...r, display_name: r.status === "inativo" ? `${r.full_name} (inativo)` : r.full_name }));
  } finally { await conn.close(); }
}

/** Uma cota pelo ID com informações de cliente e produto. */
export async function get_share_by_id(share_id: number): Promise<Row | null> {
  const conn = await get_connection();
  try {
    return (await conn.execute(
      `SELECT s.*,
                      c.full_name AS client_name, c.cpf AS client_cpf,
                      cd.name AS condominium_name, cd.code AS condominium_code,
                      cd.default_monthly_rate AS monthly_rate
               FROM shares s
               JOIN clients c  ON c.id  = s.client_id
               JOIN condominiums cd ON cd.id = s.condominium_id
               WHERE s.id = ?`,
      [share_id],
    )).fetchone();
  } finally { await conn.close(); }
}

/** Cotas com filtros completos (superset de get_shares). */
export async function get_shares_filtered(
  condominium_id: number | null = null, client_id: number | null = null, status: string | null = null,
  maturity_from: string | null = null, maturity_to: string | null = null, search: string | null = null,
): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `
            SELECT s.*,
                   c.full_name AS client_name, c.cpf AS client_cpf,
                   c.pix_key AS client_pix, c.email AS client_email,
                   cd.name AS condominium_name, cd.code AS condominium_code,
                   cd.default_monthly_rate AS monthly_rate
            FROM shares s
            JOIN clients c  ON c.id  = s.client_id
            JOIN condominiums cd ON cd.id = s.condominium_id
            WHERE 1=1
        `;
    const params: any[] = [];
    if (condominium_id) { sql += " AND s.condominium_id = ?"; params.push(condominium_id); }
    if (client_id) { sql += " AND s.client_id = ?"; params.push(client_id); }
    if (status) { sql += " AND s.status = ?"; params.push(status); }
    if (maturity_from) { sql += " AND s.maturity_date >= ?"; params.push(maturity_from); }
    if (maturity_to) { sql += " AND s.maturity_date <= ?"; params.push(maturity_to); }
    if (search) {
      sql += " AND (s.share_number LIKE ? OR c.full_name LIKE ? OR c.cpf LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    sql += " ORDER BY cd.name, s.id";
    const result = (await conn.execute(sql, params)).fetchall();
    return sortBy(result, (r) => [dget(r, "condominium_name", ""), share_number_sort_key(r.share_number)]);
  } finally { await conn.close(); }
}

/** Inativa uma cota com data de retirada obrigatória. */
export async function deactivate_share(share_id: number, withdrawal_date: string, user_note = "",
  accrual_until_withdrawal = false): Promise<boolean> {
  const wd = String(ou(withdrawal_date, "")).trim();
  if (!wd) throw new ValueError("Data de retirada é obrigatória para inativar a cota.");
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  if (old.status === "inativa") throw new ValueError(`A cota ${old.share_number} já está inativa.`);
  const acq = String(ou(dget(old, "acquisition_date"), "")).trim();
  if (acq && wd < acq) {
    throw new ValueError(`A data de retirada (${wd}) não pode ser anterior à data de aquisição (${acq}).`);
  }
  const conn = await get_connection();
  try {
    const prop_flag = pyb(accrual_until_withdrawal) ? 1 : 0;
    await conn.execute(
      `UPDATE shares SET status='inativa', withdrawal_date=?,
               accrual_until_withdrawal=?,
               updated_at=datetime('now','localtime') WHERE id=?`,
      [wd, prop_flag, share_id],
    );
    await conn.commit();
    const old_val = pyJsonDumps({
      status: old.status, withdrawal_date: dget(old, "withdrawal_date"),
      accrual_until_withdrawal: ou(dget(old, "accrual_until_withdrawal"), 0),
    });
    const new_val = pyJsonDumps({ status: "inativa", withdrawal_date: wd, accrual_until_withdrawal: prop_flag });
    const nota_prop = prop_flag
      ? " | PROPORCIONAL ATE A RETIRADA LIGADO: a cota ainda rende ate o dia anterior a data de retirada na apuracao do periodo."
      : "";
    await _log(conn, "shares", share_id, "DEACTIVATE", old_val, new_val,
      (user_note || "Cota inativada com data de retirada") + nota_prop);
    await conn.commit();
    logger.info(`deactivate_share: cota id=${share_id} inativada withdrawal_date=${wd} accrual_until_withdrawal=${prop_flag}`);
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`deactivate_share rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Reativa uma cota (status = ativa) e limpa withdrawal_date. */
export async function reactivate_share(share_id: number, user_note = ""): Promise<boolean> {
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  const conn = await get_connection();
  try {
    await conn.execute(
      `UPDATE shares SET status='ativa', withdrawal_date=NULL,
               withdrawal_requested=0, withdrawal_request_date=NULL,
               withdrawal_effective_date=NULL, withdrawal_notes=NULL,
               accrual_until_withdrawal=0,
               updated_at=datetime('now','localtime') WHERE id=?`,
      [share_id],
    );
    await conn.commit();
    const old_val = pyJsonDumps({
      status: old.status, withdrawal_date: dget(old, "withdrawal_date"),
      withdrawal_requested: ou(dget(old, "withdrawal_requested"), 0),
    });
    await _log(conn, "shares", share_id, "REACTIVATE", old_val,
      '{"status": "ativa", "withdrawal_date": null, "withdrawal_requested": 0}',
      user_note || "Cota reativada — dados de retirada removidos");
    await conn.commit();
    logger.info(`reactivate_share: cota id=${share_id} reativada, withdrawal_date limpo`);
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`reactivate_share rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

function _maiorInteiro(rows: Row[]): number {
  let max_int = 0;
  for (const row of rows) {
    const num = pyStr(v0(row)).trim();
    try {
      const val = pyInt(num);
      if (val > max_int) max_int = val;
    } catch { /* ignora "1.12", "A1", etc. */ }
  }
  return max_int;
}

/** Sugere o próximo número simples (inteiro) de cota para o produto. */
export async function suggest_next_share_number(condominium_id: number): Promise<string> {
  const conn = await get_connection();
  let rows: Row[];
  try {
    rows = (await conn.execute("SELECT share_number FROM shares WHERE condominium_id=?", [condominium_id])).fetchall();
  } finally { await conn.close(); }
  return String(_maiorInteiro(rows) + 1);
}

/** True se a cota foi usada em algum cálculo mensal salvo. */
export async function share_has_monthly_calculations(share_id: number): Promise<boolean> {
  const conn = await get_connection();
  try {
    const row = (await conn.execute("SELECT COUNT(*) FROM monthly_calculation_items WHERE share_id = ?", [share_id])).fetchone();
    return row ? v0(row) > 0 : false;
  } catch {
    return false;
  } finally { await conn.close(); }
}

/** Exclui permanentemente uma cota (bloqueia se tiver cálculos mensais). */
export async function delete_share(share_id: number, user_note = "Cota excluída por correção de cadastro"): Promise<boolean> {
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  if (await share_has_monthly_calculations(share_id)) {
    throw new ValueError(
      `A cota ${old.share_number} possui cálculos mensais vinculados e não pode ser excluída. ` +
      "Use Inativar para registrar a saída do cotista.",
    );
  }
  const conn = await get_connection();
  try {
    const old_json = pyJsonDumps({ ...old });
    await _log(conn, "shares", share_id, "DELETE", old_json, null, user_note);
    await conn.execute("DELETE FROM shares WHERE id = ?", [share_id]);
    await conn.commit();
    logger.info(`delete_share: cota id=${share_id} num=${pyStr(dget(old, "share_number"))} excluída.`);
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`delete_share rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Sugere os próximos `qty` números inteiros de cota para o produto. */
export async function suggest_next_share_numbers(condominium_id: number, qty: any): Promise<string[]> {
  const conn = await get_connection();
  let rows: Row[];
  try {
    rows = (await conn.execute("SELECT share_number FROM shares WHERE condominium_id=?", [condominium_id])).fetchall();
  } finally { await conn.close(); }
  const max_int = _maiorInteiro(rows);
  const n = Math.max(1, pyInt(qty));
  return Array.from({ length: n }, (_, i) => String(max_int + i + 1));
}

/** Cria múltiplas cotas em uma única transação atômica. Retorna os IDs. */
export async function create_multiple_shares(
  condominium_id: number, client_id: number, share_numbers: any[], share_value: number, acquisition_date: string,
  maturity_date = "", last_renewal_date = "", status = "ativa", notes = "", allow_duplicate_share_number = false,
  share_values: any[] | null = null, acquisition_dates: any[] | null = null, maturity_dates: any[] | null = null,
  last_renewal_dates: any[] | null = null,
): Promise<number[]> {
  const nums = share_numbers.map((n) => pyStr(n).trim()).filter((n) => n);
  if (!nums.length) throw new ValueError("Nenhum número de cota informado.");
  if (!allow_duplicate_share_number) {
    const seen = new Set<string>();
    for (const n of nums) {
      if (seen.has(n)) throw new ValueError(`Número de cota duplicado na lista: ${n}.`);
      seen.add(n);
    }
  }
  const note_prefix = allow_duplicate_share_number ? "[Lançamento histórico: número repetido permitido] " : "";
  const effective_notes = (note_prefix + (notes || "")).trim();

  const _pick = (lst: any[] | null, i: number, def: any): string => {
    if (lst && lst.length && i < lst.length && String(ou(lst[i], "")).trim()) return String(lst[i]).trim();
    return def || "";
  };

  const conn = await get_connection();
  try {
    if (!allow_duplicate_share_number) {
      for (const n of nums) {
        const row = (await conn.execute("SELECT id FROM shares WHERE condominium_id=? AND share_number=?", [condominium_id, n])).fetchone();
        if (row) throw new ValueError(`Cota ${n} já existe neste produto.`);
      }
    }
    const new_ids: number[] = [];
    for (let idx = 0; idx < nums.length; idx++) {
      const n = nums[idx];
      let sv: number = share_value;
      if (share_values && share_values.length && idx < share_values.length) {
        try {
          sv = pyFloat(share_values[idx]);
          if (sv <= 0) sv = share_value;
        } catch (e) {
          if (!ehTypeOuValue(e)) throw e;
          sv = share_value;
        }
      }
      const acq = _pick(acquisition_dates, idx, acquisition_date);
      const mat = _pick(maturity_dates, idx, maturity_date);
      const lrd = _pick(last_renewal_dates, idx, last_renewal_date);
      const cur = await conn.execute(
        "INSERT INTO shares " +
        "(condominium_id, client_id, share_number, share_value," +
        " acquisition_date, maturity_date, last_renewal_date, status, notes)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [condominium_id, client_id, n, sv, acq, mat, lrd, status, effective_notes],
      );
      new_ids.push(cur.lastrowid!);
    }
    const audit_note = allow_duplicate_share_number ? "Lançamento histórico com número de cota repetido permitido manualmente." : "";
    for (let idx2 = 0; idx2 < Math.min(new_ids.length, nums.length); idx2++) {
      const nid = new_ids[idx2], n = nums[idx2];
      const sv2 = share_values && share_values.length && idx2 < share_values.length ? pyFloat(share_values[idx2]) : share_value;
      const acq2 = _pick(acquisition_dates, idx2, acquisition_date);
      const mat2 = _pick(maturity_dates, idx2, maturity_date);
      const lrd2 = _pick(last_renewal_dates, idx2, last_renewal_date);
      await _log(conn, "shares", nid, "INSERT", null,
        `cond=${pyStr(condominium_id)} client=${pyStr(client_id)} num=${n} val=${typeof sv2 === "number" ? pyFloatRepr(sv2) : pyStr(sv2)} acq=${acq2} mat=${mat2} lrd=${lrd2}`,
        audit_note);
    }
    await conn.commit();
    logger.info(`create_multiple_shares: ${new_ids.length} cotas criadas`);
    return new_ids;
  } catch (exc) {
    await conn.rollback();
    logger.error(`create_multiple_shares rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

export async function get_shares_summary(): Promise<Record<string, any>> {
  const conn = await get_connection();
  try {
    const total = v0((await conn.execute("SELECT COUNT(*) FROM shares")).fetchone());
    const ativas = v0((await conn.execute("SELECT COUNT(*) FROM shares WHERE status='ativa'")).fetchone());
    const pendentes = v0((await conn.execute("SELECT COUNT(*) FROM shares WHERE status='pendente'")).fetchone());
    const inativas = v0((await conn.execute("SELECT COUNT(*) FROM shares WHERE status='inativa'")).fetchone());
    const valor_total = v0((await conn.execute("SELECT COALESCE(SUM(share_value::numeric)::float8,0) FROM shares WHERE status='ativa'")).fetchone());
    const por_produto = (await conn.execute(
      "SELECT cd.name, cd.code, COUNT(s.id) AS qty," +
      " COALESCE(SUM(s.share_value::numeric)::float8,0) AS total_value" +
      " FROM condominiums cd" +
      " LEFT JOIN shares s ON s.condominium_id=cd.id AND s.status='ativa'" +
      " GROUP BY cd.id ORDER BY cd.id",
    )).fetchall();
    return { total, ativas, pendentes, inativas, valor_total, por_produto };
  } finally { await conn.close(); }
}

/** Resumo executivo para o dashboard. */
export async function get_dashboard_summary(): Promise<Record<string, any>> {
  const conn = await get_connection();
  try {
    const total_clients = v0((await conn.execute("SELECT COUNT(*) FROM clients WHERE status='ativo'")).fetchone());
    const total_shares = v0((await conn.execute("SELECT COUNT(*) FROM shares WHERE status='ativa'")).fetchone());
    const valor_total = v0((await conn.execute("SELECT COALESCE(SUM(share_value::numeric)::float8,0) FROM shares WHERE status='ativa'")).fetchone());
    const last_calc = (await conn.execute(
      "SELECT * FROM monthly_calculations " +
      "ORDER BY calculation_year DESC, calculation_month DESC, id LIMIT 1",
    )).fetchone();
    return { total_clients, total_shares, valor_total, last_calculation: last_calc ? { ...last_calc } : null };
  } finally { await conn.close(); }
}

/** Logs de auditoria com filtros opcionais. */
export async function get_audit_logs(limit = 200, entity_type = "", action = ""): Promise<Row[]> {
  const conn = await get_connection();
  try {
    const conditions: string[] = [];
    const params: any[] = [];
    if (entity_type) { conditions.push("entity_type = ?"); params.push(entity_type); }
    if (action) { conditions.push("action = ?"); params.push(action); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    return (await conn.execute(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id LIMIT ?`, [...params, limit])).fetchall();
  } finally { await conn.close(); }
}

/** Registra um backup na tabela backups. */
export async function register_backup(filename: string, filepath: string, reason = ""): Promise<void> {
  const conn = await get_connection();
  try {
    await conn.execute("INSERT INTO backups (file_name, file_path, reason) VALUES (?, ?, ?)", [filename, filepath, reason]);
    await conn.commit();
  } catch {
    await conn.rollback();
  } finally { await conn.close(); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  IMPORTAÇÃO DE CLIENTES VIA PLANILHA
// ─────────────────────────────────────────────────────────────────────────────

/** Já existe cliente com o CPF/CNPJ informado (limpo, sem máscara)? */
export async function client_exists_by_document(document: string): Promise<boolean> {
  const doc_clean = _limpaDoc(document);
  if (!doc_clean) return false;
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT id FROM clients WHERE cpf = ?", [doc_clean])).fetchone() !== null;
  } finally { await conn.close(); }
}

export const _STATUS_VALIDOS = new Set(["ativo", "inativo"]);
export const _TIPO_CONTA_MAP: Record<string, string> = {
  "corrente": "Corrente",
  "poupança": "Poupança",
  "poupanca": "Poupança",
  "conta corrente": "Corrente",
  "conta poupança": "Poupança",
  "conta poupanca": "Poupança",
};

const _s = (v: any) => pyStr(ou(v, "")).trim();

/** Importa clientes a partir das linhas da planilha; devolve o resultado por linha. */
export async function import_clients_from_rows(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
  const resultados: Record<string, any>[] = [];
  for (const item of rows) {
    const linha = dget(item, "_linha", "?");
    const nome = _s(dget(item, "nome_completo"));
    const doc_raw = _s(dget(item, "cpf_cnpj"));
    if (!nome) {
      resultados.push({ linha, nome: "(vazio)", cpf_cnpj: doc_raw, resultado: "Erro", mensagem: "Nome obrigatório — linha ignorada" });
      continue;
    }
    const doc_clean = _limpaDoc(doc_raw);
    if (doc_clean && await client_exists_by_document(doc_clean)) {
      resultados.push({ linha, nome, cpf_cnpj: doc_raw, resultado: "Ignorado", mensagem: "CPF/CNPJ já cadastrado" });
      continue;
    }
    const status_raw = _s(dget(item, "status")).toLowerCase();
    let aviso_status = "";
    let status: string;
    if (!status_raw) status = "ativo";
    else if (_STATUS_VALIDOS.has(status_raw)) status = status_raw;
    else {
      status = "ativo";
      aviso_status = ` | Status '${status_raw}' inválido — salvo como 'ativo'`;
    }
    const tipo_raw = _s(dget(item, "tipo_conta")).toLowerCase();
    const tipo_conta = Object.prototype.hasOwnProperty.call(_TIPO_CONTA_MAP, tipo_raw) ? _TIPO_CONTA_MAP[tipo_raw] : ou(dget(item, "tipo_conta"), "");
    const data = {
      cpf: doc_clean,
      full_name: nome,
      email: _s(dget(item, "email")),
      phone: _s(dget(item, "telefone")),
      pix_key: _s(dget(item, "chave_pix")),
      status,
      notes: _s(dget(item, "observacoes")),
      bank_name: _s(dget(item, "banco")),
      bank_agency: _s(dget(item, "agencia")),
      bank_account: _s(dget(item, "conta")),
      bank_account_digit: _s(dget(item, "digito_conta")),
      bank_account_type: tipo_conta,
      bank_holder_name: _s(dget(item, "titular_conta")),
      bank_holder_document: _s(dget(item, "cpf_cnpj_titular")),
      bank_notes: _s(dget(item, "observacoes_bancarias")),
    };
    try {
      const conn = await get_connection();
      try {
        const cur = await conn.execute(..._nomeados(
          `INSERT INTO clients
                       (cpf, full_name, email, pix_key, phone, status, notes,
                        bank_name, bank_agency, bank_account, bank_account_digit,
                        bank_account_type, bank_holder_name, bank_holder_document, bank_notes)
                       VALUES
                       (:cpf, :full_name, :email, :pix_key, :phone, :status, :notes,
                        :bank_name, :bank_agency, :bank_account, :bank_account_digit,
                        :bank_account_type, :bank_holder_name, :bank_holder_document, :bank_notes)`,
          data,
        ));
        const new_id = cur.lastrowid;
        const aviso_doc = !doc_clean ? " | Sem CPF/CNPJ" : "";
        await _log(conn, "clients", new_id, "IMPORT", null, `Importado via planilha: ${nome}`, `Linha ${pyStr(linha)} da planilha de importação`);
        await conn.commit();
        resultados.push({ linha, nome, cpf_cnpj: doc_raw, resultado: "Criado", mensagem: `Cliente cadastrado com sucesso${aviso_doc}${aviso_status}` });
        logger.info(`import_clients: linha ${pyStr(linha)} — criado id=${new_id} ${nome}`);
      } catch (exc) {
        await conn.rollback();
        throw exc;
      } finally { await conn.close(); }
    } catch (exc) {
      logger.error(`import_clients: linha ${pyStr(linha)} erro: ${strExc(exc)}`);
      resultados.push({ linha, nome, cpf_cnpj: doc_raw, resultado: "Erro", mensagem: strExc(exc) });
    }
  }
  return resultados;
}

/** Cotas ativas (e inativas com proporcional até a retirada) prontas para o cálculo. */
export async function get_active_shares_for_calculation(condominium_id: number | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    const params: any[] = [];
    let cond_filter = "";
    if (condominium_id) { cond_filter = " AND s.condominium_id = ?"; params.push(condominium_id); }
    return (await conn.execute(
      `SELECT
                    s.id, s.condominium_id, s.client_id,
                    s.share_number, s.share_value,
                    s.acquisition_date, s.maturity_date,
                    s.last_renewal_date, s.withdrawal_date,
                    s.accrual_until_withdrawal,
                    s.status, s.notes,
                    c.full_name  AS client_name,
                    c.cpf        AS client_cpf,
                    c.pix_key    AS client_pix,
                    cd.code      AS condominium_code,
                    cd.name      AS condominium_name
                FROM shares s
                JOIN clients    c  ON c.id  = s.client_id
                JOIN condominiums cd ON cd.id = s.condominium_id
                WHERE (
                        s.status = 'ativa'
                        OR (
                            COALESCE(s.accrual_until_withdrawal, 0) = 1
                            AND s.withdrawal_date IS NOT NULL
                            AND TRIM(s.withdrawal_date) <> ''
                        )
                      )${cond_filter}
                ORDER BY cd.id, c.full_name, s.share_number, s.id`,
      params,
    )).fetchall();
  } finally { await conn.close(); }
}

/** Apuração já salva para mês/ano/produto (ou null). */
export async function check_duplicate_calculation(year: number, month: number, condominium_id: number | null = null): Promise<Row | null> {
  const conn = await get_connection();
  try {
    if (condominium_id) {
      return (await conn.execute(
        `SELECT mc.*, cd.name AS condominium_name
                   FROM monthly_calculations mc
                   LEFT JOIN condominiums cd ON cd.id = mc.condominium_id
                   WHERE mc.calculation_year = ? AND mc.calculation_month = ?
                     AND mc.condominium_id = ?
                   ORDER BY mc.id DESC LIMIT 1`,
        [year, month, condominium_id],
      )).fetchone();
    }
    return (await conn.execute(
      `SELECT mc.*, cd.name AS condominium_name
                   FROM monthly_calculations mc
                   LEFT JOIN condominiums cd ON cd.id = mc.condominium_id
                   WHERE mc.calculation_year = ? AND mc.calculation_month = ?
                     AND mc.condominium_id IS NULL
                   ORDER BY mc.id DESC LIMIT 1`,
      [year, month],
    )).fetchone();
  } finally { await conn.close(); }
}

const _mes2 = (m: any) => pyFormat("{:02d}", Number(m));

/** Salva apuração mensal e itens em uma transação atômica. Retorna o ID. */
export async function save_monthly_calculation(
  year: number, month: number, condominium_id: number | null, agro_special_rate: any, items: any[], notes = "",
): Promise<number> {
  let total: number = 0;
  for (const i of items) total += Number(i.income_value);
  const conn = await get_connection();
  try {
    const cur = await conn.execute(
      `INSERT INTO monthly_calculations
               (calculation_month, calculation_year, condominium_id,
                agro_special_rate, calculated_at, notes)
               VALUES (?, ?, ?, ?, datetime('now','localtime'), ?)`,
      [month, year, condominium_id, pyb(agro_special_rate) ? pyFloat(agro_special_rate) : null, notes],
    );
    const calc_id = cur.lastrowid!;
    for (const item of items) {
      await conn.execute(
        `INSERT INTO monthly_calculation_items
                   (monthly_calculation_id, share_id, client_id, condominium_id,
                    period_start, period_end, active_days, total_period_days,
                    applied_rate, share_value, income_value, calculation_details)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        _params([calc_id, item.share_id, item.client_id, item.condominium_id, item.period_start, item.period_end,
          item.active_days, item.total_period_days, item.applied_rate, item.share_value, item.income_value,
          item.calculation_details]),
      );
    }
    const note_txt =
      `Apuração ${_mes2(month)}/${year} | ` +
      `produto=${!condominium_id ? "todos" : condominium_id} | ` +
      `cotas=${items.length} | total=R$ ${pyFormat("{:,.2f}", total)}`;
    await _log(conn, "monthly_calculations", calc_id, "INSERT", null, note_txt, notes);
    await conn.commit();
    logger.info(`save_monthly_calculation: id=${calc_id} ${month}/${year} itens=${items.length}`);
    return calc_id;
  } catch (exc) {
    await conn.rollback();
    logger.error(`save_monthly_calculation rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Exclui uma apuração salva e todos os seus itens. Lança ValueError se não existir. */
export async function delete_monthly_calculation(calculation_id: number): Promise<Row> {
  const conn = await get_connection();
  try {
    const row = (await conn.execute(
      `SELECT mc.id, mc.calculation_month, mc.calculation_year,
                      mc.condominium_id, mc.agro_special_rate, mc.calculated_at,
                      cd.name AS condominium_name,
                      COUNT(mci.id) AS qty_items,
                      COALESCE(SUM(mci.income_value::numeric)::float8, 0) AS total_income
               FROM monthly_calculations mc
               LEFT JOIN condominiums cd ON cd.id = mc.condominium_id
               LEFT JOIN monthly_calculation_items mci ON mci.monthly_calculation_id = mc.id
               WHERE mc.id = ?
               GROUP BY mc.id, cd.name`,
      [calculation_id],
    )).fetchone();
    if (!row) throw new ValueError(`Apuração ID ${calculation_id} não encontrada.`);
    const resumo: Row = { ...row };
    const old_value =
      `${_mes2(resumo.calculation_month)}/${resumo.calculation_year} | ` +
      `produto=${pyStr(ou(resumo.condominium_name, "todos"))} | ` +
      `itens=${resumo.qty_items} | ` +
      `total=R$ ${pyFormat("{:,.2f}", resumo.total_income)} | ` +
      `salvo em ${pyStr(resumo.calculated_at)}`;
    await conn.execute("DELETE FROM monthly_calculation_items WHERE monthly_calculation_id = ?", [calculation_id]);
    await conn.execute("DELETE FROM monthly_calculations WHERE id = ?", [calculation_id]);
    await _log(conn, "monthly_calculation", calculation_id, "delete", old_value, null, "Apuração excluída do histórico");
    await conn.commit();
    logger.info(`delete_monthly_calculation: id=${calculation_id} ${_mes2(resumo.calculation_month)}/${resumo.calculation_year}`);
    return resumo;
  } catch (exc) {
    await conn.rollback();
    logger.error(`delete_monthly_calculation rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Cabeçalho + itens enriquecidos de uma apuração salva (ou null). */
export async function get_monthly_calculation_detail(calculation_id: number): Promise<{ header: Row; items: Row[] } | null> {
  const conn = await get_connection();
  try {
    const header = (await conn.execute(
      `SELECT mc.*, cd.name AS condominium_name, cd.code AS condominium_code
               FROM monthly_calculations mc
               LEFT JOIN condominiums cd ON cd.id = mc.condominium_id
               WHERE mc.id = ?`,
      [calculation_id],
    )).fetchone();
    if (!header) return null;
    const items = (await conn.execute(
      `SELECT mci.*,
                      c.full_name AS client_name, c.cpf AS client_cpf,
                      c.pix_key AS client_pix, c.email AS client_email,
                      cd.name AS condominium_name, cd.code AS condominium_code,
                      s.share_number, s.acquisition_date, s.maturity_date,
                      s.last_renewal_date
               FROM monthly_calculation_items mci
               JOIN clients c ON c.id = mci.client_id
               JOIN condominiums cd ON cd.id = mci.condominium_id
               JOIN shares s ON s.id = mci.share_id
               WHERE mci.monthly_calculation_id = ?
               ORDER BY cd.name, c.full_name, mci.id`,
      [calculation_id],
    )).fetchall();
    return { header: { ...header }, items };
  } finally { await conn.close(); }
}

/** Atualiza notas e itens de uma apuração salva (valida tudo antes de gravar). */
export async function update_monthly_calculation(calculation_id: number, notes: string, item_updates: Record<string, any>[]): Promise<void> {
  const conn = await get_connection();
  try {
    const header = (await conn.execute("SELECT * FROM monthly_calculations WHERE id = ?", [calculation_id])).fetchone();
    if (!header) throw new ValueError(`Apuração ID ${calculation_id} não encontrada.`);
    const somaSql = "SELECT COALESCE(SUM(income_value::numeric)::float8,0) FROM monthly_calculation_items WHERE monthly_calculation_id = ?";
    const old_total = v0((await conn.execute(somaSql, [calculation_id])).fetchone());
    const old_value = `${_mes2(header.calculation_month)}/${header.calculation_year} | ` +
      `notas=${pyStr(ou(header.notes, ""))} | total=R$ ${pyFormat("{:,.2f}", old_total)}`;

    for (const upd of item_updates) {
      const item_id = upd.id;
      const sv = pyFloat(dget(upd, "share_value", 0));
      const ad = pyInt(dget(upd, "active_days", 0));
      const tpd = pyInt(dget(upd, "total_period_days", 1));
      const ar = pyFloat(dget(upd, "applied_rate", 0));
      const iv = pyFloat(dget(upd, "income_value", 0));
      if (sv < 0) throw new ValueError(`Item ${pyStr(item_id)}: Valor da cota não pode ser negativo.`);
      if (ad < 0) throw new ValueError(`Item ${pyStr(item_id)}: Dias ativos não pode ser negativo.`);
      if (tpd <= 0) throw new ValueError(`Item ${pyStr(item_id)}: Total de dias deve ser > 0.`);
      if (ad > tpd) throw new ValueError(`Item ${pyStr(item_id)}: Dias ativos (${ad}) > total de dias (${tpd}).`);
      if (ar < 0) throw new ValueError(`Item ${pyStr(item_id)}: Taxa aplicada não pode ser negativa.`);
      if (iv < 0) throw new ValueError(`Item ${pyStr(item_id)}: Rendimento não pode ser negativo.`);
    }
    await conn.execute("UPDATE monthly_calculations SET notes = ? WHERE id = ?", [notes, calculation_id]);
    for (const upd of item_updates) {
      await conn.execute(
        `UPDATE monthly_calculation_items
                   SET share_value         = ?,
                       active_days         = ?,
                       total_period_days   = ?,
                       applied_rate        = ?,
                       income_value        = ?,
                       calculation_details = ?
                   WHERE id = ? AND monthly_calculation_id = ?`,
        [
          pyFloat(dget(upd, "share_value", 0)), pyInt(dget(upd, "active_days", 0)), pyInt(dget(upd, "total_period_days", 1)),
          pyFloat(dget(upd, "applied_rate", 0)), pyFloat(dget(upd, "income_value", 0)), dget(upd, "calculation_details", ""),
          upd.id, calculation_id,
        ],
      );
    }
    const new_total = v0((await conn.execute(somaSql, [calculation_id])).fetchone());
    const new_value = `${_mes2(header.calculation_month)}/${header.calculation_year} | ` +
      `notas=${notes || ""} | total=R$ ${pyFormat("{:,.2f}", new_total)}`;
    await _log(conn, "monthly_calculation", calculation_id, "update", old_value, new_value, "Apuração editada manualmente");
    await conn.commit();
    logger.info(`update_monthly_calculation: id=${calculation_id}`);
  } catch (exc) {
    await conn.rollback();
    logger.error(`update_monthly_calculation rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VENCIMENTOS E RETIRADAS
// ─────────────────────────────────────────────────────────────────────────────

/** Renova uma cota: atualiza last_renewal_date e maturity_date (audit RENEW). */
export async function renew_share(share_id: number, renewal_date: string, maturity_date: string, user_note = ""): Promise<boolean> {
  const rd = String(ou(renewal_date, "")).trim();
  const md = String(ou(maturity_date, "")).trim();
  if (!rd) throw new ValueError("Data de renovação é obrigatória.");
  if (!md) throw new ValueError("Novo vencimento é obrigatório.");
  if (md < rd) throw new ValueError(`O novo vencimento (${md}) não pode ser anterior à data de renovação (${rd}).`);
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  if (old.status !== "ativa") throw new ValueError(`A cota ${old.share_number} não está ativa e não pode ser renovada.`);
  const conn = await get_connection();
  try {
    await conn.execute(
      `UPDATE shares SET last_renewal_date=?, maturity_date=?,
               updated_at=datetime('now','localtime') WHERE id=?`,
      [rd, md, share_id],
    );
    const old_val = pyJsonDumps({ last_renewal_date: dget(old, "last_renewal_date"), maturity_date: dget(old, "maturity_date"), status: old.status });
    const new_val = pyJsonDumps({ last_renewal_date: rd, maturity_date: md, status: "ativa" });
    await _log(conn, "shares", share_id, "RENEW", old_val, new_val, user_note || `Cota ${old.share_number} renovada — novo vencimento ${md}`);
    await conn.commit();
    logger.info(`renew_share: cota id=${share_id} renovada em ${rd}, vencimento ${md}`);
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`renew_share rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Marca pedido de retirada (a cota continua ativa). */
export async function request_withdrawal(share_id: number, request_date: string, effective_date: string,
  withdrawal_notes = "", user_note = ""): Promise<boolean> {
  const rqd = String(ou(request_date, "")).trim();
  const eff = String(ou(effective_date, "")).trim();
  if (!rqd) throw new ValueError("Data do pedido de retirada é obrigatória.");
  if (!eff) throw new ValueError("Data efetiva da retirada é obrigatória.");
  if (eff < rqd) throw new ValueError(`A data efetiva (${eff}) não pode ser anterior à data do pedido (${rqd}).`);
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  if (old.status !== "ativa") throw new ValueError(`A cota ${old.share_number} não está ativa.`);
  if (pyb(dget(old, "withdrawal_requested"))) throw new ValueError(`A cota ${old.share_number} já está em retirada.`);
  const conn = await get_connection();
  try {
    await conn.execute(
      `UPDATE shares SET withdrawal_requested=1,
               withdrawal_request_date=?, withdrawal_effective_date=?,
               withdrawal_notes=?,
               updated_at=datetime('now','localtime') WHERE id=?`,
      [rqd, eff, withdrawal_notes || "", share_id],
    );
    const old_val = pyJsonDumps({ withdrawal_requested: ou(dget(old, "withdrawal_requested"), 0), status: old.status });
    const new_val = pyJsonDumps({ withdrawal_requested: 1, withdrawal_request_date: rqd, withdrawal_effective_date: eff, status: "ativa" });
    await _log(conn, "shares", share_id, "WITHDRAWAL_REQUEST", old_val, new_val,
      user_note || `Retirada solicitada — efetiva em ${eff}. Cota permanece ativa até lá.`);
    await conn.commit();
    logger.info(`request_withdrawal: cota id=${share_id} retirada solicitada, efetiva ${eff}`);
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`request_withdrawal rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Ajusta a data efetiva de uma retirada já solicitada. */
export async function update_withdrawal_effective_date(share_id: number, effective_date: string, user_note = ""): Promise<boolean> {
  const eff = String(ou(effective_date, "")).trim();
  if (!eff) throw new ValueError("Data efetiva da retirada é obrigatória.");
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  if (!pyb(dget(old, "withdrawal_requested"))) throw new ValueError(`A cota ${old.share_number} não possui retirada solicitada.`);
  const conn = await get_connection();
  try {
    await conn.execute(
      `UPDATE shares SET withdrawal_effective_date=?,
               updated_at=datetime('now','localtime') WHERE id=?`,
      [eff, share_id],
    );
    await _log(conn, "shares", share_id, "WITHDRAWAL_UPDATE",
      pyJsonDumps({ withdrawal_effective_date: dget(old, "withdrawal_effective_date") }),
      pyJsonDumps({ withdrawal_effective_date: eff }),
      user_note || "Data efetiva da retirada alterada");
    await conn.commit();
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`update_withdrawal_effective_date rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Cancela um pedido de retirada (a cota segue ativa). */
export async function cancel_withdrawal(share_id: number, user_note = ""): Promise<boolean> {
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  if (!pyb(dget(old, "withdrawal_requested"))) throw new ValueError(`A cota ${old.share_number} não possui retirada solicitada.`);
  const conn = await get_connection();
  try {
    await conn.execute(
      `UPDATE shares SET withdrawal_requested=0,
               withdrawal_request_date=NULL, withdrawal_effective_date=NULL,
               withdrawal_notes=NULL,
               updated_at=datetime('now','localtime') WHERE id=?`,
      [share_id],
    );
    await _log(conn, "shares", share_id, "WITHDRAWAL_CANCEL",
      pyJsonDumps({ withdrawal_requested: 1, withdrawal_effective_date: dget(old, "withdrawal_effective_date") }),
      '{"withdrawal_requested": 0}',
      user_note || "Pedido de retirada cancelado");
    await conn.commit();
    logger.info(`cancel_withdrawal: cota id=${share_id} retirada cancelada`);
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`cancel_withdrawal rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Finaliza a retirada: inativa a cota (withdrawal_date = data efetiva). */
export async function finalize_withdrawal(share_id: number, user_note = ""): Promise<boolean> {
  const old = await get_share_by_id(share_id);
  if (!old) return false;
  if (!pyb(dget(old, "withdrawal_requested"))) throw new ValueError(`A cota ${old.share_number} não possui retirada solicitada.`);
  if (old.status !== "ativa") throw new ValueError(`A cota ${old.share_number} não está ativa.`);
  const eff = String(ou(dget(old, "withdrawal_effective_date"), "")).trim();
  if (!eff) throw new ValueError(`A cota ${old.share_number} não possui data efetiva de retirada definida.`);
  const conn = await get_connection();
  try {
    await conn.execute(
      `UPDATE shares SET status='inativa', withdrawal_date=?,
               updated_at=datetime('now','localtime') WHERE id=?`,
      [eff, share_id],
    );
    const old_val = pyJsonDumps({ status: old.status, withdrawal_date: dget(old, "withdrawal_date"), withdrawal_effective_date: eff });
    const new_val = pyJsonDumps({ status: "inativa", withdrawal_date: eff });
    await _log(conn, "shares", share_id, "WITHDRAWAL_FINALIZE", old_val, new_val,
      user_note || `Retirada finalizada — cota inativada com retirada em ${eff}`);
    await conn.commit();
    logger.info(`finalize_withdrawal: cota id=${share_id} inativada, retirada ${eff}`);
    return true;
  } catch (exc) {
    await conn.rollback();
    logger.error(`finalize_withdrawal rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Atualiza vários cadastros de cota de uma vez (cada um com seu audit log). */
export async function update_shares_batch(items: Record<string, any>[], allow_duplicate = false): Promise<{ success: any[]; errors: any[] }> {
  const result: { success: any[]; errors: any[] } = { success: [], errors: [] };
  for (const item of items) {
    const data: Record<string, any> = { ...item };
    let sid: any = dget(data, "id", null);
    delete data.id;
    try {
      sid = pyInt(sid);
    } catch (e) {
      if (!ehTypeOuValue(e)) throw e;
      result.errors.push({ share_id: sid, share_number: "?", error: "ID de cota inválido." });
      continue;
    }
    const cota = await get_share_by_id(sid);
    if (!cota) {
      result.errors.push({ share_id: sid, share_number: String(sid), error: "Cota não encontrada." });
      continue;
    }
    const share_label = ou(dget(data, "share_number"), cota.share_number);
    try {
      await update_share(sid, data, allow_duplicate);
      result.success.push(share_label);
    } catch (exc) {
      if (exc instanceof ValueError) {
        result.errors.push({ share_id: sid, share_number: share_label, error: strExc(exc) });
      } else {
        logger.error(`update_shares_batch: erro inesperado na cota ${sid}: ${strExc(exc)}`);
        result.errors.push({ share_id: sid, share_number: share_label, error: "Erro inesperado ao salvar a cota." });
      }
    }
  }
  return result;
}

/** Renova várias cotas de uma vez (renew_share em loop). */
export async function renew_shares_batch(share_ids: number[], renewal_date: string, new_maturity_date: string, notes = ""): Promise<{ success: any[]; errors: any[] }> {
  const result: { success: any[]; errors: any[] } = { success: [], errors: [] };
  for (const sid of share_ids) {
    const cota = await get_share_by_id(sid);
    const share_label = cota ? cota.share_number : String(sid);
    try {
      await renew_share(sid, renewal_date, new_maturity_date, notes || "Renovação em lote via tela Vencimentos e Retiradas");
      result.success.push(share_label);
    } catch (exc) {
      if (exc instanceof ValueError) result.errors.push({ share_id: sid, share_number: share_label, error: strExc(exc) });
      else {
        logger.error(`renew_shares_batch: erro inesperado na cota ${sid}: ${strExc(exc)}`);
        result.errors.push({ share_id: sid, share_number: share_label, error: "Erro inesperado ao renovar." });
      }
    }
  }
  return result;
}

/** Marca retirada em várias cotas de uma vez (request_withdrawal em loop). */
export async function mark_withdrawal_batch(share_ids: number[], request_date: string, effective_date: string, notes = ""): Promise<{ success: any[]; errors: any[] }> {
  const result: { success: any[]; errors: any[] } = { success: [], errors: [] };
  for (const sid of share_ids) {
    const cota = await get_share_by_id(sid);
    const share_label = cota ? cota.share_number : String(sid);
    try {
      await request_withdrawal(sid, request_date, effective_date, notes, "Retirada em lote via tela Vencimentos e Retiradas");
      result.success.push(share_label);
    } catch (exc) {
      if (exc instanceof ValueError) result.errors.push({ share_id: sid, share_number: share_label, error: strExc(exc) });
      else {
        logger.error(`mark_withdrawal_batch: erro inesperado na cota ${sid}: ${strExc(exc)}`);
        result.errors.push({ share_id: sid, share_number: share_label, error: "Erro inesperado ao marcar retirada." });
      }
    }
  }
  return result;
}

// ── Modelo de comunicação de vencimento/renovação, por produto ──
export const COND_DISPLAY_NAME: Record<string, string> = { civil: "Construção Civil", agro: "Agronegócio", saude: "Saúde" };
export const COND_SECTOR_NAME: Record<string, string> = { civil: "construção civil", agro: "agronegócio", saude: "saúde" };
export const COND_RENEWAL_TERM: Record<string, string> = { civil: "6 meses", agro: "6 meses", saude: "12 meses" };

const _temChave = (o: Record<string, any>, k: any) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

/** Monta assunto/corpo do e-mail de vencimento/renovação (apenas texto). */
export function _build_renewal_email(client_name: string, condominium_display: string, sector_name: string,
  renewal_term: string, maturity_dates_text: string, total_value_fmt: string): [string, string] {
  const subject = `Vencimento de cotas - Condomínio ${condominium_display}`;
  const body =
    `Prezado(a) Sr.(a) ${client_name},\n\n` +
    "Espero que esteja bem.\n\n" +
    `Comunicamos que, no dia ${maturity_dates_text}, ocorre o vencimento do contrato ` +
    `referente às suas cotas no Condomínio ${condominium_display}.\n\n` +
    `Valor total investido: ${total_value_fmt}\n\n` +
    "Este é um momento oportuno para avaliarmos a continuidade da sua estratégia " +
    `patrimonial dentro do setor ${sector_name}, que permanece apresentando consistência ` +
    "operacional, previsibilidade produtiva e fundamentos sólidos.\n\n" +
    "Caso seja de seu interesse, podemos renovar o investimento por novo período de " +
    `${renewal_term}, mantendo as condições atuais e a continuidade da rentabilidade ` +
    "prevista para o próximo ciclo.\n\n" +
    "Se houver interesse em resgate, ajuste de valor ou realocação para outra oportunidade " +
    "do portfólio do Grupo Capuzzo, pedimos que nos sinalize em até 3 dias úteis, para que " +
    "possamos realizar a programação financeira adequada.\n\n" +
    "Na ausência de manifestação dentro desse prazo, será realizada a renovação automática, " +
    "assegurando a continuidade da estratégia de investimento.\n\n" +
    "Permanecemos à disposição para qualquer esclarecimento ou para estruturarmos a melhor " +
    "decisão estratégica para o seu patrimônio.\n\n" +
    "Atenciosamente,\nGrupo Capuzzo";
  return [subject, body];
}

/** Consolida por cliente e condomínio as cotas vencendo no mês (prévia do e-mail; não envia nada). */
export async function get_renewal_email_preview(reference_year: number | null = null, reference_month: number | null = null,
  condominium_code: string | null = null, selected_share_ids: any[] | null = null): Promise<Record<string, any>[]> {
  const conn = await get_connection();
  try {
    const base_sql = `
            SELECT s.id, s.share_number, s.share_value, s.maturity_date,
                   s.client_id, s.condominium_id,
                   c.full_name AS client_name, c.email AS client_email,
                   c.cpf AS client_cpf, c.pix_key AS client_pix,
                   c.bank_name, c.bank_agency, c.bank_account,
                   c.bank_account_digit, c.bank_account_type, c.bank_holder_name,
                   cd.name AS condominium_name, cd.code AS condominium_code
            FROM shares s
            JOIN clients c  ON c.id  = s.client_id
            JOIN condominiums cd ON cd.id = s.condominium_id
            WHERE s.status = 'ativa'
        `;
    let rows: Row[];
    if (selected_share_ids && selected_share_ids.length) {
      const ids = selected_share_ids.map((i) => pyInt(i));
      if (!ids.length) return [];
      const placeholders = ids.map(() => "?").join(",");
      rows = (await conn.execute(base_sql + ` AND s.id IN (${placeholders}) ORDER BY s.id`, ids)).fetchall();
    } else {
      const params: any[] = [];
      let sql = base_sql + " AND s.maturity_date IS NOT NULL";
      if (condominium_code) { sql += " AND cd.code = ?"; params.push(condominium_code); }
      rows = (await conn.execute(sql + " ORDER BY s.id", params)).fetchall();
      if (reference_year && reference_month) {
        rows = rows.filter((r) => {
          const mat = parse_data(r.maturity_date);
          return mat && mat.year === reference_year && mat.month === reference_month;
        });
      }
    }

    const groups = new Map<string, any>();
    for (const r of rows) {
      const key = JSON.stringify([r.client_id, r.condominium_id]);
      let g = groups.get(key);
      if (g === undefined) {
        g = {
          client_id: r.client_id,
          client_name: r.client_name,
          email: String(ou(r.client_email, "")).trim(),
          cpf: r.client_cpf,
          pix_key: ou(r.client_pix, ""),
          bank_name: ou(r.bank_name, ""),
          bank_agency: ou(r.bank_agency, ""),
          bank_account: ou(r.bank_account, ""),
          bank_account_digit: ou(r.bank_account_digit, ""),
          bank_account_type: ou(r.bank_account_type, ""),
          bank_holder_name: ou(r.bank_holder_name, ""),
          condominium_id: r.condominium_id,
          condominium_code: r.condominium_code,
          condominium_name: r.condominium_name,
          total_shares: 0,
          total_value: 0.0,
          share_ids: [] as any[],
          share_numbers: [] as any[],
          _maturity_set: new Set<string>(),
        };
        groups.set(key, g);
      }
      g.total_shares += 1;
      g.total_value += pyFloat(ou(r.share_value, 0));
      g.share_ids.push(r.id);
      g.share_numbers.push(r.share_number);
      if (r.maturity_date) g._maturity_set.add(r.maturity_date);
    }

    let result: any[] = [];
    for (const g of groups.values()) {
      const datas_ordenadas = [...(g._maturity_set as Set<string>)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      delete g._maturity_set;
      g.maturity_dates = datas_ordenadas.map((d) => formatar_data(d));
      g.status_email = g.email ? "pronto" : "sem_email";
      const code = g.condominium_code;
      const display_name = _temChave(COND_DISPLAY_NAME, code) ? COND_DISPLAY_NAME[code] : g.condominium_name;
      const sector_name = _temChave(COND_SECTOR_NAME, code) ? COND_SECTOR_NAME[code] : (g.condominium_name ? String(g.condominium_name).toLowerCase() : "");
      const renewal_term = _temChave(COND_RENEWAL_TERM, code) ? COND_RENEWAL_TERM[code] : "12 meses";
      let maturity_dates_text: string;
      if (g.maturity_dates.length <= 1) maturity_dates_text = g.maturity_dates.length ? g.maturity_dates[0] : "—";
      else maturity_dates_text = "vencimentos em " + g.maturity_dates.join(", ");
      g.condominium_name = display_name;
      g.sector_name = sector_name;
      g.renewal_term = renewal_term;
      g.maturity_dates_text = maturity_dates_text;
      const total_value_fmt = formatar_moeda(g.total_value);
      const [subject, body] = _build_renewal_email(ou(g.client_name, ""), display_name, sector_name, renewal_term, maturity_dates_text, total_value_fmt);
      g.email_subject = subject;
      g.email_body = body;
      result.push(g);
    }
    result = sortBy(result, (g) => [ou(g.client_name, ""), ou(g.condominium_name, "")]);
    return result;
  } finally { await conn.close(); }
}

/** Registra uma tentativa de rascunho/envio de e-mail em email_logs. */
export async function log_email_attempt(client_id: number | null, condominium_code: string | null,
  reference_year: number | null, reference_month: number | null, to_email: string, subject: string, body: string,
  gmail_draft_id: string | null, status: string, notes = "", gmail_message_id: string | null = null): Promise<number> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(
      `INSERT INTO email_logs
               (client_id, condominium_code, reference_year, reference_month,
                to_email, subject, body, gmail_draft_id, gmail_message_id, status, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [client_id, condominium_code, reference_year, reference_month, to_email, subject, body, gmail_draft_id, gmail_message_id, status, notes],
    );
    await conn.commit();
    logger.info(`email_logs: registro ${cur.lastrowid} status=${status} to=${to_email}`);
    return cur.lastrowid!;
  } catch (exc) {
    await conn.rollback();
    logger.error(`log_email_attempt rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Últimas tentativas de rascunho/envio registradas. */
export async function get_email_logs(client_id: number | null = null, limit = 200): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = "SELECT * FROM email_logs";
    const params: any[] = [];
    if (client_id) { sql += " WHERE client_id = ?"; params.push(client_id); }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);
    return (await conn.execute(sql, params)).fetchall();
  } finally { await conn.close(); }
}

/** Cotas ativas para a tela Vencimentos e Retiradas. */
export async function get_shares_for_vencimentos(condominium_id: number | null = null, search: string | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `
            SELECT s.*,
                   c.full_name AS client_name, c.cpf AS client_cpf,
                   c.pix_key AS client_pix,
                   cd.name AS condominium_name, cd.code AS condominium_code
            FROM shares s
            JOIN clients c  ON c.id  = s.client_id
            JOIN condominiums cd ON cd.id = s.condominium_id
            WHERE s.status = 'ativa'
        `;
    const params: any[] = [];
    if (condominium_id) { sql += " AND s.condominium_id = ?"; params.push(condominium_id); }
    if (search) {
      const digits = soDigitos(search);
      sql += " AND (s.share_number LIKE ? OR c.full_name LIKE ? OR c.cpf LIKE ?";
      const like = `%${search}%`;
      params.push(like, like, like);
      if (digits && digits !== search) { sql += " OR c.cpf LIKE ?"; params.push(`%${digits}%`); }
      sql += ")";
    }
    const result = (await conn.execute(sql + " ORDER BY s.id", params)).fetchall();
    return sortBy(result, (r) => [ou(dget(r, "maturity_date"), "9999-99-99"), dget(r, "condominium_name", ""), share_number_sort_key(r.share_number)]);
  } finally { await conn.close(); }
}

// ── Arquivo bancário (remessa CNAB) ──────────────────────────────────────

export async function get_bank_config(bank_code: string): Promise<Row | null> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM bank_configs WHERE bank_code = ?", [bank_code])).fetchone();
  } finally { await conn.close(); }
}

/** Atualiza os dados cadastrais da conta pagadora de um banco (upsert). Nunca mexe no sequencial. */
export async function save_bank_config(bank_code: string, fields: Record<string, any>): Promise<void> {
  const allowed = new Set([
    "bank_name", "company_name", "company_document",
    "agency", "agency_digit", "account_number", "account_digit",
    "address_street", "address_number", "address_complement",
    "city", "zip_code", "state", "active", "agreement_code",
  ]);
  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) if (allowed.has(k)) updates[k] = v;
  const conn = await get_connection();
  try {
    const existing = (await conn.execute("SELECT id FROM bank_configs WHERE bank_code = ?", [bank_code])).fetchone();
    if (existing) {
      if (Object.keys(updates).length) {
        const set_clause = Object.keys(updates).map((k) => `${k} = :${k}`).join(", ");
        updates.bank_code = bank_code;
        updates.updated_at = PyDate.now().strftime("%Y-%m-%d %H:%M:%S");
        await conn.execute(..._nomeados(`UPDATE bank_configs SET ${set_clause}, updated_at = :updated_at WHERE bank_code = :bank_code`, updates));
      }
    } else {
      if (!("bank_name" in updates)) updates.bank_name = dget(fields, "bank_name", "");
      updates.bank_code = bank_code;
      const cols = Object.keys(updates).join(", ");
      const placeholders = Object.keys(updates).map((k) => `:${k}`).join(", ");
      await conn.execute(..._nomeados(`INSERT INTO bank_configs (${cols}) VALUES (${placeholders})`, updates));
    }
    await conn.commit();
    logger.info(`bank_configs: dados do banco ${bank_code} atualizados.`);
  } catch (exc) {
    await conn.rollback();
    logger.error(`save_bank_config rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** Incrementa o sequencial de remessa e devolve o valor ANTERIOR (o que deve ser usado). */
export async function increment_bank_remittance_sequence(bank_code: string): Promise<number> {
  const conn = await get_connection();
  try {
    const row = (await conn.execute("SELECT remittance_sequence FROM bank_configs WHERE bank_code = ?", [bank_code])).fetchone();
    const current = row ? row.remittance_sequence : 1;
    const new_seq = pyInt(current) + 1;
    await conn.execute(
      "UPDATE bank_configs SET remittance_sequence = ?, " +
      "updated_at = datetime('now','localtime') WHERE bank_code = ?",
      [new_seq, bank_code],
    );
    await conn.commit();
    return current;
  } catch (exc) {
    await conn.rollback();
    logger.error(`increment_bank_remittance_sequence rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

export async function create_bank_remittance_file(calculation_id: number, condominium_code: string, bank_code: string,
  bank_name: string, file_name: string, file_path: string, conference_file_path: string, payment_date: string,
  total_amount: number, total_payments: number, status = "generated", notes = ""): Promise<number> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(
      `INSERT INTO bank_remittance_files
               (calculation_id, condominium_code, bank_code, bank_name,
                file_name, file_path, conference_file_path, payment_date,
                total_amount, total_payments, status, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      _params([calculation_id, condominium_code, bank_code, bank_name, file_name, file_path, conference_file_path,
        payment_date, total_amount, total_payments, status, notes]),
    );
    await conn.commit();
    logger.info(`bank_remittance_files: registro ${cur.lastrowid} criado para apuração ${calculation_id} (${file_name})`);
    return cur.lastrowid!;
  } catch (exc) {
    await conn.rollback();
    logger.error(`create_bank_remittance_file rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

/** items: client_id, client_name, client_document, pix_key, pix_key_type, amount, status, notes, calculation_item_id. */
export async function add_bank_remittance_items(remittance_file_id: number, items: Record<string, any>[]): Promise<void> {
  const conn = await get_connection();
  try {
    for (const it of items) {
      await conn.execute(
        `INSERT INTO bank_remittance_items
                   (remittance_file_id, calculation_item_id, client_id, client_name,
                    client_document, pix_key, pix_key_type, amount, status, notes)
                   VALUES (?,?,?,?,?,?,?,?,?,?)`,
        _params([remittance_file_id, dget(it, "calculation_item_id"), dget(it, "client_id"), dget(it, "client_name"),
          dget(it, "client_document"), dget(it, "pix_key"), dget(it, "pix_key_type"), dget(it, "amount"),
          dget(it, "status", "included"), dget(it, "notes", "")]),
      );
    }
    await conn.commit();
  } catch (exc) {
    await conn.rollback();
    logger.error(`add_bank_remittance_items rollback: ${strExc(exc)}`);
    throw exc;
  } finally { await conn.close(); }
}

export async function get_bank_remittance_files(calculation_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM bank_remittance_files WHERE calculation_id = ? ORDER BY id DESC", [calculation_id])).fetchall();
  } finally { await conn.close(); }
}

export async function get_bank_remittance_file_by_id(file_id: number): Promise<Row | null> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM bank_remittance_files WHERE id = ?", [file_id])).fetchone();
  } finally { await conn.close(); }
}

export async function get_bank_remittance_items(remittance_file_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM bank_remittance_items WHERE remittance_file_id = ? ORDER BY id", [remittance_file_id])).fetchall();
  } finally { await conn.close(); }
}

// ═════════════════════════════════════════════════════════════════════════
//  TÍTULOS PRIVADOS — módulo isolado (empréstimos privados a clientes).
// ═════════════════════════════════════════════════════════════════════════

/** Clientes de títulos com quantidade de empréstimos; `search` filtra nome/documento/telefone/e-mail. */
export async function get_private_loan_clients(status: string | null = null, search: string | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `
            SELECT plc.*,
                   (SELECT COUNT(*) FROM private_loans pl WHERE pl.private_client_id = plc.id) AS loan_count
            FROM private_loan_clients plc
            WHERE 1=1
        `;
    const params: any[] = [];
    if (status) { sql += " AND plc.status = ?"; params.push(status); }
    if (search) {
      sql += " AND (plc.name LIKE ? OR plc.document LIKE ? OR plc.phone LIKE ? OR plc.email LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    sql += " ORDER BY plc.name, plc.id";
    return (await conn.execute(sql, params)).fetchall();
  } finally { await conn.close(); }
}

export async function get_private_loan_client_by_id(private_client_id: number): Promise<Row | null> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM private_loan_clients WHERE id = ?", [private_client_id])).fetchone();
  } finally { await conn.close(); }
}

/** Busca no cadastro geral (clients) para vincular a um cliente de títulos. Somente leitura. */
export async function search_general_clients_for_linking(term: string, limit = 20): Promise<Row[]> {
  const conn = await get_connection();
  try {
    const like = `%${String(ou(term, "")).trim()}%`;
    return (await conn.execute(
      `SELECT id, full_name, cpf, email, phone, pix_key, status
               FROM clients
               WHERE full_name LIKE ? OR cpf LIKE ? OR phone LIKE ? OR email LIKE ?
               ORDER BY full_name
               LIMIT ?`,
      [like, like, like, like, limit],
    )).fetchall();
  } finally { await conn.close(); }
}

export async function create_private_loan_client(data: Record<string, any>): Promise<number> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO private_loan_clients
               (linked_client_id, name, document, email, phone, pix_key, notes, status)
               VALUES (:linked_client_id, :name, :document, :email, :phone, :pix_key, :notes, :status)`,
      {
        linked_client_id: dget(data, "linked_client_id"),
        name: String(dget(data, "name", "")).trim(),
        document: dget(data, "document", ""),
        email: dget(data, "email", ""),
        phone: dget(data, "phone", ""),
        pix_key: dget(data, "pix_key", ""),
        notes: dget(data, "notes", ""),
        status: dget(data, "status", "ativo"),
      },
    ));
    await conn.commit();
    const new_id = cur.lastrowid!;
    await _log(conn, "private_loan_clients", new_id, "INSERT", null, pyRepr(data));
    await conn.commit();
    return new_id;
  } finally { await conn.close(); }
}

export async function update_private_loan_client(private_client_id: number, data: Record<string, any>): Promise<boolean> {
  const old = await get_private_loan_client_by_id(private_client_id);
  if (!old) return false;
  const conn = await get_connection();
  try {
    await conn.execute(..._nomeados(
      `UPDATE private_loan_clients SET
                   linked_client_id = :linked_client_id, name = :name, document = :document,
                   email = :email, phone = :phone, pix_key = :pix_key, notes = :notes,
                   status = :status, updated_at = datetime('now','localtime')
               WHERE id = :id`,
      {
        linked_client_id: dget(data, "linked_client_id"),
        name: String(dget(data, "name", old.name)).trim(),
        document: dget(data, "document", dget(old, "document")),
        email: dget(data, "email", dget(old, "email")),
        phone: dget(data, "phone", dget(old, "phone")),
        pix_key: dget(data, "pix_key", dget(old, "pix_key")),
        notes: dget(data, "notes", dget(old, "notes")),
        status: dget(data, "status", dget(old, "status")),
        id: private_client_id,
      },
    ));
    await conn.commit();
    await _log(conn, "private_loan_clients", private_client_id, "UPDATE", pyRepr(old), pyRepr(data));
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

export async function set_private_loan_client_status(private_client_id: number, status: string): Promise<boolean> {
  const old = await get_private_loan_client_by_id(private_client_id);
  if (!old) return false;
  const conn = await get_connection();
  try {
    await conn.execute("UPDATE private_loan_clients SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?", [status, private_client_id]);
    await conn.commit();
    await _log(conn, "private_loan_clients", private_client_id, "STATUS_CHANGE", dget(old, "status"), status);
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

export async function get_private_loan_clients_summary(): Promise<Record<string, number>> {
  const conn = await get_connection();
  try {
    const total = v0((await conn.execute("SELECT COUNT(*) FROM private_loan_clients")).fetchone());
    const ativos = v0((await conn.execute("SELECT COUNT(*) FROM private_loan_clients WHERE status='ativo'")).fetchone());
    const inativos = v0((await conn.execute("SELECT COUNT(*) FROM private_loan_clients WHERE status='inativo'")).fetchone());
    return { total, ativos, inativos };
  } finally { await conn.close(); }
}

// ── Empréstimos ─────────────────────────────────────────────────────────────

export async function create_private_loan(data: Record<string, any>): Promise<number> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO private_loans
               (private_client_id, linked_client_id, loan_number, original_amount, contracted_amount,
                interest_rate_monthly, interest_rate_daily, interest_type, calculation_method,
                start_date, first_due_date, final_due_date, installments_count, installment_amount,
                status, notes)
               VALUES (:private_client_id, :linked_client_id, :loan_number, :original_amount, :contracted_amount,
                       :interest_rate_monthly, :interest_rate_daily, :interest_type, :calculation_method,
                       :start_date, :first_due_date, :final_due_date, :installments_count, :installment_amount,
                       :status, :notes)`,
      data,
    ));
    await conn.commit();
    const new_id = cur.lastrowid!;
    await _log(conn, "private_loans", new_id, "INSERT", null, pyRepr(data));
    await conn.commit();
    logger.info(`private_loans: empréstimo ${new_id} criado (cliente título ${pyStr(dget(data, "private_client_id"))})`);
    return new_id;
  } finally { await conn.close(); }
}

export async function get_private_loan_by_id(loan_id: number): Promise<Row | null> {
  const conn = await get_connection();
  try {
    return (await conn.execute(
      `SELECT pl.*,
                      plc.name AS client_name, plc.document AS client_document,
                      plc.phone AS client_phone, plc.email AS client_email,
                      plc.pix_key AS client_pix_key
               FROM private_loans pl
               JOIN private_loan_clients plc ON plc.id = pl.private_client_id
               WHERE pl.id = ?`,
      [loan_id],
    )).fetchone();
  } finally { await conn.close(); }
}

export async function get_private_loans(status: string | null = null, private_client_id: number | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `
            SELECT pl.*,
                   plc.name AS client_name, plc.document AS client_document
            FROM private_loans pl
            JOIN private_loan_clients plc ON plc.id = pl.private_client_id
            WHERE 1=1
        `;
    const params: any[] = [];
    if (status) { sql += " AND pl.status = ?"; params.push(status); }
    if (private_client_id) { sql += " AND pl.private_client_id = ?"; params.push(private_client_id); }
    sql += " ORDER BY pl.created_at DESC, pl.id";
    return (await conn.execute(sql, params)).fetchall();
  } finally { await conn.close(); }
}

export async function update_private_loan_status(loan_id: number, status: string, user_note = ""): Promise<boolean> {
  const old = await get_private_loan_by_id(loan_id);
  if (!old) return false;
  const conn = await get_connection();
  try {
    await conn.execute("UPDATE private_loans SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?", [status, loan_id]);
    await conn.commit();
    await _log(conn, "private_loans", loan_id, "STATUS_CHANGE", dget(old, "status"), status, user_note);
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

export async function update_private_loan_notes(loan_id: number, notes: string): Promise<boolean> {
  const old = await get_private_loan_by_id(loan_id);
  if (!old) return false;
  const conn = await get_connection();
  try {
    await conn.execute("UPDATE private_loans SET notes = ?, updated_at = datetime('now','localtime') WHERE id = ?", [notes, loan_id]);
    await conn.commit();
    await _log(conn, "private_loans", loan_id, "UPDATE_NOTES", dget(old, "notes"), notes);
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

// ── Parcelas ─────────────────────────────────────────────────────────────

/** Insere em lote as parcelas de um empréstimo. */
export async function create_private_loan_installments(loan_id: number, installments: Record<string, any>[]): Promise<void> {
  const conn = await get_connection();
  try {
    for (const inst of installments) {
      await conn.execute(
        `INSERT INTO private_loan_installments
                   (loan_id, installment_number, due_date, principal_amount,
                    interest_amount, installment_amount, status)
                   VALUES (?,?,?,?,?,?,?)`,
        _params([loan_id, inst.installment_number, inst.due_date, dget(inst, "principal_amount", 0),
          dget(inst, "interest_amount", 0), inst.installment_amount, dget(inst, "status", "open")]),
      );
    }
    await conn.commit();
    await _log(conn, "private_loan_installments", loan_id, "INSERT_BULK", null, `${installments.length} parcela(s) geradas`);
    await conn.commit();
  } finally { await conn.close(); }
}

export async function get_private_loan_installments(loan_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM private_loan_installments WHERE loan_id = ? ORDER BY installment_number, id", [loan_id])).fetchall();
  } finally { await conn.close(); }
}

export async function update_installment_payment(installment_id: number, paid_amount: number, paid_date: string,
  status: string, notes = ""): Promise<boolean> {
  const conn = await get_connection();
  try {
    await conn.execute(
      `UPDATE private_loan_installments SET
                   paid_amount = ?, paid_date = ?, status = ?, notes = ?,
                   updated_at = datetime('now','localtime')
               WHERE id = ?`,
      _params([paid_amount, paid_date, status, notes, installment_id]),
    );
    await conn.commit();
    await _log(conn, "private_loan_installments", installment_id, "PAYMENT", null,
      `paid_amount=${typeof paid_amount === "number" ? pyFloatRepr(paid_amount) : pyStr(paid_amount)} status=${status}`);
    await conn.commit();
    return true;
  } finally { await conn.close(); }
}

// ── Prorrogações ─────────────────────────────────────────────────────────

export async function create_private_loan_extension(data: Record<string, any>): Promise<number> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO private_loan_extensions
               (loan_id, reference_date, paid_date, extension_amount,
                covered_until_date, principal_kept_amount, notes)
               VALUES (:loan_id, :reference_date, :paid_date, :extension_amount,
                       :covered_until_date, :principal_kept_amount, :notes)`,
      data,
    ));
    await conn.commit();
    const new_id = cur.lastrowid!;
    await _log(conn, "private_loan_extensions", new_id, "INSERT", null, pyRepr(data));
    await conn.commit();
    return new_id;
  } finally { await conn.close(); }
}

export async function get_private_loan_extensions(loan_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM private_loan_extensions WHERE loan_id = ? ORDER BY covered_until_date DESC, id DESC", [loan_id])).fetchall();
  } finally { await conn.close(); }
}

export async function get_latest_covered_until(loan_id: number): Promise<string | null> {
  const conn = await get_connection();
  try {
    const row = (await conn.execute("SELECT MAX(covered_until_date) AS max_date FROM private_loan_extensions WHERE loan_id = ?", [loan_id])).fetchone();
    return row && row.max_date ? row.max_date : null;
  } finally { await conn.close(); }
}

// ── Amortizações ─────────────────────────────────────────────────────────

/** Campos legados + detalhamento Price (todos opcionais). */
export async function create_private_loan_amortization(data: Record<string, any>): Promise<number> {
  const payload: Record<string, any> = {
    loan_id: dget(data, "loan_id"),
    installment_id: dget(data, "installment_id"),
    payment_date: dget(data, "payment_date"),
    amount: dget(data, "amount"),
    amortization_type: dget(data, "amortization_type"),
    applied_to: dget(data, "applied_to", "principal"),
    target_mode: dget(data, "target_mode"),
    price_action: dget(data, "price_action"),
    amount_before: dget(data, "amount_before"),
    amount_after: dget(data, "amount_after"),
    recalculated_schedule_json: dget(data, "recalculated_schedule_json"),
    notes: dget(data, "notes"),
  };
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO private_loan_amortizations
               (loan_id, installment_id, payment_date, amount, amortization_type,
                applied_to, target_mode, price_action, amount_before, amount_after,
                recalculated_schedule_json, notes)
               VALUES (:loan_id, :installment_id, :payment_date, :amount, :amortization_type,
                       :applied_to, :target_mode, :price_action, :amount_before, :amount_after,
                       :recalculated_schedule_json, :notes)`,
      // dget devolve null para ausentes (o Python mandava None)
      Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, v ?? null])),
    ));
    await conn.commit();
    const new_id = cur.lastrowid!;
    await _log(conn, "private_loan_amortizations", new_id, "INSERT", null, pyRepr(payload));
    await conn.commit();
    return new_id;
  } finally { await conn.close(); }
}

/** Amortizações de um empréstimo com o número da parcela alvo. */
export async function get_private_loan_amortizations(loan_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute(
      `SELECT pla.*, pli.installment_number AS target_installment_number
               FROM private_loan_amortizations pla
               LEFT JOIN private_loan_installments pli ON pli.id = pla.installment_id
               WHERE pla.loan_id = ?
               ORDER BY pla.payment_date DESC, pla.id DESC`,
      [loan_id],
    )).fetchall();
  } finally { await conn.close(); }
}

// ── Pagamentos (registro geral) ─────────────────────────────────────────

export async function create_private_loan_payment(data: Record<string, any>): Promise<number> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO private_loan_payments
               (loan_id, installment_id, payment_date, amount, payment_type, notes)
               VALUES (:loan_id, :installment_id, :payment_date, :amount, :payment_type, :notes)`,
      data,
    ));
    await conn.commit();
    const new_id = cur.lastrowid!;
    await _log(conn, "private_loan_payments", new_id, "INSERT", null, pyRepr(data));
    await conn.commit();
    return new_id;
  } finally { await conn.close(); }
}

export async function get_private_loan_payments(loan_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM private_loan_payments WHERE loan_id = ? ORDER BY payment_date DESC, id DESC", [loan_id])).fetchall();
  } finally { await conn.close(); }
}

/** Pagamentos de todos os empréstimos (telas agregadas). */
export async function get_private_loan_payments_all(payment_type: string | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `
            SELECT plp.*, pl.loan_number, plc.name AS client_name
            FROM private_loan_payments plp
            JOIN private_loans pl ON pl.id = plp.loan_id
            JOIN private_loan_clients plc ON plc.id = pl.private_client_id
            WHERE 1=1
        `;
    const params: any[] = [];
    if (payment_type) { sql += " AND plp.payment_type = ?"; params.push(payment_type); }
    sql += " ORDER BY plp.payment_date DESC, plp.id DESC";
    return (await conn.execute(sql, params)).fetchall();
  } finally { await conn.close(); }
}

/** Parcelas de todos os empréstimos (tela agregada Parcelas/Recebimentos). */
export async function get_private_loan_installments_all(status: string | null = null): Promise<Row[]> {
  const conn = await get_connection();
  try {
    let sql = `
            SELECT pli.*, pl.loan_number, plc.name AS client_name
            FROM private_loan_installments pli
            JOIN private_loans pl ON pl.id = pli.loan_id
            JOIN private_loan_clients plc ON plc.id = pl.private_client_id
            WHERE 1=1
        `;
    const params: any[] = [];
    if (status) { sql += " AND pli.status = ?"; params.push(status); }
    sql += " ORDER BY pli.due_date, pli.id";
    return (await conn.execute(sql, params)).fetchall();
  } finally { await conn.close(); }
}

/** Prorrogações de todos os empréstimos. */
export async function get_private_loan_extensions_all(): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute(
      `SELECT ple.*, pl.loan_number, plc.name AS client_name
               FROM private_loan_extensions ple
               JOIN private_loans pl ON pl.id = ple.loan_id
               JOIN private_loan_clients plc ON plc.id = pl.private_client_id
               ORDER BY ple.covered_until_date DESC, ple.id DESC`,
    )).fetchall();
  } finally { await conn.close(); }
}

/** Amortizações de todos os empréstimos (com o número da parcela alvo). */
export async function get_private_loan_amortizations_all(): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute(
      `SELECT pla.*, pl.loan_number, plc.name AS client_name,
                      pli.installment_number AS target_installment_number
               FROM private_loan_amortizations pla
               JOIN private_loans pl ON pl.id = pla.loan_id
               JOIN private_loan_clients plc ON plc.id = pl.private_client_id
               LEFT JOIN private_loan_installments pli ON pli.id = pla.installment_id
               ORDER BY pla.payment_date DESC, pla.id DESC`,
    )).fetchall();
  } finally { await conn.close(); }
}

// ── Log de cálculos/simulações ──────────────────────────────────────────

export async function create_private_loan_calculation_log(data: Record<string, any>): Promise<number> {
  const conn = await get_connection();
  try {
    const cur = await conn.execute(..._nomeados(
      `INSERT INTO private_loan_calculations_log
               (loan_id, base_date, base_amount, days_overdue, monthly_rate,
                daily_rate, calculated_amount, calculation_details)
               VALUES (:loan_id, :base_date, :base_amount, :days_overdue, :monthly_rate,
                       :daily_rate, :calculated_amount, :calculation_details)`,
      data,
    ));
    await conn.commit();
    return cur.lastrowid!;
  } finally { await conn.close(); }
}

export async function get_private_loan_calculations_log(loan_id: number): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute("SELECT * FROM private_loan_calculations_log WHERE loan_id = ? ORDER BY id DESC LIMIT 20", [loan_id])).fetchall();
  } finally { await conn.close(); }
}

// ── Bundle de detalhe (empréstimo completo) ──────────────────────────────

export async function get_private_loan_detail(loan_id: number): Promise<Record<string, any> | null> {
  const loan = await get_private_loan_by_id(loan_id);
  if (!loan) return null;
  return {
    loan,
    installments: await get_private_loan_installments(loan_id),
    extensions: await get_private_loan_extensions(loan_id),
    amortizations: await get_private_loan_amortizations(loan_id),
    payments: await get_private_loan_payments(loan_id),
    calculations_log: await get_private_loan_calculations_log(loan_id),
  };
}

// ── Validação Sistema (projeção gerencial) — SOMENTE LEITURA ─────────────

export async function get_shares_for_validation(condominium_id: number | null = null, client_id: number | null = null,
  search: string | null = null, statuses: string[] = ["ativa"]): Promise<Row[]> {
  const conn = await get_connection();
  try {
    const marcadores = statuses.map(() => "?").join(",") || "?";
    let sql = `
            SELECT s.*,
                   c.full_name AS client_name,
                   c.cpf       AS client_cpf,
                   c.email     AS client_email,
                   c.status    AS client_status,
                   cd.name                 AS condominium_name,
                   cd.code                 AS condominium_code,
                   cd.default_monthly_rate AS condominium_rate,
                   cd.payment_day          AS condominium_payment_day
            FROM shares s
            JOIN clients      c  ON c.id  = s.client_id
            JOIN condominiums cd ON cd.id = s.condominium_id
            WHERE s.status IN (${marcadores})
        `;
    const params: any[] = statuses.length ? [...statuses] : ["ativa"];
    if (condominium_id) { sql += " AND s.condominium_id = ?"; params.push(condominium_id); }
    if (client_id) { sql += " AND s.client_id = ?"; params.push(client_id); }
    if (search) {
      const digits = soDigitos(search);
      const like = `%${search}%`;
      sql += " AND (c.full_name LIKE ? OR c.cpf LIKE ? OR s.share_number LIKE ?";
      params.push(like, like, like);
      if (digits && digits !== search) { sql += " OR c.cpf LIKE ?"; params.push(`%${digits}%`); }
      sql += ")";
    }
    const result = (await conn.execute(sql + " ORDER BY s.id", params)).fetchall();
    return sortBy(result, (r) => [ou(dget(r, "client_name"), ""), ou(dget(r, "condominium_name"), ""),
      ou(dget(r, "maturity_date"), "9999-99-99"), share_number_sort_key(r.share_number)]);
  } finally { await conn.close(); }
}

/** Clientes que possuem cotas ativas (filtro da tela Validação Sistema). */
export async function get_clients_with_shares_for_validation(): Promise<Row[]> {
  const conn = await get_connection();
  try {
    return (await conn.execute(`
            SELECT c.id, c.full_name, c.cpf, COUNT(s.id) AS qtd_cotas
            FROM clients c
            JOIN shares s ON s.client_id = c.id AND s.status = 'ativa'
            GROUP BY c.id, c.full_name, c.cpf
            ORDER BY c.full_name, c.id
        `)).fetchall();
  } finally { await conn.close(); }
}

// pyCmp re-exportado para quem precisar ordenar com share_number_sort_key
export { pyCmp };
