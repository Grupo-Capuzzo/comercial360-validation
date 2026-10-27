import Link from "next/link";
import { PortalShell } from "@/components/portal/portal-shell";
import { AccessResult } from "@/components/portal/access-result";
import { authorizedCompanies, attempt } from "@/services/portal.service";
export default async function Portal() {
    const result = await attempt(authorizedCompanies);
    if (!result.ok) return <PortalShell><AccessResult error={result.error} /></PortalShell>;
    const companies = result.data;
    return <PortalShell><p className="mb-3 text-xs tracking-[.25em] text-[var(--gold-dark)]">PORTAL DO GRUPO CAPUZZO</p><h1 className="font-serif text-4xl">Suas empresas</h1><p className="my-5">Escolha uma empresa autorizada para acessar os módulos.</p><div className="grid gap-6 sm:grid-cols-2">{companies.map(c => <article key={c.empresa_id} className="rounded-[22px] border border-slate-200 bg-white p-8 shadow-sm"><p className="text-sm text-green-800">Acesso autorizado</p><h2 className="my-6 text-xl font-semibold">{c.nome}</h2><Link className="inline-block rounded-full bg-[var(--navy)] px-8 py-3 text-white" href={`/portal/empresas/${c.empresa_id}`}>Acessar {c.nome}</Link></article>)}</div>{!companies.length && <p>Nenhuma empresa liberada para seu usuário.</p>}</PortalShell>;
}
