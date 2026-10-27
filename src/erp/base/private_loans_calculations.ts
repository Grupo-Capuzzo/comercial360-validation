/* eslint-disable @typescript-eslint/no-explicit-any */
// private_loans_calculations.py — Cálculos do módulo Títulos Privados
//
// Módulo ISOLADO: não usa nada de calculations.ts (apuração dos condomínios).
// REGRAS CRÍTICAS:
//   - Tudo em Decimal, nunca float, até o último instante (float só na saída).
//   - Nenhuma função aqui grava no banco (calculate_current_loan_balance só LÊ).
//
// Fórmulas:
//   taxa_diaria  = (1 + taxa_mensal) ** (1/30) - 1
//   valor_atual  = valor_base * (1 + taxa_diaria) ** dias_em_atraso
//   PMT (Price)  = PV * i / (1 - (1 + i) ** -n)
import { PyDate, pyStr } from "../core/py";
import {
  Decimal, D, ValueError, InvalidOperation, ROUND_HALF_UP, pyFloatRepr, pyInt, dget, ou, somaDec, pyMax, pyMin, pyRepr,
} from "./pyextra";
import * as db from "./database";

export { Decimal } from "./pyextra";

export const TWO_PLACES = D("0.01");
export const RATE_PLACES = D("0.00000001"); // 8 casas — suficiente para taxa diária

// Precisão dos cálculos intermediários de potência (juros compostos / Price).
export const CALC_PRECISION = 40;

/** Converte para Decimal sempre a partir de str() — nunca direto de float. */
export function _d(value: any): Decimal {
  if (value instanceof Decimal) return value;
  if (value === null || value === undefined) return D("0");
  if (typeof value === "number") return new Decimal(pyFloatRepr(value));
  if (typeof value === "boolean") return D(value ? 1 : 0);
  return new Decimal(value instanceof PyDate ? value.toString() : String(value));
}

/** Converte um valor monetário em texto (pt-BR / americano) para Decimal — nunca usa float. */
export function parse_money_br(value: any): Decimal {
  if (value === null || value === undefined) return D("0");
  if (value instanceof Decimal) return value;
  let texto = (typeof value === "number" ? pyFloatRepr(value) : pyStr(value)).trim();
  if (typeof value === "number" && Number.isInteger(value)) texto = String(value);
  if (!texto) return D("0");
  texto = texto.replace(/R\$/g, "").replace(/r\$/g, "").trim();
  texto = texto.replace(/ /g, "");
  if (!texto) return D("0");

  const tem_ponto = texto.includes(".");
  const tem_virgula = texto.includes(",");
  if (tem_ponto && tem_virgula) {
    texto = texto.replace(/\./g, "").replace(/,/g, ".");
  } else if (tem_virgula) {
    texto = texto.replace(/,/g, ".");
  } else if (tem_ponto) {
    const partes = texto.split(".");
    if (partes.length === 2 && partes[1].length === 3) texto = texto.replace(/\./g, "");
  }
  try {
    return new Decimal(texto);
  } catch (e) {
    if (e instanceof InvalidOperation) throw new ValueError("Valor informado inválido.");
    throw e;
  }
}

/** Converte uma taxa percentual em texto para Decimal fracionário (3,5 → 0.035; 0,035 → 0.035). */
export function parse_percent_br(value: any): Decimal {
  if (value === null || value === undefined) return D("0");
  if (value instanceof Decimal) return value.le(1) ? value : value.div(D("100"));
  let texto = (typeof value === "number" && !Number.isInteger(value) ? pyFloatRepr(value) : pyStr(value)).trim();
  if (!texto) return D("0");
  texto = texto.replace(/%/g, "").replace(/ /g, "");
  texto = texto.replace(/,/g, ".");
  let percent: Decimal;
  try {
    percent = new Decimal(texto);
  } catch (e) {
    if (e instanceof InvalidOperation) throw new ValueError("Taxa de juros mensal inválida.");
    throw e;
  }
  if (percent.gt(1)) percent = percent.div(D("100"));
  return percent;
}

