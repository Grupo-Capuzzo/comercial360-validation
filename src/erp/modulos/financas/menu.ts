/* eslint-disable @typescript-eslint/no-explicit-any */
// Menu lateral do ERP, por empresa (porte de financas/menu.py).
// Cada empresa tem uma lista de TÓPICOS; um tópico pode ser um link direto ou um grupo com itens.
// Para personalizar uma empresa, acrescente-a em MENUS_ESPECIFICOS.
import { g, url_for } from "../../core/flask";

function _admin(): boolean {
  const u = g().portal_user;
  return !!(u && u.admin);
}

function _i(chave: string, rotulo: string, url: string, icone: string) {
  return { chave, rotulo, url, icone };
}

function _base(slug: string): Record<string, any> {
  const u = (ep: string, kw: Record<string, any> = {}) => url_for(ep, { slug, ...kw });
  return {
    inicio: { id: "inicio", rotulo: "Visão geral", curto: "Início", icone: "painel", url: u("financas.painel"), chaves: ["painel"] },
    receber: { id: "receber", rotulo: "Contas a receber", curto: "Receber", icone: "receber", url: u("financas.lancamentos", { tipo: "receber" }), chaves: ["receber"] },
    pagar: { id: "pagar", rotulo: "Contas a pagar", curto: "Pagar", icone: "pagar", url: u("financas.lancamentos", { tipo: "pagar" }), chaves: ["pagar"] },
    bancos: {
      id: "bancos", rotulo: "Bancos", curto: "Bancos", icone: "banco", itens: [
        _i("extrato", "Extrato bancário", u("financas.extrato"), "extrato"),
        _i("conciliacao", "Conciliação (OFX)", u("financas.conciliacao"), "conciliar"),
        _i("cad_contas", "Contas bancárias", u("financas.cad_contas"), "banco"),
      ],
    },
    relatorios: {
      id: "relatorios", rotulo: "Relatórios", curto: "Relatórios", icone: "dre", itens: [
        _i("rel_fluxo", "Fluxo de caixa", u("financas.rel_fluxo"), "fluxo"),
        _i("rel_dre", "DRE gerencial", u("financas.rel_dre"), "dre"),
      ],
    },
    cadastros: {
      id: "cadastros", rotulo: "Cadastros", curto: "Cadastros", icone: "pessoas", itens: [
        _i("cad_pessoas", "Clientes e fornecedores", u("financas.cad_pessoas"), "pessoas"),
        _i("cad_categorias", "Categorias", u("financas.cad_categorias"), "categoria"),
        _i("cad_centros", "Centros de custo", u("financas.cad_centros"), "centro"),
        ...(_admin() ? [_i("cad_integracoes", "Integrações (API)", u("financas.cad_integracoes"), "conciliar")] : []),
      ],
    },
  };
}

function _capuzzo(slug: string, b: Record<string, any>): any[] {
  const u = (ep: string, kw: Record<string, any> = {}) => url_for(ep, { slug, ...kw });
  const condominios = {
    id: "condominios", rotulo: "Condomínios", curto: "Condomínios", icone: "predio", produto: true, itens: [
      _i("cond_painel", "Painel dos condomínios", u("financas.cond_painel"), "painel"),
      _i("cond_civil", "Construção Civil", u("financas.cond_produto", { code: "civil" }), "predio"),
      _i("cond_agro", "Agronegócio", u("financas.cond_produto", { code: "agro" }), "predio"),
      _i("cond_saude", "Saúde", u("financas.cond_produto", { code: "saude" }), "predio"),
      _i("cond_cotistas", "Cotistas", u("financas.cond_cotistas"), "pessoas"),
      _i("cond_contratos", "Contratos e assinaturas", u("financas.cond_contratos"), "contrato"),
      _i("cond_vencimentos", "Vencimentos e retiradas", u("financas.cond_vencimentos"), "calendario"),
      _i("cond_apuracao", "Apurações (histórico)", u("financas.cond_apuracao"), "calculo"),
    ],
  };
  const tatica = {
    id: "tatica", rotulo: "Gestão Tática", curto: "Tática", icone: "tatica", produto: true, itens: [
      _i("tat_painel", "Painel", u("financas.tatica_painel"), "painel"),
      _i("tat_mes", "Apuração do mês", u("financas.gt_mes"), "calculo"),
      _i("tat_clientes", "Clientes", u("financas.gt_clientes"), "pessoas"),
      _i("tat_importar", "Importar planilha", u("financas.gt_importar"), "abrir"),
    ],
  };
  const titulos = {
    id: "titulos", rotulo: "Títulos Privados", curto: "Títulos", icone: "titulo", produto: true, itens: [
      _i("tit_painel", "Carteira", u("financas.titulos_painel"), "painel"),
      _i("tit_parcelas", "Parcelas a receber", u("financas.titulos_painel", { aba: "parcelas" }), "calendario"),
    ],
  };
  return [b.inicio, b.receber, b.pagar, b.bancos, "-", condominios, tatica, titulos, "-", b.relatorios, b.cadastros];
}

export const MENUS_ESPECIFICOS: Record<string, (slug: string, b: Record<string, any>) => any[]> = { assessoria: _capuzzo };

export function menu_empresa(slug: string): any[] {
  const b = _base(slug);
  const fn = MENUS_ESPECIFICOS[slug];
  if (fn) return fn(slug, b);
  return [b.inicio, b.receber, b.pagar, b.bancos, "-", b.relatorios, b.cadastros];
}

export function topico_ativo(menu: any[], chave: string): string {
  for (const t of menu) {
    if (t === "-") continue;
    if ((t.chaves ?? []).includes(chave) || (t.itens ?? []).some((i: any) => i.chave === chave)) return t.id;
  }
  return "";
}
