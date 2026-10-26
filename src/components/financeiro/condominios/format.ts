/** Mesmas regras de formatação do sistema original (calculations.py). */

/** formatar_moeda: "R$ 1.234,56". */
export function formatarMoeda(valor: string | number | null | undefined) {
  const n = Number(valor);
  if (valor === null || valor === undefined || valor === "" || !Number.isFinite(n)) return "R$ 0,00";
  const [inteiro, centavos] = Math.abs(n).toFixed(2).split(".");
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}R$ ${milhar},${centavos}`;
}

/** formatar_percentual: fração → "1.700%" (3 casas, como no sistema original). */
export function formatarPercentual(valor: string | number, casas = 3) {
  const n = Number(valor);
  return Number.isFinite(n) ? `${(n * 100).toFixed(casas)}%` : "0,000%";
}
