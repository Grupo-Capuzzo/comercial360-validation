"use client";
import { useState } from "react";
import { CrmPage } from "@/components/crm/crm-page";
import { ClientsPage } from "@/components/clients/clients-page";
import { ProductsPage } from "@/components/products/products-page";
import { LeadsPage } from "@/components/leads/leads-page";
import { Dashboard } from "@/components/dashboard/dashboard";
import { CrmScopeContextProvider } from "./scope-context";
import type { CrmScopeContext } from "@/lib/crm/scope";
import { EMPRESAS } from "@/components/portal-grupo/portal-data";
import { scopedRows } from "@/services/crm-scope.client";
import { useEffect } from "react";

function Interactions({ scope }: { scope: string }) {
  const [result, setResult] = useState<{ data: Record<string, unknown>[]; error: { message: string } | null } | null>(null);
  useEffect(() => { let active = true; void scopedRows<Record<string, unknown>>(scope, "interactions").then(value => { if (active) setResult(value); }); return () => { active = false; }; }, [scope]);
  if (!result) return <p>Carregando interações…</p>;
  if (result.error) return <p role="alert">{result.error.message}</p>;
  return <section className="space-y-3"><h2 className="text-xl font-semibold">Interações</h2>{result.data.length ? result.data.map(row => <article className="rounded-xl border bg-white p-4" key={String(row.interacao_id)}><p>{String(row.resumo ?? "")}</p><p className="text-sm text-slate-500">{String(row.nome_cliente ?? "")} · {String(row.canal ?? "")}</p></article>) : <p>Nenhuma interação neste escopo.</p>}</section>;
}
export function CrmWorkspace({ context }: { context: CrmScopeContext }) {
  const [tab, setTab] = useState("pipeline");
  const company = EMPRESAS.find(item => item.slug === context.scope);
  return <CrmScopeContextProvider value={context.scope}>
    <div className="space-y-6">
      <header className="rounded-2xl border bg-white p-5" style={{ borderTop: `4px solid ${company?.tema.accent ?? "#C9A45C"}` }}>
        <h1 className="text-2xl font-semibold">{context.general ? "CRM GERAL" : `CRM — ${context.nome}`}</h1>
        <p className="mt-2 text-sm text-slate-500">{context.general ? "Consolidação das empresas autorizadas. Registros sem vínculo validado permanecem pendentes de classificação." : "Registros e indicadores exclusivos desta empresa."}</p>
        {!context.can_write && <p className="mt-2 text-sm">Acesso somente para leitura.</p>}
      </header>
      {!context.mapped ? <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-semibold">CRM pendente de conciliação</h2><p>O vínculo desta empresa com o catálogo Comercial precisa ser validado antes de liberar registros e operações.</p></section> : <>
        <nav aria-label="Áreas do CRM" className="flex flex-wrap gap-2">{[["dashboard","Dashboard"],["pipeline","Pipeline e tarefas"],["clients","Clientes"],["products","Produtos"],["leads","Leads"],["interactions","Interações"]].map(([id,label]) => <button type="button" aria-pressed={tab === id} className={`rounded-xl border px-4 py-2 ${tab === id ? "bg-slate-900 text-white" : "bg-white"}`} key={id} onClick={() => setTab(id)}>{label}</button>)}</nav>
        <div key={context.scope + tab}>{tab === "pipeline" ? <CrmPage /> : tab === "dashboard" ? <Dashboard /> : tab === "clients" ? <ClientsPage /> : tab === "products" ? <ProductsPage /> : tab === "leads" ? <LeadsPage /> : <Interactions scope={context.scope} />}</div>
      </>}
    </div>
  </CrmScopeContextProvider>;
}
