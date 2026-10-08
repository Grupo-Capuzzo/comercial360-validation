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

export type LeadCentralRow = {
  lead_id: string;
  produto_id: string;
  produto_codigo: string;
  produto_nome: string;
  categoria_codigo: string;
  categoria_nome: string;
  origem: string | null;
  origem_tipo: string;
  origem_registro_id: string | null;
  nome: string;
  email: string | null;
  telefone: string | null;
  status: string;
  cliente_id_global: string | null;
  data_entrada: string;
  objetivo: string | null;
  faixa_valor: string | null;
  investimento_mensal: string | null;
  interesse_simulacao: string | null;
  detalhes: Json;
  criado_por: string | null;
  atualizado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type InvestmentPositionCurrentRow = {
  posicao_id: string;
  cliente_id_global: string;
  nome_preferencial: string | null;
  produto_id: string;
  produto_codigo: string;
  produto_nome: string;
  data_referencia: string | null;
  numero_cotas_ativas: number | null;
  valor_ativo: number | null;
  montante: number | null;
  rendimento: number | null;
  rentabilidade: number | null;
  aportes: number | null;
  saques: number | null;
  tarifas: number | null;
  saldo_final: number | null;
  saldo_bloqueado: number | null;
  data_vencimento: string | null;
  status_origem: string | null;
  atualizado_na_origem_em: string | null;
  coletado_em: string | null;
  tabela_origem: string | null;
  registro_origem_id: string | null;
};

export type InvestmentCurrentBalanceRow = {
  cliente_id_global: string;
  nome_preferencial: string | null;
  valor_total_atual: number;
  atualizado_na_origem_em: string | null;
  produtos: Json;
};

export type CrmPipelineRow = {
  etapa_id: string;
  codigo: string;
  nome: string;
  ordem: number;
  tipo: string;
  probabilidade_padrao: number | null;
  ativo: boolean;
};

export type CrmOpportunityRow = {
  oportunidade_id: string;
  cliente_id_global: string | null;
  nome_cliente: string | null;
  nome_prospect: string | null;
  titulo: string;
  produto_id: string | null;
  produto_codigo: string | null;
  produto_nome: string | null;
  etapa_id: string;
  etapa_codigo: string;
  etapa_nome: string;
  etapa_ordem: number;
  etapa_tipo: string;
  valor_potencial: number | null;
  probabilidade: number | null;
  responsavel_usuario_id: string | null;
  responsavel_nome: string | null;
  origem_oportunidade: string | null;
  proxima_acao: string | null;
  proxima_acao_em: string | null;
  previsao_fechamento: string | null;
  etapa_alterada_em: string | null;
  fechada_em: string | null;
  motivo_perda: string | null;
  criada_por_usuario_id: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type CrmTaskRow = {
  tarefa_id: string;
  oportunidade_id: string | null;
  cliente_id_global: string | null;
  nome_cliente: string | null;
  titulo: string;
  descricao: string | null;
  tipo: string | null;
  prioridade: string | null;
  status: string;
  responsavel_usuario_id: string | null;
  responsavel_nome: string | null;
  criada_por_usuario_id: string | null;
  prazo_em: string | null;
  concluida_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type LeadRow = {
  lead_id: string;
  produto_id: string;
  origem: string | null;
  origem_tipo: string;
  origem_registro_id: string | null;
  nome: string;
  email: string | null;
  telefone: string | null;
  status: string;
  cliente_id_global: string | null;
  data_entrada: string;
  objetivo: string | null;
  faixa_valor: string | null;
  investimento_mensal: string | null;
  interesse_simulacao: string | null;
  detalhes: Json;
  criado_por: string | null;
  atualizado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type LeadInsert = {
  lead_id?: string;
  produto_id: string;
  origem?: string | null;
  origem_tipo?: string;
  origem_registro_id?: string | null;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  status?: string;
  cliente_id_global?: string | null;
  data_entrada?: string;
  objetivo?: string | null;
  faixa_valor?: string | null;
  investimento_mensal?: string | null;
  interesse_simulacao?: string | null;
  detalhes?: Json;
  criado_por: string;
  atualizado_por?: string | null;
  criado_em?: string;
  atualizado_em?: string;
};

export type LeadUpdate = {
  produto_id?: string;
  origem?: string | null;
  origem_tipo?: string;
  nome?: string;
  email?: string | null;
  telefone?: string | null;
  status?: string;
  cliente_id_global?: string | null;
  objetivo?: string | null;
  faixa_valor?: string | null;
  investimento_mensal?: string | null;
  interesse_simulacao?: string | null;
  detalhes?: Json;
  atualizado_por: string;
  atualizado_em?: string;
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
      leads_central: ReadonlyView<LeadCentralRow>;
      investimentos_posicoes_atuais:
        ReadonlyView<InvestmentPositionCurrentRow>;
      investimentos_saldos_atuais:
        ReadonlyView<InvestmentCurrentBalanceRow>;
      crm_pipeline: ReadonlyView<CrmPipelineRow>;
      crm_oportunidades: ReadonlyView<CrmOpportunityRow>;
      crm_tarefas: ReadonlyView<CrmTaskRow>;
    };

    Functions: {
      lead_criar_oportunidade: {
        Args: {
          p_lead_id: string;
        };
        Returns: string;
      };

      crm_mover_oportunidade: {
        Args: {
          p_dados: Json;
        };
        Returns: string;
      };

      crm_atualizar_oportunidade: {
        Args: {
          p_dados: Json;
        };
        Returns: string;
      };

      crm_criar_tarefa: {
        Args: {
          p_dados: Json;
        };
        Returns: string;
      };

      crm_concluir_tarefa: {
        Args: {
          p_dados: Json;
        };
        Returns: string;
      };
    };

    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };

  comercial_360: {
    Tables: {
      leads: {
        Row: LeadRow;
        Insert: LeadInsert;
        Update: LeadUpdate;
        Relationships: [];
      };
    };

    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};