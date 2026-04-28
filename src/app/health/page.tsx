"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, HeartPulse, CheckCircle, AlertTriangle, XCircle, Link2, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; url: string; }

interface HealthData {
  success: boolean;
  grade: string;
  overall_score: number;
  breakdown: { gsc_score: number; pagespeed_score: number; content_score: number; position_score: number };
  recommendations: string[];
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

export default function HealthPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [broken, setBroken] = useState<BrokenLinksData | null>(null);
  const [loadingH, setLoadingH] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [allGrades, setAllGrades] = useState<{ name: string; grade: string; score: number; id: number }[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) {
        setSites(list);
        if (!selectedSite) setSelectedSite(list[0].id);
        setLoadingAll(true);
        const batch = list.slice(0, 16);
        const results: { name: string; grade: string; score: number; id: number }[] = [];
        for (let i = 0; i < batch.length; i += 4) {
          const chunk = batch.slice(i, i + 4);
          const settled = await Promise.all(
            chunk.map(async (s) => {
              const ctrl = new AbortController();
              const timeout = setTimeout(() => ctrl.abort(), 15000);
              try {
                const r = await fetch(`/api/seo-health?site_id=${s.id}`, { signal: ctrl.signal });
                const dd = await r.json() as HealthData;
                return dd.success ? { name: s.name, grade: dd.grade, score: dd.overall_score, id: s.id } : null;
              } catch { return null; }
              finally { clearTimeout(timeout); }
            })
          );
          for (const r of settled) { if (r) results.push(r); }
        }
        setAllGrades(results.sort((a, b) => b.score - a.score));
        setLoadingAll(false);
      }
    } catch { setLoadingAll(false); }
  }

  async function fetchHealth() {
    if (!selectedSite) return;
    setLoadingH(true);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`/api/seo-health?site_id=${selectedSite}`, { signal: ctrl.signal });
      const d = await res.json() as HealthData;
      if (d.success) setHealth(d);
    } catch { setHealth(null); }
    finally { clearTimeout(timeout); }
    setLoadingH(false);
  }

  async function checkBroken() {
    if (!selectedSite) return;
    setLoadingB(true);
    try {
      const res = await fetch("/api/broken-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite }),
      });
      const d = await res.json() as BrokenLinksData;
      if (d.success) setBroken(d);
    } catch { setBroken(null); }
    setLoadingB(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchSites(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedSite) { void fetchHealth(); } }, [selectedSite]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <HeartPulse className="w-5 h-5 text-rose-400" />
        <h1 className="text-xl font-semibold">SEO Health Check</h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select value={selectedSite ?? ""} onChange={(e) => setSelectedSite(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64">
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          {(() => {
            const current = sites.find((s) => s.id === selectedSite);
            return current?.url ? (
              <a href={current.url} target="_blank" rel="noopener noreferrer"
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
          <button onClick={checkBroken} disabled={loadingB}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2">
            {loadingB ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loadingB ? "Scan liens..." : "Vérifier liens cassés"}
          </button>
        </div>

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
