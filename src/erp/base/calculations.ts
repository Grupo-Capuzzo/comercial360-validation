/* eslint-disable @typescript-eslint/no-explicit-any */
// calculations.py — Motor Financeiro
// Condomínios de Investimento — Grupo Capuzzo
//
// Regras:
//   Civil : taxa 1,7% | período dia 6 mês anterior → dia 5 mês atual
//   Saúde : taxa 1,8% | período dia 20 mês anterior → dia 19 mês atual
//   Agro  : taxa 1,5% (padrão) | cotas vencendo no mês → taxa especial 3,5%–4,5%
//           pagamento dia 15 | período dia 15 mês anterior → dia 14 mês atual
//
// Cálculo proporcional obrigatório para cotas que entraram no meio do período.
// Apenas cotas com status 'ativa' são consideradas.
//
// EXCEÇÃO — proporcional até a retirada (opt-in por cota, flag accrual_until_withdrawal):
//   a cota entra na apuração mesmo inativa e rende de period_start até o DIA ANTERIOR
//   à data de retirada (o dia da retirada não rende).
import { PyDate, pyFormat, pyStr } from "../core/py";
import {
  Decimal, D, ValueError, InvalidOperation, ROUND_HALF_UP, pyFloat, pyFloatRepr, dget, sortBy, ou, soDigitos,
} from "./pyextra";

export { Decimal } from "./pyextra";

// ══════════════════════════════════════════════════════════════
// UTILITÁRIOS DE FORMATAÇÃO (mantidos para compatibilidade)
// ══════════════════════════════════════════════════════════════

export function formatar_moeda(valor: any): string {
  try {
    return ("R$ " + pyFormat("{:,.2f}", pyFloat(valor))).replace(/,/g, "X").replace(/\./g, ",").replace(/X/g, ".");
  } catch {
    return "R$ 0,00";
  }
}

export function formatar_percentual(valor: any, casas = 3): string {
  try {
    return pyFormat(`{:.${casas}f}`, pyFloat(valor) * 100) + "%";
  } catch {
    return "0,000%";
  }
}

/** datetime.strptime estrito (sem aparar espaços), lança ValueError. */
export function _strptime(texto: string, fmt: string): PyDate {
  const s = String(texto);
  if (s !== s.trim()) throw new ValueError(`time data '${s}' does not match format '${fmt}'`);
  try {
    return PyDate.strptime(s, fmt);
  } catch {
    throw new ValueError(`time data '${s}' does not match format '${fmt}'`);
  }
}

export function formatar_data(valor: any, fmt_saida = "%d/%m/%Y"): string {
  if (valor === null || valor === undefined) return "—";
  if (valor instanceof PyDate) return valor.strftime(fmt_saida);
  for (const fmt of ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"]) {
    try {
      return _strptime(pyStr(valor), fmt).strftime(fmt_saida);
    } catch {
      continue;
    }
  }
  return pyStr(valor);
}

export function parse_data(texto: any): PyDate | null {
  if (!texto) return null;
  if (texto instanceof PyDate) return texto;
  for (const fmt of ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"]) {
    try {
      return _strptime(pyStr(texto).trim(), fmt).date();
    } catch {
      continue;
    }
  }
  return null;
}

/** Interpreta 1 / '1' / True / 'on' / 'sim' como ligado. None / 0 / '' → desligado. */
export function flag_ligada(valor: any): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "boolean") return valor;
  const s = (typeof valor === "number" ? pyStr(valor) : String(valor)).trim().toLowerCase();
  return ["1", "true", "on", "sim", "s", "yes"].includes(s);
}

/** Próximo dia útil após a data (pula sábado e domingo). */
export function next_business_day(d: PyDate): PyDate {
  let proximo = d.addDays(1);
  while (proximo.weekday() >= 5) proximo = proximo.addDays(1);
  return proximo;
}

export function formatar_cpf(cpf: any): any {
  const c = soDigitos(pyStr(cpf));
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  return cpf;
}

export function limpar_cpf(cpf: any): string {
  return soDigitos(pyStr(cpf));
}

// ══════════════════════════════════════════════════════════════
// MOTOR FINANCEIRO
// ══════════════════════════════════════════════════════════════

