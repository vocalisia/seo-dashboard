"use client";

import { useEffect, useState } from "react";
import {
  Globe, Search, MousePointerClick,
  BarChart3, RefreshCw, Loader2, ChevronDown, ChevronRight,
  PlaySquare, TrendingUp, TrendingDown, X, Smartphone, ChevronsDownUp, ChevronsUpDown, ExternalLink, Activity
} from "lucide-react";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";

interface Site {
  id: number; name: string; url: string;
  gsc_clicks_30d: number; gsc_impressions_30d: number; avg_position_30d: number;
}

interface DashboardQualitySite {
  id: number;
  name: string;
  latest_gsc_date: string | null;
  positioned_keywords_30d: number;
  top10_keywords_7d: number;
  tracked_keywords: number;
  kp_volumes_imported: number;
  kp_volumes_missing: number;
  gain_candidates: number;
  latest_ga4_date: string | null;
  users_30d: number;
  status: "ok" | "gsc_not_configured" | "gsc_no_query_data" | "gsc_stale" | "kp_missing" | "ga4_no_daily_data" | string;
}

interface QueryData {
  query: string; total_clicks: number; total_impressions: number;
  avg_ctr: number; avg_position: number; first_seen?: string | null;
  // From tracked_keywords JOIN
  volume_market?: number | null; volume_fr?: number | null; volume_ch?: number | null; market?: string | null; volume_source?: string | null;
  row_source?: "current" | "recent_30d" | "tracked";
}

interface GainData {
  query: string;
  position_now: number; position_prev: number;
  position_w2: number | null; position_w3: number | null; position_w4: number | null;
  gain: number;
  gain_w1_w2: number | null; gain_w2_w3: number | null; gain_w3_w4: number | null;
  clicks_now: number; clicks_prev: number; clicks_gain: number;
  impressions_now: number;
  first_seen?: string | null;
  // From tracked_keywords JOIN
  volume_market?: number | null; volume_fr?: number | null; volume_ch?: number | null; market?: string | null; volume_source?: string | null;
}

interface GainLabels { w0: string; w1: string; w2: string; w3: string; w4: string }

const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#f97316","#14b8a6","#6366f1","#84cc16","#f43f5e","#a855f7","#0ea5e9","#22c55e","#eab308"];

type Period = "3" | "7" | "30" | "90";
type TabType = "keywords" | "gains" | "analytics" | "device";
type KwTypeFilter = "all" | "important" | "highvolume" | "longtail" | "questions";
const KEYWORD_LOAD_LIMIT = 500;
const KEYWORD_RENDER_LIMIT = 300;

interface ServiceTiming {
  label: string;
  ms: number;
  ok: boolean;
  at: number;
  cache?: string | null;
}

interface DeviceRow {
  device: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
}

interface AnalyticsDay {
  date: string; sessions: number; users: number; pageviews: number;
  organic_sessions: number; direct_sessions: number; referral_sessions: number; social_sessions: number;
  bounce_rate: number; avg_session_duration: number;
}

// Prefer DB-stored real volume (DataForSEO / Ahrefs / Keyword Planner via sync).
// GSC impressions are a visibility signal, not a market volume: do not use them
// to rank opportunity or trigger action recommendations.
function resolveSourceVolume(
  volMarket: number | null | undefined,
  volFr: number | null | undefined,
  volCh?: number | null | undefined,
): number {
  const m = Number(volMarket ?? 0);
  if (m > 1) return m;
  const ch = Number(volCh ?? 0);
  if (ch > 1) return ch;
  const f = Number(volFr ?? 0);
  if (f > 1) return f;
  return 0;
}

function volLabel(vol: number): { label: string; color: string } {
  if (!vol || vol <= 1) return { label: "-", color: "text-gray-600" }; // 1 = niche_skip marker
  if (vol >= 10000) return { label: vol.toLocaleString(), color: "text-orange-400" };
  if (vol >= 1000) return { label: vol.toLocaleString(), color: "text-yellow-400" };
  if (vol >= 100) return { label: vol.toLocaleString(), color: "text-blue-400" };
  return { label: vol.toLocaleString(), color: "text-gray-400" };
}

type VolumeSignal = {
  value: number;
  kind: "source" | "source_empty" | "none";
};

function hasImportedVolumeSource(source: string | null | undefined): boolean {
  const s = String(source ?? "").toLowerCase();
  return s.startsWith("google_kp_real_plan") || s.includes("keyword_planner") || s.includes("dataforseo") || s.includes("ahrefs");
}

function resolveVolumeSignal(
  volMarket: number | null | undefined,
  volFr: number | null | undefined,
  _impressions: number | null | undefined,
  _periodDays: number,
  volCh?: number | null | undefined,
  volumeSource?: string | null | undefined,
): VolumeSignal {
  const source = resolveSourceVolume(volMarket, volFr, volCh);
  if (source > 1) return { value: source, kind: "source" };
  if (hasImportedVolumeSource(volumeSource)) return { value: 0, kind: "source_empty" };
  return { value: 0, kind: "none" };
}

function volumeSignalLabel(signal: VolumeSignal): { label: string; color: string; title: string } {
  const base = volLabel(signal.value);
  if (signal.kind === "source") {
    return { ...base, title: "Volume mensuel importe depuis une source externe." };
  }
  if (signal.kind === "source_empty") {
    return { label: "0", color: "text-gray-500", title: "Keyword Planner importe, mais Google ne donne pas de volume exploitable pour ce mot-cle." };
  }
  return { ...base, title: "Aucun volume source disponible." };
}

function volumeSignalBadge(signal: VolumeSignal): { label: string; className: string } {
  if (signal.kind === "source") {
    return { label: "volume importe", className: "bg-green-500/15 text-green-300 border-green-500/30" };
  }
  if (signal.kind === "source_empty") {
    return { label: "0 KP", className: "bg-slate-700/40 text-slate-300 border-slate-600/40" };
  }
  return { label: "non importe", className: "bg-gray-700/40 text-gray-400 border-gray-600/40" };
}
function ctrAtPosition(pos: number): number {
  if (pos <= 1) return 0.32;
  if (pos <= 2) return 0.18;
  if (pos <= 3) return 0.12;
  if (pos <= 5) return 0.07;
  if (pos <= 7) return 0.04;
  if (pos <= 10) return 0.025;
  if (pos <= 15) return 0.012;
  if (pos <= 20) return 0.006;
  if (pos <= 30) return 0.003;
  return 0.001;
}

// Score d'opportunité : combien de clics gagnerais-tu en passant top 3 ?
// = volume mensuel × (CTR_top3 - CTR_actuel)
function opportunityScore(monthlyVolume: number, currentPos: number): number {
  if (monthlyVolume <= 0 || currentPos <= 0) return 0;
  if (currentPos <= 3) return 0; // déjà top — focus retention
  const ctrTarget = ctrAtPosition(3);
  const ctrNow = ctrAtPosition(currentPos);
  const gain = monthlyVolume * (ctrTarget - ctrNow);
  return Math.max(0, Math.round(gain));
}

function oppLabel(score: number): { label: string; color: string } {
  if (score >= 500) return { label: `+${score.toLocaleString()} clics/mois`, color: "text-orange-400 font-bold" };
  if (score >= 100) return { label: `+${score.toLocaleString()} clics/mois`, color: "text-yellow-400 font-semibold" };
  if (score >= 20) return { label: `+${score.toLocaleString()} clics/mois`, color: "text-blue-400" };
  if (score > 0) return { label: `+${score} clics/mois`, color: "text-gray-400" };
  return { label: "-", color: "text-gray-600" };
}
function recommendedAction(position: number, monthlyVolume: number): { label: string; cta: string; type: "push" | "optimize" | "maintain" | "create" } {
  if (position <= 0) return { label: "Pas de position GSC", cta: "-", type: "create" };
  if (monthlyVolume <= 1) return { label: "Importer volume KP avant action", cta: "-", type: "maintain" };
  if (position <= 3) return { label: "Maintenir top 3", cta: "Suivre", type: "maintain" };
  if (position <= 10) return { label: "Optimiser CTR", cta: "Optimiser", type: "optimize" };
  if (position <= 20 && monthlyVolume >= 100) return { label: "Pousser top 10", cta: "Pousser", type: "push" };
  if (position <= 30 && monthlyVolume >= 500) return { label: "Renforcer contenu", cta: "Renforcer", type: "push" };
  if (monthlyVolume >= 1000) return { label: "Creer article dedie", cta: "Creer", type: "create" };
  return { label: "Faible priorite", cta: "-", type: "maintain" };
}
function keywordSolution(kw: QueryData): string {
  const pos = Number(kw.avg_position) || 0;
  const sourceVolume = resolveSourceVolume(kw.volume_market, kw.volume_fr, kw.volume_ch);
  const hasSource = hasImportedVolumeSource(kw.volume_source);
  const impressions = Number(kw.total_impressions) || 0;

  if (!pos || pos === 0) return "Pas de position GSC";
  if (sourceVolume <= 1 && hasSource) return pos <= 10 ? "Page 1 - CTR/meta, KP sans volume" : "KP sans volume - prioriser GSC";
  if (sourceVolume <= 1 && pos > 10) return impressions >= 20 ? "Importer volume KP - signal GSC" : "Importer volume KP";
  if (sourceVolume <= 1) return "Importer volume KP avant action";
  if (pos <= 3) return "Top 3 - maintenir";
  if (pos <= 10) return "Page 1 - optimiser CTR";
  if (pos <= 15) return "Quasi page 1 - contenu + maillage";
  if (pos <= 30) return "Page 2-3 - renforcer la page";
  return sourceVolume >= 100 ? "Creer contenu dedie" : "Faible priorite";
}

function qualityStatusLabel(status: string): string {
  if (status === "ok") return "donnees OK";
  if (status === "gsc_stale") return "GSC en retard";
  if (status === "gsc_no_query_data") return "GSC sans requetes";
  if (status === "gsc_not_configured") return "GSC non configure";
  if (status === "kp_missing") return "Volumes KP manquants";
  if (status === "ga4_no_daily_data") return "GA4 sans donnees";
  return status;
}

