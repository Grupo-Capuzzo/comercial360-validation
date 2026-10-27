"use client";

/**
 * Estrutura visual do sistema de Condomínios — cópia fiel de templates/base.html
 * do sistema local (mesmo menu, mesmos rótulos, mesmos ícones e classes CSS).
 */
import Link from "next/link";
import { useState } from "react";

import "./condominios.css";

export type CondPage =
  | "dashboard" | "clientes" | "cotas"
  | "produto_civil" | "produto_agro" | "produto_saude" | "vencimentos" | "apuracao" | "historico" | "validacao_sistema"
  | "titulos_privados_dashboard" | "titulos_privados_clientes" | "titulos_privados_emprestimos" | "titulos_privados_parcelas"
  | "titulos_privados_prorrogacoes" | "titulos_privados_amortizacoes" | "titulos_privados_calculadora_price"
  | "backup" | "configuracoes" | "auditoria" | "exportacao_supabase";

type Item = { page: CondPage; icon: string; label: string };

const condominiosItens: Item[] = [
  { page: "produto_civil", icon: "🏗️", label: "Construção Civil" },
  { page: "produto_agro", icon: "🌾", label: "Agronegócio" },
  { page: "produto_saude", icon: "🏥", label: "Saúde" },
  { page: "vencimentos", icon: "⏰", label: "Vencimentos e Retiradas" },
  { page: "apuracao", icon: "📐", label: "Apuração" },
  { page: "historico", icon: "📈", label: "Histórico" },
  { page: "validacao_sistema", icon: "🧾", label: "Validação Sistema" },
];

const titulosItens: Item[] = [
  { page: "titulos_privados_dashboard", icon: "📊", label: "Dashboard" },
  { page: "titulos_privados_clientes", icon: "👤", label: "Clientes de Títulos" },
  { page: "titulos_privados_emprestimos", icon: "💰", label: "Empréstimos" },
  { page: "titulos_privados_parcelas", icon: "🧾", label: "Parcelas / Recebimentos" },
  { page: "titulos_privados_prorrogacoes", icon: "⏳", label: "Prorrogações" },
  { page: "titulos_privados_amortizacoes", icon: "📉", label: "Amortizações" },
  { page: "titulos_privados_calculadora_price", icon: "🧮", label: "Calculadora Price" },
];

const sistemaItens: Item[] = [
  { page: "backup", icon: "💾", label: "Backup" },
  { page: "configuracoes", icon: "⚙️", label: "Configurações" },
  { page: "auditoria", icon: "🔍", label: "Auditoria" },
  { page: "exportacao_supabase", icon: "🛰️", label: "Exportação Supabase" },
];

type CondShellProps = {
  active: CondPage;
  /** Endereço de cada tela já construída; as demais ficam no menu sem link ativo. */
  hrefs: Partial<Record<CondPage, string>>;
  /** Endereço do link "Central do Grupo" (volta ao portal). */
  centralHref?: string;
  /** Avisos exibidos como as mensagens (flash) do sistema original. */
  alerts?: { category: "success" | "error" | "warning" | "info"; message: string }[];
  children: React.ReactNode;
};

function NavLink({ item, active, hrefs, sub = false }: { item: Item; active: CondPage; hrefs: CondShellProps["hrefs"]; sub?: boolean }) {
  const className = `${sub ? "sidebar-sublink" : "sidebar-link"} ${active === item.page ? "active" : ""}`;
  const content = (
    <>
      <span className="sidebar-link-icon">{item.icon}</span> {item.label}
    </>
  );
  const href = hrefs[item.page];
  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <a className={className} aria-disabled="true" title="Em construção">{content}</a>
  );
}

function Group({ id, icon, label, items, active, hrefs }: { id: string; icon: string; label: string; items: Item[]; active: CondPage; hrefs: CondShellProps["hrefs"] }) {
  const [open, setOpen] = useState(items.some((i) => i.page === active));
  return (
    <>
      <button
        className={`sidebar-group-btn ${open ? "group-open" : ""}`}
        id={`group-${id}-btn`}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sidebar-link-icon">{icon}</span>
        <span className="sidebar-group-label">{label}</span>
        <span className="sidebar-group-arrow">&#9660;</span>
      </button>
      <div className={`sidebar-subitems ${open ? "open" : ""}`} id={`group-${id}-items`}>
        {items.map((item) => (
          <NavLink key={item.page} item={item} active={active} hrefs={hrefs} sub />
        ))}
      </div>
    </>
  );
}

export function CondShell({ active, hrefs, centralHref = "/portal", alerts = [], children }: CondShellProps) {
  return (
    <div className="cond-app">
      <div className="app-wrapper">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-name">GRUPO CAPUZZO</div>
            <div className="sidebar-brand-sub">Gestão de Investimentos</div>
            <div className="sidebar-brand-label">Painel de Gestão</div>
          </div>

          <Link href={centralHref} className="sidebar-link">
            <span className="sidebar-link-icon">&#8592;</span> Central do Grupo
          </Link>

          <nav className="sidebar-nav">
            <div className="sidebar-section-label">VISÃO GERAL</div>
            <NavLink item={{ page: "dashboard", icon: "🏠", label: "Dashboard Executivo" }} active={active} hrefs={hrefs} />

            <div className="sidebar-divider" />

            <div className="sidebar-section-label">CADASTROS</div>
            <NavLink item={{ page: "clientes", icon: "👤", label: "Clientes" }} active={active} hrefs={hrefs} />
            <NavLink item={{ page: "cotas", icon: "📄", label: "Todas as Cotas" }} active={active} hrefs={hrefs} />

            <div className="sidebar-divider" />

            <div className="sidebar-section-label">OPERAÇÕES</div>
            <Group id="condominios" icon="🏛️" label="Condomínios" items={condominiosItens} active={active} hrefs={hrefs} />
            <Group id="titulos" icon="📜" label="Títulos Privados" items={titulosItens} active={active} hrefs={hrefs} />

            <div className="sidebar-divider" />

            <div className="sidebar-section-label">SISTEMA</div>
            {sistemaItens.map((item) => (
              <NavLink key={item.page} item={item} active={active} hrefs={hrefs} />
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-footer-dot" />
            <div className="sidebar-footer-text">Grupo Capuzzo &copy; 2026 &middot; v2.0</div>
          </div>
        </aside>

        <main className="main-content">
          <div className="page-container">
            {alerts.map((a) => (
              <div key={a.message} className={`alert alert-${a.category}`}>{a.message}</div>
            ))}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
