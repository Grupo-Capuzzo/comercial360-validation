/**
 * Empresas, identidade visual e módulos do portal — mesma configuração do
 * portal do sistema local (app/portal_grupo.py).
 */

export type Tema = {
  primary: string; secondary: string; accent: string; accent_dark: string;
  on_primary: string; on_accent: string; bg: string; surface: string;
  text: string; muted: string; font_head: string;
};

/**
 * Módulo de uma empresa.
 * - status "ativo": já funciona; "construcao": aparece com a etiqueta "Em construção".
 * - origem "fernando" | "bia": quem desenvolve o módulo (o Comercial é o que a Bia já fez — CRM).
 */
export type Modulo = { id: string; nome: string; icone: string; desc: string; status: "ativo" | "construcao"; origem: "fernando" | "bia" };

export type Empresa = {
  slug: string; nome: string; descricao: string; logo: string;
  tema: Partial<Tema>; modulos: Modulo[];
};

export type StatusEmpresa = "ativo" | "pendente" | "inativo";

export const STATUS: Record<StatusEmpresa, string> = { ativo: "Ativo", pendente: "Pendente", inativo: "Inativo" };

export const TEMA_GRUPO: Tema = {
  "primary": "#0B0B0B",
  "secondary": "#1C1A16",
  "accent": "#C9A45C",
  "accent_dark": "#9E7C34",
  "on_primary": "#F5EFE2",
  "on_accent": "#141210",
  "bg": "#F4F1EA",
  "surface": "#FFFFFF",
  "text": "#1A1814",
  "muted": "#6F685C",
  "font_head": "Montserrat"
};