function qualityStatusClass(status: string): string {
  if (status === "ok") return "border-green-500/30 bg-green-500/10 text-green-300";
  if (status === "gsc_stale") return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  return "border-yellow-500/30 bg-yellow-500/10 text-yellow-200";
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

async function runLimited<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

async function fetchWithTiming(
  record: (timing: ServiceTiming) => void,
  label: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const started = performance.now();
  const res = await fetch(input, init);
  record({
    label,
    ms: performance.now() - started,
    ok: res.ok,
    at: Date.now(),
    cache: res.headers.get("X-Cache"),
  });
  return res;
}

export default function DashboardPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [pageLoadMs, setPageLoadMs] = useState<number | null>(null);
  const [serviceTimings, setServiceTimings] = useState<ServiceTiming[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<Record<number, TabType>>({});
  const [period, setPeriod] = useState<Period>("7"); // 7j default: 3j lag=2j = often just 1 real day
  const [keywords, setKeywords] = useState<Record<string, QueryData[]>>({});
  const [gains, setGains] = useState<Record<number, GainData[]>>({});
  const [qualitySites, setQualitySites] = useState<DashboardQualitySite[]>([]);
  const [gainLabels, setGainLabels] = useState<GainLabels | null>(null);
  const [kwLoadingIds, setKwLoadingIds] = useState<Set<number>>(new Set());
  const [highVolLoading, setHighVolLoading] = useState<Set<number>>(new Set());
  const [highVolResult, setHighVolResult] = useState<Record<number, {added: number; total: number}>>({});
  const [highVolPanel, setHighVolPanel] = useState<number | null>(null); // siteId with open panel
  const [highVolKws, setHighVolKws] = useState<{keyword: string; impressions: number; avg_position: number; clicks: number; source: string; already_tracked: boolean}[]>([]);
  const [highVolPanelLoading, setHighVolPanelLoading] = useState(false);
  const [highVolSelected, setHighVolSelected] = useState<Set<string>>(new Set());
  type HVSort = "impressions" | "avg_position" | "clicks";
  type HVDir = "asc" | "desc";
  const [hvSortCol, setHvSortCol] = useState<HVSort>("impressions");
  const [hvSortDir, setHvSortDir] = useState<HVDir>("desc");
  function hvSort(col: HVSort) {
    if (hvSortCol === col) {
      setHvSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setHvSortCol(col);
      setHvSortDir(col === "avg_position" ? "asc" : "desc");
    }
    setHighVolKws(prev => [...prev].sort((a, b) => {
      const dir = (col === hvSortCol ? (hvSortDir === "desc" ? 1 : -1) : (col === "avg_position" ? 1 : -1));
      return (a[col] - b[col]) * dir;
    }));
  }
  const [search, setSearch] = useState("");
  const [kwTypeFilter, setKwTypeFilter] = useState<KwTypeFilter>("all");
  const [siteSortCol, setSiteSortCol] = useState<"clicks"|"impressions"|"position">("clicks");
  const [siteSortDir, setSiteSortDir] = useState<"asc"|"desc">("desc");
  const [sortCol, setSortCol] = useState<"priority"|"clicks"|"impressions"|"ctr"|"position"|"volume">("priority");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [gainSortCol, setGainSortCol] = useState<"gain"|"position_now"|"clicks_gain"|"volume"|"opportunity">("gain");
  const [gainSortDir, setGainSortDir] = useState<"asc"|"desc">("desc");
  const [analytics, setAnalytics] = useState<Record<number, AnalyticsDay[]>>({});
  const [activeKw, setActiveKw] = useState<{siteId: number; query: string} | null>(null);
  const [kwHistory, setKwHistory] = useState<{date: string; position: number; clicks: number}[]>([]);
  const [kwHistLoading, setKwHistLoading] = useState(false);
  const [deviceData, setDeviceData] = useState<Record<number, DeviceRow[]>>({});
  const [langFilter, setLangFilter] = useState<string>(""); // "" | "fr" | "en" | "de" | ...
  const [configError, setConfigError] = useState<string | null>(null);
  const [aiModal, setAiModal] = useState<{
    siteId: number; query: string; actionType: string; loading: boolean; response?: string; error?: string;
  } | null>(null);

  function recordTiming(timing: ServiceTiming) {
    setServiceTimings((prev) => [timing, ...prev].slice(0, 12));
  }

  async function timedFetch(label: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetchWithTiming(recordTiming, label, input, init);
  }

  async function askAiAgent(siteId: number, query: string, position: number, monthlyVolume: number, actionType: "push" | "optimize" | "maintain" | "create") {
    setAiModal({ siteId, query, actionType, loading: true });
    try {
      const site = sites.find(s => s.id === siteId);
      const res = await timedFetch("IA action", "/api/ai/seo-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          query,
          position,
          monthlyVolume,
          actionType,
          siteUrl: site?.url,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAiModal({ siteId, query, actionType, loading: false, response: data.response });
      } else {
        setAiModal({ siteId, query, actionType, loading: false, error: data.error || "Erreur IA" });
      }
    } catch (e) {
      setAiModal({ siteId, query, actionType, loading: false, error: e instanceof Error ? e.message : "Erreur réseau" });
    }
  }

  async function fetchSites(lang?: string, p?: Period, silent = false) {
    if (silent) setStatsRefreshing(true);
    else setLoading(true);
    setConfigError(null);
    try {
      const langKey = lang ?? langFilter;
      const periodKey = p ?? period;
      const params = new URLSearchParams();
      if (langKey) params.set("language", langKey);
      params.set("days", periodKey);
      const res = await timedFetch("Sites + stats", `/api/sites?${params.toString()}`);
      const data = await res.json() as unknown;
      if (data && typeof data === "object" && data !== null && "error" in data) {
        const err = data as { error?: string; message?: string };
        if (err.error === "missing_env") {
          setConfigError(
            typeof err.message === "string"
              ? err.message
              : "DATABASE_URL manquant dans .env.local."
          );
          setSites([]);
          if (silent) setStatsRefreshing(false);
          else setLoading(false);
          return;
        }
      }
      if (Array.isArray(data)) setSites(data);
    } catch { /* ignore */ }
    if (silent) setStatsRefreshing(false);
    else setLoading(false);
  }

  async function fetchQuality() {
    try {
      const res = await timedFetch("Qualite dashboard", "/api/dashboard-quality");
      const data = await res.json() as { sites?: DashboardQualitySite[] };
      if (Array.isArray(data.sites)) setQualitySites(data.sites);
    } catch {
      setQualitySites([]);
    }
  }

  async function loadInitialDashboard() {
    setLoading(true);
    setConfigError(null);
    try {
      const res = await timedFetch("Sites liste rapide", "/api/sites");
      const data = await res.json() as unknown;
      if (Array.isArray(data)) setSites(data);
    } catch { /* ignore */ }
    setLoading(false);
    void fetchSites(undefined, period, true);
    void fetchQuality();
  }

  useEffect(() => { void loadInitialDashboard(); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav) setPageLoadMs(nav.domContentLoadedEventEnd);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function loadKeywords(siteId: number, p: Period) {
    const key = `${siteId}-${p}-${langFilter || "all"}`;
    if (keywords[key]) return;
    setKwLoadingIds(prev => new Set(prev).add(siteId));
    try {
      const langQs = langFilter ? `&language=${langFilter}` : "";
      const res = await timedFetch("Mots-cles site", `/api/search-console?siteId=${siteId}&type=queries&days=${p}&limit=${KEYWORD_LOAD_LIMIT}${langQs}`);
      const data = await res.json();
      if (Array.isArray(data)) setKeywords(prev => ({ ...prev, [key]: data }));
    } catch { /* ignore */ }
    setKwLoadingIds(prev => { const n = new Set(prev); n.delete(siteId); return n; });
  }

  async function loadGains(siteId: number, force = false) {
    if (gains[siteId] && !force) return;
    try {
      const langQs = langFilter ? `&language=${langFilter}` : "";
      const res = await timedFetch("Gains site", `/api/search-console?siteId=${siteId}&type=gains&limit=200${langQs}`);
      const data = await res.json() as { rows?: GainData[]; labels?: GainLabels } | GainData[];
      if (Array.isArray(data)) {
        setGains(prev => ({ ...prev, [siteId]: data }));
      } else if (data && Array.isArray(data.rows)) {
        setGains(prev => ({ ...prev, [siteId]: data.rows as GainData[] }));
        if (data.labels) setGainLabels(data.labels);
      }
    } catch { /* ignore */ }
  }

  async function changeLangFilter(lang: string) {
    setLangFilter(lang);
    // Invalidate ALL cache — sites stats + keywords + gains
    setKeywords({});
    setGains({});
    setAnalytics({});
    setDeviceData({});

    // Re-fetch sites with new country filter → updates clics/impr/position per site
    await fetchSites(lang, undefined, true);

    // Re-fetch keywords for all expanded sites
    const p = period;
    const langQs = lang ? `&language=${lang}` : "";
    for (const expandedId of expandedIds) {
      setKwLoadingIds(prev => new Set(prev).add(expandedId));
      try {
        const res = await timedFetch("Mots-cles filtre", `/api/search-console?siteId=${expandedId}&type=queries&days=${p}&limit=${KEYWORD_LOAD_LIMIT}${langQs}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          const key = `${expandedId}-${p}-${lang || "all"}`;
          setKeywords(prev => ({ ...prev, [key]: data }));
        }
      } catch { /* ignore */ }
      setKwLoadingIds(prev => { const n = new Set(prev); n.delete(expandedId); return n; });
      void loadGains(expandedId, true);
    }
  }

  async function toggleSite(siteId: number) {
    const wasOpen = expandedIds.has(siteId);
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (wasOpen) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }
      return next;
    });
    if (!wasOpen) {
      const tab = activeTab[siteId] || "keywords";
      if (tab === "keywords") {
        await loadKeywords(siteId, period);
      } else await loadGains(siteId);
    }
  }

  async function toggleAll() {
    if (expandedIds.size === sites.length) {
      setExpandedIds(new Set());
    } else {
      const allIds = sites.map(s => s.id);
      setExpandedIds(new Set(allIds));
      setBulkLoading(true);
      await runLimited(allIds, 4, async (id) => {
        const tab = activeTab[id] || "keywords";
        if (tab === "keywords") await loadKeywords(id, period);
        else if (tab === "gains") await loadGains(id);
        else if (tab === "analytics") await loadAnalytics(id, period);
        else await loadDeviceSplit(id, period);
      });
      setBulkLoading(false);
    }
  }

  async function loadAnalytics(siteId: number, p: Period) {
    if (analytics[siteId]) return;
    try {
      const res = await timedFetch("Analytics site", `/api/analytics?siteId=${siteId}&days=${p}`);
      const data = await res.json();
      if (Array.isArray(data)) setAnalytics(prev => ({ ...prev, [siteId]: data.map((r: AnalyticsDay) => ({ ...r, date: r.date.toString().slice(5, 10) })) }));
    } catch { /* ignore */ }
  }

  async function loadDeviceSplit(siteId: number, p: Period) {
    if (deviceData[siteId]) return;
    try {
      const res = await timedFetch("Device split", `/api/device-split?site_id=${siteId}&days=${p}`);
      const data = await res.json() as { overview?: DeviceRow[] };
      if (data.overview && Array.isArray(data.overview)) {
        setDeviceData(prev => ({ ...prev, [siteId]: data.overview as DeviceRow[] }));
      }
    } catch { /* ignore */ }
  }

  async function switchTab(siteId: number, tab: TabType) {
    setActiveTab(prev => ({ ...prev, [siteId]: tab }));
    if (tab === "keywords") { await loadKeywords(siteId, period); loadGains(siteId); }
    else if (tab === "gains") await loadGains(siteId);
    else if (tab === "analytics") await loadAnalytics(siteId, period);
    else if (tab === "device") await loadDeviceSplit(siteId, period);
  }

  async function changePeriod(p: Period) {
    setPeriod(p);
    await fetchSites(undefined, p, true);
    for (const id of expandedIds) await loadKeywords(id, p);
  }

  async function openHighVolPanel(siteId: number) {
    if (highVolPanel === siteId) { setHighVolPanel(null); return; }
    setHighVolPanel(siteId);
    setHighVolKws([]);
    setHighVolSelected(new Set());
    setHighVolPanelLoading(true);
    try {
      const res = await timedFetch("High volume", `/api/keywords/high-volume?site_id=${siteId}&min_imp=30`);
      const d = await res.json() as { success: boolean; keywords?: typeof highVolKws };
      if (d.success && d.keywords) {
        const untracked = d.keywords.filter(k => !k.already_tracked).slice(0, 40);
        setHighVolKws(untracked);
        // Keep discovery read-only by default. The user chooses what to track.
        setHighVolSelected(new Set());
      }
    } catch { /* ignore */ }
    setHighVolPanelLoading(false);
  }

  async function addSelectedHighVol(siteId: number) {
    const toAdd = highVolKws.filter(k => highVolSelected.has(k.keyword));
    if (toAdd.length === 0) return;
    setHighVolLoading(prev => new Set(prev).add(siteId));
    try {
      const res = await timedFetch("Ajout high volume", `/api/keywords/high-volume?site_id=${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: toAdd.map(k => ({ keyword: k.keyword, source: k.source })) }),
      });
      const d = await res.json() as { success: boolean; added: number };
      if (d.success) {
        setHighVolResult(prev => ({ ...prev, [siteId]: { added: d.added, total: toAdd.length } }));
        setHighVolPanel(null);
        if (d.added > 0) await loadKeywords(siteId, period);
      }
    } catch { /* ignore */ }
    setHighVolLoading(prev => { const n = new Set(prev); n.delete(siteId); return n; });
  }

  async function openKwHistory(siteId: number, query: string) {
    if (activeKw?.siteId === siteId && activeKw?.query === query) { setActiveKw(null); return; }
    setActiveKw({ siteId, query });
    setKwHistLoading(true);
    try {
      const res = await timedFetch("Historique mot-cle", `/api/keyword-history?siteId=${siteId}&query=${encodeURIComponent(query)}&days=90`);
      const data = await res.json();
      if (Array.isArray(data)) setKwHistory(data.map(r => ({ date: r.date.slice(5), position: Math.round(Number(r.position) * 10) / 10, clicks: Number(r.clicks) })));
    } catch { setKwHistory([]); }
    setKwHistLoading(false);
  }

  const [syncMsg, setSyncMsg] = useState<{type: "ok"|"err"; text: string} | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await timedFetch("Sync GSC/GA4", "/api/sync", { method: "POST" });
      const data = await res.json();
      if (res.status === 401 || data.error?.includes("authentifié")) {
        setSyncMsg({ type: "err", text: "Connecte-toi Google d'abord → /login" });
      } else if (data.error) {
        setSyncMsg({ type: "err", text: data.error });
      } else {
        const results = data.results || [];
        const total = results.reduce((s: number, r: { gsc?: number }) => s + (r.gsc || 0), 0);
        setSyncMsg({ type: "ok", text: `Sync OK — ${total} lignes GSC importées` });
        setKeywords({}); setGains({});
        await fetchSites(undefined, undefined, true);
      }
    } catch (err) {
      setSyncMsg({ type: "err", text: err instanceof Error ? err.message : "Erreur réseau" });
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 8000);
  }

  const totalClicks = sites.reduce((s, site) => s + (Number(site.gsc_clicks_30d) || 0), 0);
  const totalImpressions = sites.reduce((s, site) => s + (Number(site.gsc_impressions_30d) || 0), 0);
  const activeSites = sites.filter(s => Number(s.avg_position_30d) > 0);
  const avgPosition = activeSites.length > 0
    ? activeSites.reduce((s, site) => s + Number(site.avg_position_30d), 0) / activeSites.length
    : 0;
  const qualityById = new Map(qualitySites.map((site) => [site.id, site]));
  const qualityOkCount = qualitySites.filter((site) => site.status === "ok").length;
  const qualityStaleCount = qualitySites.filter((site) => site.status === "gsc_stale" || site.status === "gsc_no_query_data").length;
  const totalImportedVolumes = qualitySites.reduce((sum, site) => sum + Number(site.kp_volumes_imported || 0), 0);
  const totalMissingVolumes = qualitySites.reduce((sum, site) => sum + Number(site.kp_volumes_missing || 0), 0);
  const totalGainCandidates = qualitySites.reduce((sum, site) => sum + Number(site.gain_candidates || 0), 0);
  const totalTop10Keywords = qualitySites.reduce((sum, site) => sum + Number(site.top10_keywords_7d || 0), 0);
  const latestTiming = serviceTimings[0];
  const avgServiceMs = serviceTimings.length
    ? serviceTimings.reduce((sum, item) => sum + item.ms, 0) / serviceTimings.length
    : 0;

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );

  if (configError) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-xl bg-amber-950/30 border border-amber-700/40 rounded-2xl p-8 shadow-xl">
          <h1 className="text-xl font-bold text-amber-200 mb-3">Dashboard inaccessible en local</h1>
          <p className="text-gray-300 mb-6">{configError}</p>
          <p className="text-gray-400 text-sm mb-4">Le fichier <code className="bg-gray-800 px-1.5 py-0.5 rounded text-amber-100">.env.local</code> ne contient pas les variables (souvent après une réinitialisation de sécurité).</p>
          <ol className="list-decimal list-inside text-gray-300 text-sm space-y-3 mb-6">
            <li>
              Depuis le dossier du projet :{" "}
              <code className="bg-gray-800 px-2 py-1 rounded text-green-300">npx vercel env pull .env.local</code>
              {" "}(compte Vercel lié au projet)
            </li>
            <li>
              Ou copie les variables depuis le dashboard Vercel → Projet → Settings → Environment Variables.
            </li>
            <li>
              Vérifie au minimum <code className="bg-gray-800 px-1 rounded">DATABASE_URL</code>,{" "}
              <code className="bg-gray-800 px-1 rounded">NEXTAUTH_SECRET</code>,{" "}
              <code className="bg-gray-800 px-1 rounded">DASHBOARD_AUTH_USER</code> / <code className="bg-gray-800 px-1 rounded">DASHBOARD_AUTH_PASSWORD</code>.
            </li>
            <li>
              Puis <code className="bg-gray-800 px-1 rounded">npm run dev</code> et recharge la page.
            </li>
          </ol>
          <a
            href="/login"
            className="inline-block text-blue-400 hover:text-blue-300 text-sm underline"
          >
            Page de connexion (Google)
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* AI Action Modal */}
      {aiModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setAiModal(null)}
        >
          <div
            className="bg-gray-900 border border-blue-500/30 rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-blue-400 font-semibold">🤖 Agent IA SEO — {aiModal.actionType}</div>
                <div className="text-lg font-bold mt-1 text-white">&ldquo;{aiModal.query}&rdquo;</div>
              </div>
              <button
                type="button"
                onClick={() => setAiModal(null)}
                className="text-gray-400 hover:text-white text-2xl px-2"
                title="Fermer"
              >×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {aiModal.loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <div className="text-sm">L&apos;IA analyse ton mot-clé et génère un plan d&apos;action...</div>
                </div>
              )}
              {aiModal.error && (
                <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 text-red-300 text-sm">
                  Erreur : {aiModal.error}
                </div>
              )}
              {aiModal.response && (
                <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-gray-200 leading-relaxed">
                  {aiModal.response}
                </div>
              )}
            </div>
            {aiModal.response && (
              <div className="px-6 py-3 border-t border-gray-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(aiModal.response!)}
                  className="px-3 py-1.5 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition"
                >📋 Copier</button>
                <button
                  type="button"
                  onClick={() => setAiModal(null)}
                  className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white transition"
                >Fermer</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-7 h-7 text-blue-500" />
          <h1 className="text-xl font-bold">SEO Dashboard</h1>
          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">{sites.length} sites</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text" placeholder="Filtrer mots clés..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:border-blue-500"
          />
          <div className="flex bg-gray-800 border border-gray-700 rounded-lg overflow-hidden text-sm">
            {(["3","7","30","90"] as Period[]).map(p => (
              <button key={p} onClick={() => changePeriod(p)}
                className={`px-3 py-2 transition ${period === p ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
                {p}j
              </button>
            ))}
          </div>
          <select
            value={langFilter}
            onChange={(e) => changeLangFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            title="Filtrer les mots-clés par langue/pays"
          >
            <option value="">🌍 Tous pays</option>
            <option value="fr">🇫🇷 France (FR)</option>
            <option value="ch">🇨🇭 Suisse (CH uniquement)</option>
            <option value="en">🇬🇧 UK/US (EN)</option>
            <option value="de">🇩🇪 DE/AT/CH (DE)</option>
            <option value="es">🇪🇸 Espagne (ES)</option>
            <option value="it">🇮🇹 Italie (IT)</option>
            <option value="nl">🇳🇱 Pays-Bas (NL)</option>
            <option value="pt">🇵🇹 Portugal/BR (PT)</option>
          </select>
          <Link href="/overview" className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <Globe className="w-4 h-4" /> Vue globale
          </Link>
          <Link href="/reports" className="bg-green-600/20 hover:bg-green-600/40 text-green-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4" /> Rapports IA
          </Link>
          <Link href="/youtube" className="bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <PlaySquare className="w-4 h-4" /> YouTube
          </Link>
          <Link href="/opportunities" className="bg-green-600/20 hover:bg-green-600/40 text-green-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4" /> Opportunités
          </Link>
          <Link href="/audit" className="bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <Search className="w-4 h-4" /> Audit
          </Link>
          <Link href="/backlinks" className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <Globe className="w-4 h-4" /> Backlinks
          </Link>
          <Link href="/autopilot" className="bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            ⚡ Autopilot
          </Link>
          <Link href="/countries" className="bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            🌍 Pays
          </Link>
          <Link href="/competitors" className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            🎯 Concurrents
          </Link>
          <Link href="/tracker" className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            📊 Tracker
          </Link>
          <Link href="/calendar" className="bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            📅 Calendrier
          </Link>
          <Link href="/alerts" className="bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🚨 Alertes
          </Link>
          <Link href="/refresh" className="bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🔄 Refresh
          </Link>
          <Link href="/clusters" className="bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🧩 Clusters
          </Link>
          <Link href="/internal-links" className="bg-teal-600/20 hover:bg-teal-600/40 text-teal-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🔗 Maillage
          </Link>
          <Link href="/authority" className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🛡 Autorité
          </Link>
          <Link href="/compare" className="bg-pink-600/20 hover:bg-pink-600/40 text-pink-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            ⚖ Comparer
          </Link>
          <Link href="/health" className="bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            💊 Santé SEO
          </Link>
          <Link href="/scanner" className="bg-gradient-to-r from-cyan-600/20 to-blue-600/20 hover:from-cyan-600/40 hover:to-blue-600/40 text-cyan-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-cyan-800/50">
            🔮 Scanner
          </Link>
          <Link href="/striking-distance" className="bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            🎯 Striking
          </Link>
          <Link href="/cannibalization-hhi" className="bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            ⚔️ Cannibal HHI
          </Link>
          <Link href="/cross-domain-cannibal" className="bg-pink-600/20 hover:bg-pink-600/40 text-pink-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            🌐 Cross-domain
          </Link>
          <Link href="/ctr-anomaly" className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            📉 CTR anomaly
          </Link>
          <Link href="/content-decay" className="bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            📊 Decay
          </Link>
          <Link href="/aio-detector" className="bg-gradient-to-r from-cyan-600/20 to-purple-600/20 hover:from-cyan-600/40 hover:to-purple-600/40 text-cyan-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-cyan-800/30">
            ✨ AIO
          </Link>
          <Link href="/ai-visibility" className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-blue-800/40">
            🤖 AI Visibility
          </Link>
          <Link href="/ai-prompts" className="bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-yellow-800/40">
            💡 AI Prompts
          </Link>
          <Link href="/keywords-pro" className="bg-green-600/20 hover:bg-green-600/40 text-green-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-green-800/40">
            🎯 Keywords Pro
          </Link>
          <Link href="/content-plan" className="bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-indigo-800/40">
            📅 Content Plan
          </Link>
          <Link href="/logs" className="bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-cyan-800/40">
            📋 Logs
          </Link>
          <Link href="/schema" className="bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-violet-800/40">
            🔣 Schema
          </Link>
          <Link href="/index-bloat" className="bg-orange-600/20 hover:bg-orange-600/40 text-orange-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-orange-800/40">
            🗑 Index Bloat
          </Link>
          <Link href="/pagerank" className="bg-teal-600/20 hover:bg-teal-600/40 text-teal-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-teal-800/40">
            🔗 PageRank
          </Link>
          <Link href="/ga4-audit" className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-blue-800/40">
            📊 Audit GA4
          </Link>
          <Link href="/traffic-by-country" className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold border border-emerald-800/40">
            🌍 Traffic by country
          </Link>
          <button onClick={handleSync} disabled={syncing}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
              syncing
                ? "bg-yellow-600 animate-pulse text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            } disabled:cursor-wait`}>
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? "Sync en cours..." : "Synchroniser"}
          </button>
        </div>
      </header>

      {/* Sync feedback */}
      {syncMsg && (
        <div className={`mx-6 mt-2 px-4 py-2 rounded-lg text-sm flex items-center gap-2 animate-in ${
          syncMsg.type === "ok"
            ? "bg-green-900/40 border border-green-700 text-green-300"
            : "bg-red-900/40 border border-red-700 text-red-300"
        }`}>
          {syncMsg.type === "ok" ? "✅" : "❌"} {syncMsg.text}
        </div>
      )}

      {statsRefreshing && (
        <div className="mx-6 mt-2 px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-cyan-950/30 border border-cyan-800/50 text-cyan-200">
          <Loader2 className="w-4 h-4 animate-spin" />
          Stats SEO en chargement en arriere-plan. La page reste utilisable.
        </div>
      )}

      <section className="px-6 pt-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Pilotage SEO</div>
                <h2 className="text-lg font-semibold mt-1">Positions GSC, volumes KP, gains et alertes</h2>
              </div>
              <Link href="/keyword-planner-import" className="text-xs px-3 py-1.5 rounded border border-blue-500/40 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20">
                Importer volumes
              </Link>
            </div>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
              <div className="rounded border border-green-500/25 bg-green-500/10 p-3">
                <div className="text-xs text-green-200">Sites OK</div>
                <div className="text-2xl font-bold text-green-300 mt-1">{qualitySites.length ? `${qualityOkCount}/${qualitySites.length}` : "-"}</div>
                <div className="text-[11px] text-green-200/70 mt-1">GSC + KP exploitables</div>
              </div>
              <div className="rounded border border-yellow-500/25 bg-yellow-500/10 p-3">
                <div className="text-xs text-yellow-200">A verifier</div>
                <div className="text-2xl font-bold text-yellow-300 mt-1">{qualityStaleCount}</div>
                <div className="text-[11px] text-yellow-200/70 mt-1">GSC stale ou absent</div>
              </div>
              <div className="rounded border border-blue-500/25 bg-blue-500/10 p-3">
                <div className="text-xs text-blue-200">Volumes KP</div>
                <div className="text-2xl font-bold text-blue-300 mt-1">{totalImportedVolumes.toLocaleString()}</div>
                <div className="text-[11px] text-blue-200/70 mt-1">{totalMissingVolumes.toLocaleString()} manquants</div>
              </div>
              <div className="rounded border border-purple-500/25 bg-purple-500/10 p-3">
                <div className="text-xs text-purple-200">Gains / Top 10</div>
                <div className="text-2xl font-bold text-purple-300 mt-1">{totalGainCandidates.toLocaleString()}</div>
                <div className="text-[11px] text-purple-200/70 mt-1">{totalTop10Keywords.toLocaleString()} mots-cles top 10</div>
              </div>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Autocontrole</div>
                <div className="text-sm text-gray-300 mt-1">Source positions: GSC query-level. Source volumes: Keyword Planner importe.</div>
              </div>
              <button
                type="button"
                onClick={() => void fetchQuality()}
                className="p-2 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:text-white"
                title="Rafraichir l'autocontrole"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 space-y-2 text-xs">
              {qualitySites.slice(0, 4).map((site) => (
                <div key={site.id} className="flex items-center justify-between gap-3 rounded bg-gray-950/60 border border-gray-800 px-3 py-2">
                  <span className="font-medium text-gray-200 truncate">{site.name}</span>
                  <span className={`shrink-0 px-2 py-0.5 rounded border ${qualityStatusClass(site.status)}`}>
                    {qualityStatusLabel(site.status)}
                  </span>
                </div>
              ))}
              {qualitySites.length === 0 && <div className="text-gray-500">Autocontrole en chargement.</div>}
            </div>
          </div>
        </div>
      </section>

      {/* KPIs globaux */}
      <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1"><MousePointerClick className="w-3 h-3" /> Clics GSC ({period}j)</div>
          <div className="text-2xl font-bold text-blue-400">{totalClicks.toLocaleString()}</div>
          <div className="text-xs text-gray-400 mt-1">~{Math.round(totalClicks / parseInt(period))}/jour</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Search className="w-3 h-3" /> Impressions ({period}j)</div>
          <div className="text-2xl font-bold text-purple-400">{totalImpressions.toLocaleString()}</div>
          <div className="text-xs text-gray-400 mt-1">~{Math.round(totalImpressions / parseInt(period))}/jour</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Globe className="w-3 h-3" /> Position moy. globale</div>
          <div className="text-2xl font-bold text-green-400">{avgPosition > 0 ? avgPosition.toFixed(1) : "—"}</div>
          <div className="text-xs text-gray-400 mt-1">{activeSites.length} sites avec données</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Activity className="w-3 h-3" /> Vitesse services</div>
          <div className={`text-2xl font-bold ${avgServiceMs && avgServiceMs > 1500 ? "text-yellow-400" : "text-cyan-400"}`}>
            {latestTiming ? formatMs(latestTiming.ms) : formatMs(pageLoadMs ?? 0)}
          </div>
          <div className="text-xs text-gray-400 mt-1 truncate">
            {latestTiming
              ? `${latestTiming.label}${latestTiming.cache ? ` - ${latestTiming.cache}` : ""} - moy. ${formatMs(avgServiceMs)}`
              : `page ${formatMs(pageLoadMs ?? 0)}`}
          </div>
        </div>
      </div>

      {/* Sort bar sites */}
      <div className="px-6 pb-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-400">Classer par :</span>
        {([
          { col: "clicks" as const, label: "Clics" },
          { col: "impressions" as const, label: "Impressions" },
          { col: "position" as const, label: "Position" },
        ]).map(({ col, label }) => {
          const active = siteSortCol === col;
          return (
            <button key={col}
              onClick={() => { if (active) setSiteSortDir(d => d === "desc" ? "asc" : "desc"); else { setSiteSortCol(col); setSiteSortDir(col === "position" ? "asc" : "desc"); } }}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}>
              {label}
              <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                <span className={active && siteSortDir === "asc" ? "text-white" : "opacity-40"}>▲</span>
                <span className={active && siteSortDir === "desc" ? "text-white" : "opacity-40"}>▼</span>
              </span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={toggleAll} disabled={bulkLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 text-gray-400 hover:text-white hover:border-gray-500 transition disabled:opacity-50 disabled:cursor-wait">
            {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : expandedIds.size === sites.length ? <ChevronsDownUp className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3" />}
            {bulkLoading ? "Chargement par lots..." : expandedIds.size === sites.length ? "Tout fermer" : "Tout ouvrir"}
          </button>
        </div>
      </div>

      {/* Sites */}
      <div className="px-6 pb-10 space-y-3">
        {[...sites].sort((a, b) => {
          let va = 0, vb = 0;
          if (siteSortCol === "impressions") { va = Number(a.gsc_impressions_30d); vb = Number(b.gsc_impressions_30d); }
          else if (siteSortCol === "position") { va = Number(a.avg_position_30d) || 999; vb = Number(b.avg_position_30d) || 999; }
          else { va = Number(a.gsc_clicks_30d); vb = Number(b.gsc_clicks_30d); }
          return siteSortDir === "asc" ? va - vb : vb - va;
        }).map((site, i) => {
          const isOpen = expandedIds.has(site.id);
          const tab = activeTab[site.id] || "keywords";
          const quality = qualityById.get(site.id);
          const kwKey = `${site.id}-${period}-${langFilter || "all"}`;
          const QUESTION_WORDS = ["comment","pourquoi","quand","quel","quelle","quels","quelles","qu'est","qu est","how","what","why","when","which","where","who","is","are","does","do","can","best","top"];
          const rawKws = keywords[kwKey] || [];
          const searchedKws = rawKws.filter(k => !search || k.query.toLowerCase().includes(search.toLowerCase()));
          const filteredKws = searchedKws
            .filter(k => {
              const position = Number(k.avg_position) || 0;
              const sourceVolume = resolveSourceVolume(k.volume_market, k.volume_fr, k.volume_ch);
              const hasRealVolume = hasImportedVolumeSource(k.volume_source) && sourceVolume > 1;
              if (kwTypeFilter === "important") return hasRealVolume && position >= 4 && position <= 30;
              if (kwTypeFilter === "highvolume") return hasRealVolume && sourceVolume >= 3000;
              if (kwTypeFilter === "longtail") return k.query.trim().split(/\s+/).length >= 4;
              if (kwTypeFilter === "questions") return QUESTION_WORDS.some(w => k.query.toLowerCase().startsWith(w + " ") || k.query.toLowerCase().includes(" " + w + " "));
              return true;
            });
          const emptyActiveFilter = searchedKws.length > 0 && filteredKws.length === 0 && kwTypeFilter !== "all";
          const kws = filteredKws
            .sort((a, b) => {
              let va = 0, vb = 0;
              if (sortCol === "position") { va = Number(a.avg_position); vb = Number(b.avg_position); }
              else if (sortCol === "impressions") { va = Number(a.total_impressions); vb = Number(b.total_impressions); }
              else if (sortCol === "ctr") { va = Number(a.avg_ctr); vb = Number(b.avg_ctr); }
              else if (sortCol === "volume") {
                va = resolveSourceVolume(a.volume_market, a.volume_fr, a.volume_ch);
                vb = resolveSourceVolume(b.volume_market, b.volume_fr, b.volume_ch);
              }
              else if (sortCol === "priority") {
                va = opportunityScore(resolveSourceVolume(a.volume_market, a.volume_fr, a.volume_ch), Number(a.avg_position) || 0);
                vb = opportunityScore(resolveSourceVolume(b.volume_market, b.volume_fr, b.volume_ch), Number(b.avg_position) || 0);
              }
              else { va = Number(a.total_clicks); vb = Number(b.total_clicks); }
              return sortDir === "asc" ? va - vb : vb - va;
            });
          const gainList = (gains[site.id] || [])
            .filter(g => !search || g.query.toLowerCase().includes(search.toLowerCase()))
            .sort((a, b) => {
              let va = 0, vb = 0;
              const sourceVol = (g: GainData) => resolveSourceVolume(g.volume_market, g.volume_fr, g.volume_ch);
              const oppEst = (g: GainData) => opportunityScore(sourceVol(g), Number(g.position_now) || 0);
              if (gainSortCol === "position_now") { va = Number(a.position_now); vb = Number(b.position_now); }
              else if (gainSortCol === "clicks_gain") { va = Number(a.clicks_gain); vb = Number(b.clicks_gain); }
              else if (gainSortCol === "volume") { va = sourceVol(a); vb = sourceVol(b); }
              else if (gainSortCol === "opportunity") { va = oppEst(a); vb = oppEst(b); }
              else { va = Number(a.gain); vb = Number(b.gain); }
              return gainSortDir === "asc" ? va - vb : vb - va;
            });
          const top10 = rawKws.filter(k => Number(k.avg_position) > 0 && Number(k.avg_position) <= 10).length;
          const keywordSourceVolumeCount = rawKws.filter(k =>
            hasImportedVolumeSource(k.volume_source) && resolveSourceVolume(k.volume_market, k.volume_fr, k.volume_ch) > 1
          ).length;
          const keywordImportedZeroVolumeCount = rawKws.filter(k =>
            resolveSourceVolume(k.volume_market, k.volume_fr, k.volume_ch) <= 1 && hasImportedVolumeSource(k.volume_source)
          ).length;
          const gainsSourceVolumeCount = gainList.filter(g =>
            hasImportedVolumeSource(g.volume_source) && resolveSourceVolume(g.volume_market, g.volume_fr, g.volume_ch) > 1
          ).length;
          const sourceVolumeCount = tab === "gains" ? gainsSourceVolumeCount : keywordSourceVolumeCount;
          const missingVolumeKeywords = rawKws.filter(k =>
            resolveSourceVolume(k.volume_market, k.volume_fr, k.volume_ch) <= 1 && !hasImportedVolumeSource(k.volume_source)
          );
          const missingVolumeCount = missingVolumeKeywords.length;
          const highVolumeKeywords = rawKws
            .map((kw) => ({
              query: kw.query,
              volume: resolveSourceVolume(kw.volume_market, kw.volume_fr, kw.volume_ch),
              hasRealVolume: hasImportedVolumeSource(kw.volume_source),
              position: Number(kw.avg_position) || 0,
              clicks: Number(kw.total_clicks) || 0,
            }))
            .filter((kw) => kw.hasRealVolume && kw.volume >= 3000)
            .sort((a, b) => b.volume - a.volume);
          const displayedMetricCount = tab === "gains" ? gainList.length : kws.length;

          return (
            <div key={site.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              {/* Site header */}
              <div onClick={() => toggleSite(site.id)}
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/50 transition">
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="font-semibold">{site.name}</span>
                  <a href={site.url} target="_blank" rel="noopener noreferrer"
                    className="hidden md:block text-xs text-gray-400 hover:text-blue-400"
                    onClick={(e) => e.stopPropagation()}>
                    {site.url}
                  </a>
                  {top10 > 0 && isOpen && (
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">{top10} top10</span>
                  )}
                  {quality && (
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${qualityStatusClass(quality.status)}`}>
                      {qualityStatusLabel(quality.status)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-6 text-sm">
                  {quality && (
                    <div className="hidden lg:block text-right">
                      <div className="text-cyan-300 font-bold">{quality.kp_volumes_imported}</div>
                      <div className="text-xs text-gray-400">volumes reels</div>
                    </div>
                  )}
                  {quality && quality.kp_volumes_missing > 0 && (
                    <div className="hidden xl:block text-right">
                      <div className="text-yellow-300 font-bold">{quality.kp_volumes_missing}</div>
                      <div className="text-xs text-gray-400">sans volume</div>
                    </div>
                  )}
                  {highVolumeKeywords.length > 0 && (
                    <div className="hidden xl:block text-right">
                      <div className="text-orange-300 font-bold">{highVolumeKeywords.length}</div>
                      <div className="text-xs text-gray-400">3000+/mois</div>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-blue-400 font-bold">{(Number(site.gsc_clicks_30d)||0).toLocaleString()}</div>
                    <div className="text-xs text-gray-400">clics/{period}j</div>
                  </div>
                  <div className="text-right">
                    <div className="text-purple-400 font-bold">{(Number(site.gsc_impressions_30d)||0).toLocaleString()}</div>
                    <div className="text-xs text-gray-400">impressions</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${Number(site.avg_position_30d) > 0 && Number(site.avg_position_30d) <= 10 ? "text-green-400" : Number(site.avg_position_30d) <= 20 ? "text-yellow-400" : "text-gray-400"}`}>
                      {Number(site.avg_position_30d) > 0 ? Number(site.avg_position_30d).toFixed(1) : "—"}
                    </div>
                    <div className="text-xs text-gray-400">position moy.</div>
                  </div>
                </div>
              </div>

              {/* Content */}
              {isOpen && (
                <div className="border-t border-gray-800">
                  {/* Tabs */}
                  <div className="flex gap-1 px-4 pt-3 pb-0">
                    <button onClick={() => switchTab(site.id, "keywords")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition ${tab === "keywords" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      Mots clés ({period}j)
                    </button>
                    <button onClick={() => switchTab(site.id, "gains")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "gains" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      <TrendingUp className="w-3 h-3" /> Gains / semaine
                    </button>
                    <button onClick={() => switchTab(site.id, "analytics")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "analytics" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      <BarChart3 className="w-3 h-3" /> Analytics GA4
                    </button>
                    <button onClick={() => switchTab(site.id, "device")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "device" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      <Smartphone className="w-3 h-3" /> Devices
                    </button>
                  </div>

                  {tab === "keywords" && (
                    <div className="flex items-center flex-wrap gap-1 px-4 py-2">
                      {(["all","important","highvolume","longtail","questions"] as const).map(f => (
                        <button key={f} type="button" onClick={() => setKwTypeFilter(f)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${kwTypeFilter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                          {f === "important" ? "Important" : f === "highvolume" ? "Fort volume 3000+" : f === "all" ? "Tous" : f === "longtail" ? "Long tail (4+ mots)" : "Questions"}
                        </button>
                      ))}
                      {emptyActiveFilter && (
                        <span className="ml-2 text-[11px] text-yellow-300">
                          Filtre actif sans resultat. Clique Tous pour revoir tous les mots-cles charges.
                        </span>
                      )}
                    </div>
                  )}

                  {(tab === "keywords" || tab === "gains") && (
                    <div className="px-4 py-2 border-t border-gray-800 bg-gray-950/40">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="px-2 py-1 rounded border border-green-500/25 bg-green-500/10 text-green-300">
                          {sourceVolumeCount} volume(s) source
                        </span>
                        {tab === "keywords" && keywordImportedZeroVolumeCount > 0 && (
                          <span className="px-2 py-1 rounded border border-slate-600/40 bg-slate-700/30 text-slate-300">
                            {keywordImportedZeroVolumeCount} KP sans volume
                          </span>
                        )}
                        {tab === "keywords" && missingVolumeCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-yellow-500/25 bg-yellow-500/10 text-yellow-200">
                            {missingVolumeCount} volume(s) a importer
                            <CopyKeywordsButton
                              keywords={missingVolumeKeywords.slice(0, 200).map((kw) => kw.query)}
                              label="Copier les mots-cles sans volume"
                              className="h-5 w-5 border-yellow-500/40 bg-yellow-500/10 text-yellow-200 hover:border-yellow-400 hover:bg-yellow-500/20"
                            />
                          </span>
                        )}
                        {tab === "keywords" && highVolumeKeywords.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-orange-500/30 bg-orange-500/10 text-orange-200">
                            {highVolumeKeywords.length} fort volume 3000+/mois
                            <CopyKeywordsButton
                              keywords={highVolumeKeywords.slice(0, KEYWORD_RENDER_LIMIT).map((kw) => kw.query)}
                              label="Copier les mots-cles fort volume"
                              className="h-5 w-5 border-orange-500/40 bg-orange-500/10 text-orange-200 hover:border-orange-400 hover:bg-orange-500/20"
                            />
                          </span>
                        )}
                        <span className="text-gray-400">
                          {displayedMetricCount} ligne(s) affichee(s): positions/clics/impressions GSC quand disponibles, volumes importes uniquement.
                        </span>
                        <Link href="/keyword-planner-import" className="text-blue-300 hover:text-blue-200 underline underline-offset-2">
                          Importer FR/CH
                        </Link>
                      </div>
                    </div>
                  )}
                  {/* High Vol Discovery Panel */}
                  {highVolPanel === site.id && (
                    <div className="border-t border-yellow-500/20 bg-gray-900">
                      {/* Header + actions */}
                      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-800">
                        <span className="text-xs font-semibold text-yellow-300 flex-1 min-w-0">
                          ⚡ {highVolKws.length} mots-clés du secteur (GSC réel 90j)
                        </span>
                        <button type="button"
                          onClick={() => void addSelectedHighVol(site.id)}
                          disabled={highVolSelected.size === 0 || highVolLoading.has(site.id)}
                          className="text-xs px-3 py-1 rounded bg-yellow-500/40 border border-yellow-500/60 text-yellow-100 font-semibold hover:bg-yellow-500/60 disabled:opacity-40">
                          {highVolLoading.has(site.id) ? <Loader2 className="w-3 h-3 animate-spin inline" /> : null}
                          {` Ajouter (${highVolSelected.size})`}
                        </button>
                        <button type="button"
                          onClick={async () => {
                            const all = new Set(highVolKws.map(k => k.keyword));
                            setHighVolSelected(all);
                            // Direct add without waiting for state update
                            if (highVolKws.length === 0 || highVolLoading.has(site.id)) return;
                            setHighVolLoading(prev => new Set(prev).add(site.id));
                            try {
                              const res = await timedFetch("Tout ajouter high volume", `/api/keywords/high-volume?site_id=${site.id}`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ keywords: highVolKws.map(k => ({ keyword: k.keyword, source: k.source })) }),
                              });
                              const d = await res.json() as { success: boolean; added: number };
                              if (d.success) {
                                setHighVolResult(prev => ({ ...prev, [site.id]: { added: d.added, total: highVolKws.length } }));
                                setHighVolPanel(null);
                                await loadKeywords(site.id, period);
                              }
                            } catch { /* ignore */ }
                            setHighVolLoading(prev => { const n = new Set(prev); n.delete(site.id); return n; });
                          }}
                          className="text-[10px] px-2 py-1 rounded bg-yellow-600/40 text-yellow-100 font-semibold hover:bg-yellow-600/60 border border-yellow-500/50 transition"
                          title="Ajouter tous les 40 keywords en un clic">
                          ⚡ Tout ajouter
                        </button>
                        <button type="button" onClick={() => setHighVolSelected(new Set(highVolKws.map(k => k.keyword)))}
                          className="text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">Tout</button>
                        <button type="button" onClick={() => setHighVolSelected(new Set())}
                          className="text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">Aucun</button>
                        <button type="button" onClick={() => setHighVolKws(prev => [...prev].sort((a,b) => a.avg_position - b.avg_position))}
                          title="Trier par position (meilleures d'abord)"
                          className="text-[10px] px-2 py-1 rounded bg-gray-700 text-green-300 hover:bg-gray-600">Pos. ↑</button>
                        <button type="button" onClick={() => setHighVolKws(prev => [...prev].sort((a,b) => b.impressions - a.impressions))}
                          title="Trier par impressions (les plus vus)"
                          className="text-[10px] px-2 py-1 rounded bg-gray-700 text-blue-300 hover:bg-gray-600">Imp. ↓</button>
                        <button type="button" onClick={() => setHighVolPanel(null)}
                          className="text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-400 hover:bg-gray-600">✕</button>
                      </div>
                      {/* Keyword list — flex rows to avoid table overflow conflicts */}
                      {highVolPanelLoading ? (
                        <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-yellow-400" /></div>
                      ) : highVolKws.length === 0 ? (
                        <p className="text-xs text-gray-400 px-4 py-3">Aucun nouveau mot-clé — tous déjà trackés ou trop peu d&apos;impressions.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <div style={{minWidth: "520px"}}>
                            {/* Column headers */}
                            <div className="flex items-center px-3 py-1.5 bg-gray-950 border-b border-gray-800 sticky top-0 z-10 text-[10px] text-gray-400 select-none">
                              <span className="w-5 shrink-0"></span>
                              <span className="flex-1 min-w-[160px]">Mot-clé du secteur</span>
                              {(["impressions","avg_position","clicks"] as HVSort[]).map((col, i) => (
                                <button key={col} type="button" onClick={() => hvSort(col)}
                                  className={`w-20 text-right flex items-center justify-end gap-0.5 shrink-0 hover:text-white transition ${hvSortCol === col ? "text-yellow-300" : ""}`}>
                                  {["Imp. 90j","Pos.","Clics 90j"][i]}
                                  <span className="flex flex-col leading-none text-[7px] ml-0.5">
                                    <span className={hvSortCol === col && hvSortDir === "asc" ? "text-yellow-400" : "opacity-30"}>▲</span>
                                    <span className={hvSortCol === col && hvSortDir === "desc" ? "text-yellow-400" : "opacity-30"}>▼</span>
                                  </span>
                                </button>
                              ))}
                            </div>
                            {/* Rows */}
                            <div className="max-h-72 overflow-y-auto">
                              {highVolKws.map((kw) => (
                                <div key={kw.keyword}
                                  className={`flex items-center px-3 py-2 border-b border-gray-800/30 cursor-pointer transition ${highVolSelected.has(kw.keyword) ? "bg-yellow-500/12 hover:bg-yellow-500/20" : "hover:bg-yellow-500/5"}`}
                                  onClick={() => setHighVolSelected(prev => {
                                    const n = new Set(prev);
                                    if (n.has(kw.keyword)) {
                                      n.delete(kw.keyword);
                                    } else {
                                      n.add(kw.keyword);
                                    }
                                    return n;
                                  })}>
                                  <span className="w-5 shrink-0 flex items-center">
                                    <input type="checkbox" readOnly checked={highVolSelected.has(kw.keyword)}
                                      title={`Sélectionner ${kw.keyword}`}
                                      aria-label={`Sélectionner ${kw.keyword}`}
                                      className="accent-yellow-400 w-3 h-3" />
                                  </span>
                                  <span className="flex-1 min-w-[160px] text-xs text-white font-medium truncate pr-2">{kw.keyword}</span>
                                  <span className="w-20 text-right text-xs text-blue-400 shrink-0">{kw.impressions.toLocaleString()}</span>
                                  <span className={`w-20 text-right text-xs shrink-0 ${kw.avg_position <= 10 ? "text-green-400" : kw.avg_position <= 20 ? "text-yellow-400" : "text-red-400"}`}>
                                    {kw.avg_position > 0 ? kw.avg_position.toFixed(1) : "—"}
                                  </span>
                                  <span className="w-20 text-right text-xs text-gray-400 shrink-0">{kw.clicks > 0 ? kw.clicks.toLocaleString() : "0"}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "keywords" && highVolumeKeywords.length > 0 && (
                    <div className="px-4 py-3 border-t border-gray-800 bg-orange-950/10">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-orange-300">Mots-cles fort volume niche</div>
                          <div className="text-[11px] text-gray-400">Volume reel importe, seuil 3000 recherches/mois</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setKwTypeFilter("highvolume")}
                          className="text-xs px-3 py-1.5 rounded border border-orange-500/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/20"
                        >
                          Voir 3000+
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
                        {highVolumeKeywords.slice(0, 5).map((kw) => (
                          <div key={kw.query} className="rounded border border-gray-800 bg-gray-950/60 px-3 py-2">
                            <div className="text-sm font-semibold text-white truncate" title={kw.query}>{kw.query}</div>
                            <div className="mt-1 flex items-center justify-between text-[11px]">
                              <span className="text-orange-300 font-bold">{kw.volume.toLocaleString()}/mois</span>
                              <span className={kw.position > 0 && kw.position <= 10 ? "text-green-300" : kw.position <= 30 ? "text-yellow-300" : "text-gray-500"}>
                                pos. {kw.position > 0 ? kw.position.toFixed(1) : "-"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {kwLoadingIds.has(site.id) ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                  ) : tab === "keywords" ? (
                    kws.length === 0 ? (
                      <div className="py-6 text-center text-gray-400 text-sm">
                        {rawKws.length === 0
                          ? `Aucune requete GSC pour ce site${langFilter ? " avec ce pays/langue" : ""}.`
                          : kwTypeFilter === "highvolume"
                            ? "Aucun mot-cle avec volume reel importe >= 3000/mois pour ce site."
                            : "Aucun mot-cle ne correspond au filtre actif."}
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs bg-gray-800/50">
                            <th className="text-left py-2 px-5">#</th>
                            <th className="text-left py-2 px-3">
                              <span className="inline-flex items-center gap-2">
                                Mot clé
                                <CopyKeywordsButton keywords={kws.slice(0, KEYWORD_RENDER_LIMIT).map((kw) => kw.query)} />
                              </span>
                            </th>
                            {(["priority","clicks","impressions","ctr","position"] as const).map(col => {
                              const labels = { priority: "Priorite", clicks: "Clics", impressions: "Impressions", ctr: "CTR", position: "Position" };
                              const active = sortCol === col;
                              return (
                                <th key={col} className="text-right py-2 px-3 cursor-pointer select-none"
                                  onClick={() => { if (active) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir(col === "position" ? "asc" : "desc"); } }}>
                                  <span className={`inline-flex items-center justify-end gap-1 ${active ? "text-white" : "hover:text-gray-300"}`}>
                                    {labels[col]}
                                    <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                                      <span className={active && sortDir === "asc" ? "text-blue-400" : "opacity-30"}>▲</span>
                                      <span className={active && sortDir === "desc" ? "text-blue-400" : "opacity-30"}>▼</span>
                                    </span>
                                  </span>
                                </th>
                              );
                            })}
                            {(() => {
                              const col = "volume" as const;
                              const active = sortCol === col;
                              return (
                                <th className="text-right py-2 px-3 cursor-pointer select-none"
                                  onClick={() => { if (active) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir("desc"); } }}>
                                  <span className={`inline-flex items-center justify-end gap-1 ${active ? "text-white" : "hover:text-gray-300"}`}>
                                    Volume source
                                    <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                                      <span className={active && sortDir === "asc" ? "text-blue-400" : "opacity-30"}>▲</span>
                                      <span className={active && sortDir === "desc" ? "text-blue-400" : "opacity-30"}>▼</span>
                                    </span>
                                  </span>
                                </th>
                              );
                            })()}
                            <th className="text-left py-2 px-5">Solution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kws.slice(0, KEYWORD_RENDER_LIMIT).map((kw, j) => (
                            <tr key={j} className={`border-b border-gray-800/40 hover:bg-gray-800/20 cursor-pointer ${activeKw?.query === kw.query && activeKw?.siteId === site.id ? "bg-blue-900/10" : ""}`}
                              onClick={() => openKwHistory(site.id, kw.query)}>
                              <td className="py-2 px-5 text-gray-600 text-xs">{j + 1}</td>
                              <td className="py-2 px-3 font-medium text-gray-200">
                                <div className="flex items-center gap-1.5">
                                  <a
                                    href={`https://www.google.com/search?q=${encodeURIComponent(kw.query)}&hl=fr&gl=fr&pws=0`}
                                    target="_blank" rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Vérifier le SERP Google pour ce mot-clé"
                                    className="hover:text-blue-400 hover:underline transition"
                                  >
                                    {kw.query}
                                  </a>
                                  {kw.first_seen && (Date.now() - new Date(kw.first_seen).getTime()) < 14 * 24 * 60 * 60 * 1000 && (
                                    <span className="text-[9px] bg-green-500/20 text-green-400 px-1 py-0.5 rounded font-bold shrink-0">NEW</span>
                                  )}
                                  <a
                                    href={`https://www.google.com/search?q=${encodeURIComponent(`site:${(() => { try { return new URL(site.url).hostname.replace(/^www\./, ""); } catch { return site.url; } })()} ${kw.query}`)}&hl=fr`}
                                    target="_blank" rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title={`Trouver quelle page de ${site.name} ranke pour ce mot-clé (site:)`}
                                    className="text-gray-500 hover:text-blue-400 transition shrink-0"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                  <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${activeKw?.query === kw.query && activeKw?.siteId === site.id ? "rotate-180" : ""}`} />
                                </div>
                              </td>
                              <td className="text-right py-2 px-3">
                                {(() => {
                                  const score = opportunityScore(
                                    resolveSourceVolume(kw.volume_market, kw.volume_fr, kw.volume_ch),
                                    Number(kw.avg_position) || 0
                                  );
                                  const { label, color } = oppLabel(score);
                                  return <span className={`text-xs ${color}`}>{score > 0 ? label : "-"}</span>;
                                })()}
                              </td>
                              <td className="text-right py-2 px-3 text-blue-400 font-semibold">{Number(kw.total_clicks)}</td>
                              <td className="text-right py-2 px-3 text-gray-400">{Number(kw.total_impressions).toLocaleString()}</td>
                              <td className="text-right py-2 px-3 text-gray-400">{(Number(kw.avg_ctr) * 100).toFixed(1)}%</td>
                              <td className="text-right py-2 px-3">
                                <div className="inline-flex flex-col items-end gap-0.5">
                                  <span className={`font-semibold ${!kw.avg_position || Number(kw.avg_position) === 0 ? "text-gray-600" : Number(kw.avg_position) <= 10 ? "text-green-400" : Number(kw.avg_position) <= 20 ? "text-yellow-400" : "text-red-400"}`}>
                                    {(!kw.avg_position || Number(kw.avg_position) === 0) ? "—" : Number(kw.avg_position).toFixed(1)}
                                  </span>
                                  {(() => {
                                    const g = gainList.find(x => x.query === kw.query);
                                    if (!g) return <span className="text-xs text-gray-600">vs sem. ?</span>;
                                    const gain = Number(g.gain);
                                    if (gain > 0) return <span className="text-xs text-green-400 flex items-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" />+{gain} vs sem.</span>;
                                    if (gain < 0) return <span className="text-xs text-red-400 flex items-center gap-0.5"><TrendingDown className="w-2.5 h-2.5" />{gain} vs sem.</span>;
                                    return <span className="text-xs text-gray-400">= vs sem.</span>;
                                  })()}
                                </div>
                              </td>
                              <td className="text-right py-2 px-3">
                                {(() => {
                                  const signal = resolveVolumeSignal(kw.volume_market, kw.volume_fr, kw.total_impressions, Number(period), kw.volume_ch, kw.volume_source);
                                  const { label, color, title } = volumeSignalLabel(signal);
                                  const badge = volumeSignalBadge(signal);
                                  return (
                                    <div className="inline-flex flex-col items-end gap-0.5" title={title}>
                                      <span className={`text-xs font-medium ${color}`}>{label}</span>
                                      <span className={`text-[9px] leading-none px-1.5 py-0.5 rounded border ${badge.className}`}>{badge.label}</span>
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="py-2 px-5 text-xs text-gray-400">{keywordSolution(kw)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : (
                    gainList.length === 0 ? (
                      <div className="py-6 text-center text-gray-400 text-sm">
                        Aucune variation hebdo comparable dans la derniere fenetre GSC importee.
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs bg-gray-800/50">
                            <th className="text-left py-2 px-5">
                              <span className="inline-flex items-center gap-2">
                                Mot clé
                                <CopyKeywordsButton keywords={gainList.map((kw) => kw.query)} />
                              </span>
                            </th>
                            <th className="text-right py-2 px-2 cursor-pointer select-none"
                              onClick={() => { if (gainSortCol === "position_now") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("position_now"); setGainSortDir("asc"); } }}>
                              <div className={`inline-flex flex-col items-end ${gainSortCol === "position_now" ? "text-white" : "hover:text-gray-300"}`}>
                                <span>Cette sem. {gainSortCol === "position_now" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}</span>
                                <span className="text-[9px] text-gray-600">{gainLabels?.w0 || ""}</span>
                              </div>
                            </th>
                            <th className="text-right py-2 px-2 cursor-pointer select-none"
                              onClick={() => { if (gainSortCol === "gain") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("gain"); setGainSortDir("desc"); } }}>
                              <div className={`inline-flex flex-col items-end ${gainSortCol === "gain" ? "text-white" : "hover:text-gray-300"}`}>
                                <span>S-1 {gainSortCol === "gain" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}</span>
                                <span className="text-[9px] text-gray-600">{gainLabels?.w1 || ""}</span>
                              </div>
                            </th>
                            <th className="text-right py-2 px-2">
                              <div className="inline-flex flex-col items-end text-gray-400">
                                <span>S-2</span>
                                <span className="text-[9px] text-gray-600">{gainLabels?.w2 || ""}</span>
                              </div>
                            </th>
                            <th className="text-right py-2 px-2">
                              <div className="inline-flex flex-col items-end text-gray-400">
                                <span>S-3</span>
                                <span className="text-[9px] text-gray-600">{gainLabels?.w3 || ""}</span>
                              </div>
                            </th>
                            <th className="text-right py-2 px-2">
                              <div className="inline-flex flex-col items-end text-gray-400">
                                <span>S-4</span>
                                <span className="text-[9px] text-gray-600">{gainLabels?.w4 || ""}</span>
                              </div>
                            </th>
                            <th className="text-right py-2 px-3 cursor-pointer select-none"
                              onClick={() => { if (gainSortCol === "clicks_gain") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("clicks_gain"); setGainSortDir("desc"); } }}>
                              <span className={gainSortCol === "clicks_gain" ? "text-white" : "hover:text-gray-300"}>Clics +/- {gainSortCol === "clicks_gain" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}</span>
                            </th>
                            <th className="text-right py-2 px-3 cursor-pointer select-none"
                              title="Tri sur volume source uniquement. Le signal GSC reste informatif."
                              onClick={() => { if (gainSortCol === "volume") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("volume"); setGainSortDir("desc"); } }}>
                              <span className={gainSortCol === "volume" ? "text-white" : "text-gray-400 hover:text-gray-300"}>
                                Volume source {gainSortCol === "volume" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}
                              </span>
                            </th>
                            <th className="text-right py-2 px-3 cursor-pointer select-none"
                              title="Score = clics gagnables si tu passes top 3. Tri = quick wins prioritaires."
                              onClick={() => { if (gainSortCol === "opportunity") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("opportunity"); setGainSortDir("desc"); } }}>
                              <span className={gainSortCol === "opportunity" ? "text-white" : "text-gray-400 hover:text-gray-300"}>
                                Opportunité {gainSortCol === "opportunity" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}
                              </span>
                            </th>
                            <th className="text-left py-2 px-3" title="Action recommandée + IA agent disponible">
                              <span className="text-gray-400">Action</span>
                            </th>
                            <th className="text-right py-2 px-3">Tendance 5 sem.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gainList.slice(0, 100).map((g, j) => {
                            const fmtPos = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number(v).toFixed(1));
                            const colorPos = (v: number | null | undefined) => v == null ? "text-gray-600" : Number(v) <= 10 ? "text-green-400" : Number(v) <= 20 ? "text-yellow-400" : "text-gray-300";
                            const renderCell = (now: number | null | undefined, prev: number | null | undefined) => {
                              if (now == null) return <span className="text-gray-600">—</span>;
                              const delta = prev == null ? null : Number(prev) - Number(now);
                              return (
                                <div className="inline-flex flex-col items-end gap-0.5">
                                  <span className={`font-semibold ${colorPos(now)}`}>{fmtPos(now)}</span>
                                  {delta !== null && (
                                    delta > 0.1 ? <span className="text-[10px] text-green-400">↑+{delta.toFixed(1)}</span> :
                                    delta < -0.1 ? <span className="text-[10px] text-red-400">↓{delta.toFixed(1)}</span> :
                                    <span className="text-[10px] text-gray-600">=</span>
                                  )}
                                </div>
                              );
                            };
                            const series: Array<number | null> = [
                              g.position_w4 == null ? null : Number(g.position_w4),
                              g.position_w3 == null ? null : Number(g.position_w3),
                              g.position_w2 == null ? null : Number(g.position_w2),
                              g.position_prev == null ? null : Number(g.position_prev),
                              g.position_now == null ? null : Number(g.position_now),
                            ];
                            const valid = series.filter((v): v is number => v != null);
                            const minV = valid.length ? Math.min(...valid) : 0;
                            const maxV = valid.length ? Math.max(...valid) : 1;
                            const range = Math.max(0.1, maxV - minV);
                            return (
                              <tr key={j} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                                <td className="py-2 px-5 font-medium text-gray-200">
                                  {g.query}
                                  {g.first_seen && (Date.now() - new Date(g.first_seen).getTime()) < 14 * 24 * 60 * 60 * 1000 && (
                                    <span className="ml-2 text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold align-middle">NEW</span>
                                  )}
                                </td>
                                <td className="text-right py-2 px-2">{renderCell(g.position_now, g.position_prev)}</td>
                                <td className="text-right py-2 px-2">{renderCell(g.position_prev, g.position_w2)}</td>
                                <td className="text-right py-2 px-2">{renderCell(g.position_w2, g.position_w3)}</td>
                                <td className="text-right py-2 px-2">{renderCell(g.position_w3, g.position_w4)}</td>
                                <td className="text-right py-2 px-2">{renderCell(g.position_w4, null)}</td>
                                <td className="text-right py-2 px-3">
                                  <span className={Number(g.clicks_gain) > 0 ? "text-green-400" : Number(g.clicks_gain) < 0 ? "text-red-400" : "text-gray-400"}>
                                    {Number(g.clicks_gain) > 0 ? "+" : ""}{Number(g.clicks_gain)}
                                  </span>
                                </td>
                                <td className="text-right py-2 px-3">
                                  {(() => {
                                    const signal = resolveVolumeSignal(g.volume_market, g.volume_fr, g.impressions_now, 7, g.volume_ch, g.volume_source);
                                    const { label, color, title } = volumeSignalLabel(signal);
                                    const badge = volumeSignalBadge(signal);
                                    return (
                                      <div className="inline-flex flex-col items-end gap-0.5" title={title}>
                                        <span className={`text-xs font-semibold ${color}`}>{label}</span>
                                        <span className={`text-[9px] leading-none px-1.5 py-0.5 rounded border ${badge.className}`}>{badge.label}</span>
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td className="text-right py-2 px-3">
                                  {(() => {
                                    const pos = Number(g.position_now) || 0;
                                    if (pos <= 0) return <span className="text-gray-600 text-xs">—</span>;
                                    const monthlyVol = resolveSourceVolume(g.volume_market, g.volume_fr, g.volume_ch);
                                    if (monthlyVol <= 1) {
                                      return <span className="text-gray-600 text-xs" title="Importe un volume source pour calculer l'opportunite">—</span>;
                                    }
                                    const score = opportunityScore(monthlyVol, pos);
                                    const { label, color } = oppLabel(score);
                                    return <span className={`text-xs ${color}`} title={`Si tu passes top 3, tu gagnes ~${score} clics/mois`}>{label}</span>;
                                  })()}
                                </td>
                                <td className="py-2 px-3">
                                  {(() => {
                                    const pos = Number(g.position_now) || 0;
                                    const monthlyVol = pos > 0 ? resolveSourceVolume(g.volume_market, g.volume_fr, g.volume_ch) : 0;
                                    const action = recommendedAction(pos, monthlyVol);
                                    const btnColor = action.type === "push" ? "bg-orange-500/20 text-orange-300 border-orange-500/40 hover:bg-orange-500/30" :
                                                     action.type === "optimize" ? "bg-blue-500/20 text-blue-300 border-blue-500/40 hover:bg-blue-500/30" :
                                                     action.type === "create" ? "bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30" :
                                                     "bg-gray-700/30 text-gray-400 border-gray-600/40";
                                    return (
                                      <div className="flex flex-col gap-1">
                                        <span className="text-[11px] text-gray-300">{action.label}</span>
                                        {action.cta !== "-" && (
                                          <button
                                            type="button"
                                            onClick={() => askAiAgent(site.id, g.query, pos, monthlyVol, action.type)}
                                            className={`text-[10px] px-2 py-0.5 rounded border ${btnColor} transition w-fit`}
                                            title="Demander à l'IA un plan d'action détaillé"
                                          >
                                            IA : {action.cta}
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td className="text-right py-2 px-3">
                                  <svg width="80" height="22" className="inline-block">
                                    {series.map((v, k) => {
                                      if (v == null) return null;
                                      const x = (k / 4) * 76 + 2;
                                      const y = 20 - ((maxV - v) / range) * 18;
                                      const next = series[k + 1];
                                      if (next == null) return <circle key={k} cx={x} cy={y} r="2" fill="#3b82f6" />;
                                      const x2 = ((k + 1) / 4) * 76 + 2;
                                      const y2 = 20 - ((maxV - next) / range) * 18;
                                      const stroke = next < v ? "#10b981" : next > v ? "#ef4444" : "#6b7280";
                                      return (
                                        <g key={k}>
                                          <line x1={x} y1={y} x2={x2} y2={y2} stroke={stroke} strokeWidth="1.5" />
                                          <circle cx={x} cy={y} r="1.8" fill="#3b82f6" />
                                        </g>
                                      );
                                    })}
                                  </svg>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )
                  )}
                  {tab === "analytics" && (() => {
                    const aData = analytics[site.id] || [];
                    if (kwLoadingIds.has(site.id)) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;
                    if (aData.length === 0) return (
                      <div className="py-8 text-center space-y-2">
                        <p className="text-gray-400 text-sm">Pas de données GA4 pour ce site</p>
                        <p className="text-gray-600 text-xs">Ajoute <span className="text-blue-400 font-mono">seo-dashboard@businessdeveloperia.iam.gserviceaccount.com</span> dans GA4 → Admin → Gestion des accès à la propriété</p>
                        <p className="text-gray-600 text-xs">Puis renseigne le Property ID numérique (ex: 123456789) dans la DB pour ce site</p>
                      </div>
                    );
                    const totalSessions = aData.reduce((s, d) => s + Number(d.sessions), 0);
                    const totalUsers = aData.reduce((s, d) => s + Number(d.users), 0);
                    const totalPageviews = aData.reduce((s, d) => s + Number(d.pageviews), 0);
                    const totalOrganic = aData.reduce((s, d) => s + Number(d.organic_sessions), 0);
                    return (
                      <div className="px-5 py-4 space-y-4">
                        {/* KPIs */}
                        <div className="grid grid-cols-4 gap-3">
                          {[
                            { label: "Sessions", value: totalSessions.toLocaleString(), color: "text-blue-400" },
                            { label: "Utilisateurs", value: totalUsers.toLocaleString(), color: "text-purple-400" },
                            { label: "Pages vues", value: totalPageviews.toLocaleString(), color: "text-green-400" },
                            { label: "Trafic organique", value: `${totalSessions > 0 ? Math.round(totalOrganic/totalSessions*100) : 0}%`, color: "text-yellow-400" },
                          ].map(k => (
                            <div key={k.label} className="bg-gray-800/60 rounded-lg p-3">
                              <div className={`text-lg font-bold ${k.color}`}>{k.value}</div>
                              <div className="text-xs text-gray-400">{k.label}</div>
                            </div>
                          ))}
                        </div>
                        {/* Sessions chart */}
                        <div>
                          <div className="text-xs text-gray-400 mb-2">Sessions par jour</div>
                          <ResponsiveContainer width="100%" height={160}>
                            <LineChart data={aData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
                              <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                                labelStyle={{ color: "#9ca3af", fontSize: 11 }}
                                formatter={(v: unknown) => [(v as number).toLocaleString()]} />
                              <Line type="monotone" dataKey="sessions" stroke="#3b82f6" strokeWidth={2} dot={false} name="sessions" />
                              <Line type="monotone" dataKey="organic_sessions" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="organic_sessions" />
                            </LineChart>
                          </ResponsiveContainer>
                          <div className="flex gap-4 text-xs text-gray-400 mt-1">
                            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> Sessions totales</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-400 inline-block border-dashed border-b" /> Organique</span>
                          </div>
                        </div>
                        {/* Sources */}
                        <div>
                          <div className="text-xs text-gray-400 mb-2">Sources de trafic ({period}j)</div>
                          <div className="flex gap-3 flex-wrap">
                            {[
                              { label: "Organique", val: totalOrganic, color: "bg-green-500" },
                              { label: "Direct", val: aData.reduce((s,d)=>s+Number(d.direct_sessions),0), color: "bg-blue-500" },
                              { label: "Référents", val: aData.reduce((s,d)=>s+Number(d.referral_sessions),0), color: "bg-purple-500" },
                              { label: "Social", val: aData.reduce((s,d)=>s+Number(d.social_sessions),0), color: "bg-pink-500" },
                            ].map(src => (
                              <div key={src.label} className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
                                <div className={`w-2 h-2 rounded-full ${src.color}`} />
                                <span className="text-xs text-gray-400">{src.label}</span>
                                <span className="text-xs font-bold text-white">{src.val.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {tab === "device" && (() => {
                    const devRows = deviceData[site.id] || [];
                    const totalClicks = devRows.reduce((s, r) => s + r.clicks, 0);
                    return devRows.length === 0 ? (
                      <div className="py-6 text-center text-gray-400 text-sm">Aucune donnée device disponible</div>
                    ) : (
                      <div className="px-5 py-4 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          {devRows.map(r => (
                            <div key={r.device} className="bg-gray-800/60 rounded-xl p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <Smartphone className="w-4 h-4 text-gray-400" />
                                <span className="text-sm font-semibold capitalize">{r.device.toLowerCase()}</span>
                                <span className="ml-auto text-xs text-gray-400">{totalClicks > 0 ? Math.round(r.clicks / totalClicks * 100) : 0}%</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div><div className="text-gray-400">Clics</div><div className="text-blue-400 font-bold text-sm">{r.clicks.toLocaleString()}</div></div>
                                <div><div className="text-gray-400">Impressions</div><div className="text-purple-400 font-bold text-sm">{r.impressions.toLocaleString()}</div></div>
                                <div><div className="text-gray-400">CTR</div><div className="text-gray-300">{(r.ctr * 100).toFixed(1)}%</div></div>
                                <div><div className="text-gray-400">Position</div><div className={r.position <= 10 ? "text-green-400" : "text-yellow-400"}>{r.position.toFixed(1)}</div></div>
                              </div>
                              <div className="mt-3 bg-gray-700 rounded-full h-1.5">
                                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${totalClicks > 0 ? Math.round(r.clicks / totalClicks * 100) : 0}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {tab === "keywords" && activeKw?.siteId === site.id && (
                    <div className="border-t border-gray-800 bg-gray-950 px-5 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-sm font-semibold text-white">&quot;{activeKw.query}&quot;</span>
                          <span className="text-xs text-gray-400 ml-2">— évolution position 90 jours</span>
                        </div>
                        <button onClick={() => setActiveKw(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
                      </div>
                      {kwHistLoading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                      ) : kwHistory.length === 0 ? (
                        <div className="text-center py-6 text-gray-400 text-sm">Pas assez d&apos;historique pour ce mot clé</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={180}>
                          <LineChart data={kwHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                            <YAxis reversed domain={['auto','auto']} tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
                            <Tooltip
                              contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                              labelStyle={{ color: "#9ca3af", fontSize: 11 }}
                              formatter={(v: unknown) => [`Position ${v}`, ""]}
                            />
                            <ReferenceLine y={10} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} label={{ value: "Top 10", fill: "#10b981", fontSize: 9 }} />
                            <Line type="monotone" dataKey="position" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  )}
                  {tab === "keywords" && kws.length > KEYWORD_RENDER_LIMIT && (
                    <div className="py-2 text-center text-xs text-gray-400">{kws.length - KEYWORD_RENDER_LIMIT} mots clés supplémentaires — affine le filtre</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