/** Arredonda para centavos (ROUND_HALF_UP), sempre em Decimal. */
export function round_money(value: any): Decimal {
  return _d(value).quantize(TWO_PLACES, ROUND_HALF_UP);
}

export function _to_date(value: any): PyDate {
  if (value instanceof PyDate) return value.isDatetime ? value.date() : value;
  const s = pyStr(value);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const d = m ? new PyDate(+m[1], +m[2], +m[3]) : null;
  if (!d || !d.valid()) throw new ValueError(`time data ${pyRepr(s)} does not match format '%Y-%m-%d'`);
  return d;
}

/** Soma meses mantendo o dia (ajustado para o último dia do mês de destino). */
export function _add_months(d: PyDate, months: number): PyDate {
  const month_index = d.month - 1 + months;
  const year = d.year + Math.floor(month_index / 12);
  const month = (((month_index % 12) + 12) % 12) + 1;
  let last_day: number;
  if (month === 2) {
    const bissexto = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    last_day = bissexto ? 29 : 28;
  } else if ([4, 6, 9, 11].includes(month)) last_day = 30;
  else last_day = 31;
  return new PyDate(year, month, Math.min(d.day, last_day));
}

// ─────────────────────────────────────────────────────────────────────────
//  Juros compostos
// ─────────────────────────────────────────────────────────────────────────

/** taxa_diaria = (1 + taxa_mensal) ** (1/30) - 1, inteiramente em Decimal. */
export function calculate_daily_rate(monthly_rate: any): Decimal {
  const mr = _d(monthly_rate);
  return Decimal.comPrecisao(CALC_PRECISION, () => {
    const base = D(1).add(mr);
    const expoente = D(1).div(D(30));
    return base.pow(expoente).sub(D(1));
  });
}

/** valor_atual = valor_base * (1 + taxa_diaria) ** dias_em_atraso (sem juros se end <= start). */
export function compound_amount(base_amount: any, monthly_rate: any, start_date: any, end_date: any): Decimal {
  const base = _d(base_amount);
  const ini = _to_date(start_date);
  const fim = _to_date(end_date);
  const dias = fim.diffDays(ini);
  if (dias <= 0) return base.quantize(TWO_PLACES, ROUND_HALF_UP);
  const daily_rate = calculate_daily_rate(monthly_rate);
  const resultado = Decimal.comPrecisao(CALC_PRECISION, () => {
    const fator = D(1).add(daily_rate).pow(D(dias));
    return base.mul(fator);
  });
  return resultado.quantize(TWO_PLACES, ROUND_HALF_UP);
}

// ─────────────────────────────────────────────────────────────────────────
//  Sistema Price
// ─────────────────────────────────────────────────────────────────────────

/** PMT = PV * i / (1 - (1 + i) ** -n). */
export function calculate_price_payment(principal: any, monthly_rate: any, installments: any): Decimal {
  const pv = _d(principal);
  const i = _d(monthly_rate);
  const n = pyInt(installments);
  if (n <= 0) throw new ValueError("Número de parcelas deve ser maior que zero.");
  if (pv.le(0)) throw new ValueError("Valor financiado deve ser maior que zero.");
  if (i.lt(0)) throw new ValueError("Taxa mensal não pode ser negativa.");
  if (i.isZero()) return pv.div(D(n)).quantize(TWO_PLACES, ROUND_HALF_UP);
  const pmt = Decimal.comPrecisao(CALC_PRECISION, () => {
    const fator = D(1).add(i).pow(D(-n));
    return pv.mul(i).div(D(1).sub(fator));
  });
  return pmt.quantize(TWO_PLACES, ROUND_HALF_UP);
}

