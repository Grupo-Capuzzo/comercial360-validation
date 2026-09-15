export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type DashboardExecutiveRow = {
  clientes_total: number;
  clientes_ativos: number;
  clientes_inativos: number;
  clientes_em_validacao: number;
  vinculos_total: number;
  vinculos_ativos: number;
  vinculos_inativos: number;
  vinculos_em_validacao: number;
  eventos_contratuais: number;
  pendencias_qualidade: number;
  consultado_em: string;
};

export type ProductSummaryRow = {
  produto_id: string;
  produto_codigo: string;
  produto_nome: string;
  categoria_codigo: string;
  categoria_nome: string;
  vinculos_total: number;
  vinculos_ativos: number;
  vinculos_inativos: number;
  vinculos_em_validacao: number;
  clientes_distintos: number;
  ultima_atualizacao_origem_em: string | null;
};

export type Client360Row = {
  cliente_id_global: string;
  tipo_pessoa: string | null;
  cpf_cnpj_normalizado: string | null;
  nome_preferencial: string | null;
  email_preferencial: string | null;
  telefone_preferencial: string | null;
  status_cliente: string | null;
  qualidade_cadastro: string | null;
  tem_conflito: boolean;
  total_vinculos_produto: number;
  total_produtos_ativos: number;
  total_eventos_contratuais: number;
  primeira_data_inicio: string | null;
  proximo_limite_contratual: string | null;
  dados_atualizados_em: string | null;
  produtos: Json;
};

type ReadonlyView<Row> = {
  Row: Row;
  Insert: never;
  Update: never;
  Relationships: [];
};

export type Database = {
  api_comercial: {
    Tables: Record<string, never>;
    Views: {
      dashboard_executivo: ReadonlyView<DashboardExecutiveRow>;
      produtos_resumo: ReadonlyView<ProductSummaryRow>;
      cliente_360: ReadonlyView<Client360Row>;
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
