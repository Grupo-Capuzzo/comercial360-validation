import Link from "next/link";
import type { FinancialRow } from "@/services/portal.service";
import { financeAreas, type FinanceArea } from "@/lib/finance/navigation";

type Result = { label: string; state: "loaded" | "not_loaded"; reference: string | null; rows: FinancialRow[] };

function href(empresa: string, slug?: string) {
  return slug ? `/financeiro/${empresa}/${slug}` : `/financeiro/${empresa}`;
}

export function FinanceNav({ empresa, current }: { empresa: string; current?: string }) {
  return <nav aria-label="Navegação financeira" className="mt-6 flex flex-wrap gap-2">
    <Link className={`rounded-full px-3 py-2 text-sm ${!current ? "bg-[var(--navy)] text-white" : "bg-white ring-1 ring-slate-200"}`} href={href(empresa)}>Dashboard</Link>
    {financeAreas.map(area => <Link key={area.slug} className={`rounded-full px-3 py-2 text-sm ${current === area.slug ? "bg-[var(--navy)] text-white" : "bg-white ring-1 ring-slate-200"}`} href={href(empresa, area.slug)}>{area.title}</Link>)}
  </nav>;
}

function RowTable({ rows }: { rows: FinancialRow[] }) {
  if (!rows.length) return <p role="status" className="rounded-2xl border bg-white p-6">Nenhum registro encontrado para esta consulta.</p>;
  return <div className="overflow-auto rounded-2xl border bg-white"><table className="w-full text-left text-sm"><thead><tr>{["Referência", "Descrição", "Status", "Valor preservado", "Data", "Detalhes"].map(h => <th key={h} className="whitespace-nowrap p-4">{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.origem_id} className="border-t align-top"><td className="p-4 font-mono text-xs">{r.origem_id}</td><td className="p-4">{r.descricao}</td><td className="p-4">{r.status ?? "Não informado"}</td><td className="p-4">{r.valor === null ? "Não informado" : `R$ ${r.valor}`}</td><td className="p-4">{r.data_referencia ?? "Não informada"}</td><td className="p-4"><details><summary className="cursor-pointer underline">Ver</summary><pre className="mt-2 max-w-sm overflow-auto text-xs">{JSON.stringify(r.detalhes, null, 2)}</pre></details></td></tr>)}</tbody></table></div>;
}

function Unavailable({ area }: { area: FinanceArea }) {
  return <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6"><h2 className="font-serif text-xl">Operação ainda indisponível</h2><p className="mt-2 max-w-2xl text-sm leading-6">A interface de {area.title.toLowerCase()} segue a organização do módulo original, mas a persistência Supabase e as regras operacionais ainda não foram entregues. Nenhuma ação será simulada, recalculada no navegador ou confirmada como concluída.</p><button disabled className="mt-4 cursor-not-allowed rounded-full bg-slate-300 px-4 py-2 text-sm text-slate-600">Aguardando operação aprovada</button></section>;
}

export function FinanceDashboard({ empresa, results }: { empresa: string; results: Result[] }) {
  const loaded = results.filter(result => result.state === "loaded");
  const notLoaded = results.filter(result => result.state === "not_loaded");
  const total = loaded.reduce((sum, result) => sum + result.rows.length, 0);
  return <><header><p className="text-sm font-semibold uppercase tracking-[.16em] text-[var(--gold-dark)]">Capuzzo Assessoria & Consultoria</p><h1 className="mt-2 font-serif text-3xl">Condomínios de Investimento</h1><p className="mt-3 max-w-3xl leading-6 text-slate-600">Visão financeira por empresa autorizada. Valores são históricos preservados; não representam saldo atual.</p></header><FinanceNav empresa={empresa}/><section aria-label="Resumo financeiro" className="mt-8 grid gap-4 sm:grid-cols-3"><article className="rounded-2xl bg-[var(--navy)] p-5 text-white"><p className="text-sm text-white/65">Consultas disponíveis</p><p className="mt-2 text-3xl font-semibold">{loaded.length}</p></article><article className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Registros exibidos</p><p className="mt-2 text-3xl font-semibold">{total}</p></article><article className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Carga pendente</p><p className="mt-2 text-3xl font-semibold">{notLoaded.length}</p></article></section><section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{financeAreas.map(area => <article className="rounded-2xl border bg-white p-5" key={area.slug}><p className="text-xs uppercase tracking-wide text-[var(--gold-dark)]">{area.operations === "read" ? "Consulta" : "Estrutura visual"}</p><h2 className="mt-2 font-serif text-xl">{area.title}</h2><p className="mt-2 min-h-12 text-sm leading-6 text-slate-600">{area.description}</p><Link className="mt-5 inline-block underline" href={href(empresa, area.slug)}>Abrir {area.title}</Link></article>)}</section></>;
}

export function FinanceAreaPage({ empresa, area, results }: { empresa: string; area: FinanceArea; results: Result[] }) {
  const unavailable = area.operations === "planned";
  return <><header><p className="text-sm font-semibold uppercase tracking-[.16em] text-[var(--gold-dark)]">Condomínios de Investimento</p><h1 className="mt-2 font-serif text-3xl">{area.title}</h1><p className="mt-3 max-w-3xl leading-6 text-slate-600">{area.description}</p></header><FinanceNav empresa={empresa} current={area.slug}/><p className="mt-6 text-xs text-slate-500">Referência funcional: {area.original}.</p>{unavailable ? <div className="mt-6"><Unavailable area={area}/></div> : <section className="mt-6 space-y-6">{results.map(result => <article key={result.label}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-serif text-xl">{result.label}</h2>{result.state === "loaded" ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800">Consulta disponível</span> : <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-800">Carga ainda não realizada</span>}</div>{result.state === "not_loaded" ? <p role="status" className="rounded-2xl border bg-white p-6">A carga real ainda não foi realizada para esta empresa. Nenhum valor foi substituído por zero.</p> : <><p className="mb-3 text-sm text-slate-500">Histórico de referência: {result.reference ?? "não informado"}.</p><RowTable rows={result.rows}/></>}</article>)}</section>}</>;
}
