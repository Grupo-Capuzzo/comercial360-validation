import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalShell } from "@/components/portal/portal-shell";
import { AccessResult } from "@/components/portal/access-result";
import { financeSections, financialRecords, attempt, type FinanceSection } from "@/services/portal.service";
export default async function Finance({ params, searchParams }: { params: Promise<{ empresa: string; secao: string }>; searchParams: Promise<{ q?: string }> }) {
  const { empresa, secao } = await params;
  if (!financeSections.includes(secao as FinanceSection)) notFound();
    const { q } = await searchParams;
    const loaded = await attempt(() => financialRecords(empresa, secao as FinanceSection, q));
    if (!loaded.ok) return <PortalShell><AccessResult error={loaded.error} /></PortalShell>;
    const result = loaded.data;
    return <PortalShell><h1 className="font-serif text-3xl">Financeiro · {secao}</h1><nav className="my-6 flex flex-wrap gap-5">{financeSections.map(s => <Link key={s} href={`/financeiro/${empresa}/${s}`} className="capitalize underline">{s}</Link>)}</nav><form className="mb-5 flex gap-3"><input aria-label="Filtrar registros" name="q" defaultValue={q} className="rounded-lg border bg-white p-3" /><button className="rounded-lg bg-[var(--navy)] px-5 text-white">Filtrar</button></form>{result.state === "not_loaded" ? <p role="status">Carga real ainda não realizada para esta empresa.</p> : <><p className="mb-4 text-sm">Histórico de referência: {result.reference}. Não representa saldo atual.</p>{!result.rows.length ? <p role="status">Nenhum registro encontrado.</p> : <div className="overflow-auto rounded-2xl border bg-white"><table className="w-full text-left"><thead><tr>{["Referência", "Descrição", "Status", "Valor preservado", "Data", "Histórico"].map(h => <th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{result.rows.map(r => <tr key={r.origem_id} className="border-t"><td className="p-4">{r.origem_id}</td><td className="p-4">{r.descricao}</td><td className="p-4">{r.status ?? "Não informado"}</td><td className="p-4">{r.valor === null ? "Não informado" : `R$ ${r.valor}`}</td><td className="p-4">{r.data_referencia ?? "Não informada"}</td><td className="p-4"><details><summary>Detalhes</summary><pre>{JSON.stringify(r.detalhes, null, 2)}</pre></details></td></tr>)}</tbody></table></div>}</>}</PortalShell>;
}
