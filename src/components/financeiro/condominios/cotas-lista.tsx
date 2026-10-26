"use client";

/**
 * Todas as Cotas — cópia fiel de templates/cotas_lista.html do sistema local.
 * As ações (Nova Cota, Editar, Inativar, Reativar, Excluir) aparecem como no original
 * e ficam sem efeito até a gravação no Supabase ser implementada.
 */
import { useMemo, useState } from "react";

import { formatarMoeda } from "@/components/financeiro/condominios/format";
import type { Condominio, CotaLista, ResumoCotas } from "@/components/financeiro/condominios/types";

type Filtros = { q: string; produto: string; status: string };

const semAcao = { title: "Disponível após a integração com o banco", "aria-disabled": true } as const;

function normalizar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function BadgeProduto({ code }: { code: CotaLista["condominium_code"] }) {
  if (code === "civil") return <span className="badge badge-civil">🏗️ Civil</span>;
  if (code === "agro") return <span className="badge badge-agro">🌾 Agro</span>;
  return <span className="badge badge-saude">🏥 Saúde</span>;
}

export function CotasListaCondominios({
  cotas,
  resumo,
  conds,
}: {
  cotas: CotaLista[];
  resumo: ResumoCotas;
  conds: Condominio[];
}) {
  const [rascunho, setRascunho] = useState<Filtros>({ q: "", produto: "", status: "" });
  const [filtros, setFiltros] = useState<Filtros>(rascunho);
  const filtrando = Boolean(filtros.q || filtros.produto || filtros.status);

  const lista = useMemo(() => {
    const termo = normalizar(filtros.q.trim());
    return cotas.filter((c) => {
      if (filtros.produto && c.condominium_code !== filtros.produto) return false;
      if (filtros.status && c.status !== filtros.status) return false;
      if (termo) {
        const alvo = normalizar(`${c.share_number} ${c.client_name} ${c.client_cpf}`);
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [cotas, filtros]);

  return (
    <>
      <div className="page-header">
        <div className="page-header-icon">📄</div>
        <div className="page-header-title">Todas as Cotas</div>
        <div className="page-header-sub">Gestão de cotas de investimento — todos os produtos</div>
      </div>

      <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        <div className="metric-card">
          <div className="metric-value">{resumo.total}</div>
          <div className="metric-label">Total de Cotas</div>
        </div>
        <div className="metric-card">
          <div className="metric-value" style={{ color: "#4ade80" }}>{resumo.ativas}</div>
          <div className="metric-label">Ativas</div>
        </div>
        <div className="metric-card">
          <div className="metric-value" style={{ color: "#fbbf24" }}>{resumo.pendentes}</div>
          <div className="metric-label">Pendentes</div>
        </div>
        <div className="metric-card">
          <div className="metric-value" style={{ color: "#555" }}>{resumo.inativas}</div>
          <div className="metric-label">Inativas</div>
        </div>
        <div className="metric-card">
          <div className="metric-value text-gold">{formatarMoeda(resumo.valor_total)}</div>
          <div className="metric-label">Patrimônio Ativo</div>
        </div>
      </div>

      <div className="metrics-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: -8 }}>
        {resumo.por_produto.map((pp) => (
          <div className="metric-card" key={pp.code}>
            <div className="metric-value">{pp.qty}</div>
            <div className="metric-label">
              {pp.name} · {formatarMoeda(pp.total_value)}
            </div>
          </div>
        ))}
      </div>

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFiltros(rascunho);
        }}
      >
        <div className="toolbar-left">
          <div className="search-wrap">
            <input
              type="text"
              name="q"
              value={rascunho.q}
              onChange={(e) => setRascunho((r) => ({ ...r, q: e.target.value }))}
              placeholder="Buscar por nº cota, cliente, CPF…"
              className="form-control"
              style={{ width: 260 }}
            />
          </div>
          <select
            name="produto"
            className="form-control form-control-sm"
            style={{ width: 160 }}
            value={rascunho.produto}
            onChange={(e) => setRascunho((r) => ({ ...r, produto: e.target.value }))}
          >
            <option value="">Todos os produtos</option>
            {conds.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          <select
            name="status"
            className="form-control form-control-sm"
            style={{ width: 140 }}
            value={rascunho.status}
            onChange={(e) => setRascunho((r) => ({ ...r, status: e.target.value }))}
          >
            <option value="">Todos os status</option>
            <option value="ativa">Ativas</option>
            <option value="pendente">Pendentes</option>
            <option value="inativa">Inativas</option>
          </select>
          <button type="submit" className="btn btn-secondary btn-sm">Filtrar</button>
          {filtrando && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const vazio = { q: "", produto: "", status: "" };
                setRascunho(vazio);
                setFiltros(vazio);
              }}
            >
              Limpar
            </button>
          )}
        </div>
        <div className="toolbar-right">
          <a className="btn btn-primary" {...semAcao}>+ Nova Cota</a>
        </div>
      </form>

      {lista.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Produto</th>
                  <th>Cliente</th>
                  <th>Valor</th>
                  <th>Aquisição</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((cota) => (
                  <tr key={cota.id}>
                    <td style={{ fontSize: 18, fontWeight: 700, color: "#d4af37" }}>{cota.share_number}</td>
                    <td><BadgeProduto code={cota.condominium_code} /></td>
                    <td>
                      <a style={{ color: "#F5F5F5" }} {...semAcao}>{cota.client_name}</a>
                      <div className="text-mono text-dim" style={{ fontSize: 11 }}>{cota.client_cpf}</div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{formatarMoeda(cota.share_value)}</td>
                    <td className="text-dim">{cota.acquisition_date || "—"}</td>
                    <td className="text-dim">{cota.maturity_date || "—"}</td>
                    <td>
                      {cota.status === "ativa" ? (
                        <>
                          <span className="badge badge-active">● Ativa</span>
                          {cota.withdrawal_requested && (
                            <>
                              {" "}
                              <span className="badge badge-retirada" title={`Retirada efetiva em ${cota.withdrawal_effective_date || "—"}`}>
                                📤 Em retirada
                              </span>
                            </>
                          )}
                        </>
                      ) : cota.status === "pendente" ? (
                        <span className="badge badge-pending">● Pendente</span>
                      ) : (
                        <span className="badge badge-inactive">● Inativa</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <a className="btn btn-secondary btn-sm" {...semAcao}>Editar</a>{" "}
                      {cota.status === "ativa" || cota.status === "pendente" ? (
                        <button type="button" className="btn btn-danger btn-sm" {...semAcao}>Inativar</button>
                      ) : (
                        <button type="button" className="btn btn-success btn-sm" {...semAcao}>Reativar</button>
                      )}{" "}
                      <button type="button" className="btn btn-delete btn-sm" {...semAcao}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-dim" style={{ fontSize: 12, marginTop: 10, textAlign: "right" }}>
            {lista.length} cota(s) encontrada(s)
          </div>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <div className="empty-state-title">Nenhuma cota encontrada</div>
          <div className="empty-state-sub">
            {filtrando ? "Tente ajustar os filtros de busca." : "Cadastre a primeira cota para começar."}
          </div>
        </div>
      )}
    </>
  );
}
