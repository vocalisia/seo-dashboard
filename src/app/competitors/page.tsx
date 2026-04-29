"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, Search, Zap, TrendingUp, ExternalLink,
  Target, GitCompare, Bot, Copy, Check, X, Filter,
} from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface CompetitorStat {
  domain: string;
  found_keywords_count: number;
  total_volume: number;
}

interface KeywordGap {
  keyword: string;
  volume: number;
  competitor: string;
  competitor_domain: string;
  competitor_position: number;
  difficulty: string;
  intent: string;
}

interface ResearchResult {
  success: boolean;
  competitors: { domain: string; description?: string }[];
  gaps: KeywordGap[];
  our_keywords_count: number;
  total_gaps: number;
  error?: string;
  raw?: string;
}

interface CachedData {
  gaps: KeywordGap[];
  competitors: CompetitorStat[];
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
type IntentFilter = "all" | "commercial" | "informational" | "transactional";

interface AiWidget {
  prompt: string;
  result: string | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
}

const AI_QUICK_ACTIONS = [
  {
    label: "Compare positionnement",
    buildPrompt: (domains: string[]) =>
      `Compare le positionnement marketing de ${domains.join(", ")}. Identifie qui cible quel segment (PME/grandes entreprises, B2B/B2C, prix premium/low cost). Donne-moi un tableau structuré.`,
  },
  {
    label: "Trouve angles différenciants",
    buildPrompt: (domains: string[]) =>
      `Pour chacun de ces concurrents (${domains.join(", ")}), identifie ses 3 forces et 3 faiblesses SEO/marketing. Suggère 5 angles où Vocalis peut se différencier.`,
  },
  {
    label: "Stratégie contenu manquant",
    buildPrompt: (domains: string[]) =>
      `Quels sujets aucun de ces concurrents (${domains.join(", ")}) ne traite mais qui auraient du potentiel SEO en 2026 pour Vocalis (voice AI, agent vocal IA) ?`,
  },
];

export default function CompetitorsPage() {
  const router = useRouter();
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [cached, setCached] = useState<CachedData>({ gaps: [], competitors: [] });
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("analysis");
  const [gapRows, setGapRows] = useState<GapRow[]>([]);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [briefLoading, setBriefLoading] = useState<string | null>(null);
  const [briefResult, setBriefResult] = useState<{ keyword: string; text: string } | null>(null);

  // Filters for analysis tab
  const [activeCompetitorFilter, setActiveCompetitorFilter] = useState<string | null>(null);
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all");

  // Inline AI widget
  const [aiWidget, setAiWidget] = useState<AiWidget>({
    prompt: "",
    result: null,
    loading: false,
    error: null,
    copied: false,
  });

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
      const d = await res.json() as { gaps?: KeywordGap[]; competitors?: CompetitorStat[] };
      setCached({ gaps: d.gaps ?? [], competitors: d.competitors ?? [] });
    } catch { setCached({ gaps: [], competitors: [] }); }
  }

  async function runResearch() {
    if (!selectedSite || selectedSite === "all") return;
    setLoading(true);
    setError(null);
    setResult(null);
    setActiveCompetitorFilter(null);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite }),
      });
      const d = await res.json() as ResearchResult;
      if (d.success) {
        setResult(d);
        // Refresh cached data after analysis
        await fetchCached();
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

  const callAiWidget = useCallback(async (prompt: string, competitors: string[]) => {
    const ctx = `Concurrents analysés: ${competitors.join(", ")}`;
    setAiWidget((s) => ({ ...s, loading: true, error: null, result: null }));
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "competitor", prompt, context: ctx }),
      });
      const data = await res.json() as { success: boolean; reply?: string; error?: string };
      if (data.success && data.reply) {
        setAiWidget((s) => ({ ...s, loading: false, result: data.reply ?? null }));
      } else {
        setAiWidget((s) => ({ ...s, loading: false, error: data.error ?? "Erreur inconnue" }));
      }
    } catch (err) {
      setAiWidget((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Erreur réseau" }));
    }
  }, []);

  async function callBriefIA(gap: KeywordGap) {
    const key = gap.keyword;
    setBriefLoading(key);
    setBriefResult(null);
    const prompt = `Génère un brief SEO complet pour cibler le mot-clé "${gap.keyword}" où concurrent "${gap.competitor}" est positionné #${gap.competitor_position}. Inclus: angle unique, plan H2/H3, mots-clés sémantiques, longueur cible, schema FAQ, CTA recommandé.`;
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "write", prompt }),
      });
      const data = await res.json() as { success: boolean; reply?: string; error?: string };
      if (data.success && data.reply) {
        setBriefResult({ keyword: key, text: data.reply });
      } else {
        showNotification("error", data.error ?? "Erreur IA");
      }
    } catch {
      showNotification("error", "Erreur réseau");
    }
    setBriefLoading(null);
  }

  async function saveToContentPlan(keyword: string) {
    if (!selectedSite || selectedSite === "all") {
      showNotification("error", "Sélectionne un site d'abord");
      return;
    }
    try {
      const res = await fetch("/api/content-plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSite }),
      });
      const data = await res.json() as { success: boolean };
      if (data.success) {
        showNotification("success", `"${keyword}" ajouté au content plan`);
      } else {
        showNotification("error", "Impossible d'enregistrer dans le content plan");
      }
    } catch {
      showNotification("error", "Erreur réseau");
    }
  }

  useEffect(() => {
    void fetchSites();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedSite && selectedSite !== "all") void fetchCached();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite]);

  // Derived data
  const gaps = cached.gaps;
  const competitors = cached.competitors;
  const totalVolume = gaps.reduce((s, g) => s + (g.volume ?? 0), 0);
  const hasVolumes = gaps.some((g) => (g.volume ?? 0) > 0);
  const selectedSiteObj = sites.find((s) => s.id === selectedSite);
  const competitorDomains = competitors.map((c) => c.domain);

  // Filtered gaps
  const filteredGaps = gaps.filter((g) => {
    const matchCompetitor = !activeCompetitorFilter || g.competitor_domain === activeCompetitorFilter || g.competitor === activeCompetitorFilter;
    const matchIntent = intentFilter === "all" || g.intent?.toLowerCase() === intentFilter;
    return matchCompetitor && matchIntent;
  });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Brief IA Modal */}
      {briefResult && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setBriefResult(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-purple-400" />
                  <span className="font-semibold text-white">Brief IA — {briefResult.keyword}</span>
                </div>
                <button onClick={() => setBriefResult(null)} className="text-gray-400 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 flex-1 overflow-y-auto space-y-3">
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { void navigator.clipboard.writeText(briefResult.text); showNotification("success", "Copié !"); }}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                  >
                    <Copy className="w-3 h-3" /> Copier
                  </button>
                  <button
                    onClick={() => void saveToContentPlan(briefResult.keyword)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                  >
                    Sauvegarder dans content-plan
                  </button>
                </div>
                <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto">
                  {briefResult.text}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

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

        {/* ===================== GAPS TAB ===================== */}
        {activeTab === "gaps" && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-purple-400" /> Keyword Gaps ({gapRows.length})
              </h2>
              <select value={selectedSite ?? ""} onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none w-48">
                <option value="all">Tous les sites</option>
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
                            {g.competitor_positions.length === 0
                              ? <span className="text-gray-600 text-xs">—</span>
                              : g.competitor_positions.slice(0, 3).map((cp, j) => (
                                  <a
                                    key={j}
                                    href={`https://${cp.domain}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-blue-400 px-2 py-0.5 rounded transition-colors"
                                  >
                                    {cp.domain} <span className="text-green-400">#{cp.pos}</span>
                                    <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                                  </a>
                                ))
                            }
                          </div>
                        </td>
                        <td className="px-5 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <a href={`/api/content-brief?query=${encodeURIComponent(g.keyword)}`} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 rounded text-xs transition-colors">
                              <Zap className="w-3 h-3" /> Brief
                            </a>
                            <button
                              onClick={() => void callBriefIA({
                                keyword: g.keyword,
                                volume: g.volume,
                                competitor: g.competitor_positions[0]?.domain ?? "—",
                                competitor_domain: g.competitor_positions[0]?.domain ?? "—",
                                competitor_position: g.competitor_positions[0]?.pos ?? 0,
                                difficulty: "",
                                intent: "",
                              })}
                              disabled={briefLoading === g.keyword}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-xs transition-colors disabled:opacity-50"
                            >
                              {briefLoading === g.keyword ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                              IA
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===================== ANALYSIS TAB ===================== */}
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
                  <option value="all">Tous les sites</option>
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
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {loading ? "Recherche Perplexity..." : "Lancer l’analyse concurrentielle"}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Perplexity identifie 5-8 concurrents directs &rarr; extrait leurs mots-clés (vol. ≥ 1000/mois) &rarr; compare avec tes données GSC &rarr; affiche les GAPS à cibler.
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
                <div className={`text-3xl font-bold mt-1 ${hasVolumes ? "text-blue-400" : "text-gray-600"}`}>
                  {hasVolumes ? totalVolume.toLocaleString() : "N/A"}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {hasVolumes ? "recherches/mois cumulées" : "données non disponibles"}
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Concurrents analysés</div>
                <div className="text-3xl font-bold text-white mt-1">{competitors.length > 0 ? competitors.length : (result?.competitors.length ?? "—")}</div>
              </div>
            </div>
          )}

          {/* Competitors list — rich grid */}
          {competitors.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-medium text-gray-200 flex items-center gap-2">
                  <Target className="w-4 h-4 text-purple-400" />
                  Concurrents identifiés
                </h2>
                {activeCompetitorFilter && (
                  <button
                    onClick={() => setActiveCompetitorFilter(null)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                  >
                    <X className="w-3 h-3" /> Retirer filtre
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {competitors.map((c) => {
                  const isActive = activeCompetitorFilter === c.domain;
                  return (
                    <button
                      key={c.domain}
                      onClick={() => setActiveCompetitorFilter(isActive ? null : c.domain)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        isActive
                          ? "border-purple-500 bg-purple-900/30"
                          : "border-gray-700 bg-gray-800 hover:border-gray-600"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=16`}
                          alt=""
                          width={16}
                          height={16}
                          className="rounded-sm"
                        />
                        <a
                          href={`https://${c.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate"
                        >
                          {c.domain} <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                        </a>
                      </div>
                      <div className="text-xs text-gray-400">
                        <span className="text-purple-400 font-semibold">{c.found_keywords_count}</span> keywords
                      </div>
                      {c.total_volume > 0 && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {(c.total_volume / 1000).toFixed(1)}K vol/mois
                        </div>
                      )}
                      {isActive && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-purple-400">
                          <Filter className="w-2.5 h-2.5" /> Filtré
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Competitors from fresh result (before cache load) */}
          {competitors.length === 0 && result?.competitors && result.competitors.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="font-medium text-gray-200 mb-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-400" />
                Concurrents identifiés
              </h2>
              <div className="flex flex-wrap gap-3">
                {result.competitors.map((c) => (
                  <div key={c.domain} className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
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
              <div className="px-5 py-4 border-b border-gray-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium text-gray-200 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    Keyword Gaps à cibler
                    <span className="text-gray-500 text-xs">({filteredGaps.length}/{gaps.length})</span>
                  </h2>
                </div>
                {/* Intent filter chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Intent:</span>
                  {(["all", "commercial", "informational", "transactional"] as IntentFilter[]).map((val) => (
                    <button
                      key={val}
                      onClick={() => setIntentFilter(val)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        intentFilter === val
                          ? "bg-purple-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      {val === "all" ? "All" : val.charAt(0).toUpperCase() + val.slice(1)}
                    </button>
                  ))}
                  {activeCompetitorFilter && (
                    <span className="ml-2 flex items-center gap-1 text-xs bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded-full border border-purple-700/40">
                      <Filter className="w-2.5 h-2.5" /> {activeCompetitorFilter}
                    </span>
                  )}
                </div>
                {!hasVolumes && (
                  <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-800/60 rounded-lg px-3 py-2">
                    <span className="text-blue-400 flex-shrink-0">i</span>
                    Volumes non disponibles — Perplexity ne fournit pas de volume précis. Consulter Semrush/Ahrefs pour validation.
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                      <th className="px-5 py-3 text-left">Mot-clé</th>
                      {hasVolumes && <th className="px-5 py-3 text-right">Volume/mois</th>}
                      <th className="px-5 py-3 text-left">Concurrent</th>
                      <th className="px-5 py-3 text-right">Pos. concurrent</th>
                      <th className="px-5 py-3 text-center">Difficulté</th>
                      <th className="px-5 py-3 text-center">Intent</th>
                      <th className="px-5 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGaps.map((g, i) => {
                      const domain = g.competitor_domain || g.competitor || "—";
                      return (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-5 py-3 font-medium text-white">{g.keyword}</td>
                          {hasVolumes && (
                            <td className="px-5 py-3 text-right text-blue-400 font-semibold">
                              {(g.volume ?? 0).toLocaleString()}
                            </td>
                          )}
                          <td className="px-5 py-3 text-xs">
                            {domain !== "—" ? (
                              <a
                                href={`https://${domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
                              >
                                {domain} <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={(g.competitor_position ?? 99) <= 5 ? "text-green-400" : (g.competitor_position ?? 99) <= 10 ? "text-yellow-400" : "text-gray-400"}>
                              {g.competitor_position ?? "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={`text-xs font-medium ${DIFF_COLOR[g.difficulty] ?? "text-gray-400"}`}>
                              {g.difficulty || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded ${INTENT_COLOR[g.intent] ?? "text-gray-400 bg-gray-800"}`}>
                              {g.intent || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => generateArticle(g.keyword)}
                                disabled={generating === g.keyword}
                                className="flex items-center gap-1 px-2 py-1 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 rounded text-xs font-medium transition-colors disabled:opacity-50"
                              >
                                {generating === g.keyword ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                                Article
                              </button>
                              <button
                                onClick={() => void callBriefIA(g)}
                                disabled={briefLoading === g.keyword}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded text-xs font-medium transition-colors disabled:opacity-50"
                              >
                                {briefLoading === g.keyword ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                                Brief IA
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredGaps.length === 0 && gaps.length > 0 && (
                  <div className="py-8 text-center text-gray-500 text-sm">Aucun gap pour ces filtres.</div>
                )}
              </div>
            </div>
          )}

          {/* IA Widget */}
          {(competitors.length > 0 || (result?.competitors ?? []).length > 0) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <Bot className="w-4 h-4 text-purple-400" />
                Analyse IA des concurrents
              </h2>
              {/* Quick actions */}
              <div className="flex flex-wrap gap-2">
                {AI_QUICK_ACTIONS.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => {
                      const domains = competitorDomains.length > 0
                        ? competitorDomains
                        : (result?.competitors ?? []).map((c) => c.domain);
                      setAiWidget((s) => ({ ...s, prompt: a.buildPrompt(domains) }));
                    }}
                    className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 text-xs rounded-lg transition-colors border border-purple-700/40"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <textarea
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-purple-500 h-28"
                value={aiWidget.prompt}
                onChange={(e) => setAiWidget((s) => ({ ...s, prompt: e.target.value }))}
                placeholder="Décris ta demande d'analyse concurrentielle..."
              />
              <button
                onClick={() => {
                  const domains = competitorDomains.length > 0
                    ? competitorDomains
                    : (result?.competitors ?? []).map((c) => c.domain);
                  void callAiWidget(aiWidget.prompt, domains);
                }}
                disabled={aiWidget.loading || !aiWidget.prompt.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
              >
                {aiWidget.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                {aiWidget.loading ? "L’IA scrute les concurrents en temps réel via Perplexity (25-40s)…" : "Analyser"}
              </button>
              {aiWidget.error && (
                <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">{aiWidget.error}</div>
              )}
              {aiWidget.result && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Résultat</span>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(aiWidget.result ?? "").then(() => {
                          setAiWidget((s) => ({ ...s, copied: true }));
                          setTimeout(() => setAiWidget((s) => ({ ...s, copied: false })), 2000);
                        });
                      }}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                    >
                      {aiWidget.copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {aiWidget.copied ? "Copié" : "Copier"}
                    </button>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                    {aiWidget.result}
                  </div>
                </div>
              )}
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