export const EMPRESAS: Empresa[] = [
  {
    "slug": "assessoria",
    "nome": "Capuzzo Assessoria & Consultoria",
    "descricao": "Assessoria e consultoria empresarial",
    "logo": "assessoria.png",
    "tema": {
      "primary": "#0A0A0A",
      "secondary": "#2A2418",
      "accent": "#C7A955",
      "accent_dark": "#9E7C34",
      "on_primary": "#F3EBD6",
      "on_accent": "#141210",
      "bg": "#F5F2EA",
      "text": "#16140F",
      "muted": "#6E6552",
      "font_head": "Montserrat"
    },
    "modulos": [
      {
        "id": "condominios",
        "nome": "Condomínios de Investimento",
        "icone": "apartment",
        "desc": "Clientes, cotas, apuração, vencimentos e títulos privados.",
        "status": "ativo",
        "origem": "fernando"
      },
      {
        "id": "comercial",
        "nome": "Comercial",
        "icone": "handshake",
        "desc": "CRM, leads, propostas e formalização comercial.",
        "status": "ativo",
        "origem": "bia"
      },
      {
        "id": "financas",
        "nome": "Finanças",
        "icone": "payments",
        "desc": "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.",
        "status": "ativo",
        "origem": "fernando"
      },
      {
        "id": "juridico",
        "nome": "Jurídico",
        "icone": "gavel",
        "desc": "Contratos, processos e documentos jurídicos.",
        "status": "construcao",
        "origem": "fernando"
      }
    ]
  },
  {
    "slug": "cred",
    "nome": "Capuzzo Cred",
    "descricao": "",
    "logo": "cred.png",
    "tema": {
      "primary": "#0D0D0D",
      "secondary": "#3A2E1B",
      "accent": "#D4B26A",
      "accent_dark": "#A68646",
      "on_primary": "#F6EEDC",
      "on_accent": "#15120C",
      "bg": "#F6F3EC",
      "text": "#15130F",
      "muted": "#6B6250",
      "font_head": "Nunito"
    },
    "modulos": [
      {
        "id": "comercial",
        "nome": "Comercial",
        "icone": "handshake",
        "desc": "CRM, leads, propostas e formalização comercial.",
        "status": "ativo",
        "origem": "bia"
      },
      {
        "id": "financas",
        "nome": "Finanças",
        "icone": "payments",
        "desc": "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.",
        "status": "ativo",
        "origem": "fernando"
      },
      {
        "id": "juridico",
        "nome": "Jurídico",
        "icone": "gavel",
        "desc": "Contratos, processos e documentos jurídicos.",
        "status": "construcao",
        "origem": "fernando"
      }
    ]
  },
  {
    "slug": "ethernexus",
    "nome": "Ether Nexus",
    "descricao": "Centro de Excelência Médica e Empresarial",
    "logo": "ethernexus.png",
    "tema": {
      "primary": "#1B4D91",
      "secondary": "#236A9D",
      "accent": "#2F8FD8",
      "accent_dark": "#1B4D91",
      "on_primary": "#FFFFFF",
      "on_accent": "#FFFFFF",
      "bg": "#EEF3FA",
      "text": "#10223D",
      "muted": "#5A6B85",
      "font_head": "Mulish"
    },
    "modulos": [
      {
        "id": "financas",
        "nome": "Finanças",
        "icone": "payments",
        "desc": "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.",
        "status": "ativo",
        "origem": "fernando"
      },
      {
        "id": "comercial",
        "nome": "Comercial",
        "icone": "handshake",
        "desc": "CRM, leads, propostas e formalização comercial.",
        "status": "ativo",
        "origem": "bia"
      },
      {
        "id": "orcamentos",
        "nome": "Orçamentos",
        "icone": "request_quote",
        "desc": "Elaboração e acompanhamento de orçamentos.",
        "status": "construcao",
        "origem": "fernando"
      }
    ]
  },
  {
    "slug": "grao",
    "nome": "Grão",
    "descricao": "",
    "logo": "grao.png",
    "tema": {
      "primary": "#3F2117",
      "secondary": "#5E3A24",
      "accent": "#BD944F",
      "accent_dark": "#8E6A34",
      "on_primary": "#F3E6CF",
      "on_accent": "#2B160E",
      "bg": "#F6EFE3",
      "surface": "#FFFCF7",
      "text": "#2E1A12",
      "muted": "#7A6250",
      "font_head": "Oswald"
    },
    "modulos": []
  },
  {
    "slug": "hortstufas",
    "nome": "Hortstufas",
    "descricao": "Soluções para crescer",
    "logo": "hortstufas.png",
    "tema": {
      "primary": "#0F1A0C",
      "secondary": "#24461A",
      "accent": "#3E9B1C",
      "accent_dark": "#2C7512",
      "on_primary": "#EEF5E6",
      "on_accent": "#FFFFFF",
      "bg": "#F1F6EC",
      "text": "#15210F",
      "muted": "#5F6F55",
      "font_head": "Montserrat"
    },
    "modulos": [
      {
        "id": "producao",
        "nome": "Produção",
        "icone": "factory",
        "desc": "Ordens de produção e acompanhamento da fabricação.",
        "status": "construcao",
        "origem": "fernando"
      },
      {
        "id": "comercial",
        "nome": "Comercial",
        "icone": "handshake",
        "desc": "CRM, leads, propostas e formalização comercial.",
        "status": "ativo",
        "origem": "bia"
      },
      {
        "id": "financas",
        "nome": "Finanças",
        "icone": "payments",
        "desc": "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.",
        "status": "ativo",
        "origem": "fernando"
      },
      {
        "id": "orcamentos",
        "nome": "Orçamento",
        "icone": "request_quote",
        "desc": "Elaboração e acompanhamento de orçamentos.",
        "status": "construcao",
        "origem": "fernando"
      }
    ]
  },
  {
    "slug": "terceiriza",
    "nome": "Terceiriza Fácil",
    "descricao": "BPO inteligente",
    "logo": "terceiriza.png",
    "tema": {
      "primary": "#06214A",
      "secondary": "#0458A1",
      "accent": "#0692E7",
      "accent_dark": "#0458A1",
      "on_primary": "#EAF4FF",
      "on_accent": "#FFFFFF",
      "bg": "#EEF5FC",
      "text": "#0B1B33",
      "muted": "#566A86",
      "font_head": "Raleway"
    },
    "modulos": [
      {
        "id": "comercial",
        "nome": "Comercial",
        "icone": "handshake",
        "desc": "CRM, leads, propostas e formalização comercial.",
        "status": "ativo",
        "origem": "bia"
      },
      {
        "id": "financas",
        "nome": "Finanças",
        "icone": "payments",
        "desc": "Contas a pagar e receber, extrato, conciliação, fluxo de caixa e DRE.",
        "status": "ativo",
        "origem": "fernando"
      }
    ]
  },
  {
    "slug": "worldgym",
    "nome": "World Gym",
    "descricao": "Health Club",
    "logo": "worldgym.png",
    "tema": {
      "primary": "#111111",
      "secondary": "#2B2618",
      "accent": "#C0A040",
      "accent_dark": "#8C7328",
      "on_primary": "#FFFFFF",
      "on_accent": "#111111",
      "bg": "#F3F2EF",
      "text": "#141414",
      "muted": "#66625A",
      "font_head": "Roboto Slab"
    },
    "modulos": []
  }
];

export function tema(t?: Partial<Tema>): Tema {
  return { ...TEMA_GRUPO, surface: "#FFFFFF", ...(t ?? {}) } as Tema;
}

export function modulosDaEmpresa(e: Empresa): Modulo[] {
  return e.modulos;
}
