/* eslint-disable @typescript-eslint/no-explicit-any */
// Porte de app/supabase_export.py (área temporária de exportação App → Supabase/Lovable).
// Na versão online os dados JÁ estão no Supabase: a tela continua igual (bases, esquemas,
// opções, pontos a confirmar), mas gerar/baixar arquivos não se aplica — ver
// generate_supabase_export(). Constantes e funções de configuração mantêm os nomes.
import { PyDate } from "../core/py";

export const EXPORT_ROOT = "exports/supabase_lovable";
export const MSG_ONLINE = "Não se aplica na versão online: os dados do app já estão no Supabase.";

export const CUTOFF_MINIMO = new PyDate(2026, 7, 1);
export const CUTOFF_PADRAO = new PyDate(2026, 7, 1);
export const AGRO_SPECIAL_RATE_FALLBACK = "0.035";

export const ESTRATEGIA_MENSAL = "delete_insert_por_data";
export const ESTRATEGIA_CADASTRAL = "upsert_cadastral";
export const ESTRATEGIAS = [ESTRATEGIA_MENSAL, ESTRATEGIA_CADASTRAL];

export const ORIGEM_HISTORICO = "historico_apuracao";
export const ORIGEM_RECALCULO = "calculo_regerado";
export const ORIGEM_CADASTRO = "cadastro_cotas";
export const META_PREFIXO = "_";
export const MESES_PT = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const FLUXO_TIPO = "Rendimento";
export const FLUXO_GRUPO = "Condomínios de Investimento";

export const OPCOES_PADRAO: Record<string, any> = {
  percentual_como_fracao: true,
  cadastro_somente_alteradas: false,
  fluxo_tipo: FLUXO_TIPO,
  fluxo_grupo: FLUXO_GRUPO,
  status_civil_ativa: "",
  status_civil_inativa: "",
  status_saude_ativa: "",
  status_saude_inativa: "",
};

export function pontos_a_confirmar(opcoes: Record<string, any> | null = null): [string, string][] {
  const op = { ...OPCOES_PADRAO, ...(opcoes ?? {}) };
  return [
    [
      "condominio_agro · data_base e data_de_calculo",
      "Hoje: data_base = INÍCIO e data_de_calculo = FIM do período de "
      + "rentabilidade apurado. Se no Supabase antigo data_de_calculo for a "
      + "data em que a apuração foi rodada (ou a data de pagamento), o "
      + "mapeamento precisa ser ajustado antes de rodar em produção.",
    ],
    [
      "fluxo_capuzzo · tipo, grupo e detalhe",
      `Hoje: tipo = '${op.fluxo_tipo}', grupo = '${op.fluxo_grupo}' e `
      + "detalhe = nome do condomínio. Confira a nomenclatura que o fluxo "
      + "antigo já usa no Supabase/Lovable; se for diferente, ajuste os "
      + "campos na tela antes de rodar em produção.",
    ],
    [
      "condominio_saude · grafia do status (faz parte da chave)",
      "O status entra na chave do UPSERT da Saúde. O app grava "
      + `'${op.status_saude_ativa || "ativa"}' / `
      + `'${op.status_saude_inativa || "inativa"}'. Se o Supabase usar `
      + "outra grafia (ex.: 'Ativo' / 'Inativo'), o ON CONFLICT nunca casa "
      + "e cada execução INSERE tudo de novo. Ajuste a tradução do status "
      + "na tela antes de rodar em produção.",
    ],
    [
      "condominio_agro · percentual_rendimento",
      "Formato atual: "
      + (op.percentual_como_fracao ? "fração (1,7% grava 0,017)." : "percentual (1,7% grava 1,70).")
      + " Confira como os meses até 06/2026 estão gravados e use o mesmo.",
    ],
  ];
}

// ── Esquema real das tabelas do Supabase ─────────────────────────────────
export const TABLE_SCHEMAS: Record<string, any> = {
  condominio_agro: {
    base: "agro", label: "Agronegócio", strategy: ESTRATEGIA_MENSAL, cutoff_column: "mes", conflict_columns: [],
    columns: ["mes", "data_base", "data_de_calculo", "numero_cota", "data_de_aquisicao", "cliente", "valor_da_cota",
      "percentual_rendimento", "valor_de_rendimento", "data_de_encerramento", "status_da_cota", "data_de_retirada"],
  },
  fluxo_capuzzo: {
    base: "fluxo", label: "Fluxo / Apurações", strategy: ESTRATEGIA_MENSAL, cutoff_column: "mes", conflict_columns: [],
    columns: ["tipo", "grupo", "detalhe", "cliente_ou_fornecedor", "mes", "mes_descricao", "periodo", "periodo_descricao", "valor"],
  },
  condominio_civil: {
    base: "civil", label: "Construção Civil", strategy: ESTRATEGIA_CADASTRAL, cutoff_column: null,
    conflict_columns: ["cliente", "cotas", "vencimento"],
    columns: ["cotas", "data_de_aquisicao", "data_de_renovacao", "data_de_retirada", "cliente", "valor_cota", "valor_multa",
      "valor_retirado", "status", "vencimento"],
  },
  condominio_saude: {
    base: "saude", label: "Saúde", strategy: ESTRATEGIA_CADASTRAL, cutoff_column: null,
    conflict_columns: ["cliente", "cota", "vencimento", "status"],
    columns: ["cota", "data_de_aquisicao", "data_de_renovacao", "data_de_retirada", "cliente", "valor_da_cota", "status", "vencimento"],
  },
};

