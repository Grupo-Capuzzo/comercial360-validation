/**
 * Tipos das telas de Condomínios de Investimento.
 * Os nomes dos campos seguem as tabelas do sistema original (condominiums, shares, clients).
 * Valores monetários e taxas trafegam como texto decimal, nunca float.
 */

export type CondominioCodigo = "civil" | "agro" | "saude";
export type StatusCota = "ativa" | "pendente" | "inativa";

export type Condominio = {
  code: CondominioCodigo;
  name: string;
  /** Taxa mensal como fração decimal (ex.: "0.017" = 1,700%). */
  default_monthly_rate: string;
  payment_day: number;
  active: boolean;
};

export type ResumoProduto = { code: CondominioCodigo; name: string; qty: number; total_value: string };

export type ResumoCotas = {
  total: number;
  ativas: number;
  pendentes: number;
  inativas: number;
  /** Patrimônio das cotas ativas. */
  valor_total: string;
  por_produto: ResumoProduto[];
};

export type DashboardCondominios = {
  total_clients: number;
  s_res: ResumoCotas;
  conds: Condominio[];
  /** Ex.: "Set/2026"; null quando não há apuração. */
  ultima_apuracao: string | null;
};

export type CotaLista = {
  id: number;
  share_number: string;
  condominium_code: CondominioCodigo;
  client_id: number;
  client_name: string;
  client_cpf: string;
  share_value: string;
  acquisition_date: string | null;
  maturity_date: string | null;
  status: StatusCota;
  withdrawal_requested: boolean;
  withdrawal_effective_date: string | null;
};
