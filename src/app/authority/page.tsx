"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Shield, BarChart3, ExternalLink, GraduationCap } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; url: string; }

interface AcademicMention {
  id: number;
  site_id: number;
  source_url: string | null;
  title: string;
  authors: string[] | null;
  year: number | null;
  doi: string | null;
  cited_by_count: number;
  source_type: string | null;
  source_domain: string | null;
  scanned_at: string;
}

interface AcademicStats { total: number; edu_gov: number; total_citations: number; }

interface AuthorityData {
  success: boolean;
  scores_ui?: { coverage: number; authority: number; content: number; overall: number };
  stats_ui?: { queries: number; avg_position: number; clicks: number; articles: number; clusters: number };
  scores?: {
    coverage?: number;
    authority?: number;
    content?: number;
    overall?: number;
    coverage_score?: number;
    authority_score?: number;
    content_score?: number;
    overall_score?: number;
  };
  stats?: {
    queries?: number;
    avg_position: number;
    clicks?: number;
    articles?: number;
    clusters?: number;
    unique_queries?: number;
    total_clicks?: number;
    article_count?: number;
    cluster_count?: number;
  };
}

function normalizeAuthorityData(raw: AuthorityData): AuthorityData {
  const scores = raw.scores_ui ?? {
    coverage: raw.scores?.coverage ?? raw.scores?.coverage_score ?? 0,
    authority: raw.scores?.authority ?? raw.scores?.authority_score ?? 0,
    content: raw.scores?.content ?? raw.scores?.content_score ?? 0,
    overall: raw.scores?.overall ?? raw.scores?.overall_score ?? 0,
  };

  const stats = raw.stats_ui ?? {
    queries: raw.stats?.queries ?? raw.stats?.unique_queries ?? 0,
    avg_position: raw.stats?.avg_position ?? 0,
    clicks: raw.stats?.clicks ?? raw.stats?.total_clicks ?? 0,
    articles: raw.stats?.articles ?? raw.stats?.article_count ?? 0,
    clusters: raw.stats?.clusters ?? raw.stats?.cluster_count ?? 0,
  };

  return {
    ...raw,
    success: raw.success,
    scores_ui: scores,
    stats_ui: stats,
  };
}

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-[100px] h-[100px]">
        <svg width="100" height="100" className="transform -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#1f2937" strokeWidth="8" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-1000" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white">{Math.round(score)}</div>
      </div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}

