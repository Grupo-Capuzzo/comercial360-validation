import Link from "next/link";
import { PortalShell } from "@/components/portal/portal-shell";
import { AccessResult } from "@/components/portal/access-result";
import { requireCompany, attempt } from "@/services/portal.service";
export default async function Company({ params }: { params: Promise<{ empresa: string }> }) {
    const { empresa } = await params;
    const result = await attempt(() => requireCompany(empresa));
    if (!result.ok) return <PortalShell><AccessResult error={result.error} /></PortalShell>;
    const { modules } = result.data;
    return <PortalShell><h1 className="font-serif text-3xl">Módulos da empresa</h1><div className="mt-8 grid gap-6 sm:grid-cols-2">{["comercial", "financeiro"].filter(m => modules.includes(m)).map(m => <article key={m} className="rounded-[22px] border bg-white p-8"><h2 className="mb-5 text-2xl capitalize">{m}</h2><Link href={m === "financeiro" ? `/financeiro/${empresa}/clientes` : `/comercial/${empresa}`} className="rounded-full bg-[var(--navy)] px-8 py-3 text-white">Acessar {m === "financeiro" ? "Financeiro" : "Comercial"}</Link></article>)}</div></PortalShell>;
}