export const _COND_CONFIG: Record<string, { name: string; rate: Decimal; accrual_start_day: number; accrual_end_day: number }> = {
  civil: { name: "Construção Civil", rate: D("0.017"), accrual_start_day: 6, accrual_end_day: 5 },
  saude: { name: "Saúde", rate: D("0.018"), accrual_start_day: 20, accrual_end_day: 19 },
  agro: { name: "Agronegócio", rate: D("0.015"), accrual_start_day: 15, accrual_end_day: 14 },
};

export const AGRO_SPECIAL_RATE_MIN = D("0.035");
export const AGRO_SPECIAL_RATE_MAX = D("0.045");

function _date(y: number, m: number, d: number): PyDate {
  const r = new PyDate(y, m, d);
  if (!r.valid()) throw new ValueError("day is out of range for month");
  return r;
}

/** Retorna [period_start, period_end] para o mês/ano e produto. */
export function get_accrual_period(year: number, month: number, condominium_code: string): [PyDate, PyDate] {
  const cfg = Object.prototype.hasOwnProperty.call(_COND_CONFIG, condominium_code) ? _COND_CONFIG[condominium_code] : null;
  if (!cfg) throw new ValueError(`Produto desconhecido: ${pyStr(condominium_code)}`);
  const period_end = _date(year, month, cfg.accrual_end_day);
  const [prev_year, prev_month] = month === 1 ? [year - 1, 12] : [year, month - 1];
  const period_start = _date(prev_year, prev_month, cfg.accrual_start_day);
  return [period_start, period_end];
}

/** Retorna [active_days, total_period_days] — inclusivo nas duas pontas. */
export function calculate_active_days(
  acquisition_date: PyDate, period_start: PyDate, period_end: PyDate, accrual_end: PyDate | null = null,
): [number, number] {
  const total_period_days = period_end.diffDays(period_start) + 1;
  const effective_start = acquisition_date.compare(period_start) >= 0 ? acquisition_date : period_start;
  let effective_end = period_end;
  if (accrual_end !== null && accrual_end.compare(period_end) < 0) effective_end = accrual_end;
  if (effective_start.compare(effective_end) > 0) return [0, total_period_days];
  return [effective_end.diffDays(effective_start) + 1, total_period_days];
}

/** True se a data de vencimento cai no mês/ano informado. */
export function is_maturity_month(maturity_date_str: any, year: number, month: number): boolean {
  if (!maturity_date_str) return false;
  const d = parse_data(maturity_date_str);
  if (!d) return false;
  return d.year === year && d.month === month;
}

/** Normaliza e valida a taxa especial do Agronegócio (3,5%–4,5%); devolve Decimal 0.04. */
export function validate_agro_special_rate(rate_input: any): Decimal {
  if (rate_input === null || rate_input === undefined || rate_input === "") {
    throw new ValueError("Taxa especial do Agronegócio é obrigatória.");
  }
  const raw = (rate_input instanceof Decimal ? rate_input.toString() : pyStr(rate_input)).trim().replace(/,/g, ".");
  let d: Decimal;
  try {
    d = new Decimal(raw);
  } catch (e) {
    if (e instanceof InvalidOperation) throw new ValueError(`Taxa especial inválida: '${pyStr(rate_input)}'.`);
    throw e;
  }
  if (d.ge(D("1"))) d = d.div(D("100"));
  if (d.lt(AGRO_SPECIAL_RATE_MIN)) {
    throw new ValueError(`Taxa especial do Agro não pode ser inferior a ${pyFormat("{:.1f}", AGRO_SPECIAL_RATE_MIN.mul(100).toNumber())}%.`);
  }
  if (d.gt(AGRO_SPECIAL_RATE_MAX)) {
    throw new ValueError(`Taxa especial do Agro não pode ser superior a ${pyFormat("{:.1f}", AGRO_SPECIAL_RATE_MAX.mul(100).toNumber())}%.`);
  }
  return d;
}