/** Cronograma Price completo; a última parcela zera o saldo com exatidão. */
export function generate_price_schedule(principal: any, monthly_rate: any, installments: any, first_due_date: any): any {
  const principal_d = _d(principal);
  const i = _d(monthly_rate);
  const n = pyInt(installments);
  const first_due = _to_date(first_due_date);
  const pmt = calculate_price_payment(principal_d, i, n);

  const schedule: any[] = [];
  let saldo = principal_d;
  let total_pago = D("0");
  let total_juros = D("0");
  for (let k = 1; k <= n; k++) {
    const juros = saldo.mul(i).quantize(TWO_PLACES, ROUND_HALF_UP);
    let amortizacao = pmt.sub(juros).quantize(TWO_PLACES, ROUND_HALF_UP);
    let parcela_valor = pmt;
    if (k === n) {
      amortizacao = saldo;
      parcela_valor = juros.add(amortizacao).quantize(TWO_PLACES, ROUND_HALF_UP);
    }
    const saldo_final = saldo.sub(amortizacao).quantize(TWO_PLACES, ROUND_HALF_UP);
    const vencimento = _add_months(first_due, k - 1);
    schedule.push({
      installment_number: k,
      due_date: vencimento.isoformat(),
      opening_balance: saldo.toNumber(),
      interest: juros.toNumber(),
      principal: amortizacao.toNumber(),
      installment_amount: parcela_valor.toNumber(),
      closing_balance: saldo_final.toNumber(),
    });
    total_pago = total_pago.add(parcela_valor);
    total_juros = total_juros.add(juros);
    saldo = saldo_final;
  }
  return {
    principal: principal_d.toNumber(),
    monthly_rate: i.toNumber(),
    installments_count: n,
    installment_amount: pmt.toNumber(),
    total_paid: total_pago.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    total_interest: total_juros.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    first_due_date: first_due.isoformat(),
    schedule,
  };
}

// ─────────────────────────────────────────────────────────────────────────
//  Saldo atualizado / valor em atraso
// ─────────────────────────────────────────────────────────────────────────

/** Função PURA — saldo atualizado de um empréstimo até as_of_date. */
export function calculate_overdue_amount(loan: any, extensions: any[], amortizations: any[], payments: any[], as_of_date: any): any {
  void payments;
  const as_of = _to_date(as_of_date);
  const monthly_rate = _d(dget(loan, "interest_rate_monthly"));
  let base_amount: Decimal;
  let base_date_raw: any;
  if (dget(loan, "calculation_method") === "bullet") {
    base_amount = _d(dget(loan, "contracted_amount"));
    base_date_raw = ou(ou(dget(loan, "final_due_date"), dget(loan, "first_due_date")), dget(loan, "start_date"));
  } else {
    base_amount = _d(dget(loan, "_open_installments_total", dget(loan, "contracted_amount")));
    base_date_raw = ou(ou(dget(loan, "_earliest_open_due_date"), dget(loan, "first_due_date")), dget(loan, "start_date"));
  }
  if (!base_date_raw) throw new ValueError("Empréstimo sem data de vencimento definida — não é possível calcular atraso.");
  let base_date = _to_date(base_date_raw);

  if (extensions && extensions.length) {
    const maior_cobertura = pyMax(extensions.map((e) => _to_date(e.covered_until_date)));
    if (maior_cobertura.compare(base_date) > 0) base_date = maior_cobertura;
  }

  const total_amortizado = somaDec(amortizations.map((a) => _d(a.amount)), D("0"));
  let saldo_base = base_amount.sub(total_amortizado);
  if (saldo_base.lt(0)) saldo_base = D("0");
  saldo_base = saldo_base.quantize(TWO_PLACES, ROUND_HALF_UP);

  let dias_atraso = as_of.diffDays(base_date);
  let valor_atualizado: Decimal;
  if (dias_atraso <= 0) {
    dias_atraso = 0;
    valor_atualizado = saldo_base;
  } else {
    valor_atualizado = compound_amount(saldo_base, monthly_rate, base_date, as_of);
  }
  const daily_rate = calculate_daily_rate(monthly_rate);
  const juros_acumulados = valor_atualizado.sub(saldo_base).quantize(TWO_PLACES, ROUND_HALF_UP);

  return {
    base_amount: saldo_base.toNumber(),
    base_date: base_date.isoformat(),
    as_of_date: as_of.isoformat(),
    days_overdue: dias_atraso,
    monthly_rate: monthly_rate.toNumber(),
    daily_rate: daily_rate.quantize(RATE_PLACES, ROUND_HALF_UP).toNumber(),
    total_amortized: total_amortizado.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    accrued_interest: juros_acumulados.toNumber(),
    updated_amount: valor_atualizado.toNumber(),
  };
}