export const TABELAS_PADRAO: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE_SCHEMAS).map(([tabela, s]) => [s.base, tabela]),
);

export const BASES: Record<string, any>[] = [
  { chave: "agro", label: "Agronegócio", condominio: "agro", tabela_padrao: "condominio_agro", estrategia_padrao: ESTRATEGIA_MENSAL,
    corte_padrao: "mes", descricao: "Rendimento mês a mês, uma linha por cota apurada." },
  { chave: "fluxo", label: "Fluxo / Apurações", condominio: null, tabela_padrao: "fluxo_capuzzo", estrategia_padrao: ESTRATEGIA_MENSAL,
    corte_padrao: "mes", descricao: "Lançamento por cliente/condomínio/mês, consolidando os três produtos." },
  { chave: "civil", label: "Construção Civil", condominio: "civil", tabela_padrao: "condominio_civil", estrategia_padrao: ESTRATEGIA_CADASTRAL,
    corte_padrao: "", descricao: "Posição atual das cotas (não é tabela mensal)." },
  { chave: "saude", label: "Saúde", condominio: "saude", tabela_padrao: "condominio_saude", estrategia_padrao: ESTRATEGIA_CADASTRAL,
    corte_padrao: "", descricao: "Posição atual das cotas (não é tabela mensal)." },
];
export const BASES_POR_CHAVE: Record<string, any> = Object.fromEntries(BASES.map((b) => [b.chave, b]));

export const INDICES_UNICOS_SUGERIDOS: Record<string, string> = {
  condominio_civil: "ux_condominio_civil_cliente_cotas_vencimento",
  condominio_saude: "ux_condominio_saude_cliente_cota_vencimento_status",
};

export function schema_da_base(chave: string): Record<string, any> {
  const tabela = TABELAS_PADRAO[chave];
  const s = TABLE_SCHEMAS[tabela];
  return { ...s, table: tabela, columns: [...s.columns], conflict_columns: [...s.conflict_columns] };
}

// ── Escape / identificadores ─────────────────────────────────────────────
const _RE_IDENTIFICADOR = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/** repr() simples de texto do Python (aspas simples). */
function pyRepr(v: any) { return v === null || v === undefined ? "None" : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; }

export function sql_quote(value: any): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (value instanceof PyDate) return "'" + (value.isDatetime ? value.strftime("%Y-%m-%d %H:%M:%S") : value.strftime("%Y-%m-%d")) + "'";
  const texto = String(value);
  if (texto === "") return "''";
  return "'" + texto.replace(/\x00/g, "").replace(/'/g, "''") + "'";
}

export function sql_identificador(nome: string, rotulo = "tabela"): string {
  const limpo = (nome || "").trim();
  if (!_RE_IDENTIFICADOR.test(limpo)) {
    throw new Error(`Nome de ${rotulo} inválido: ${pyRepr(nome)}. Use apenas letras, números e underscore (ex.: condominio_agro).`);
  }
  return limpo;
}

export function parse_cutoff(valor: any): PyDate {
  if (valor instanceof PyDate) return new PyDate(valor.year, valor.month, 1);
  let texto = String(valor ?? "").trim();
  if (!texto) throw new Error("A data de corte é obrigatória.");
  if (texto.length === 7) texto += "-01";
  let d: PyDate;
  try { d = PyDate.fromisoformat(texto); if (d.isDatetime) throw new Error(); } catch {
    throw new Error(`Data de corte inválida: ${pyRepr(valor)}. Use o formato AAAA-MM-DD.`);
  }
  return new PyDate(d.year, d.month, 1);
}
export function mes_label(comp: PyDate) { return `${String(comp.month).padStart(2, "0")}/${comp.year}`; }
export function mes_descricao(comp: PyDate) { return `${MESES_PT[comp.month]}/${comp.year}`; }

export const COLUNA_PROIBIDA = "competencia";
export class SQLInseguroError extends Error {}

