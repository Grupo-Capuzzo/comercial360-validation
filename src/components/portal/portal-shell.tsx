import Link from "next/link";
export function PortalShell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-[var(--surface-muted)] text-[var(--ink)]"><header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5"><Link href="/portal" className="font-serif text-xl">Grupo <strong>Capuzzo</strong></Link><div className="flex gap-5"><Link href="/portal">Empresas</Link><form action="/auth/signout" method="post"><button>Sair</button></form></div></header><div className="mx-auto max-w-6xl px-6 py-10">{children}</div></main>;
}