/** Calcula o rendimento de UMA cota para o mês/ano (ou null se não entra). */
export function calculate_share_income(
  share: any, condominium_code: string, year: number, month: number, agro_special_rate: Decimal | null = null,
): any | null {
  const withdrawal = parse_data(dget(share, "withdrawal_date"));
  const prop_ate_retirada = flag_ligada(dget(share, "accrual_until_withdrawal")) && withdrawal !== null;

  if (dget(share, "status") !== "ativa" && !prop_ate_retirada) return null;

  const acq = parse_data(dget(share, "acquisition_date"));
  if (!acq) return null;

  // Regra: rentabilidade começa sempre 1 dia útil após a data de aquisição
  const accrual_start = next_business_day(acq);
  const [period_start, period_end] = get_accrual_period(year, month, condominium_code);

  // Último dia que ainda rende: o dia da retirada NÃO rende
  const accrual_end = prop_ate_retirada ? withdrawal!.addDays(-1) : null;

  if (accrual_start.compare(period_end) > 0) return null;
  if (accrual_end !== null && accrual_end.compare(period_start) < 0) return null;

  const [active_days, total_days] = calculate_active_days(accrual_start, period_start, period_end, accrual_end);
  if (active_days <= 0) return null;

  const value = D(typeof share.share_value === "number" ? pyFloatRepr(share.share_value) : pyStr(share.share_value));

  let is_special_agro = false;
  let rate: Decimal;
  if (condominium_code === "agro" && is_maturity_month(dget(share, "maturity_date"), year, month)) {
    if (agro_special_rate === null || agro_special_rate === undefined) {
      throw new ValueError(
        `Cota ${pyStr(share.share_number)} do Agronegócio vence em ` +
        `${pyStr(dget(share, "maturity_date"))} — informe a taxa especial.`,
      );
    }
    rate = agro_special_rate;
    is_special_agro = true;
  } else {
    rate = _COND_CONFIG[condominium_code].rate;
  }

  let income: Decimal;
  let calc_type: string;
  if (active_days === total_days) {
    income = value.mul(rate).quantize(D("0.01"), ROUND_HALF_UP);
    calc_type = "Integral";
  } else {
    income = value.mul(rate).mul(D(active_days)).div(D(total_days)).quantize(D("0.01"), ROUND_HALF_UP);
    calc_type = "Proporcional";
  }
  if (is_special_agro) calc_type = "Especial Agro vencimento";

  const truncado_por_retirada = prop_ate_retirada && accrual_end !== null && accrual_end.compare(period_end) < 0;
  if (truncado_por_retirada) {
    calc_type = is_special_agro ? "Especial vencimento · proporcional até retirada" : "Proporcional até retirada";
  }

  const effective_accrual_date = accrual_start.compare(period_start) >= 0 ? accrual_start : period_start;
  let effective_accrual_end = period_end;
  if (accrual_end !== null && accrual_end.compare(period_end) < 0) effective_accrual_end = accrual_end;

  let details =
    `R$ ${value.format(",.2f")} × ${pyFormat("{:.2f}", rate.mul(100).toNumber())}% ` +
    `× ${active_days}/${total_days} dias` +
    ` (início rentab.: ${effective_accrual_date.strftime("%d/%m/%Y")},` +
    ` aquisição: ${acq.strftime("%d/%m/%Y")})`;
  if (truncado_por_retirada) {
    details +=
      ` | RETIRADA em ${withdrawal!.strftime("%d/%m/%Y")}` +
      ` — rendeu até ${effective_accrual_end.strftime("%d/%m/%Y")}` +
      " (o dia da retirada não rende)";
  }

  return {
    share_id: share.id,
    client_id: share.client_id,
    client_name: dget(share, "client_name", ""),
    client_cpf: dget(share, "client_cpf", ""),
    client_pix: ou(dget(share, "client_pix", ""), ""),
    condominium_id: share.condominium_id,
    condominium_code,
    condominium_name: _COND_CONFIG[condominium_code].name,
    share_number: share.share_number,
    share_value: value.toNumber(),
    acquisition_date: dget(share, "acquisition_date", ""),
    accrual_start_date: effective_accrual_date.isoformat(),
    accrual_end_date: effective_accrual_end.isoformat(),
    withdrawal_date: withdrawal ? withdrawal.isoformat() : "",
    accrual_until_withdrawal: Boolean(truncado_por_retirada),
    maturity_date: ou(dget(share, "maturity_date", ""), ""),
    last_renewal_date: ou(dget(share, "last_renewal_date", ""), ""),
    period_start: period_start.isoformat(),
    period_end: period_end.isoformat(),
    active_days,
    total_period_days: total_days,
    applied_rate: rate.toNumber(),
    income_value: income.toNumber(),
    calc_type,
    calculation_details: details,
  };
}

