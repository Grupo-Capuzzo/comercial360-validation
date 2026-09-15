import { Icon, type IconName } from "@/components/ui/icon";

type MetricCardProps = {
  label: string;
  value: number | null;
  detail: string;
  icon: IconName;
  tone: "navy" | "gold" | "blue" | "green" | "violet";
  loading?: boolean;
};

const toneClasses = {
  navy: "bg-slate-100 text-slate-700",
  gold: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  violet: "bg-violet-50 text-violet-700",
};

const numberFormatter = new Intl.NumberFormat("pt-BR");

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
  loading = false,
}: MetricCardProps) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_30px_rgba(15,23,42,.07)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-400">
            {label}
          </p>
          {loading ? (
            <div className="mt-3 h-9 w-20 animate-pulse rounded-lg bg-slate-100" />
          ) : (
            <p className="mt-2 font-serif text-[32px] font-semibold leading-none tracking-[-0.03em] text-slate-900">
              {value === null ? "—" : numberFormatter.format(value)}
            </p>
          )}
        </div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${toneClasses[tone]}`}>
          <Icon className="h-[19px] w-[19px]" name={icon} />
        </span>
      </div>
      <p className="mt-4 truncate text-xs text-slate-500">{detail}</p>
      <div className="absolute bottom-0 left-0 h-0.5 w-0 bg-[var(--gold)] transition-all duration-300 group-hover:w-full" />
    </article>
  );
}