/** Wrapper com acesso ao banco (somente LEITURA) — chama calculate_overdue_amount. */
export async function calculate_current_loan_balance(loan_id: number, as_of_date: any = null): Promise<any> {
  const loan = await db.get_private_loan_by_id(loan_id);
  if (!loan) throw new ValueError(`Empréstimo #${loan_id} não encontrado.`);
  const as_of = as_of_date === null || as_of_date === undefined ? PyDate.today() : _to_date(as_of_date);

  const extensions = await db.get_private_loan_extensions(loan_id);
  const amortizations = await db.get_private_loan_amortizations(loan_id);
  const payments = await db.get_private_loan_payments(loan_id);
  const installments = await db.get_private_loan_installments(loan_id);

  const loan_for_calc: any = { ...loan };
  if (dget(loan, "calculation_method") !== "bullet" && installments.length) {
    const open_installments = installments.filter((ins: any) => ["open", "overdue", "partial"].includes(dget(ins, "status")));
    if (open_installments.length) {
      const saldo_parcelas = somaDec(
        open_installments.map((ins: any) => _d(ins.installment_amount).sub(_d(ou(dget(ins, "paid_amount"), 0)))),
        D("0"),
      );
      loan_for_calc._open_installments_total = saldo_parcelas.toNumber();
      loan_for_calc._earliest_open_due_date = pyMin(open_installments.map((ins: any) => ins.due_date));
    }
  }
  const result = calculate_overdue_amount(loan_for_calc, extensions, amortizations, payments, as_of);
  result.loan_id = loan_id;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
//  Cálculo POR PARCELA (tela de detalhe do empréstimo)
// ─────────────────────────────────────────────────────────────────────────

/** Status visual e valor atualizado de UMA parcela até as_of_date (hoje, se omitido). */
export function calculate_installment_current_amount(
  installment: any, monthly_rate: any, as_of_date: any = null, covered_until_date: any = null,
): any {
  const as_of = as_of_date === null || as_of_date === undefined ? PyDate.today() : _to_date(as_of_date);
  const due = _to_date(installment.due_date);
  const original = _d(dget(installment, "installment_amount"));
  const paid = _d(ou(dget(installment, "paid_amount"), 0));

  let saldo_aberto = original.sub(paid);
  if (saldo_aberto.lt(0)) saldo_aberto = D("0");
  saldo_aberto = saldo_aberto.quantize(TWO_PLACES, ROUND_HALF_UP);

  const status_salvo = dget(installment, "status");
  if (status_salvo === "paid" || paid.ge(original)) {
    return {
      original_amount: original.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
      paid_amount: paid.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
      open_amount: 0.0,
      days_overdue: 0,
      updated_amount: 0.0,
      accrued_interest: 0.0,
      visual_status: "paid",
    };
  }

  const tem_cobertura = covered_until_date !== null && covered_until_date !== undefined;
  const coberta = tem_cobertura && _to_date(covered_until_date).compare(due) > 0;
  const due_efetivo = coberta ? _to_date(covered_until_date) : due;
  const prorrogada_ativa = coberta && as_of.compare(due_efetivo) <= 0;
  const vencida = due_efetivo.compare(as_of) < 0;

  let visual_status: string;
  let days_overdue: number;
  let updated_amount: Decimal;
  if (prorrogada_ativa) {
    visual_status = "extended";
    days_overdue = 0;
    updated_amount = saldo_aberto;
  } else if (paid.gt(0)) {
    visual_status = "partial";
    if (vencida) {
      days_overdue = as_of.diffDays(due_efetivo);
      updated_amount = compound_amount(saldo_aberto, monthly_rate, due_efetivo, as_of);
    } else {
      days_overdue = 0;
      updated_amount = saldo_aberto;
    }
  } else if (vencida) {
    visual_status = "overdue";
    days_overdue = as_of.diffDays(due_efetivo);
    updated_amount = compound_amount(saldo_aberto, monthly_rate, due_efetivo, as_of);
  } else {
    visual_status = "open";
    days_overdue = 0;
    updated_amount = saldo_aberto;
  }
  const accrued_interest = updated_amount.sub(saldo_aberto).quantize(TWO_PLACES, ROUND_HALF_UP);
  return {
    original_amount: original.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    paid_amount: paid.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    open_amount: saldo_aberto.toNumber(),
    days_overdue,
    updated_amount: updated_amount.toNumber(),
    accrued_interest: accrued_interest.toNumber(),
    visual_status,
  };
}

/** Quanto o cliente paga em payment_date para quitar ANTECIPADAMENTE uma parcela Price. */
export function calculate_early_installment_settlement(installment: any, monthly_rate: any, payment_date: any): any {
  const due = _to_date(installment.due_date);
  const pay_date = _to_date(payment_date);
  const original = _d(dget(installment, "installment_amount"));
  const paid = _d(ou(dget(installment, "paid_amount"), 0));

  let saldo_aberto = original.sub(paid);
  if (saldo_aberto.lt(0)) saldo_aberto = D("0");
  saldo_aberto = saldo_aberto.quantize(TWO_PLACES, ROUND_HALF_UP);

  const base_result = {
    installment_id: dget(installment, "id"),
    installment_number: dget(installment, "installment_number"),
    due_date: due.isoformat(),
    original_installment_amount: original.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    payment_date: pay_date.isoformat(),
  };

  if (dget(installment, "status") === "paid" || paid.ge(original)) {
    return { ...base_result, days_until_due: 0, daily_rate: 0.0, early_settlement_amount: 0.0, discount_amount: 0.0, status: "paid" };
  }

  const dias_ate_vencimento = due.diffDays(pay_date);
  const daily_rate = calculate_daily_rate(monthly_rate);
  let early_settlement_amount: Decimal;
  let discount_amount: Decimal;
  let status: string;
  if (dias_ate_vencimento > 0) {
    const valor_presente = Decimal.comPrecisao(CALC_PRECISION, () => {
      const fator = D(1).add(daily_rate).pow(D(dias_ate_vencimento));
      return saldo_aberto.div(fator);
    });
    early_settlement_amount = valor_presente.quantize(TWO_PLACES, ROUND_HALF_UP);
    discount_amount = saldo_aberto.sub(early_settlement_amount).quantize(TWO_PLACES, ROUND_HALF_UP);
    status = "antecipada";
  } else if (dias_ate_vencimento === 0) {
    early_settlement_amount = saldo_aberto;
    discount_amount = D("0");
    status = "no_vencimento";
  } else {
    const r = calculate_installment_current_amount(installment, monthly_rate, pay_date);
    early_settlement_amount = _d(r.updated_amount);
    discount_amount = D("0");
    status = "atrasada";
  }
  return {
    ...base_result,
    days_until_due: dias_ate_vencimento,
    daily_rate: daily_rate.quantize(RATE_PLACES, ROUND_HALF_UP).toNumber(),
    early_settlement_amount: early_settlement_amount.toNumber(),
    discount_amount: discount_amount.toNumber(),
    status,
  };
}

/** Saldo atualizado de um empréstimo Price/manual somando o cálculo de cada parcela em aberto. */
export function calculate_price_loan_open_balance(installments: any[], monthly_rate: any, as_of_date: any = null, extensions: any[] | null = null): any {
  const as_of = as_of_date === null || as_of_date === undefined ? PyDate.today() : _to_date(as_of_date);
  const daily_rate = calculate_daily_rate(monthly_rate);

  let covered_until: PyDate | null = null;
  if (extensions && extensions.length) {
    const datas = extensions.filter((e) => dget(e, "covered_until_date")).map((e) => _to_date(e.covered_until_date));
    if (datas.length) covered_until = pyMax(datas);
  }

  let total_aberto = D("0");
  let total_atualizado = D("0");
  let total_juros = D("0");
  let maior_atraso = 0;
  let data_mais_antiga_vencida: PyDate | null = null;
  let data_base_prorrogada: PyDate | null = null;

  for (const inst of installments) {
    const r = calculate_installment_current_amount(inst, monthly_rate, as_of, covered_until);
    if (r.visual_status === "paid") continue;
    total_aberto = total_aberto.add(_d(r.open_amount));
    total_atualizado = total_atualizado.add(_d(r.updated_amount));
    total_juros = total_juros.add(_d(r.accrued_interest));
    if (r.days_overdue > maior_atraso) maior_atraso = r.days_overdue;
    if (r.visual_status === "overdue") {
      const due = _to_date(inst.due_date);
      if (data_mais_antiga_vencida === null || due.compare(data_mais_antiga_vencida) < 0) data_mais_antiga_vencida = due;
    } else if (r.visual_status === "extended") {
      data_base_prorrogada = covered_until;
    }
  }
  const base_date = data_mais_antiga_vencida ?? data_base_prorrogada ?? as_of;
  return {
    base_amount: total_aberto.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    base_date: base_date.isoformat(),
    as_of_date: as_of.isoformat(),
    days_overdue: maior_atraso,
    monthly_rate: _d(monthly_rate).toNumber(),
    daily_rate: daily_rate.quantize(RATE_PLACES, ROUND_HALF_UP).toNumber(),
    total_amortized: 0.0,
    accrued_interest: total_juros.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    updated_amount: total_atualizado.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
  };
}

/** Status visual do empréstimo a partir do status calculado de cada parcela. */
export function calculate_loan_visual_status(installments_calc: any[]): string {
  if (!installments_calc || !installments_calc.length) return "sem_parcelas";
  if (installments_calc.some((i) => i.visual_status === "overdue")) return "overdue";
  if (installments_calc.some((i) => i.visual_status === "extended")) return "extended";
  if (installments_calc.some((i) => ["open", "partial"].includes(i.visual_status))) return "active";
  return "settled";
}

// ─────────────────────────────────────────────────────────────────────────
//  Amortização de principal no modelo Price (Fase 2)
// ─────────────────────────────────────────────────────────────────────────

/** Saldo devedor de PRINCIPAL de um empréstimo Price, a partir das parcelas em aberto. */
export function calculate_price_outstanding_principal(installments: any[], as_of_date: any = null): any {
  const as_of = as_of_date === null || as_of_date === undefined ? PyDate.today() : _to_date(as_of_date);
  let outstanding_principal = D("0");
  let remaining_installments = 0;
  let next_due_date: PyDate | null = null;
  for (const inst of installments) {
    const original = _d(dget(inst, "installment_amount"));
    const paid = _d(ou(dget(inst, "paid_amount"), 0));
    if (original.le(0) || paid.ge(original)) continue;
    remaining_installments += 1;
    const due = _to_date(inst.due_date);
    if (next_due_date === null || due.compare(next_due_date) < 0) next_due_date = due;
    const principal_total = _d(ou(dget(inst, "principal_amount"), 0));
    const saldo_aberto_parcela = original.sub(paid).quantize(TWO_PLACES, ROUND_HALF_UP);
    const proporcao_principal = original.gt(0) ? principal_total.div(original) : D("0");
    outstanding_principal = outstanding_principal.add(saldo_aberto_parcela.mul(proporcao_principal));
  }
  return {
    outstanding_principal: outstanding_principal.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
    remaining_installments,
    next_due_date: next_due_date ? next_due_date.isoformat() : null,
    as_of_date: as_of.isoformat(),
  };
}

/** NOVO cronograma futuro depois de uma amortização de principal (reduce_payment / reduce_term). */
export function recalculate_price_schedule_after_principal_amortization(
  outstanding_principal: any, monthly_rate: any, remaining_installments: any, next_due_date: any, mode: string,
  current_installment_amount: any = null,
): any {
  const outstanding = _d(outstanding_principal);
  const i = _d(monthly_rate);
  const next_due = _to_date(next_due_date);

  if (outstanding.le(0)) {
    return { mode, outstanding_principal: 0.0, monthly_rate: i.toNumber(), new_installment_amount: 0.0, new_installments_count: 0, schedule: [] };
  }

  if (mode === "reduce_payment") {
    const n = pyInt(remaining_installments);
    if (n <= 0) throw new ValueError("Quantidade de parcelas restantes deve ser maior que zero.");
    const schedule_result = generate_price_schedule(outstanding, i, n, next_due);
    return {
      mode: "reduce_payment",
      outstanding_principal: outstanding.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
      monthly_rate: i.toNumber(),
      new_installment_amount: schedule_result.installment_amount,
      new_installments_count: n,
      schedule: schedule_result.schedule,
    };
  }

  if (mode === "reduce_term") {
    if (current_installment_amount === null || current_installment_amount === undefined) {
      throw new ValueError(
        "reduce_term exige o valor atual da parcela (current_installment_amount) " +
        "para ser mantido fixo enquanto se recalcula o prazo restante.",
      );
    }
    const pmt = _d(current_installment_amount);
    if (pmt.le(0)) throw new ValueError("Valor da parcela atual inválido para recalcular o prazo.");

    const schedule: any[] = [];
    const limite_parcelas = Math.max(pyInt(remaining_installments), 1) * 3 + 12;
    let saldo = outstanding;
    Decimal.comPrecisao(CALC_PRECISION, () => {
      let due = next_due;
      let numero = 0;
      while (saldo.gt(D("0.01")) && numero < limite_parcelas) {
        numero += 1;
        const juros = saldo.mul(i).quantize(TWO_PLACES, ROUND_HALF_UP);
        let principal_parcela = pmt.sub(juros);
        if (principal_parcela.le(0)) {
          throw new ValueError(
            "O valor atual da parcela não é suficiente para cobrir os juros do saldo " +
            "devedor restante — não é possível reduzir o prazo mantendo essa parcela.",
          );
        }
        const opening = saldo;
        let parcela_valor: Decimal;
        if (principal_parcela.ge(saldo)) {
          principal_parcela = saldo;
          parcela_valor = principal_parcela.add(juros).quantize(TWO_PLACES, ROUND_HALF_UP);
          saldo = D("0");
        } else {
          parcela_valor = pmt.quantize(TWO_PLACES, ROUND_HALF_UP);
          saldo = saldo.sub(principal_parcela).quantize(TWO_PLACES, ROUND_HALF_UP);
        }
        schedule.push({
          installment_number: numero,
          due_date: due.isoformat(),
          opening_balance: opening.toNumber(),
          interest: juros.toNumber(),
          principal: principal_parcela.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
          installment_amount: parcela_valor.toNumber(),
          closing_balance: saldo.toNumber(),
        });
        due = _add_months(next_due, numero);
      }
    });
    if (saldo.gt(D("0.01"))) {
      throw new ValueError(
        "Não foi possível quitar o saldo devedor com a parcela atual dentro de um " +
        "prazo razoável — revise o valor da parcela ou use 'reduce_payment'.",
      );
    }
    return {
      mode: "reduce_term",
      outstanding_principal: outstanding.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
      monthly_rate: i.toNumber(),
      new_installment_amount: pmt.quantize(TWO_PLACES, ROUND_HALF_UP).toNumber(),
      new_installments_count: schedule.length,
      schedule,
    };
  }

  throw new ValueError(`Modo de recálculo inválido: ${pyRepr(mode)} (use 'reduce_payment' ou 'reduce_term').`);
}