export default function AuthorityPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [data, setData] = useState<AuthorityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [allScores, setAllScores] = useState<{ site: string; overall: number; id: number }[]>([]);
  const [academicMentions, setAcademicMentions] = useState<AcademicMention[]>([]);
  const [academicStats, setAcademicStats] = useState<AcademicStats | null>(null);
  const [academicLoading, setAcademicLoading] = useState(false);
  const [academicScanning, setAcademicScanning] = useState(false);

  async function fetchAcademic(siteIdParam: number | "all" | null) {
    if (!siteIdParam || siteIdParam === "all") {
      setAcademicMentions([]);
      setAcademicStats(null);
      return;
    }
    setAcademicLoading(true);
    try {
      const res = await fetch(`/api/eeat/academic-mentions?site_id=${siteIdParam}&limit=20`);
      const d = await res.json() as { mentions?: AcademicMention[]; stats?: AcademicStats };
      setAcademicMentions(d.mentions ?? []);
      setAcademicStats(d.stats ?? null);
    } catch { setAcademicMentions([]); setAcademicStats(null); }
    setAcademicLoading(false);
  }

  async function scanAcademic() {
    if (!selectedSite || selectedSite === "all") return;
    setAcademicScanning(true);
    try {
      await fetch(`/api/eeat/academic-scan?site_id=${selectedSite}`, { method: "POST" });
      await fetchAcademic(selectedSite);
    } catch { /* ignore */ }
    setAcademicScanning(false);
  }

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) {
        setSites(list);
        if (!selectedSite && list.length > 0) setSelectedSite(list[0].id);
        // Fetch all scores in parallel (chunks of 4)
        setLoadingAll(true);
        const batch = list.slice(0, 16);
        const results: { site: string; overall: number; id: number }[] = [];
        for (let i = 0; i < batch.length; i += 4) {
          const chunk = batch.slice(i, i + 4);
          const settled = await Promise.all(
            chunk.map(async (s) => {
              const ctrl = new AbortController();
              const timeout = setTimeout(() => ctrl.abort(), 15000);
              try {
                const r = await fetch(`/api/topical-authority?site_id=${s.id}`, { signal: ctrl.signal });
                const dd = normalizeAuthorityData(await r.json() as AuthorityData);
                return dd.success ? { site: s.name, overall: dd.scores_ui?.overall ?? 0, id: s.id } : null;
              } catch { return null; }
              finally { clearTimeout(timeout); }
            })
          );
          for (const r of settled) { if (r) results.push(r); }
        }
        setAllScores(results.sort((a, b) => b.overall - a.overall));
        setLoadingAll(false);
      }
    } catch { setLoadingAll(false); }
  }

  async function fetchAuthority() {
    if (!selectedSite || selectedSite === "all") return;
    setLoading(true);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`/api/topical-authority?site_id=${selectedSite}`, { signal: ctrl.signal });
      const d = normalizeAuthorityData(await res.json() as AuthorityData);
      if (d.success) setData(d);
    } catch { setData(null); }
    finally { clearTimeout(timeout); }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchSites(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedSite && selectedSite !== "all") void fetchAuthority(); }, [selectedSite]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchAcademic(selectedSite); }, [selectedSite]);

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
            onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            <option value="all">🌐 Tous les sites</option>
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
                <ScoreRing score={data.scores_ui?.overall ?? 0} label="Score Global" color={scoreColor(data.scores_ui?.overall ?? 0)} />
                <ScoreRing score={data.scores_ui?.coverage ?? 0} label="Couverture" color={scoreColor(data.scores_ui?.coverage ?? 0)} />
                <ScoreRing score={data.scores_ui?.authority ?? 0} label="Autorité" color={scoreColor(data.scores_ui?.authority ?? 0)} />
                <ScoreRing score={data.scores_ui?.content ?? 0} label="Contenu" color={scoreColor(data.scores_ui?.content ?? 0)} />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-5 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">{data.stats_ui?.queries ?? 0}</div>
                <div className="text-xs text-gray-400">Requêtes uniques</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">{(data.stats_ui?.avg_position ?? 0).toFixed(1)}</div>
                <div className="text-xs text-gray-400">Position moy.</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{data.stats_ui?.clicks ?? 0}</div>
                <div className="text-xs text-gray-400">Clics 30j</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-green-400">{data.stats_ui?.articles ?? 0}</div>
                <div className="text-xs text-gray-400">Articles publiés</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-violet-400">{data.stats_ui?.clusters ?? 0}</div>
                <div className="text-xs text-gray-400">Clusters</div>
              </div>
            </div>

            {/* Mentions académiques (OpenAlex) */}
            {selectedSite && selectedSite !== "all" && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
                  <GraduationCap className="w-4 h-4 text-violet-400" />
                  <h2 className="font-medium text-gray-200">Mentions académiques</h2>
                  {academicStats && (
                    <span className="text-xs text-gray-500">
                      {academicStats.total} mentions · {academicStats.edu_gov} .edu/.gov · {academicStats.total_citations} citations
                    </span>
                  )}
                  <button
                    onClick={scanAcademic}
                    disabled={academicScanning}
                    className="ml-auto px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-xs font-medium flex items-center gap-2"
                  >
                    {academicScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <GraduationCap className="w-3 h-3" />}
                    {academicScanning ? "Scan…" : "Scanner OpenAlex"}
                  </button>
                </div>
                <div className="p-4">
                  {academicLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                    </div>
                  ) : academicMentions.length === 0 ? (
                    <div className="text-sm text-gray-500 text-center py-6">
                      Aucune mention académique. Lance un scan OpenAlex (100k req/jour, gratuit).
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {academicMentions.map((m) => {
                        const isEduGov = /\.(edu|gov)(\.|$)/i.test(m.source_domain ?? "");
                        return (
                          <a
                            key={m.id}
                            href={m.source_url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block py-2.5 hover:bg-gray-800/40 -mx-4 px-4 transition-colors"
                          >
                            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                              {isEduGov && (
                                <span className="bg-emerald-900/40 text-emerald-300 px-1.5 py-0.5 rounded font-medium">
                                  {m.source_domain?.match(/\.(edu|gov)/i)?.[0] ?? ".edu"}
                                </span>
                              )}
                              {m.year && <span>{m.year}</span>}
                              <span className="text-violet-400">
                                {m.cited_by_count} citation{m.cited_by_count !== 1 ? "s" : ""}
                              </span>
                              {m.source_type && (
                                <span className="text-gray-500">{m.source_type}</span>
                              )}
                            </div>
                            <div className="text-sm text-white line-clamp-2">{m.title}</div>
                            {m.authors && m.authors.length > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                {m.authors.slice(0, 3).join(", ")}
                                {m.authors.length > 3 ? ` +${m.authors.length - 3}` : ""}
                              </div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

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
