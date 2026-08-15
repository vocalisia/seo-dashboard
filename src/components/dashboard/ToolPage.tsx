import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert } from "lucide-react";

type ToolTone = "info" | "success" | "warning" | "error";

const ALERT_TONES: Record<ToolTone, string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-100",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  error: "border-red-500/30 bg-red-500/10 text-red-100",
};

const ALERT_ICONS: Record<ToolTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
};

export function ToolPage({
  title,
  description,
  eyebrow,
  icon: Icon,
  actions,
  children,
  width = "wide",
}: {
  title: string;
  description: string;
  eyebrow?: string;
  icon: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  width?: "standard" | "wide";
}) {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-6 sm:px-6 lg:py-8">
        <div className={`${width === "wide" ? "max-w-[96rem]" : "max-w-6xl"} mx-auto flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between`}>
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-300">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              {eyebrow && <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">{eyebrow}</div>}
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      <div className={`${width === "wide" ? "max-w-[96rem]" : "max-w-6xl"} mx-auto space-y-5 px-4 py-5 sm:px-6 lg:py-7`}>
        {children}
      </div>
    </div>
  );
}

export function ToolPanel({
  children,
  className = "",
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={`rounded-xl border border-slate-800 bg-slate-900/70 ${className}`}>
      {children}
    </section>
  );
}

export function ToolAlert({ tone, children, action }: { tone: ToolTone; children: ReactNode; action?: ReactNode }) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${ALERT_TONES[tone]}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 leading-5">{children}</div>
      </div>
      {action}
    </div>
  );
}

export function ToolEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-64 place-items-center px-5 py-12 text-center">
      <div className="max-w-lg">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function ToolLoadingState({
  title,
  description,
  rows = 4,
}: {
  title: string;
  description: string;
  rows?: number;
}) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-300">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        </span>
        <div>
          <div className="font-medium text-white">{title}</div>
          <div className="mt-1 text-sm text-slate-400">{description}</div>
        </div>
      </div>
      <div className="mt-5 space-y-3" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-800/70 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}