/** Calcula rendimentos de uma lista de cotas (já filtradas pelo chamador). */
export function calculate_monthly_income(
  year: number, month: number, shares: any[], condominium_code: string | null = null, agro_special_rate: any = null,
): any[] {
  let agro_rate: Decimal | null = null;
  if (agro_special_rate !== null && agro_special_rate !== undefined &&
      (agro_special_rate instanceof Decimal ? agro_special_rate.toString() : pyStr(agro_special_rate)).trim() !== "") {
    agro_rate = validate_agro_special_rate(agro_special_rate);
  }
  const results: any[] = [];
  const codes = condominium_code ? [condominium_code] : Object.keys(_COND_CONFIG);
  for (const code of codes) {
    const shares_for_code = shares.filter((s) => dget(s, "condominium_code") === code);
    for (const share of shares_for_code) {
      const item = calculate_share_income(share, code, year, month, agro_rate);
      if (item) results.push(item);
    }
  }
  return results;
}

/** Este item corresponde a uma cota RETIRADA dentro do período? */
export function item_retirado_no_periodo(item: any): boolean {
  if (dget(item, "accrual_until_withdrawal")) return true;
  return String(ou(dget(item, "calculation_details"), "")).includes("RETIRADA em");
}

function _dstr(x: any): Decimal {
  return D(typeof x === "number" ? pyFloatRepr(x) : x instanceof Decimal ? x : pyStr(x));
}

/** Agrupa itens calculados por (cliente, condomínio). */
export function consolidate_by_client(calculation_items: any[]): any[] {
  const groups = new Map<string, any>();
  for (const item of calculation_items) {
    const cid = item.client_id;
    const code = item.condominium_code;
    const key = JSON.stringify([cid, code]);
    if (!groups.has(key)) {
      groups.set(key, {
        client_id: cid,
        client_name: item.client_name,
        client_cpf: item.client_cpf,
        client_pix: ou(dget(item, "client_pix"), ""),
        condominium_code: code,
        condominium_name: dget(item, "condominium_name", ""),
        shares_count: 0,
        withdrawn_count: 0,
        total_share_value: D("0"),
        total_withdrawn_value: D("0"),
        total_income: D("0"),
        shares_detail: [] as any[],
      });
    }
    const entry = groups.get(key);
    entry.shares_count += 1;
    const valor_cota = _dstr(item.share_value);
    if (item_retirado_no_periodo(item)) {
      entry.withdrawn_count += 1;
      entry.total_withdrawn_value = entry.total_withdrawn_value.add(valor_cota);
    } else {
      entry.total_share_value = entry.total_share_value.add(valor_cota);
    }
    entry.total_income = entry.total_income.add(_dstr(item.income_value));
    entry.shares_detail.push(item);
  }
  const result: any[] = [];
  for (const entry of groups.values()) {
    result.push({
      client_id: entry.client_id,
      client_name: entry.client_name,
      client_cpf: entry.client_cpf,
      client_pix: entry.client_pix,
      condominium_code: entry.condominium_code,
      condominium_name: entry.condominium_name,
      shares_count: entry.shares_count,
      withdrawn_count: entry.withdrawn_count,
      active_shares_count: entry.shares_count - entry.withdrawn_count,
      total_share_value: entry.total_share_value.toNumber(),
      total_withdrawn_value: entry.total_withdrawn_value.toNumber(),
      total_income: entry.total_income.toNumber(),
      shares_detail: entry.shares_detail,
    });
  }
  return sortBy(result, (x) => [x.condominium_name, x.client_name]);
}

/** True se houver cotas do Agro vencendo no mês. */
export function check_agro_maturing(shares: any[], year: number, month: number): boolean {
  return shares.some((s) =>
    dget(s, "condominium_code") === "agro" && dget(s, "status") === "ativa" &&
    is_maturity_month(dget(s, "maturity_date"), year, month));
}
