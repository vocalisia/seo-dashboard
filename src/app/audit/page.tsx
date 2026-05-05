"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Zap, Monitor, Smartphone, CheckCircle, XCircle } from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface PageSpeedMetrics {
  score: number;
  lcp: number;
  cls: number;
  fcp: number;
  ttfb: number;
  inp: number;
}

interface AuditResult {
  mobile: PageSpeedMetrics;
  desktop: PageSpeedMetrics;
  url: string;
}

interface SiteAuditResult {
  site: Site;
  result: AuditResult | null;
  error: string | null;
  status: "pending" | "running" | "done" | "error";
}

type MetricStatus = "good" | "needs-improvement" | "poor";

function getScoreColor(score: number): string {
  if (score >= 90) return "text-green-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function getScoreBg(score: number): string {
  if (score >= 90) return "border-green-500";
  if (score >= 50) return "border-yellow-500";
  return "border-red-500";
}

function metricStatus(metric: string, value: number): MetricStatus {
  const thresholds: Record<string, [number, number]> = {
    lcp: [2.5, 4],
    cls: [0.1, 0.25],
    fcp: [1.8, 3],
    ttfb: [0.8, 1.8],
  };
  const [good, poor] = thresholds[metric] ?? [1, 2];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

function statusBadge(s: MetricStatus): string {
  if (s === "good") return "bg-green-500/20 text-green-400";
  if (s === "needs-improvement") return "bg-yellow-500/20 text-yellow-400";
  return "bg-red-500/20 text-red-400";
}

function ScoreCircle({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`w-20 h-20 rounded-full border-4 ${getScoreBg(score)} flex items-center justify-center`}>
        <span className={`text-2xl font-bold ${getScoreColor(score)}`}>{score}</span>
      </div>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

function MetricRow({ label, mobileVal, desktopVal, metric, unit }: {
  label: string; mobileVal: number; desktopVal: number; metric: string; unit: string;
}) {
  const ms = metricStatus(metric, mobileVal);
  const ds = metricStatus(metric, desktopVal);
  return (
    <tr className="border-b border-gray-800">
      <td className="py-3 px-4 text-gray-300 font-medium">{label}</td>
      <td className="py-3 px-4 text-center">
        <span className={`px-2 py-1 rounded text-sm font-mono ${statusBadge(ms)}`}>
          {mobileVal.toFixed(metric === "cls" ? 3 : 2)}{unit}
        </span>
      </td>
      <td className="py-3 px-4 text-center text-xs text-gray-500">{ms === "good" ? "✓ Bon" : ms === "needs-improvement" ? "⚠ Moyen" : "✗ Mauvais"}</td>
      <td className="py-3 px-4 text-center">
        <span className={`px-2 py-1 rounded text-sm font-mono ${statusBadge(ds)}`}>
          {desktopVal.toFixed(metric === "cls" ? 3 : 2)}{unit}
        </span>
      </td>
      <td className="py-3 px-4 text-center text-xs text-gray-500">{ds === "good" ? "✓ Bon" : ds === "needs-improvement" ? "⚠ Moyen" : "✗ Mauvais"}</td>
    </tr>
  );
}

export default function AuditPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | "all" | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<SiteAuditResult[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setSites(data as Site[]);
          if ((data as Site[]).length > 0) setSelectedSite((data as Site[])[0]);
        }
      })
      .catch(() => {});
  }, []);

  async function runAudit() {
    if (!selectedSite) return;

    if (selectedSite === "all") {
      await runBatchAudit();
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setBatchResults([]);
    try {
      const res = await fetch(`/api/pagespeed?url=${encodeURIComponent(selectedSite.url)}&site_id=${selectedSite.id}`);
      const data = await res.json() as AuditResult & { error?: string };
      if (data.error) { setError(data.error); return; }
      setResult(data);
    } catch {
      setError("Erreur lors de l'audit");
    } finally {
      setLoading(false);
    }
  }

  async function runBatchAudit() {
    setLoading(true);
    setResult(null);
    setError(null);
    setBatchProgress(0);

    const initial: SiteAuditResult[] = sites.map((s) => ({ site: s, result: null, error: null, status: "pending" }));
    setBatchResults(initial);

    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      setBatchResults((prev) => prev.map((r, idx) => idx === i ? { ...r, status: "running" } : r));
      try {
        const res = await fetch(`/api/pagespeed?url=${encodeURIComponent(site.url)}&site_id=${site.id}`);
        const data = await res.json() as AuditResult & { error?: string };
        setBatchResults((prev) => prev.map((r, idx) =>
          idx === i ? { ...r, status: data.error ? "error" : "done", result: data.error ? null : data, error: data.error ?? null } : r
        ));
      } catch (e) {
        setBatchResults((prev) => prev.map((r, idx) =>
          idx === i ? { ...r, status: "error", error: e instanceof Error ? e.message : "Erreur réseau" } : r
        ));
      }
      setBatchProgress(i + 1);
    }
    setLoading(false);
  }

  const isBatchMode = selectedSite === "all";

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-400 hover:text-white transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Zap className="w-6 h-6 text-yellow-400" />
        <h1 className="text-xl font-bold">Audit Technique</h1>
        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full">PageSpeed</span>
      </header>

      <div className="px-6 py-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap gap-3 mb-8">
          <select
            title="Sélectionner un site"
            value={selectedSite === "all" ? "all" : typeof selectedSite === "object" && selectedSite ? String(selectedSite.id) : ""}
            onChange={(e) => {
              setResult(null); setBatchResults([]);
              if (e.target.value === "all") { setSelectedSite("all"); return; }
              const s = sites.find((site) => site.id === parseInt(e.target.value, 10));
              setSelectedSite(s ?? null);
            }}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">🌐 Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.url}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={runAudit}
            disabled={loading || !selectedSite}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading
              ? isBatchMode ? `Audit ${batchProgress}/${sites.length}...` : "Analyse en cours..."
              : isBatchMode ? `Auditer tous les sites (${sites.length})` : "Lancer l'audit"}
          </button>
        </div>

        {/* Progress bar for batch */}
        {isBatchMode && loading && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Progression</span>
              <span>{batchProgress}/{sites.length}</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${sites.length > 0 ? (batchProgress / sites.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Batch results table */}
        {isBatchMode && batchResults.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold">Résultats — {batchResults.filter(r => r.status === "done").length}/{sites.length} audités</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                    <th className="py-3 px-4 text-left">Site</th>
                    <th className="py-3 px-4 text-center">Mobile</th>
                    <th className="py-3 px-4 text-center">Desktop</th>
                    <th className="py-3 px-4 text-center">LCP mob.</th>
                    <th className="py-3 px-4 text-center">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((r) => (
                    <tr key={r.site.id} className="border-b border-gray-800">
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{r.site.name}</div>
                        <div className="text-xs text-gray-500">{r.site.url.replace(/^https?:\/\//, "")}</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {r.result ? <span className={`font-bold text-lg ${getScoreColor(r.result.mobile.score)}`}>{r.result.mobile.score}</span> : "—"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {r.result ? <span className={`font-bold text-lg ${getScoreColor(r.result.desktop.score)}`}>{r.result.desktop.score}</span> : "—"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {r.result ? (
                          <span className={`px-2 py-0.5 rounded text-xs font-mono ${statusBadge(metricStatus("lcp", r.result.mobile.lcp))}`}>
                            {r.result.mobile.lcp.toFixed(2)}s
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {r.status === "pending" && <span className="text-gray-600 text-xs">En attente</span>}
                        {r.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-blue-400 mx-auto" />}
                        {r.status === "done" && <CheckCircle className="w-4 h-4 text-green-400 mx-auto" />}
                        {r.status === "error" && <span title={r.error ?? ""}><XCircle className="w-4 h-4 text-red-400 mx-auto" /></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Single site loading */}
        {!isBatchMode && loading && (
          <div className="flex flex-col items-center gap-4 py-16 text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p>Analyse PageSpeed en cours... (jusqu&apos;à 60s)</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 rounded-xl p-4">{error}</div>
        )}

        {/* Single site result */}
        {result && !isBatchMode && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-6">Scores Performance</h2>
              <div className="flex justify-around flex-wrap gap-8">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2 text-gray-400 text-sm"><Smartphone className="w-4 h-4" /> Mobile</div>
                  <ScoreCircle score={result.mobile.score} label="Score mobile" />
                </div>
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2 text-gray-400 text-sm"><Monitor className="w-4 h-4" /> Desktop</div>
                  <ScoreCircle score={result.desktop.score} label="Score desktop" />
                </div>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800">
                <h2 className="text-lg font-semibold">Core Web Vitals</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                      <th className="py-3 px-4 text-left">Métrique</th>
                      <th className="py-3 px-4 text-center">Mobile</th>
                      <th className="py-3 px-4 text-center">Statut</th>
                      <th className="py-3 px-4 text-center">Desktop</th>
                      <th className="py-3 px-4 text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    <MetricRow label="LCP" mobileVal={result.mobile.lcp} desktopVal={result.desktop.lcp} metric="lcp" unit="s" />
                    <MetricRow label="CLS" mobileVal={result.mobile.cls} desktopVal={result.desktop.cls} metric="cls" unit="" />
                    <MetricRow label="FCP" mobileVal={result.mobile.fcp} desktopVal={result.desktop.fcp} metric="fcp" unit="s" />
                    <MetricRow label="TTFB" mobileVal={result.mobile.ttfb} desktopVal={result.desktop.ttfb} metric="ttfb" unit="s" />
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-xs text-gray-600 text-center">
              Données via Google PageSpeed Insights · {result.url}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
