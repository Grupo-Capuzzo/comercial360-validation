import type { FinanceSection } from "@/services/portal.service";

export type FinanceArea = {
  slug: string;
  title: string;
  description: string;
  sources: FinanceSection[];
  operations: "read" | "planned";
  original: string;
};

export const financeAreas: FinanceArea[] = [
  { slug: "clientes", title: "Clientes", description: "Cadastro e vínculos preservados na consulta financeira.", sources: ["clientes"], operations: "read", original: "clientes_lista.html e clientes_detalhe.html" },
  { slug: "cotas", title: "Cotas", description: "Consulta das cotas projetadas para a empresa autorizada.", sources: ["cotas"], operations: "read", original: "cotas_lista.html e cotas_form.html" },
  { slug: "apuracoes", title: "Apurações", description: "Apurações históricas disponíveis para leitura.", sources: ["apuracoes"], operations: "read", original: "apuracao.html" },
  { slug: "vencimentos", title: "Vencimentos", description: "Estrutura para acompanhar vencimentos de cotas.", sources: [], operations: "planned", original: "condominios_vencimentos.html" },
  { slug: "renovacoes-retiradas", title: "Renovações e retiradas", description: "Fluxo de renovação, retirada e confirmação operacional.", sources: [], operations: "planned", original: "condominio.html e cotas_lista.html" },
  { slug: "historico", title: "Histórico", description: "Consulta histórica de apurações já projetadas.", sources: ["apuracoes"], operations: "read", original: "historico.html e historico_detalhe.html" },
  { slug: "relatorios", title: "Relatórios", description: "Espaço para relatórios financeiros aprovados.", sources: [], operations: "planned", original: "relatorios.html" },
  { slug: "validacao-projecao", title: "Validação e projeção", description: "Estrutura para validação da base e projeções autorizadas.", sources: [], operations: "planned", original: "validacao_sistema.html" },
  { slug: "titulos-privados", title: "Títulos Privados", description: "Consulta de títulos e parcelas históricas disponíveis.", sources: ["titulos", "parcelas"], operations: "read", original: "titulos_privados.html e templates correlatos" },
];

export function getFinanceArea(slug: string) {
  return financeAreas.find((area) => area.slug === slug);
}
