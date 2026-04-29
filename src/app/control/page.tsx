"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

const STATUS_STYLE = {
  ok: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-300", dot: "bg-emerald-400" },
  warn: { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-300", dot: "bg-amber-400" },
  fail: { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-300", dot: "bg-red-400" },
} as const;

const OVERALL_STYLE = {
  healthy: "bg-emerald-500/15 border-emerald-500/40 text-emerald-200",
  degraded: "bg-amber-500/15 border-amber-500/40 text-amber-200",
  broken: "bg-red-500/15 border-red-500/40 text-red-200",
} as const;

export default function ControlPage() {
  const [report, setReport] = useState<ControllerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/control", { cache: "no-store" });
      const data = (await res.json()) as { success: boolean; report?: ControllerReport; error?: string };
      if (!data.success || !data.report) throw new Error(data.error ?? "Failed");
      setReport(data.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/dashboard" className="text-sm text-slate-400 hover:text-slate-200">← Dashboard</Link>
          <span className="text-slate-600">/</span>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <span>🤖</span> Agent Contrôleur
          </h1>
        </div>

        {loading && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 animate-pulse">
            Analyse en cours…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-red-300">
            {error}
            <button onClick={load} className="ml-4 underline">Réessayer</button>
          </div>
        )}

        {report && !loading && (
          <>
            <div className={`rounded-2xl border p-6 mb-6 ${OVERALL_STYLE[report.overall]}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase tracking-wider opacity-70">État global</div>
                <button
                  onClick={load}
                  className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full"
                >
                  ↻ Re-scanner
                </button>
              </div>
              <div className="text-3xl font-bold mb-2">
                {report.overall === "healthy" && "✅ Healthy"}
                {report.overall === "degraded" && "⚠️ Degraded"}
                {report.overall === "broken" && "🔥 Broken"}
              </div>
              <div className="text-sm opacity-80 mb-4">{report.ai_summary}</div>
              <div className="text-xs opacity-50">
                Généré: {new Date(report.generated_at).toLocaleString("fr-FR")}
              </div>
            </div>

            {report.ai_actions.length > 0 && (
              <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-6 mb-6">
                <div className="text-sm uppercase tracking-wider text-cyan-300 mb-3">Actions recommandées par l&apos;agent</div>
                <ul className="space-y-2">
                  {report.ai_actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="text-cyan-400 mt-0.5">→</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Checks détaillés</div>
              {report.checks.map((check, i) => {
                const style = STATUS_STYLE[check.status];
                return (
                  <div key={i} className={`rounded-xl border ${style.border} ${style.bg} p-4 flex items-start gap-4`}>
                    <div className={`${style.dot} w-2.5 h-2.5 rounded-full mt-2 shrink-0`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-medium">{check.name}</div>
                        <div className={`text-xs uppercase tracking-wider ${style.text}`}>{check.status}</div>
                      </div>
                      <div className="text-sm text-slate-300">{check.detail}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
