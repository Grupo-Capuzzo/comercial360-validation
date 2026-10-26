/**
 * Dashboard Executivo — cópia fiel de templates/dashboard.html do sistema local.
 */
import Link from "next/link";

import { formatarMoeda, formatarPercentual } from "@/components/financeiro/condominios/format";
import type { CondominioCodigo, DashboardCondominios as Dados } from "@/components/financeiro/condominios/types";

type Links = {
  produto?: (code: CondominioCodigo) => string | undefined;
  clientes?: string;
  cotas?: string;
  apuracao?: string;
  backup?: string;
};

function QuickLink({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className="quick-card">{children}</Link>
  ) : (
    <a className="quick-card" aria-disabled="true" title="Em construção">{children}</a>
  );
}

export function DashboardCondominios({ dados, links = {} }: { dados: Dados; links?: Links }) {
  const { s_res, conds } = dados;
  const porProd = new Map(s_res.por_produto.map((p) => [p.code, p]));

  return (
    <>
      <div className="hero">
        <div className="hero-title">🏛️ &nbsp;Painel de Gestão — Condomínios de Investimento</div>
        <div className="hero-sub">Visão executiva de cotas, clientes e produtos · Grupo Capuzzo</div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">💰</div>
          <div className="metric-value">{formatarMoeda(s_res.valor_total)}</div>
          <div className="metric-label">Patrimônio em Cotas</div>
          <div className="metric-sub">total investido ativo</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">👤</div>
          <div className="metric-value">{dados.total_clients}</div>
          <div className="metric-label">Clientes Ativos</div>
          <div className="metric-sub">cotistas cadastrados</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">📄</div>
          <div className="metric-value">{s_res.ativas}</div>
          <div className="metric-label">Cotas Ativas</div>
          <div className="metric-sub">{s_res.pendentes} pendentes</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">🏛️</div>
          <div className="metric-value">{conds.filter((c) => c.active).length}</div>
          <div className="metric-label">Produtos Ativos</div>
          <div className="metric-sub">condomínios em operação</div>
        </div>
      </div>

      <div className="metrics-grid" style={{ marginTop: -8 }}>
        <div className="metric-card">
          <div className="metric-icon">📊</div>
          <div className="metric-value">{s_res.total}</div>
          <div className="metric-label">Total de Cotas</div>
          <div className="metric-sub">todas as situações</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">⏳</div>
          <div className="metric-value">{s_res.pendentes}</div>
          <div className="metric-label">Pendentes</div>
          <div className="metric-sub">aguardando ativação</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">🔒</div>
          <div className="metric-value">{s_res.inativas}</div>
          <div className="metric-label">Inativas</div>
          <div className="metric-sub">encerradas</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">📐</div>
          <div className="metric-value">{dados.ultima_apuracao ?? "—"}</div>
          <div className="metric-label">Última Apuração</div>
          <div className="metric-sub">mês calculado</div>
        </div>
      </div>

      <hr className="divider-gold" />

      <div className="section-label">🏛️ &nbsp;Produtos de Investimento</div>

      <div className="cards-grid">
        {conds.map((cond) => {
          const prod = porProd.get(cond.code);
          const href = links.produto?.(cond.code);
          return (
            <div className="product-card" key={cond.code}>
              <div className="product-card-header">
                <div>
                  <div className="product-card-name">{cond.name}</div>
                  <div className="product-card-code">{cond.code.toUpperCase()}</div>
                </div>
                {cond.active ? (
                  <span className="product-badge-active">● Ativo</span>
                ) : (
                  <span className="badge badge-inactive">● Inativo</span>
                )}
              </div>

              <div className="product-stat">
                <span className="product-stat-label">Taxa mensal</span>
                <span className="product-stat-value">{formatarPercentual(cond.default_monthly_rate)}</span>
              </div>
              <div className="product-stat">
                <span className="product-stat-label">Dia de pagamento</span>
                <span className="product-stat-value">Dia {cond.payment_day}</span>
              </div>
              <div className="product-stat">
                <span className="product-stat-label">Cotas ativas</span>
                <span className="product-stat-value">{prod?.qty ?? 0}</span>
              </div>

              {cond.code === "agro" && (
                <div className="note-box" style={{ marginTop: 10 }}>
                  <span style={{ color: "#fbbf24", fontWeight: 600 }}>Taxa especial vencimento: </span>
                  <span>3,5% a 4,5%</span>
                </div>
              )}

              <div className="product-value">
                <div className="product-value-label">Patrimônio ativo</div>
                <div className="product-value-amount">{formatarMoeda(prod?.total_value ?? 0)}</div>
              </div>

              {href ? (
                <Link href={href} className="btn btn-primary btn-full">Abrir {cond.name} →</Link>
              ) : (
                <a className="btn btn-primary btn-full" aria-disabled="true" title="Em construção">Abrir {cond.name} →</a>
              )}
            </div>
          );
        })}
      </div>

      <hr className="divider-gold" />

      <div className="section-label">⚡ &nbsp;Acesso Rápido</div>
      <div className="quick-grid">
        <QuickLink href={links.clientes}>👤 &nbsp;Gestão de Clientes</QuickLink>
        <QuickLink href={links.cotas}>📄 &nbsp;Todas as Cotas</QuickLink>
        <QuickLink href={links.apuracao}>📐 &nbsp;Apuração Geral</QuickLink>
        <QuickLink href={links.backup}>💾 &nbsp;Backup</QuickLink>
      </div>
    </>
  );
}
