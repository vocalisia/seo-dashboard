"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, CheckCircle2, RefreshCw, ShieldCheck, TriangleAlert, XCircle,
  type LucideIcon,
} from "lucide-react";
import { ToolAlert, ToolLoadingState, ToolPage, ToolPanel } from "@/components/dashboard/ToolPage";

interface HealthCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  metric?: number | string;
}

interface ControllerReport {
  generated_at: string;
  overall: "healthy" | "degraded" | "broken";
  checks: HealthCheck[];
  ai_summary: string;
  ai_actions: string[];
}

const STATUS_STYLE: Record<HealthCheck["status"], { label: string; card: string; text: string; icon: LucideIcon }> = {
  ok: {
    label: "Opérationnel",
    card: "border-emerald-500/25 bg-emerald-500/[0.06]",
    text: "text-emerald-300",
    icon: CheckCircle2,
  },
  warn: {
    label: "À surveiller",
    card: "border-amber-500/25 bg-amber-500/[0.06]",
    text: "text-amber-200",
    icon: TriangleAlert,
  },
  fail: {
    label: "En échec",
    card: "border-red-500/25 bg-red-500/[0.06]",
    text: "text-red-200",
    icon: XCircle,
  },
};

const OVERALL = {
  healthy: { label: "Opérationnel", detail: "Les contrôles essentiels répondent.", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100", icon: CheckCircle2 },
  degraded: { label: "À surveiller", detail: "Au moins un contrôle nécessite une intervention.", className: "border-amber-500/30 bg-amber-500/10 text-amber-100", icon: TriangleAlert },
  broken: { label: "Critique", detail: "Un service essentiel ne répond pas correctement.", className: "border-red-500/30 bg-red-500/10 text-red-100", icon: XCircle },
} as const;

export default function ControlPage() {
  const [report, setReport] = useState<ControllerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/control", { cache: "no-store", signal });
      const data = await response.json() as { success: boolean; report?: ControllerReport; error?: string };
      if (!response.ok || !data.success || !data.report) {
        throw new Error(data.error ?? `Contrôle indisponible (HTTP ${response.status})`);
      }
      setReport(data.report);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Le centre de contrôle ne répond pas.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const counts = useMemo(() => ({
    ok: report?.checks.filter((check) => check.status === "ok").length ?? 0,
    warn: report?.checks.filter((check) => check.status === "warn").length ?? 0,
    fail: report?.checks.filter((check) => check.status === "fail").length ?? 0,
  }), [report]);

  const overall = report ? OVERALL[report.overall] : null;

  return (
    <ToolPage
      title="Centre de contrôle"
      eyebrow="Diagnostic du système"
      description="Vérifie la base, les sources SEO, les connecteurs et les endpoints critiques. Un contrôle peut prendre quelques secondes car les services sont réellement interrogés."
      icon={ShieldCheck}
      width="standard"
      actions={(
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          {loading ? "Contrôle en cours" : "Relancer le contrôle"}
        </button>
      )}
    >
      {loading && (
        <ToolLoadingState
          title="Contrôle des services en cours"
          description="Base de données, GSC, GA4, PageSpeed, moteur IA et endpoints métier sont testés en parallèle."
          rows={6}
        />
      )}

      {error && !loading && (
        <ToolAlert
          tone="error"
          action={<button type="button" onClick={() => void load()} className="min-h-11 rounded-lg border border-red-300/30 px-3 font-medium hover:bg-red-500/10">Réessayer</button>}
        >
          <strong className="block text-white">Contrôle interrompu</strong>
          {error}
        </ToolAlert>
      )}

      {report && overall && !loading && (
        <>
          <section className={`rounded-xl border p-5 ${overall.className}`} aria-labelledby="control-overall-title">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <overall.icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] opacity-75">État global</div>
                  <h2 id="control-overall-title" className="mt-1 text-2xl font-semibold text-white">{overall.label}</h2>
                  <p className="mt-1 text-sm leading-6">{report.ai_summary || overall.detail}</p>
                </div>
              </div>
              <div className="text-xs opacity-75">
                Mesuré le {new Date(report.generated_at).toLocaleString("fr-FR")}
              </div>
            </div>
          </section>

          <section aria-label="Résumé des contrôles" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              ["Opérationnels", counts.ok, CheckCircle2, "text-emerald-300"],
              ["À surveiller", counts.warn, TriangleAlert, "text-amber-200"],
              ["En échec", counts.fail, XCircle, "text-red-200"],
            ] as const).map(([label, value, Icon, tone]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-400">{label}</span>
                  <Icon className={`h-4 w-4 ${tone}`} aria-hidden="true" />
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</div>
              </div>
            ))}
          </section>

          {report.ai_actions.length > 0 && (
            <ToolPanel className="p-5" labelledBy="controller-actions-title">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-300" aria-hidden="true" />
                <h2 id="controller-actions-title" className="font-semibold text-white">Actions prioritaires</h2>
              </div>
              <ol className="mt-4 grid gap-2">
                {report.ai_actions.map((action, index) => (
                  <li key={`${index}-${action}`} className="flex gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-3 text-sm leading-6 text-slate-200">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-blue-500/10 text-xs font-semibold text-blue-200">{index + 1}</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ol>
            </ToolPanel>
          )}

          <section aria-labelledby="controller-checks-title">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 id="controller-checks-title" className="font-semibold text-white">Contrôles détaillés</h2>
                <p className="mt-1 text-sm text-slate-400">Chaque ligne correspond à une vérification réelle et expose son résultat.</p>
              </div>
              <span className="text-xs text-slate-500">{report.checks.length} contrôles</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {report.checks.map((check) => {
                const style = STATUS_STYLE[check.status];
                const Icon = style.icon;
                return (
                  <article key={check.name} className={`rounded-xl border p-4 ${style.card}`}>
                    <div className="flex items-start gap-3">
                      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.text}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h3 className="font-medium text-white">{check.name}</h3>
                          <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{check.detail}</p>
                        {check.metric !== undefined && <div className="mt-2 text-xs tabular-nums text-slate-500">Mesure : {check.metric}</div>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </ToolPage>
  );
}
