/* eslint-disable @typescript-eslint/no-explicit-any */
// Cálculos dos Títulos Privados (empréstimos a terceiros) — funções puras, sem banco.
//
//  • Tabela Price: PMT = PV · i / (1 − (1 + i)^−n), juros = saldo · i, amortização = PMT − juros.
//  • Atraso: a taxa mensal do título vira taxa diária composta, d = (1 + i)^(1/30) − 1, e corre sobre o
//    que está em aberto desde o vencimento (dia a dia, inclusive sobre o que já atualizou).
//  • Pagamento parcial abate primeiro os encargos do atraso, depois os juros da parcela e por último o
//    valor devolvido (principal). O que sobra continua sendo atualizado.
//  • Quitação antecipada: parcela que ainda vai vencer entra pelo valor presente na data (desconta os juros
//    que ainda não correram), pela mesma taxa diária.

export function r2(v: number) { return Math.round((v + Number.EPSILON) * 100) / 100; }

export function taxa_diaria(taxa_mensal: number) { return Math.pow(1 + taxa_mensal, 1 / 30) - 1; }

export function iso(d: Date) { return d.toISOString().slice(0, 10); }
export function data(isoTxt: string) { const [a, m, d] = isoTxt.slice(0, 10).split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); }
export function dias_entre(de: string, ate: string) { return Math.round((data(ate).getTime() - data(de).getTime()) / 86400000); }

/** Soma meses mantendo o dia (31/01 + 1 mês = 28/02 ou 29/02). */
export function somar_meses(isoTxt: string, meses: number, dia_base?: number) {
  const d = data(isoTxt);
  const dia = dia_base ?? d.getUTCDate();
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimo));
  return iso(alvo);
}

export interface LinhaPrice {
  numero: number; vencimento: string; saldo_inicial: number; juros: number; amortizacao: number; parcela: number; saldo_final: number;
}

/** Tabela Price completa. taxa em fração (0.035 = 3,5% a.m.). */
export function tabela_price(valor: number, taxa: number, n: number, primeiro_venc: string) {
  if (!(valor > 0)) throw new Error("Informe o valor emprestado.");
  if (!(taxa >= 0)) throw new Error("Informe a taxa de juros.");
  if (!(n >= 1 && n <= 360)) throw new Error("Informe o número de parcelas (1 a 360).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primeiro_venc || "")) throw new Error("Informe a data da primeira parcela.");
  const pmt = taxa === 0 ? r2(valor / n) : r2(valor * taxa / (1 - Math.pow(1 + taxa, -n)));
  const dia = data(primeiro_venc).getUTCDate();
  const linhas: LinhaPrice[] = [];
  let saldo = r2(valor);
  for (let k = 1; k <= n; k++) {
    const juros = r2(saldo * taxa);
    let amort = r2(pmt - juros);
    if (k === n) amort = saldo; // última parcela zera o saldo (ajuste de centavos)
    const parcela = r2(amort + juros);
    const final = r2(saldo - amort);
    linhas.push({ numero: k, vencimento: somar_meses(primeiro_venc, k - 1, dia), saldo_inicial: saldo, juros, amortizacao: amort, parcela, saldo_final: final });
    saldo = final;
  }
  const total_juros = r2(linhas.reduce((a, l) => a + l.juros, 0));
  const total_pago = r2(linhas.reduce((a, l) => a + l.parcela, 0));
  return { valor: r2(valor), taxa, n, primeiro_venc, parcela: pmt, total_juros, total_pago, linhas };
}

export interface Pagamento { data: string; valor: number } // valor = o que abate (recebido + desconto concedido)

/** Situação de uma parcela numa data: quanto já foi pago e o que ainda falta, separado em
 *  encargos do atraso, juros da parcela e principal. */
export function situacao_parcela(p: { vencimento: string; principal: number; juros: number }, pagamentos: Pagamento[], taxa_mensal: number, ate: string) {
  const d = taxa_diaria(taxa_mensal);
  let enc = 0, jur = p.juros, pri = p.principal, pago = 0, encargos_total = 0;
  let ultimo = p.vencimento;
  const crescer = (atePara: string) => {
    if (atePara <= ultimo) return;
    const base = enc + jur + pri;
    if (base > 0.004) {
      const g = base * (Math.pow(1 + d, dias_entre(ultimo, atePara)) - 1);
      enc += g; encargos_total += g;
    }
    ultimo = atePara;
  };
  for (const pg of [...pagamentos].filter((x) => x.data <= ate).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))) {
    crescer(pg.data);
    let v = pg.valor; pago += v;
    const t1 = Math.min(v, enc); enc -= t1; v -= t1;
    const t2 = Math.min(v, jur); jur -= t2; v -= t2;
    const t3 = Math.min(v, pri); pri -= t3; v -= t3;
  }
  crescer(ate);
  const saldo = Math.max(0, enc + jur + pri);
  const quitada = saldo < 0.005;
  const dias_atraso = !quitada && ate > p.vencimento ? dias_entre(p.vencimento, ate) : 0;
  return {
    pago: r2(pago), encargos: r2(enc), juros: r2(jur), principal: r2(pri), saldo: r2(saldo), quitada, dias_atraso,
    encargos_total: r2(encargos_total),
  };
}

/** Prazo em meses entre duas datas: meses cheios do calendário + dias que sobram / 30. */
export function meses_entre(de: string, ate: string) {
  if (ate <= de) return 0;
  const dia = data(de).getUTCDate();
  let m = 0;
  while (somar_meses(de, m + 1, dia) <= ate) m++;
  return m + dias_entre(somar_meses(de, m, dia), ate) / 30;
}

/** Valor para quitar a parcela numa data: atrasada/vencendo = saldo atualizado; futura = valor presente. */
export function valor_quitacao(p: { vencimento: string; principal: number; juros: number }, pagamentos: Pagamento[], taxa_mensal: number, ate: string) {
  const s = situacao_parcela(p, pagamentos, taxa_mensal, ate);
  if (s.quitada) return { ...s, quitacao: 0, desconto: 0, futura: false };
  if (p.vencimento <= ate) return { ...s, quitacao: s.saldo, desconto: 0, futura: false };
  const fator = Math.pow(1 + taxa_mensal, meses_entre(ate, p.vencimento));
  const vp = r2(s.saldo / fator);
  return { ...s, quitacao: vp, desconto: r2(s.saldo - vp), futura: true };
}