export function resolver_config(chave: string, ajustes: Record<string, any> | null = null): Record<string, any> {
  if (!BASES_POR_CHAVE[chave]) throw new Error(`Base desconhecida: ${pyRepr(chave)}.`);
  const schema = schema_da_base(chave);
  ajustes = ajustes ?? {};
  const tabela = sql_identificador(ajustes.tabela || schema.table, "tabela");
  const estrategia = String(ajustes.estrategia || schema.strategy).trim();
  if (!ESTRATEGIAS.includes(estrategia)) {
    throw new Error(`Estratégia inválida para ${tabela}: ${pyRepr(estrategia)}. Use ${ESTRATEGIA_MENSAL} ou ${ESTRATEGIA_CADASTRAL}.`);
  }
  let coluna_corte: string | null = null;
  let conflito: string[] = [...schema.conflict_columns];
  if (estrategia === ESTRATEGIA_MENSAL) {
    const bruto = String(ajustes.coluna_corte || schema.cutoff_column || "").trim();
    if (!bruto) throw new Error(`A tabela ${tabela} usa a estratégia mensal e precisa da coluna de corte (ex.: mes).`);
    coluna_corte = sql_identificador(bruto, "coluna de corte");
    if (coluna_corte.toLowerCase() === COLUNA_PROIBIDA) {
      throw new Error(`A coluna ${pyRepr(COLUNA_PROIBIDA)} não existe nas tabelas do Supabase. Para ${tabela}, use a coluna real de corte mensal (ex.: mes).`);
    }
    if (!schema.columns.includes(coluna_corte)) {
      throw new Error(`A coluna de corte ${pyRepr(coluna_corte)} não está entre as colunas exportadas para ${tabela}: ${schema.columns.join(", ")}.`);
    }
    conflito = [];
  } else {
    let bruto: any = (ajustes.conflict_columns && ajustes.conflict_columns.length ? ajustes.conflict_columns : null) || schema.conflict_columns;
    if (typeof bruto === "string") bruto = bruto.split(",").map((p: string) => p.trim()).filter(Boolean);
    conflito = bruto.map((c: string) => sql_identificador(c, "coluna de conflito"));
    if (!conflito.length) throw new Error(`A tabela ${tabela} usa UPSERT e precisa da chave lógica (ex.: cliente, cotas).`);
    const faltando = conflito.filter((c) => !schema.columns.includes(c));
    if (faltando.length) throw new Error(`Chave de conflito de ${tabela} contém coluna(s) que não são exportadas: ${faltando.join(", ")}.`);
  }
  return {
    chave, label: BASES_POR_CHAVE[chave].label, tabela, tabela_padrao: schema.table, estrategia,
    coluna_corte, conflict_columns: conflito, columns: [...schema.columns],
  };
}

export function resolver_configs(bases: Iterable<string>, table_mapping: Record<string, any> | null = null) {
  const tm = table_mapping ?? {};
  const sel = new Set(bases);
  return BASES.map((b) => b.chave).filter((c) => sel.has(c)).map((c) => resolver_config(c, tm[c]));
}

export const NOMES_ARQUIVOS: Record<string, string> = {
  excel: "conferencia_supabase.xlsx",
  csv: "conferencia_supabase.csv",
  sql: "atualizar_supabase_incremental.sql",
  readme: "README_EXPORTACAO.txt",
};

export function validar_parametros(cutoff_date: any, selected_condominiums: any[] | null): [PyDate, string[], string[]] {
  if (cutoff_date === null || cutoff_date === undefined || String(cutoff_date).trim() === "") {
    throw new Error("Informe a data de corte. Ela é obrigatória.");
  }
  const cutoff = parse_cutoff(cutoff_date);
  const alertas: string[] = [];
  if (cutoff.compare(CUTOFF_MINIMO) < 0) {
    alertas.push(`A data de corte informada (${cutoff.isoformat()}) é ANTERIOR a ${CUTOFF_MINIMO.isoformat()}. Nas tabelas mensais, competências a partir dessa data serão substituídas — inclusive meses que vieram das planilhas originais. Confira o CSV antes de executar.`);
  }
  const bases = (selected_condominiums ?? []).filter((c) => BASES_POR_CHAVE[c]);
  if (!bases.length) throw new Error("Selecione pelo menos uma base para exportar.");
  return [cutoff, bases, alertas];
}

/** Online: não gera arquivos (os dados já estão no Supabase). Mantém as validações da tela
 *  e então avisa que a ação não se aplica (ValueError → mensagem na tela, como no Flask). */
export async function generate_supabase_export(
  cutoff_date: any, selected_condominiums: any[] | null = null, table_mapping: Record<string, any> | null = null,
  _opcoes: Record<string, any> | null = null,
): Promise<Record<string, any>> {
  const [, bases] = validar_parametros(cutoff_date, selected_condominiums);
  resolver_configs(bases, table_mapping);
  throw new Error(MSG_ONLINE);
}

export function pasta_do_export(_export_id: string): { name: string } | null { return null; }
export function carregar_resumo(_export_id: string): Record<string, any> | null { return null; }
export function caminho_arquivo_export(_export_id: string, _file_type: string): { stem: string; suffix: string } | null { return null; }
export function listar_exports_supabase(_limite = 15): Record<string, any>[] { return []; }
