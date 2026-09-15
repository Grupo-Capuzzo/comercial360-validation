import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/icon";

const navigation: Array<{ label: string; icon: IconName; active?: boolean }> = [
  { label: "Dashboard", icon: "dashboard", active: true },
  { label: "Clientes", icon: "clients" },
  { label: "Produtos", icon: "products" },
  { label: "Consórcio", icon: "consortium" },
  { label: "Investimentos", icon: "investments" },
  { label: "Serviços", icon: "services" },
  { label: "Leads", icon: "leads" },
  { label: "CRM", icon: "briefcase" },
  { label: "Relatórios", icon: "reports" },
];

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  return (
    <>
      {isOpen ? (
        <button
          aria-label="Fechar navegação"
          className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
          type="button"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-white/7 bg-[var(--navy)] text-white transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[88px] items-center gap-3 border-b border-white/8 px-6">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--gold)] text-[var(--navy)] shadow-[0_8px_30px_rgba(195,154,65,.22)]">
            <span className="font-serif text-xl font-semibold">C</span>
          </div>
          <div>
            <p className="font-serif text-[17px] font-semibold tracking-[0.01em]">
              Grupo Capuzzo
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
              Comercial 360
            </p>
          </div>
        </div>

        <nav aria-label="Navegação principal" className="flex-1 px-4 py-6">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
            Operação
          </p>
          <ul className="space-y-1">
            {navigation.map((item) => (
              <li key={item.label}>
                {item.active ? (
                  <Link
                    aria-current="page"
                    className="group flex items-center gap-3 rounded-xl bg-white/[0.09] px-3.5 py-3 text-sm font-medium text-white shadow-[inset_3px_0_0_var(--gold)]"
                    href="/"
                    onClick={onClose}
                  >
                    <Icon className="h-[19px] w-[19px] text-[var(--gold-light)]" name={item.icon} />
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="group flex cursor-default items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium text-white/58"
                    title="Módulo previsto para uma próxima etapa"
                  >
                    <Icon className="h-[19px] w-[19px] text-white/38" name={item.icon} />
                    {item.label}
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/16" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="m-4 rounded-2xl border border-white/8 bg-white/[0.045] p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-white/72">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.1)]" />
            Ambiente conectado
          </div>
          <p className="text-[11px] leading-5 text-white/38">
            servopa-integrations
          </p>
          <p className="truncate font-mono text-[10px] text-white/28">
            umvldqzzliqmgkvoedyd
          </p>
        </div>
      </aside>
    </>
  );
}
