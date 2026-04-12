"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Shield, BarChart3 } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; }

interface AuthorityData {
  success: boolean;
  scores: { coverage: number; authority: number; content: number; overall: number };
  stats: { queries: number; avg_position: number; clicks: number; articles: number; clusters: number };
}

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="100" height="100" className="transform -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1f2937" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute mt-8 text-2xl font-bold text-white">{Math.round(score)}</div>
      <div className="text-xs text-gray-400 -mt-1">{label}</div>
    </div>
  );
}

export default function AuthorityPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [data, setData] = useState<AuthorityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [allScores, setAllScores] = useState<{ site: string; overall: number; id: number }[]>([]);

  useEffect(() => { void fetchSites(); }, []);
  useEffect(() => { if (selectedSite) void fetchAuthority(); }, [selectedSite]);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) {
        setSites(list);
        if (!selectedSite) setSelectedSite(list[0].id);
        // Fetch all scores for ranking
        const scores = [];
        for (const s of list.slice(0, 16)) {
          try {
            const r = await fetch(`/api/topical-authority?site_id=${s.id}`);
            const dd = await r.json() as AuthorityData;
            if (dd.success) scores.push({ site: s.name, overall: dd.scores.overall, id: s.id });
          } catch { /* skip */ }
        }
        setAllScores(scores.sort((a, b) => b.overall - a.overall));
      }
    } catch { /* ignore */ }
  }

  async function fetchAuthority() {
    if (!selectedSite) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/topical-authority?site_id=${selectedSite}`);
      const d = await res.json() as AuthorityData;
      if (d.success) setData(d);
    } catch { setData(null); }
    setLoading(false);
  }

  const scoreColor = (s: number) => s >= 70 ? "#22c55e" : s >= 40 ? "#eab308" : "#ef4444";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Shield className="w-5 h-5 text-emerald-400" />
        <h1 className="text-xl font-semibold">Autorité Topique</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : data ? (
          <>
            {/* Score rings */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
              <div className="flex justify-center gap-12">
                <div className="relative flex flex-col items-center">
                  <ScoreRing score={data.scores.overall} label="Score Global" color={scoreColor(data.scores.overall)} />
                </div>
                <div className="relative flex flex-col items-center">
                  <ScoreRing score={data.scores.coverage} label="Couverture" color={scoreColor(data.scores.coverage)} />
                </div>
                <div className="relative flex flex-col items-center">
                  <ScoreRing score={data.scores.authority} label="Autorité" color={scoreColor(data.scores.authority)} />
                </div>
                <div className="relative flex flex-col items-center">
                  <ScoreRing score={data.scores.content} label="Contenu" color={scoreColor(data.scores.content)} />
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-5 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">{data.stats.queries}</div>
                <div className="text-xs text-gray-400">Requêtes uniques</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">{data.stats.avg_position.toFixed(1)}</div>
                <div className="text-xs text-gray-400">Position moy.</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{data.stats.clicks}</div>
                <div className="text-xs text-gray-400">Clics 30j</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-green-400">{data.stats.articles}</div>
                <div className="text-xs text-gray-400">Articles publiés</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-violet-400">{data.stats.clusters}</div>
                <div className="text-xs text-gray-400">Clusters</div>
              </div>
            </div>

            {/* Ranking all sites */}
            {allScores.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h2 className="font-medium text-gray-200 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                    Classement autorité topique (tous les sites)
                  </h2>
                </div>
                <div className="divide-y divide-gray-800">
                  {allScores.map((s, i) => (
                    <div
                      key={s.id}
                      className={`px-5 py-3 flex items-center gap-3 ${s.id === selectedSite ? "bg-emerald-900/10" : ""}`}
                    >
                      <span className={`w-6 text-center font-bold ${i < 3 ? "text-yellow-400" : "text-gray-500"}`}>
                        {i + 1}
                      </span>
                      <span className="flex-1 text-sm text-white">{s.site}</span>
                      <div className="w-32 bg-gray-800 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{ width: `${s.overall}%`, backgroundColor: scoreColor(s.overall) }}
                        />
                      </div>
                      <span className="text-sm font-semibold w-10 text-right" style={{ color: scoreColor(s.overall) }}>
                        {Math.round(s.overall)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
