"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Search, Zap, TrendingUp, ExternalLink, Target, GitCompare } from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface Competitor {
  domain: string;
  description?: string;
}

interface KeywordGap {
  keyword: string;
  volume: number;
  competitor: string;
  competitor_position: number;
  difficulty: string;
  intent: string;
}

interface ResearchResult {
  success: boolean;
  competitors: Competitor[];
  gaps: KeywordGap[];
  our_keywords_count: number;
  total_gaps: number;
  error?: string;
  raw?: string;
}

const INTENT_COLOR: Record<string, string> = {
  informational: "text-blue-400 bg-blue-900/30",
  commercial: "text-yellow-400 bg-yellow-900/30",
  transactional: "text-green-400 bg-green-900/30",
};

const DIFF_COLOR: Record<string, string> = {
  easy: "text-green-400",
  medium: "text-yellow-400",
  hard: "text-red-400",
};

interface Notification { type: "success" | "error"; text: string; }

interface GapRow {
  keyword: string;
  our_position: number | null;
  competitor_positions: { domain: string; pos: number }[];
  volume: number;
}

type ActiveTab = "analysis" | "gaps";

export default function CompetitorsPage() {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [cached, setCached] = useState<KeywordGap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("analysis");
  const [gapRows, setGapRows] = useState<GapRow[]>([]);
  const [gapsLoading, setGapsLoading] = useState(false);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[] | { sites?: Site[] };
      const list = Array.isArray(d) ? d : d.sites ?? [];
      if (list.length > 0) {
        setSites(list);
        if (!selectedSite) setSelectedSite("all");
      }
    } catch { /* ignore */ }
  }

  async function fetchCached() {
    if (!selectedSite || selectedSite === "all") return;
    try {
      const res = await fetch(`/api/competitors?site_id=${selectedSite}`);
      const d = await res.json() as { gaps?: KeywordGap[] };
      setCached(d.gaps ?? []);
    } catch { setCached([]); }
  }

  async function runResearch() {
    if (!selectedSite || selectedSite === "all") return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite }),
      });
      const d = await res.json() as ResearchResult;
      if (d.success) {
        setResult(d);
        setCached(d.gaps);
      } else {
        setError(d.error ?? "Erreur inconnue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    }
    setLoading(false);
  }

  function showNotification(type: "success" | "error", text: string) {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification({ type, text });
    notifTimerRef.current = setTimeout(() => setNotification(null), 4000);
  }

  async function generateArticle(keyword: string) {
    if (!selectedSite || selectedSite === "all") return;
    setGenerating(keyword);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, dry_run: true, language: "fr" }),
      });
      const d = await res.json() as { success: boolean };
      if (d.success) {
        showNotification("success", `Article preview créé pour "${keyword}"`);
        router.push("/autopilot");
      } else {
        showNotification("error", "Échec de la création de l'article.");
      }
    } catch {
      showNotification("error", "Erreur réseau.");
    }
    setGenerating(null);
  }

  async function fetchGapRows() {
    if (!selectedSite || selectedSite === "all") return;
    setGapsLoading(true);
    try {
      const res = await fetch(`/api/competitors/gaps?siteId=${selectedSite}`);
      const data = await res.json() as { success: boolean; gaps?: GapRow[] };
      if (data.success && data.gaps) setGapRows(data.gaps);
    } catch { /* ignore */ }
    setGapsLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSites();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedSite && selectedSite !== "all") void fetchCached();
  }, [selectedSite]);

  const gaps = result?.gaps ?? cached;
  const totalVolume = gaps.reduce((s, g) => s + (g.volume ?? 0), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Toast notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg border text-sm ${
          notification.type === "success"
            ? "bg-green-900/90 border-green-700 text-green-200"
            : "bg-red-900/90 border-red-700 text-red-200"
        }`}>
          {notification.text}
        </div>
      )}
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Target className="w-5 h-5 text-purple-400" />
        <h1 className="text-xl font-semibold">Analyse Concurrents</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setActiveTab("analysis")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === "analysis" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
            <Target className="w-4 h-4" /> Analyse
          </button>
          <button onClick={() => { setActiveTab("gaps"); void fetchGapRows(); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === "gaps" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
            <GitCompare className="w-4 h-4" /> Gaps
          </button>
        </div>

        {activeTab === "gaps" && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-purple-400" /> Keyword Gaps ({gapRows.length})
              </h2>
              <select value={selectedSite ?? ""} onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none w-48">
                <option value="all">🌐 Tous les sites</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {gapsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-purple-400" /></div>
            ) : gapRows.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-sm">
                Aucun gap détecté. Lance d&apos;abord une analyse concurrentielle pour alimenter les données.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                      <th className="px-5 py-3 text-left">Mot-clé</th>
                      <th className="px-5 py-3 text-right">Vol. estimé</th>
                      <th className="px-5 py-3 text-right">Notre pos.</th>
                      <th className="px-5 py-3 text-left">Concurrents</th>
                      <th className="px-5 py-3 text-center">Brief</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapRows.map((g, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-5 py-3 font-medium text-white">{g.keyword}</td>
                        <td className="px-5 py-3 text-right text-blue-400 font-semibold">{g.volume.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right">
                          {g.our_position !== null
                            ? <span className={Number(g.our_position) <= 30 ? "text-yellow-400" : "text-red-400"}>{Number(g.our_position).toFixed(0)}</span>
                            : <span className="text-gray-600">absent</span>}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {g.competitor_positions.slice(0, 3).map((cp, j) => (
                              <span key={j} className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded">{cp.domain} <span className="text-green-400">#{cp.pos}</span></span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <a href={`/api/content-brief?query=${encodeURIComponent(g.keyword)}`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 rounded text-xs transition-colors">
                            <Zap className="w-3 h-3" /> Brief
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "analysis" && (<>
        {/* Controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-400 uppercase">Site à analyser</label>
              <select
                value={selectedSite ?? ""}
                onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-purple-500 w-64"
              >
                <option value="all">🌐 Tous les sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={runResearch}
              disabled={loading || !selectedSite || selectedSite === "all"}
              className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {loading ? "Recherche Perplexity..." : "Lancer l'analyse concurrentielle"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Perplexity identifie 5-8 concurrents directs → extrait leurs mots-clés (vol. ≥ 1000/mois) → compare avec tes données GSC → affiche les GAPS à cibler.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Summary cards */}
        {gaps.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Keyword Gaps trouvés</div>
              <div className="text-3xl font-bold text-purple-400 mt-1">{gaps.length}</div>
              <div className="text-xs text-gray-500 mt-1">vol. ≥ 1000/mois chacun</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Volume total ciblable</div>
              <div className="text-3xl font-bold text-blue-400 mt-1">{totalVolume.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-1">recherches/mois cumulées</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Concurrents analysés</div>
              <div className="text-3xl font-bold text-white mt-1">
                {result?.competitors.length ?? "—"}
              </div>
            </div>
          </div>
        )}

        {/* Competitors list */}
        {result?.competitors && result.competitors.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="font-medium text-gray-200 mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-purple-400" />
              Concurrents identifiés
            </h2>
            <div className="flex flex-wrap gap-3">
              {result.competitors.map((c) => (
                <div
                  key={c.domain}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2"
                >
                  <a
                    href={`https://${c.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    {c.domain} <ExternalLink className="w-3 h-3" />
                  </a>
                  {c.description && (
                    <div className="text-xs text-gray-500 mt-1 max-w-[250px] truncate">{c.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Keyword Gaps table */}
        {gaps.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-400" />
                Keyword Gaps à cibler ({gaps.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left">Mot-clé</th>
                    <th className="px-5 py-3 text-right">Volume/mois</th>
                    <th className="px-5 py-3 text-left">Concurrent</th>
                    <th className="px-5 py-3 text-right">Pos. concurrent</th>
                    <th className="px-5 py-3 text-center">Difficulté</th>
                    <th className="px-5 py-3 text-center">Intent</th>
                    <th className="px-5 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.map((g, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-5 py-3 font-medium text-white">{g.keyword}</td>
                      <td className="px-5 py-3 text-right text-blue-400 font-semibold">
                        {(g.volume ?? 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{g.competitor ?? "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={(g.competitor_position ?? 99) <= 5 ? "text-green-400" : (g.competitor_position ?? 99) <= 10 ? "text-yellow-400" : "text-gray-400"}>
                          {g.competitor_position ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs font-medium ${DIFF_COLOR[g.difficulty] ?? "text-gray-400"}`}>
                          {g.difficulty}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${INTENT_COLOR[g.intent] ?? "text-gray-400 bg-gray-800"}`}>
                          {g.intent}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center">
                        <button
                          onClick={() => generateArticle(g.keyword)}
                          disabled={generating === g.keyword}
                          className="flex items-center gap-1 mx-auto px-3 py-1 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 rounded text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {generating === g.keyword ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Zap className="w-3 h-3" />
                          )}
                          Article
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && gaps.length === 0 && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <Target className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <div className="text-gray-500 text-sm">
              Clique &quot;Lancer l&apos;analyse&quot; pour trouver les keyword gaps de tes concurrents
            </div>
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}
