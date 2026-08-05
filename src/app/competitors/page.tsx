"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Loader2, Search, Zap, TrendingUp, ExternalLink,
  Target, GitCompare, Bot, Copy, Check, X, Filter, RefreshCw,
  ChevronDown, ChevronUp, Shield, FileText,
} from "lucide-react";
import Link from "next/link";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";

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
  source?: "ai_estimate" | "cache" | "fallback_gsc_signal" | "public_web";
}

interface ResearchResult {
  success: boolean;
  competitors: { domain: string; description?: string }[];
  gaps: KeywordGap[];
  our_keywords_count: number;
  total_gaps: number;
  error?: string;
  raw?: string;
  cached?: boolean;
  stale?: boolean;
  fallback?: boolean;
  warning?: string;
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

function gapSourceLabel(source?: KeywordGap["source"]): string {
  if (source === "fallback_gsc_signal") return "Signal GSC";
  if (source === "cache") return "Cache";
  if (source === "ai_estimate") return "IA";
  if (source === "public_web") return "Web public";
  return "Estime";
}

function cachedDataFromResearch(result: ResearchResult): CachedData {
  const gaps = (result.gaps ?? []).map((gap) => ({
    ...gap,
    competitor_domain: gap.competitor_domain || gap.competitor,
  }));

  const competitorMap = new Map<string, CompetitorStat>();
  for (const competitor of result.competitors ?? []) {
    if (!competitor.domain) continue;
    competitorMap.set(competitor.domain, {
      domain: competitor.domain,
      found_keywords_count: 0,
      total_volume: 0,
    });
  }
  for (const gap of gaps) {
    const domain = gap.competitor_domain || gap.competitor;
    if (!domain) continue;
    const current = competitorMap.get(domain) ?? {
      domain,
      found_keywords_count: 0,
      total_volume: 0,
    };
    current.found_keywords_count += 1;
    current.total_volume += Number(gap.volume) || 0;
    competitorMap.set(domain, current);
  }

  return { gaps, competitors: Array.from(competitorMap.values()) };
}

interface Notification { type: "success" | "error"; text: string; }

interface GapRow {
  keyword: string;
  our_position: number | null;
  competitor_positions: { domain: string; pos: number }[];
  volume: number | null;
  impressions?: number;
  source?: "competitor_cache" | "gsc_opportunity";
  derived_question?: boolean;
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

interface KeywordRow {
  keyword: string;
  volume: number;
  position: number;
  difficulty: string;
  intent: string;
}

interface CategoryStats {
  count: number;
  total_volume: number;
  top: KeywordRow[];
}

interface CompetitorKeywords {
  competitor_domain: string;
  total_keywords: number;
  categories: {
    general: CategoryStats;
    longtail: CategoryStats;
    questions: CategoryStats;
  };
}

interface LLMScanResult {
  competitor_domain: string;
  llm_readiness_score: number;
  llms_txt_present: boolean;
  llms_txt_content: string | null;
  ai_bots_allowed: string[];
  ai_bots_disallowed: string[];
  schemas_detected: string[];
  recommendations: string[];
  has_open_graph: boolean;
  scanned_at: string;
}

type KwTabName = "general" | "longtail" | "questions";

const AI_QUICK_ACTIONS = [
  {
    label: "Compare positionnement",
    buildPrompt: (domains: string[], siteLabel: string) =>
      `Compare le positionnement marketing de ${siteLabel} face a ${domains.join(", ")}. Identifie qui cible quel segment (PME/grandes entreprises, B2B/B2C, offre premium/accessible). Donne-moi un tableau structure.`,
  },
  {
    label: "Trouve angles différenciants",
    buildPrompt: (domains: string[], siteLabel: string) =>
      `Pour chacun de ces concurrents (${domains.join(", ")}), identifie ses 3 forces et 3 faiblesses SEO/marketing. Suggere 5 angles ou ${siteLabel} peut se differencier.`,
  },
  {
    label: "Stratégie contenu manquant",
    buildPrompt: (domains: string[], siteLabel: string) =>
      `Quels sujets aucun de ces concurrents (${domains.join(", ")}) ne traite correctement mais qui auraient du potentiel SEO en 2026 pour ${siteLabel} ?`,
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
  const [gapsTypeFilter, setGapsTypeFilter] = useState<"all" | "longtail" | "questions">("all");
  const [gapsRefreshing, setGapsRefreshing] = useState(false);
  const [briefLoading, setBriefLoading] = useState<string | null>(null);
  const [briefResult, setBriefResult] = useState<{ keyword: string; text: string } | null>(null);

  // Filters for analysis tab
  const [activeCompetitorFilter, setActiveCompetitorFilter] = useState<string | null>(null);
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all");

  // Per-competitor expansion (keyword breakdown + LLM scan)
  const [expandedCompetitor, setExpandedCompetitor] = useState<string | null>(null);
  const [kwTab, setKwTab] = useState<KwTabName>("general");
  const [competitorKw, setCompetitorKw] = useState<Record<string, CompetitorKeywords>>({});
  const [kwLoading, setKwLoading] = useState<string | null>(null);
  const [llmScans, setLlmScans] = useState<Record<string, LLMScanResult>>({});
  const [ownSiteScan, setOwnSiteScan] = useState<LLMScanResult | null>(null);
  const [llmScanLoading, setLlmScanLoading] = useState(false);
  const [llmScanRunning, setLlmScanRunning] = useState(false);

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
        if (!selectedSite && list.length > 0) setSelectedSite(list[0].id);
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

  async function viewCachedAnalysis() {
    if (!selectedSite) return;
    if (selectedSite === "all") {
      setError("Sélectionne un site pour consulter une analyse en cache. Un rescan multi-sites reste une action IA explicite.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setActiveCompetitorFilter(null);
    try {
      // GET only: this control must never start an AI request when no cache exists.
      const res = await fetch(`/api/competitors?site_id=${selectedSite}`);
      const d = await res.json() as {
        success?: boolean;
        error?: string;
        gaps?: KeywordGap[];
        competitors?: CompetitorStat[];
      };
      if (d.success === false) {
        setError(d.error ?? "Impossible de lire l'analyse en cache");
        return;
      }

      const nextCached = { gaps: d.gaps ?? [], competitors: d.competitors ?? [] };
      setCached(nextCached);
      if (nextCached.gaps.length === 0 && nextCached.competitors.length === 0) {
        setError("Aucune analyse concurrentielle en cache pour ce site. Utilise « Rescan web sourcé » pour lancer une nouvelle recherche publique.");
        return;
      }

      setResult({
        success: true,
        cached: true,
        competitors: nextCached.competitors,
        gaps: nextCached.gaps,
        our_keywords_count: 0,
        total_gaps: nextCached.gaps.length,
      });
      showNotification("success", `Analyse en cache : ${nextCached.competitors.length} concurrents, ${nextCached.gaps.length} gaps`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau lors de la lecture du cache");
    } finally {
      setLoading(false);
    }
  }

  async function fetchCompetitorKeywords(domain: string) {
    if (!selectedSite || selectedSite === "all") return;
    if (competitorKw[domain]) return; // already cached locally
    setKwLoading(domain);
    try {
      const res = await fetch(
        `/api/competitors/keywords?site_id=${selectedSite}&competitor_domain=${encodeURIComponent(domain)}`,
      );
      const d = await res.json() as { success: boolean; categories?: CompetitorKeywords["categories"]; total_keywords?: number; competitor_domain?: string };
      const cats = d.categories;
      if (d.success && cats) {
        setCompetitorKw((prev) => ({
          ...prev,
          [domain]: {
            competitor_domain: domain,
            total_keywords: d.total_keywords ?? 0,
            categories: cats,
          },
        }));
      }
    } catch { /* ignore */ }
    setKwLoading(null);
  }

  async function fetchLlmScans() {
    if (!selectedSite || selectedSite === "all") return;
    setLlmScanLoading(true);
    try {
      const res = await fetch(`/api/competitors/llm-scan?site_id=${selectedSite}`);
      const d = await res.json() as { success: boolean; scans?: LLMScanResult[]; own_site_scan?: LLMScanResult | null };
      if (d.success && d.scans) {
        const map: Record<string, LLMScanResult> = {};
        for (const s of d.scans) map[s.competitor_domain.toLowerCase()] = s;
        setLlmScans(map);
        setOwnSiteScan(d.own_site_scan ?? null);
      }
    } catch { /* ignore */ }
    setLlmScanLoading(false);
  }

  async function runLlmScan(forceRefresh = false) {
    if (!selectedSite || selectedSite === "all" || llmScanRunning) return;
    setLlmScanRunning(true);
    try {
      const res = await fetch(`/api/competitors/llm-scan?site_id=${selectedSite}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force_refresh: forceRefresh, include_own_site: true }),
      });
      const d = await res.json() as { success: boolean; scans?: LLMScanResult[]; scanned_now?: number; from_cache?: number; error?: string };
      if (d.success && d.scans) {
        // Identify own site scan and separate it
        const siteObj = sites.find((s) => s.id === selectedSite);
        const ownDomain = siteObj
          ? siteObj.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").toLowerCase()
          : "";
        const map: Record<string, LLMScanResult> = {};
        let own: LLMScanResult | null = null;
        for (const s of d.scans) {
          const sDom = s.competitor_domain.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
          if (ownDomain && (sDom === ownDomain || sDom.includes(ownDomain) || ownDomain.includes(sDom))) {
            own = s;
          } else {
            map[s.competitor_domain.toLowerCase()] = s;
          }
        }
        setLlmScans(map);
        setOwnSiteScan(own);
        showNotification("success", `LLM scan: ${d.scanned_now ?? 0} fresh, ${d.from_cache ?? 0} from cache (7d)`);
      } else {
        showNotification("error", d.error ?? "Scan échoué");
      }
    } catch (err) {
      showNotification("error", err instanceof Error ? err.message : "Erreur réseau");
    }
    setLlmScanRunning(false);
  }

  function toggleExpandCompetitor(domain: string) {
    if (expandedCompetitor === domain) {
      setExpandedCompetitor(null);
      return;
    }
    setExpandedCompetitor(domain);
    setKwTab("general");
    void fetchCompetitorKeywords(domain);
  }

  async function runResearch(forceRefresh = false) {
    if (!selectedSite) return;
    if (!forceRefresh) {
      await viewCachedAnalysis();
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setActiveCompetitorFilter(null);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, force_refresh: forceRefresh }),
      });
      const d = await res.json() as ResearchResult & { mode?: string; sites_processed?: number; sites_total?: number; cached?: boolean; stale?: boolean };
      if (d.success) {
        setResult(d);
        if (selectedSite === "all") {
          showNotification("success", `Analyse multi-sites: ${d.sites_processed ?? 0}/${d.sites_total ?? 0} sites traités`);
        } else {
          const nextCached = cachedDataFromResearch(d);
          if (nextCached.gaps.length > 0 || nextCached.competitors.length > 0) {
            setCached(nextCached);
          } else {
            await fetchCached();
          }
          const compCount = d.competitors?.length ?? 0;
          const gapCount = d.gaps?.length ?? 0;
          const tag = d.cached ? (d.stale ? "cache ancien" : "depuis cache") : "fresh AI";
          showNotification("success", `Analyse OK — ${compCount} concurrents, ${gapCount} gaps (${tag})`);
        }
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

  async function refreshGapsFromAI() {
    if (!selectedSite || selectedSite === "all" || gapsRefreshing) return;
    setGapsRefreshing(true);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, force_refresh: true }),
      });
      const d = await res.json() as { success: boolean; error?: string };
      if (d.success) {
        showNotification("success", "Recherche web relancée. Rechargement des gaps...");
        await fetchGapRows();
      } else {
        showNotification("error", d.error || "Échec relance audit");
      }
    } catch (e) {
      showNotification("error", `Erreur réseau : ${e instanceof Error ? e.message : "inconnu"}`);
    }
    setGapsRefreshing(false);
  }

  function isQuestion(kw: string): boolean {
    const QUESTION_WORDS = ["comment","pourquoi","combien","quand","quel","quelle","quels","quelles","qu'est","qu est","est-ce","où","ou","qui","que","quoi","how","what","why","when","which","where","who","is","are","does","do","can","should","best","top","meilleur","meilleure","comparatif"];
    const lower = kw.toLowerCase();
    if (lower.includes("?")) return true;
    return QUESTION_WORDS.some(w => lower.startsWith(w + " ") || lower.includes(" " + w + " "));
  }

  function questionVariant(keyword: string): string {
    const clean = keyword.trim().replace(/\?+$/, "");
    if (isQuestion(clean)) return clean;
    if (/\b(comparatif|vs|alternative|meilleur|best|top)\b/i.test(clean)) return `quel est le meilleur ${clean}`;
    if (/\b(prix|tarif|cost|devis)\b/i.test(clean)) return `combien coûte ${clean}`;
    return `comment choisir ${clean}`;
  }

  function isLongTail(kw: string): boolean {
    return kw.trim().split(/\s+/).length >= 4;
  }

  const filteredGapRows = gapRows.filter(g => {
    if (gapsTypeFilter === "longtail") return isLongTail(g.keyword);
    if (gapsTypeFilter === "questions") return isQuestion(g.keyword);
    return true;
  });
  const derivedQuestionRows: GapRow[] = gapsTypeFilter === "questions" && filteredGapRows.length === 0 && gapRows.length > 0
    ? gapRows
        .filter((g) => isLongTail(g.keyword) || (g.volume ?? 0) >= 100)
        .slice(0, 10)
        .map((g) => ({ ...g, keyword: questionVariant(g.keyword), derived_question: true }))
    : [];
  const visibleGapRows = filteredGapRows.length > 0 ? filteredGapRows : derivedQuestionRows;

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
    if (selectedSite && selectedSite !== "all") {
      void fetchCached();
      void fetchLlmScans();
      setExpandedCompetitor(null);
      setCompetitorKw({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite]);

  // Derived data
  const gaps = cached.gaps;
  // A cached competitor without a recorded gap is not evidence of a keyword footprint.
  // Do not render a misleading "0 keywords" competitor card.
  const competitors = cached.competitors.filter((competitor) => competitor.found_keywords_count > 0);
  const totalVolume = gaps.reduce((s, g) => s + (g.volume ?? 0), 0);
  const hasVolumes = gaps.some((g) => (g.volume ?? 0) > 0);
  const selectedSiteObj = sites.find((s) => s.id === selectedSite);
  const competitorDomains = competitors.map((c) => c.domain);

  function inferIntent(keyword: string, rawIntent?: string): Exclude<IntentFilter, "all"> {
    const raw = (rawIntent ?? "").toLowerCase().trim();
    if (raw === "commercial" || raw === "informational" || raw === "transactional") return raw;
    const lower = keyword.toLowerCase();
    if (/\b(acheter|buy|prix|price|tarif|devis|commander|order|abonnement|subscription|cost)\b/.test(lower)) return "transactional";
    if (/\b(meilleur|meilleure|best|top|comparatif|vs|alternative|avis|review)\b/.test(lower)) return "commercial";
    if (isQuestion(lower)) return "informational";
    return "informational";
  }

  // Filtered gaps
  const filteredGaps = gaps.filter((g) => {
    const matchCompetitor = !activeCompetitorFilter || g.competitor_domain === activeCompetitorFilter || g.competitor === activeCompetitorFilter;
    const inferredIntent = inferIntent(g.keyword, g.intent);
    const matchIntent = intentFilter === "all" || inferredIntent === intentFilter;
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
            <div className="px-5 py-4 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <GitCompare className="w-4 h-4 text-purple-400" /> Keyword Gaps ({visibleGapRows.length}{visibleGapRows.length !== gapRows.length ? `/${gapRows.length}` : ""})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
                  {(["all","longtail","questions"] as const).map(t => (
                    <button key={t} type="button" onClick={() => setGapsTypeFilter(t)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${gapsTypeFilter === t ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>
                      {t === "all" ? "Tous" : t === "longtail" ? "Long tail (4+ mots)" : "Questions"}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => void refreshGapsFromAI()} disabled={gapsRefreshing || !selectedSite || selectedSite === "all"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-600/20 border border-orange-600/40 text-orange-300 hover:bg-orange-600/40 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title="Relancer la recherche web publique pour actualiser les gaps">
                  {gapsRefreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {gapsRefreshing ? "Recherche en cours..." : "Actualiser par le web"}
                </button>
                <select value={selectedSite ?? ""} onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none w-48">
                  <option value="all">Tous les sites</option>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            {gapsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-purple-400" /></div>
            ) : visibleGapRows.length === 0 && gapRows.length > 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">
                Aucun mot-clé ne correspond au filtre <span className="text-purple-400">{gapsTypeFilter === "longtail" ? "Long tail" : "Questions"}</span>. Essaie un autre filtre.
              </div>
            ) : gapRows.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">
                Aucun gap détecté. Lance d&apos;abord une analyse concurrentielle pour alimenter les données.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                      <th className="px-5 py-3 text-left">
                        <span className="inline-flex items-center gap-2">
                          Mot-clé
                          <CopyKeywordsButton keywords={visibleGapRows.map((g) => g.keyword)} />
                        </span>
                      </th>
                      <th className="px-5 py-3 text-right">Volume / impr. GSC</th>
                      <th className="px-5 py-3 text-right">Notre pos.</th>
                      <th className="px-5 py-3 text-left">Concurrents</th>
                      <th className="px-5 py-3 text-center">Brief</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGapRows.map((g, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-5 py-3 font-medium text-white">
                          {g.keyword}
                          {g.derived_question && (
                            <span className="ml-2 text-[10px] text-cyan-300 bg-cyan-900/30 border border-cyan-700/40 px-1.5 py-0.5 rounded">
                              dérivé
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-blue-400 font-semibold">
                          {g.source === "gsc_opportunity"
                            ? `${(g.impressions ?? 0).toLocaleString()} impr.`
                            : g.volume === null
                              ? "—"
                              : g.volume.toLocaleString()}
                        </td>
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
                                    {cp.domain} {cp.pos > 0 && <span className="text-green-400">#{cp.pos}</span>}
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
                                volume: g.volume ?? 0,
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
                onClick={() => void viewCachedAnalysis()}
                disabled={loading || !selectedSite}
                className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
                title="Affiche les données mises en cache (rapide, sans appel IA)"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {loading
                  ? "Chargement du cache..."
                  : "Voir l'analyse (cache)"}
              </button>
              <button
                onClick={() => void runResearch(true)}
                disabled={loading || !selectedSite}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600/80 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors border border-orange-500/40"
                title="Relance la découverte web publique et ignore le cache"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                Rescan web sourcé
              </button>
            </div>
            <p className="text-xs text-gray-400">
              <strong>Voir l&apos;analyse (cache)</strong> = lit les données stockées (rapide, sans appel IA).
              <strong className="ml-2">Rescan web sourcé</strong> = recherche publique sans clé, puis extraction des expressions visibles dans les titres et H1/H2 concurrents.
              Le cache expire automatiquement après 60 jours.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {(result?.fallback || result?.stale || result?.warning) && (
            <div className="bg-yellow-950/40 border border-yellow-700/60 rounded-lg px-4 py-3 text-sm text-yellow-200">
              {result?.fallback
                ? "Analyse concurrentielle indisponible : aucune donnée concurrentielle vérifiée n'est disponible."
                : result?.stale
                  ? "Cache concurrent ancien: a utiliser comme signal, pas comme verite de volume."
                  : result?.warning}
            </div>
          )}

          {/* Summary cards */}
          {gaps.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Keyword Gaps trouvés</div>
                <div className="text-3xl font-bold text-purple-400 mt-1">{gaps.length}</div>
                <div className="text-xs text-gray-400 mt-1">{hasVolumes ? "volumes estimés, source indiquée par ligne" : "expressions visibles, sans volume inventé"}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Volume total ciblable</div>
                <div className={`text-3xl font-bold mt-1 ${hasVolumes ? "text-blue-400" : "text-gray-600"}`}>
                  {hasVolumes ? totalVolume.toLocaleString() : "N/A"}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {hasVolumes ? "estimation mensuelle cumulee" : "donnees non disponibles"}
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
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="font-medium text-gray-200 flex items-center gap-2">
                  <Target className="w-4 h-4 text-purple-400" />
                  Concurrents identifiés
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void runLlmScan(false)}
                    disabled={llmScanRunning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 border border-blue-600/40 text-blue-300 hover:bg-blue-600/40 disabled:opacity-40 transition"
                    title="Scanne /llms.txt + robots.txt + JSON-LD pour chaque concurrent (cache 7j)"
                  >
                    {llmScanRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                    {llmScanRunning ? "Scan en cours..." : "Scan LLM readiness"}
                  </button>
                  {llmScanRunning ? null : Object.keys(llmScans).length > 0 && (
                    <button
                      onClick={() => void runLlmScan(true)}
                      disabled={llmScanRunning}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-600/20 border border-orange-600/40 text-orange-300 hover:bg-orange-600/40 disabled:opacity-40 transition"
                      title="Force un nouveau scan live (ignore cache 7j)"
                    >
                      <RefreshCw className="w-3 h-3" /> Rescan live
                    </button>
                  )}
                  {activeCompetitorFilter && (
                    <button
                      onClick={() => setActiveCompetitorFilter(null)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                    >
                      <X className="w-3 h-3" /> Retirer filtre
                    </button>
                  )}
                </div>
              </div>

              {/* Own site LLM readiness — highlighted above competitors */}
              {ownSiteScan && (
                <div className="mb-4 rounded-lg border-2 border-blue-500/40 bg-gradient-to-br from-blue-900/20 to-purple-900/20 p-4">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-semibold text-blue-300">TON SITE — {sites.find((s) => s.id === selectedSite)?.name ?? ""}</span>
                      <span className="text-xs text-gray-400">{ownSiteScan.competitor_domain}</span>
                    </div>
                    <div className={`text-2xl font-bold ${
                      ownSiteScan.llm_readiness_score >= 70 ? "text-green-400"
                        : ownSiteScan.llm_readiness_score >= 40 ? "text-orange-400"
                          : "text-red-400"
                    }`}>
                      LLM {ownSiteScan.llm_readiness_score}/100
                    </div>
                  </div>
                  {/* Quick stats inline */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={`px-2 py-1 rounded ${ownSiteScan.llms_txt_present ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                      llms.txt {ownSiteScan.llms_txt_present ? "✓" : "✗"}
                    </span>
                    <span className="px-2 py-1 rounded bg-gray-800 text-gray-300">
                      {ownSiteScan.ai_bots_allowed.length} bots IA autorisés
                    </span>
                    <span className="px-2 py-1 rounded bg-gray-800 text-gray-300">
                      {ownSiteScan.schemas_detected.length} schemas
                    </span>
                    {ownSiteScan.has_open_graph && (
                      <span className="px-2 py-1 rounded bg-green-500/10 text-green-400">OG ✓</span>
                    )}
                  </div>
                  {/* Top 3 recommendations */}
                  {ownSiteScan.recommendations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-blue-500/20">
                      <div className="text-xs text-gray-400 mb-1.5">À AMÉLIORER POUR ÊTRE MIEUX CITÉ PAR LES LLM :</div>
                      <ul className="text-xs text-gray-200 space-y-1">
                        {ownSiteScan.recommendations.slice(0, 3).map((rec, i) => (
                          <li key={i} className="flex gap-2"><span className="text-blue-400">→</span>{rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {competitors.map((c) => {
                  const isActive = activeCompetitorFilter === c.domain;
                  const isExpanded = expandedCompetitor === c.domain;
                  const scan = llmScans[c.domain.toLowerCase()];
                  const scoreColor = !scan
                    ? "text-gray-500 bg-gray-800"
                    : scan.llm_readiness_score >= 70
                      ? "text-green-400 bg-green-900/30"
                      : scan.llm_readiness_score >= 40
                        ? "text-orange-400 bg-orange-900/30"
                        : "text-red-400 bg-red-900/30";
                  return (
                    <div
                      key={c.domain}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        isExpanded
                          ? "border-blue-500 bg-blue-900/20"
                          : isActive
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
                        <div className="text-xs text-gray-400 mt-0.5">
                          {(c.total_volume / 1000).toFixed(1)}K vol/mois
                        </div>
                      )}
                      {/* LLM readiness badge */}
                      {scan && (
                        <div className={`mt-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${scoreColor}`}>
                          <Shield className="w-2.5 h-2.5" /> LLM {scan.llm_readiness_score}/100
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleExpandCompetitor(c.domain)}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
                          title="Détail keywords + LLM scan"
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {isExpanded ? "Replier" : "Détail"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveCompetitorFilter(isActive ? null : c.domain)}
                          className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                            isActive ? "bg-purple-700 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-200"
                          }`}
                          title="Filtrer le tableau des gaps par ce concurrent"
                        >
                          <Filter className="w-2.5 h-2.5" />
                          {isActive ? "Filtré" : "Filtrer"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Expanded panel */}
              {expandedCompetitor && (
                <ExpandedCompetitorPanel
                  domain={expandedCompetitor}
                  kwData={competitorKw[expandedCompetitor]}
                  kwLoading={kwLoading === expandedCompetitor}
                  kwTab={kwTab}
                  setKwTab={setKwTab}
                  llmScan={llmScans[expandedCompetitor.toLowerCase()]}
                  llmScanLoading={llmScanLoading}
                  onClose={() => setExpandedCompetitor(null)}
                />
              )}
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
                      <div className="text-xs text-gray-400 mt-1 max-w-[250px] truncate">{c.description}</div>
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
                    <span className="text-gray-400 text-xs">({filteredGaps.length}/{gaps.length})</span>
                  </h2>
                </div>
                {/* Intent filter chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">Intent:</span>
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
                    Expressions extraites des titres et H1/H2 publics. Volumes, difficulté et positions restent absents tant qu&apos;une source dédiée ne les valide pas.
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                      <th className="px-5 py-3 text-left">
                        <span className="inline-flex items-center gap-2">
                          Mot-clé
                          <CopyKeywordsButton keywords={filteredGaps.map((g) => g.keyword)} />
                        </span>
                      </th>
                      {hasVolumes && <th className="px-5 py-3 text-right">Volume estime</th>}
                      {hasVolumes && <th className="px-5 py-3 text-center">Source</th>}
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
                      const inferredIntent = inferIntent(g.keyword, g.intent);
                      return (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-5 py-3 font-medium text-white">{g.keyword}</td>
                          {hasVolumes && (
                            <td className="px-5 py-3 text-right text-blue-400 font-semibold">
                              {(g.volume ?? 0).toLocaleString()}
                            </td>
                          )}
                          {hasVolumes && (
                            <td className="px-5 py-3 text-center">
                              <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700">
                                {gapSourceLabel(g.source)}
                              </span>
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
                            {(g.competitor_position ?? 0) > 0
                              ? <span className={(g.competitor_position ?? 99) <= 5 ? "text-green-400" : (g.competitor_position ?? 99) <= 10 ? "text-yellow-400" : "text-gray-400"}>
                                  {g.competitor_position}
                                </span>
                              : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={`text-xs font-medium ${DIFF_COLOR[g.difficulty] ?? "text-gray-400"}`}>
                              {g.difficulty || "—"}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded ${INTENT_COLOR[inferredIntent] ?? "text-gray-400 bg-gray-800"}`}>
                              {g.intent || inferredIntent}
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
                  <div className="py-8 text-center text-gray-400 text-sm">Aucun gap pour ces filtres.</div>
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
                      const siteLabel = selectedSiteObj ? `${selectedSiteObj.name} (${selectedSiteObj.url})` : "le site selectionne";
                      setAiWidget((s) => ({ ...s, prompt: a.buildPrompt(domains, siteLabel) }));
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
                {aiWidget.loading ? "L'IA scrute les concurrents en temps reel (25-40s)..." : "Analyser"}
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
              <div className="text-gray-400 text-sm">
                Clique &quot;Lancer l&apos;analyse&quot; pour trouver les keyword gaps de tes concurrents
              </div>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

interface ExpandedCompetitorPanelProps {
  domain: string;
  kwData: CompetitorKeywords | undefined;
  kwLoading: boolean;
  kwTab: KwTabName;
  setKwTab: (t: KwTabName) => void;
  llmScan: LLMScanResult | undefined;
  llmScanLoading: boolean;
  onClose: () => void;
}

function ExpandedCompetitorPanel({
  domain,
  kwData,
  kwLoading,
  kwTab,
  setKwTab,
  llmScan,
  llmScanLoading,
  onClose,
}: ExpandedCompetitorPanelProps) {
  const cats = kwData?.categories;
  const tabStats =
    kwTab === "general" ? cats?.general
    : kwTab === "longtail" ? cats?.longtail
    : cats?.questions;

  const scoreColor = !llmScan
    ? "text-gray-400 border-gray-700 bg-gray-800"
    : llmScan.llm_readiness_score >= 70
      ? "text-green-400 border-green-700 bg-green-900/20"
      : llmScan.llm_readiness_score >= 40
        ? "text-orange-400 border-orange-700 bg-orange-900/20"
        : "text-red-400 border-red-700 bg-red-900/20";

  return (
    <div className="mt-5 bg-gray-950/60 border border-blue-900/50 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <div className="flex items-center gap-2">
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=20`}
            alt=""
            width={20}
            height={20}
            className="rounded-sm"
          />
          <h3 className="font-semibold text-white">{domain}</h3>
          <span className="text-xs text-gray-500">— détail keywords + LLM readiness</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Keyword breakdown */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-green-400" />
          <span className="text-sm font-medium text-gray-200">Keywords par catégorie</span>
          {kwData && (
            <span className="text-xs text-gray-500">— {kwData.total_keywords} mots-clés au total</span>
          )}
        </div>
        {kwLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-400" /></div>
        ) : !cats ? (
          <div className="text-xs text-gray-500 py-4">Pas de données pour ce concurrent.</div>
        ) : (
          <>
            <div className="flex gap-1 mb-3 bg-gray-900 rounded-lg p-1 w-fit">
              {(["general", "longtail", "questions"] as const).map((t) => {
                const stats = cats[t];
                const label = t === "general" ? "General (1-3 mots)"
                  : t === "longtail" ? "Long-tail (4+ mots)"
                  : "Questions";
                return (
                  <button
                    key={t}
                    onClick={() => setKwTab(t)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                      kwTab === t ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {label} <span className="opacity-70">({stats.count})</span>
                  </button>
                );
              })}
            </div>
            {tabStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase text-gray-500">Nombre</div>
                  <div className="text-xl font-bold text-blue-400">{tabStats.count}</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase text-gray-500">Volume cumulé</div>
                  <div className="text-xl font-bold text-purple-400">
                    {tabStats.total_volume.toLocaleString()}
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                  <div className="text-[10px] uppercase text-gray-500">Top 5 affichés</div>
                  <div className="text-xl font-bold text-gray-200">{tabStats.top.length}</div>
                </div>
              </div>
            )}
            {tabStats && tabStats.top.length > 0 ? (
              <div className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-800">
                      <th className="px-3 py-2 text-left">
                        <span className="inline-flex items-center gap-2">
                          Mot-clé
                          <CopyKeywordsButton keywords={tabStats.top.map((k) => k.keyword)} className="h-6 w-6" />
                        </span>
                      </th>
                      <th className="px-3 py-2 text-right">Volume</th>
                      <th className="px-3 py-2 text-right">Pos.</th>
                      <th className="px-3 py-2 text-center">Intent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabStats.top.map((k, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-3 py-2 text-white">{k.keyword}</td>
                        <td className="px-3 py-2 text-right text-blue-400 font-semibold">{k.volume.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-300">{k.position || "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded ${INTENT_COLOR[k.intent] ?? "text-gray-400 bg-gray-800"}`}>
                            {k.intent || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : tabStats ? (
              <div className="text-xs text-gray-500 py-4">Aucun mot-clé dans cette catégorie.</div>
            ) : null}
          </>
        )}
      </div>

      {/* LLM readiness */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-gray-200">LLM bot optimization</span>
          {llmScan && (
            <span className="text-[10px] text-gray-500">
              — scanné le {new Date(llmScan.scanned_at).toLocaleDateString("fr-FR")}
            </span>
          )}
        </div>
        {llmScanLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-400" /></div>
        ) : !llmScan ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs text-gray-400">
            Pas encore scanné. Clique sur <strong className="text-blue-400">Scan LLM readiness</strong> en haut pour lancer un scan global.
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`border rounded-lg p-4 ${scoreColor}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase opacity-70">LLM readiness</div>
                  <div className="text-3xl font-bold">{llmScan.llm_readiness_score}/100</div>
                </div>
                <div className="text-right text-xs space-y-1">
                  <div>llms.txt : <strong>{llmScan.llms_txt_present ? "OUI" : "NON"}</strong></div>
                  <div>Open Graph : <strong>{llmScan.has_open_graph ? "OUI" : "NON"}</strong></div>
                  <div>AI bots autorisés : <strong>{llmScan.ai_bots_allowed.length}</strong></div>
                  <div>Schemas détectés : <strong>{llmScan.schemas_detected.length}</strong></div>
                </div>
              </div>
              {/* Gauge bar */}
              <div className="mt-3 h-2 bg-gray-900/60 rounded overflow-hidden">
                <div
                  className={`h-full ${
                    llmScan.llm_readiness_score >= 70 ? "bg-green-500"
                    : llmScan.llm_readiness_score >= 40 ? "bg-orange-500"
                    : "bg-red-500"
                  }`}
                  style={{ width: `${llmScan.llm_readiness_score}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2 font-medium">AI bots autorisés ({llmScan.ai_bots_allowed.length})</div>
                <div className="flex flex-wrap gap-1">
                  {llmScan.ai_bots_allowed.length === 0 ? (
                    <span className="text-xs text-red-400">Aucun</span>
                  ) : (
                    llmScan.ai_bots_allowed.map((b) => (
                      <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-300 border border-green-800/50">{b}</span>
                    ))
                  )}
                </div>
                {llmScan.ai_bots_disallowed.length > 0 && (
                  <>
                    <div className="text-xs text-gray-400 mt-3 mb-1 font-medium">Bloqués ({llmScan.ai_bots_disallowed.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {llmScan.ai_bots_disallowed.map((b) => (
                        <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-300 border border-red-800/50">{b}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2 font-medium">Schemas JSON-LD ({llmScan.schemas_detected.length})</div>
                <div className="flex flex-wrap gap-1">
                  {llmScan.schemas_detected.length === 0 ? (
                    <span className="text-xs text-gray-500">Aucun schema d&apos;intérêt détecté</span>
                  ) : (
                    llmScan.schemas_detected.map((s) => (
                      <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 border border-blue-800/50">{s}</span>
                    ))
                  )}
                </div>
              </div>
            </div>

            {llmScan.llms_txt_present && llmScan.llms_txt_content && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2 font-medium flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Aperçu /llms.txt
                </div>
                <pre className="text-[11px] text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                  {llmScan.llms_txt_content.slice(0, 1500)}
                  {llmScan.llms_txt_content.length > 1500 ? "\n…" : ""}
                </pre>
              </div>
            )}

            {llmScan.recommendations.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2 font-medium">Recommandations pour {domain}</div>
                <ul className="space-y-1">
                  {llmScan.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                      <span className="text-purple-400 flex-shrink-0">→</span> {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
