"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, HeartPulse, CheckCircle, AlertTriangle, XCircle, Link2, ExternalLink, Bot, Activity } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; url: string; }

interface CrawlStats {
  crawl_errors: number;
  robots_blocks: number;
  server_errors: number;
  last_crawl: string | null;
  sitemap_status: "ok" | "warning" | "error" | "unknown";
  sitemaps_total: number;
  sitemaps_pending: number;
  property: string;
}

interface HealthData {
  success: boolean;
  grade: string;
  overall_score: number;
  breakdown: { gsc_score: number; pagespeed_score: number; content_score: number; position_score: number };
  recommendations: string[];
  crawl_stats?: CrawlStats | null;
}

interface BrokenLinksData {
  success: boolean;
  total_checked: number;
  broken: { url: string; status_code: number }[];
  healthy: number;
  broken_count: number;
}

const GRADE_COLOR: Record<string, string> = {
  A: "text-emerald-400 border-emerald-500 bg-emerald-900/20",
  B: "text-blue-400 border-blue-500 bg-blue-900/20",
  C: "text-yellow-400 border-yellow-500 bg-yellow-900/20",
  D: "text-orange-400 border-orange-500 bg-orange-900/20",
  F: "text-red-400 border-red-500 bg-red-900/20",
};

function ScoreBar({ label, score, max = 100 }: { label: string; score: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-medium">{Math.round(score)}/100</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatMs(ms: number | null) {
  if (!ms || !Number.isFinite(ms)) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export default function HealthPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [broken, setBroken] = useState<BrokenLinksData | null>(null);
  const [loadingH, setLoadingH] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [allGrades, setAllGrades] = useState<{ name: string; grade: string; score: number; id: number }[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [lastTiming, setLastTiming] = useState<{ label: string; ms: number } | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [brokenError, setBrokenError] = useState<string | null>(null);
  const [gradesError, setGradesError] = useState<string | null>(null);

  function errorMessage(value: unknown, fallback: string): string {
    return value instanceof Error && value.message ? value.message : fallback;
  }

  async function timedFetch(label: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const started = performance.now();
    const res = await fetch(input, init);
    setLastTiming({ label, ms: performance.now() - started });
    return res;
  }

  async function fetchSites() {
    try {
      const res = await timedFetch("Sites", "/api/sites");
      const d = await res.json().catch(() => null) as Site[] | { error?: string } | null;
      if (!res.ok) {
        throw new Error(!Array.isArray(d) && d?.error ? d.error : `Sites indisponibles (HTTP ${res.status})`);
      }
      const list = Array.isArray(d) ? d : [];
      setSites(list);
      if (!selectedSite && list.length > 0) setSelectedSite(list[0].id);
    } catch (fetchError) {
      setHealthError(errorMessage(fetchError, "Impossible de charger les sites."));
    }
  }

  async function loadAllGrades() {
    if (sites.length === 0) return;
    setLoadingAll(true);
    setGradesError(null);
    const results: { name: string; grade: string; score: number; id: number }[] = [];
    try {
      for (let i = 0; i < sites.length; i += 4) {
        const chunk = sites.slice(i, i + 4);
        const settled = await Promise.all(
          chunk.map(async (s) => {
            const ctrl = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 8000);
            try {
              const r = await timedFetch(`Health ${s.name}`, `/api/seo-health?site_id=${s.id}`, { signal: ctrl.signal });
              const dd = await r.json().catch(() => null) as (HealthData & { error?: string }) | null;
              if (!r.ok || !dd?.success) return null;
              return { name: s.name, grade: dd.grade, score: dd.overall_score, id: s.id };
            } catch { return null; }
            finally { clearTimeout(timeout); }
          })
        );
        for (const r of settled) { if (r) results.push(r); }
      }
      setAllGrades(results.sort((a, b) => b.score - a.score));
      if (results.length < sites.length) {
        setGradesError(`Classement partiel : ${results.length}/${sites.length} sites ont répondu.`);
      }
    } finally {
      setLoadingAll(false);
    }
  }

  async function fetchHealth() {
    if (!selectedSite || selectedSite === "all") return;
    setLoadingH(true);
    setHealth(null);
    setHealthError(null);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await timedFetch("Health site", `/api/seo-health?site_id=${selectedSite}`, { signal: ctrl.signal });
      const d = await res.json().catch(() => null) as (HealthData & { error?: string }) | null;
      if (!res.ok || !d?.success) {
        throw new Error(d?.error || `Analyse indisponible (HTTP ${res.status})`);
      }
      setHealth(d);
    } catch (fetchError) {
      setHealth(null);
      setHealthError(errorMessage(fetchError, "Impossible de charger la santé SEO."));
    }
    finally { clearTimeout(timeout); }
    setLoadingH(false);
  }

  async function checkBroken() {
    if (!selectedSite || selectedSite === "all") return;
    setLoadingB(true);
    setBroken(null);
    setBrokenError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    try {
      const res = await timedFetch("Broken links", "/api/broken-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite }),
        signal: controller.signal,
      });
      const d = await res.json().catch(() => null) as (BrokenLinksData & { error?: string }) | null;
      if (!res.ok || !d?.success) {
        throw new Error(d?.error || `Scan indisponible (HTTP ${res.status})`);
      }
      setBroken(d);
    } catch (scanError) {
      setBroken(null);
      const timedOut = scanError instanceof DOMException && scanError.name === "AbortError";
      setBrokenError(timedOut ? "Le scan a dépassé 30 secondes. Aucun résultat n’est supposé." : errorMessage(scanError, "Le scan des liens a échoué."));
    } finally {
      window.clearTimeout(timeout);
      setLoadingB(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchSites(); }, []);
  useEffect(() => {
    if (selectedSite && selectedSite !== "all") {
      setBroken(null);
      setBrokenError(null);
      void fetchHealth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <HeartPulse className="w-5 h-5 text-rose-400" />
        <h1 className="text-xl font-semibold">SEO Health Check</h1>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          {lastTiming ? `${lastTiming.label}: ${formatMs(lastTiming.ms)}` : "vitesse en attente"}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select aria-label="Site à analyser" value={selectedSite ?? ""} onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64">
            <option value="all">Tous les sites</option>
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          {(() => {
            const current = sites.find((s) => s.id === selectedSite);
            return current?.url ? (
              <a href={current.url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${current.url} dans un nouvel onglet`}
                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm">
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : null;
          })()}
          {loadingAll && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement classement...
            </div>
          )}
          <button onClick={loadAllGrades} disabled={loadingAll || sites.length === 0}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2">
            {loadingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            Classement tous sites
          </button>
          <button onClick={checkBroken} disabled={loadingB || selectedSite === "all"}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2">
            {loadingB ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loadingB ? "Scan liens..." : "Vérifier liens cassés"}
          </button>
        </div>

        {healthError && (
          <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <span className="font-medium">Santé SEO indisponible.</span> {healthError}
          </div>
        )}
        {brokenError && (
          <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <span className="font-medium">Contrôle des liens indisponible.</span> {brokenError}
          </div>
        )}
        {gradesError && (
          <div role="status" className="rounded-xl border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
            {gradesError}
          </div>
        )}

        {loadingH ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : health ? (
          <>
            {/* Grade */}
            <div className="flex items-center gap-6">
              <div className={`w-24 h-24 rounded-2xl border-2 flex items-center justify-center ${GRADE_COLOR[health.grade] ?? GRADE_COLOR.F}`}>
                <span className="text-5xl font-black">{health.grade}</span>
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{Math.round(health.overall_score)}/100</div>
                <div className="text-sm text-gray-400">Score SEO global</div>
              </div>
            </div>

            {/* Breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="font-medium text-gray-200">Détail des scores</h2>
              <ScoreBar label="Trafic GSC (clics + impressions)" score={health.breakdown.gsc_score} />
              <ScoreBar label="PageSpeed (mobile + desktop)" score={health.breakdown.pagespeed_score} />
              <ScoreBar label="Contenu (articles publiés)" score={health.breakdown.content_score} />
              <ScoreBar label="Positionnement (avg position)" score={health.breakdown.position_score} />
            </div>

            {/* Crawl Stats (GSC) — additional info, does not affect score */}
            {health.crawl_stats && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="font-medium text-gray-200 mb-3 flex items-center gap-2">
                  <Bot className="w-4 h-4 text-sky-400" />
                  Crawl Stats (GSC)
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <div className="text-xs text-gray-400">Crawl errors</div>
                    <div className={`text-lg font-semibold ${health.crawl_stats.crawl_errors > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {health.crawl_stats.crawl_errors}
                    </div>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <div className="text-xs text-gray-400">Robots blocks</div>
                    <div className={`text-lg font-semibold ${health.crawl_stats.robots_blocks > 0 ? "text-yellow-400" : "text-emerald-400"}`}>
                      {health.crawl_stats.robots_blocks}
                    </div>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <div className="text-xs text-gray-400">Server errors</div>
                    <div className={`text-lg font-semibold ${health.crawl_stats.server_errors > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {health.crawl_stats.server_errors}
                    </div>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <div className="text-xs text-gray-400">Sitemap status</div>
                    <div className={`text-lg font-semibold ${
                      health.crawl_stats.sitemap_status === "ok" ? "text-emerald-400"
                      : health.crawl_stats.sitemap_status === "warning" ? "text-yellow-400"
                      : health.crawl_stats.sitemap_status === "error" ? "text-red-400" : "text-gray-400"
                    }`}>
                      {health.crawl_stats.sitemap_status}
                    </div>
                  </div>
                  <div className="bg-gray-800/40 rounded-lg p-3">
                    <div className="text-xs text-gray-400">Last crawl</div>
                    <div className="text-sm font-medium text-gray-200">
                      {health.crawl_stats.last_crawl
                        ? new Date(health.crawl_stats.last_crawl).toLocaleDateString()
                        : "—"}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-3">
                  {health.crawl_stats.sitemaps_total} sitemaps total · {health.crawl_stats.sitemaps_pending} pending · {health.crawl_stats.property}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {health.recommendations.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="font-medium text-gray-200 mb-3">Recommandations</h2>
                <div className="space-y-2">
                  {health.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-300">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}

        {/* Broken links */}
        {broken && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="font-medium text-gray-200 mb-3 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-rose-400" />
              Liens cassés: {broken.broken_count}/{broken.total_checked}
            </h2>
            {broken.broken_count === 0 ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4" /> Aucun lien cassé
              </div>
            ) : (
              <div className="space-y-1">
                {broken.broken.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <span className="text-red-300 text-xs truncate">{b.url}</span>
                    <span className="text-gray-500 text-xs">HTTP {b.status_code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* All sites ranking */}
        {allGrades.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-medium text-gray-200">Classement santé SEO — tous les sites</h2>
            </div>
            <div className="divide-y divide-gray-800">
              {allGrades.map((s, i) => (
                <div key={s.id} className={`px-5 py-3 flex items-center gap-3 ${s.id === selectedSite ? "bg-rose-900/10" : ""}`}>
                  <span className={`w-6 text-center font-bold ${i < 3 ? "text-yellow-400" : "text-gray-500"}`}>{i + 1}</span>
                  <span className={`w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold ${GRADE_COLOR[s.grade] ?? GRADE_COLOR.F}`}>
                    {s.grade}
                  </span>
                  <span className="flex-1 text-sm text-white">{s.name}</span>
                  <div className="w-24 bg-gray-800 rounded-full h-2">
                    <div className="h-2 rounded-full" style={{
                      width: `${s.score}%`,
                      backgroundColor: s.score >= 70 ? "#22c55e" : s.score >= 40 ? "#eab308" : "#ef4444"
                    }} />
                  </div>
                  <span className="text-sm font-semibold w-10 text-right text-gray-300">{Math.round(s.score)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
