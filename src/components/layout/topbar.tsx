import { Icon } from "@/components/ui/icon";

export function Topbar({ onMenuOpen }: { onMenuOpen: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center gap-4 border-b border-slate-200/80 bg-white/88 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <button
        aria-label="Abrir navegação"
        className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 lg:hidden"
        onClick={onMenuOpen}
        type="button"
      >
        <Icon className="h-5 w-5" name="menu" />
      </button>

      <div className="relative hidden w-full max-w-md sm:block">
        <Icon
          className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          name="search"
        />
        <input
          aria-label="Buscar no Comercial 360"
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/80 pl-10 pr-16 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[var(--gold)] focus:bg-white focus:ring-4 focus:ring-amber-100/60"
          placeholder="Buscar cliente, contrato ou produto..."
          type="search"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400 shadow-sm">
          ⌘ K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          aria-label="Notificações"
          className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100"
          title="Notificações serão habilitadas em uma próxima etapa"
          type="button"
        >
          <Icon className="h-5 w-5" name="bell" />
        </button>

        <div className="mx-1 hidden h-7 w-px bg-slate-200 sm:block" />

        <div className="flex items-center gap-3 rounded-xl p-1.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--navy)] text-xs font-semibold text-white">
            GC
          </span>

          <span className="hidden sm:block">
            <span className="block text-xs font-semibold text-slate-800">
              Grupo Capuzzo
            </span>
            <span className="block text-[11px] text-slate-400">
              Administrador
            </span>
          </span>
        </div>

        <form action="/auth/signout" method="post">
          <button
            className="ml-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
            type="submit"
          >
            Sair
          </button>
        </form>
      </div>
    </header>
  );
}
