"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  BarChart3, Loader2, ChevronDown, ChevronRight, ChevronUp,
  TrendingUp, TrendingDown, X, Smartphone,
  ExternalLink, AlertTriangle, CheckCircle2, Copy, Zap
} from "lucide-react";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { DashboardControlBar, type DashboardPeriod } from "@/components/dashboard/DashboardControlBar";
import { DashboardHealthOverview } from "@/components/dashboard/DashboardHealthOverview";
import {
  dashboardSiteStatusClass,
  dashboardSiteStatusLabel,
  weightedDashboardPosition,
  type DashboardQualitySite,
} from "@/lib/dashboard-quality";

interface Site {
  id: number; name: string; url: string;
  gsc_clicks_30d: number; gsc_impressions_30d: number; avg_position_30d: number;
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

type Period = DashboardPeriod;
type TabType = "keywords" | "gains" | "analytics" | "device";
const SITE_TAB_ORDER: TabType[] = ["keywords", "gains", "analytics", "device"];
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
    return { ...base, title: "Estimation mensuelle importée depuis une source tierce." };
  }
  if (signal.kind === "source_empty") {
    return { label: "0", color: "text-gray-500", title: "Keyword Planner importe, mais Google ne donne pas de volume exploitable pour ce mot-cle." };
  }
  return { ...base, title: "Aucun volume source disponible." };
}

function volumeSignalBadge(signal: VolumeSignal): { label: string; className: string } {
  if (signal.kind === "source") {
    return { label: "estimation importée", className: "bg-green-500/15 text-green-300 border-green-500/30" };
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

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function apiErrorDetail(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
  return null;
}

async function readApiJson(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiResponseError(
      `Réponse API illisible (HTTP ${response.status || "inconnu"})`,
      response.status,
    );
  }

  if (!response.ok) {
    const detail = apiErrorDetail(payload) ?? (response.statusText || "Erreur API");
    const code = isRecord(payload) && typeof payload.error === "string" ? payload.error : null;
    throw new ApiResponseError(`${detail} (HTTP ${response.status})`, response.status, code);
  }

  return payload;
}

function requireRecord(payload: unknown, contract: string): Record<string, unknown> {
  if (!isRecord(payload)) throw new Error(`${contract} : réponse API inattendue`);
  return payload;
}

function requireSuccess(payload: unknown, contract: string): Record<string, unknown> {
  const record = requireRecord(payload, contract);
  if (record.success !== true) {
    throw new Error(`${contract} : ${apiErrorDetail(record) ?? "succès non confirmé par l'API"}`);
  }
  return record;
}

function actionableRequestError(error: unknown, action: string, preserved = true): string {
  const detail = (error instanceof Error ? error.message : "Erreur inconnue").replace(/[.\s]+$/, "");
  return `${action} : ${detail}. ${preserved ? "Les données précédentes sont conservées. " : ""}Réessaie ; si le problème persiste, vérifie la session et la route API.`;
}

function hasOwn(record: object, key: string | number): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function DetailLoadingSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="px-5 py-4">
      <div className="flex items-center gap-2 text-xs text-blue-200">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="mt-3 space-y-2" aria-hidden="true">
        <div className="h-3 w-full animate-pulse rounded bg-gray-800 motion-reduce:animate-none" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-gray-800/80 motion-reduce:animate-none" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-gray-800/60 motion-reduce:animate-none" />
      </div>
    </div>
  );
}

async function fetchWithTiming(
  record: (timing: ServiceTiming) => void,
  label: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const started = performance.now();
  try {
    const res = await fetch(input, init);
    record({
      label,
      ms: performance.now() - started,
      ok: res.ok,
      at: Date.now(),
      cache: res.headers.get("X-Cache"),
    });
    return res;
  } catch (error) {
    record({ label, ms: performance.now() - started, ok: false, at: Date.now() });
    throw error;
  }
}

export default function DashboardPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [pageLoadMs, setPageLoadMs] = useState<number | null>(null);
  const [serviceTimings, setServiceTimings] = useState<ServiceTiming[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<Record<number, TabType>>({});
  const [period, setPeriod] = useState<Period>("7"); // 7j default: 3j lag=2j = often just 1 real day
  const [keywords, setKeywords] = useState<Record<string, QueryData[]>>({});
  const [gains, setGains] = useState<Record<number, GainData[]>>({});
  const [qualitySites, setQualitySites] = useState<DashboardQualitySite[]>([]);
  const [qualityLoaded, setQualityLoaded] = useState(false);
  const [gainLabels, setGainLabels] = useState<GainLabels | null>(null);
  const [kwLoadingIds, setKwLoadingIds] = useState<Set<number>>(new Set());
  const [highVolLoading, setHighVolLoading] = useState<Set<number>>(new Set());
  const [highVolFeedback, setHighVolFeedback] = useState<Record<number, { type: "ok" | "error"; text: string }>>({});
  const [highVolPanel, setHighVolPanel] = useState<number | null>(null); // siteId with open panel
  const [highVolKws, setHighVolKws] = useState<{keyword: string; impressions: number; avg_position: number; clicks: number; source: string; already_tracked: boolean}[]>([]);
  const [highVolPanelLoading, setHighVolPanelLoading] = useState(false);
  const highVolRequestIdRef = useRef(0);
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
  const [sitePage, setSitePage] = useState(1);
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
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const [detailLoadingKeys, setDetailLoadingKeys] = useState<Set<string>>(new Set());
  const [aiModal, setAiModal] = useState<{
    siteId: number; query: string; actionType: string; loading: boolean; response?: string; error?: string;
  } | null>(null);
  const aiDialogRef = useRef<HTMLDivElement>(null);
  const aiCloseButtonRef = useRef<HTMLButtonElement>(null);
  const closeAiModal = useCallback(() => setAiModal(null), []);

  useDialogFocus({
    open: aiModal !== null,
    onClose: closeAiModal,
    containerRef: aiDialogRef,
    initialFocusRef: aiCloseButtonRef,
    lockScroll: true,
  });

  function recordTiming(timing: ServiceTiming) {
    setServiceTimings((prev) => [timing, ...prev].slice(0, 12));
  }

  function updateRequestError(key: string, message: string | null) {
    setRequestErrors((prev) => {
      if (message === null) {
        if (!hasOwn(prev, key)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: message };
    });
  }

  function updateDetailLoading(key: string, active: boolean) {
    setDetailLoadingKeys((prev) => {
      const next = new Set(prev);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
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
      const data = requireSuccess(await readApiJson(res), "Action IA");
      if (typeof data.response !== "string" || !data.response.trim()) {
        throw new Error("Action IA : réponse absente malgré le succès annoncé");
      }
      setAiModal({ siteId, query, actionType, loading: false, response: data.response });
    } catch (e) {
      setAiModal({
        siteId,
        query,
        actionType,
        loading: false,
        error: actionableRequestError(e, "Impossible de générer le plan IA", false),
      });
    }
  }

  async function fetchSites(lang?: string, p?: Period, silent = false): Promise<boolean> {
    if (silent) setStatsRefreshing(true);
    else setLoading(true);
    try {
      const langKey = lang ?? langFilter;
      const periodKey = p ?? period;
      const params = new URLSearchParams();
      if (langKey) params.set("language", langKey);
      params.set("days", periodKey);
      const res = await timedFetch("Sites + stats", `/api/sites?${params.toString()}`);
      const data = await readApiJson(res);
      if (!Array.isArray(data)) throw new Error("Sites : la réponse n'est pas une liste");
      setSites(data as Site[]);
      setConfigError(null);
      updateRequestError("sites", null);
      return true;
    } catch (error) {
      if (error instanceof ApiResponseError && error.code === "missing_env") {
        setConfigError(error.message || "DATABASE_URL manquant dans .env.local.");
      } else {
        updateRequestError(
          "sites",
          actionableRequestError(error, "Impossible d'actualiser les domaines", sites.length > 0),
        );
      }
      return false;
    } finally {
      if (silent) setStatsRefreshing(false);
      else setLoading(false);
    }
  }

  async function fetchQuality(): Promise<boolean> {
    try {
      const res = await timedFetch(
        "Qualite dashboard",
        `/api/dashboard-quality?refresh=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = requireSuccess(await readApiJson(res), "Qualité dashboard");
      if (!Array.isArray(data.sites)) throw new Error("Qualité dashboard : liste de sites absente");
      setQualitySites(data.sites as DashboardQualitySite[]);
      setQualityLoaded(true);
      updateRequestError("quality", null);
      return true;
    } catch (error) {
      updateRequestError(
        "quality",
        actionableRequestError(error, "Impossible d'actualiser la qualité du dashboard", qualityLoaded),
      );
      return false;
    }
  }

  async function loadInitialDashboard() {
    void fetchQuality();
    await fetchSites(undefined, period, false);
  }

  useEffect(() => { void loadInitialDashboard(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav) setPageLoadMs(nav.domContentLoadedEventEnd);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  async function loadKeywords(siteId: number, p: Period, force = false, language = langFilter): Promise<boolean> {
    const key = `${siteId}-${p}-${language || "all"}`;
    const errorKey = `keywords:${siteId}`;
    if (hasOwn(keywords, key) && !force) return true;
    setKwLoadingIds(prev => new Set(prev).add(siteId));
    try {
      const langQs = language ? `&language=${language}` : "";
      const res = await timedFetch("Mots-cles site", `/api/search-console?siteId=${siteId}&type=queries&days=${p}&limit=${KEYWORD_LOAD_LIMIT}${langQs}`);
      const data = await readApiJson(res);
      if (!Array.isArray(data)) throw new Error("Mots-clés : la réponse n'est pas une liste");
      setKeywords(prev => ({ ...prev, [key]: data as QueryData[] }));
      updateRequestError(errorKey, null);
      return true;
    } catch (error) {
      updateRequestError(
        errorKey,
        actionableRequestError(error, "Impossible de charger les mots-clés GSC", hasOwn(keywords, key)),
      );
      return false;
    } finally {
      setKwLoadingIds(prev => { const n = new Set(prev); n.delete(siteId); return n; });
    }
  }

  async function loadGains(siteId: number, force = false, language = langFilter): Promise<boolean> {
    const errorKey = `gains:${siteId}`;
    if (hasOwn(gains, siteId) && !force) return true;
    updateDetailLoading(errorKey, true);
    try {
      const langQs = language ? `&language=${language}` : "";
      const res = await timedFetch("Gains site", `/api/search-console?siteId=${siteId}&type=gains&limit=200${langQs}`);
      const data = await readApiJson(res);
      let nextRows: GainData[];
      let nextLabels: GainLabels | null = null;
      if (Array.isArray(data)) {
        nextRows = data as GainData[];
      } else {
        const record = requireRecord(data, "Gains GSC");
        if (!Array.isArray(record.rows)) throw new Error("Gains GSC : liste de lignes absente");
        const labels = record.labels;
        if (!isRecord(labels) || !["w0", "w1", "w2", "w3", "w4"].every((key) => typeof labels[key] === "string")) {
          throw new Error("Gains GSC : libellés de périodes absents");
        }
        nextRows = record.rows as GainData[];
        nextLabels = labels as unknown as GainLabels;
      }
      setGains(prev => ({ ...prev, [siteId]: nextRows }));
      if (nextLabels) setGainLabels(nextLabels);
      updateRequestError(errorKey, null);
      return true;
    } catch (error) {
      updateRequestError(
        errorKey,
        actionableRequestError(error, "Impossible de charger les gains GSC", hasOwn(gains, siteId)),
      );
      return false;
    } finally {
      updateDetailLoading(errorKey, false);
    }
  }

  async function changeLangFilter(lang: string) {
    // Keep the current filter and its data visible until the replacement is confirmed.
    const sitesLoaded = await fetchSites(lang, undefined, true);
    if (!sitesLoaded) return;
    setLangFilter(lang);

    // Re-fetch keywords for all expanded sites
    const p = period;
    await Promise.all(Array.from(expandedIds).flatMap((expandedId) => [
      loadKeywords(expandedId, p, true, lang),
      loadGains(expandedId, true, lang),
    ]));
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
      if (tab === "keywords") await loadKeywords(siteId, period);
      else if (tab === "gains") await loadGains(siteId);
      else if (tab === "analytics") await loadAnalytics(siteId, period);
      else await loadDeviceSplit(siteId, period);
    }
  }

  async function loadAnalytics(siteId: number, p: Period, force = false): Promise<boolean> {
    const errorKey = `analytics:${siteId}`;
    if (hasOwn(analytics, siteId) && !force) return true;
    updateDetailLoading(errorKey, true);
    try {
      const res = await timedFetch("Analytics site", `/api/analytics?siteId=${siteId}&days=${p}`);
      const data = await readApiJson(res);
      if (!Array.isArray(data)) throw new Error("Analytics GA4 : la réponse n'est pas une liste");
      const nextRows = data.map((row) => {
        const record = requireRecord(row, "Analytics GA4");
        if (typeof record.date !== "string" && typeof record.date !== "number") {
          throw new Error("Analytics GA4 : date absente dans une ligne");
        }
        return { ...record, date: String(record.date).slice(5, 10) } as unknown as AnalyticsDay;
      });
      setAnalytics(prev => ({ ...prev, [siteId]: nextRows }));
      updateRequestError(errorKey, null);
      return true;
    } catch (error) {
      updateRequestError(
        errorKey,
        actionableRequestError(error, "Impossible de charger les données GA4", hasOwn(analytics, siteId)),
      );
      return false;
    } finally {
      updateDetailLoading(errorKey, false);
    }
  }

  async function loadDeviceSplit(siteId: number, p: Period, force = false): Promise<boolean> {
    const errorKey = `device:${siteId}`;
    if (hasOwn(deviceData, siteId) && !force) return true;
    updateDetailLoading(errorKey, true);
    try {
      const res = await timedFetch("Device split", `/api/device-split?site_id=${siteId}&days=${p}`);
      const data = requireRecord(await readApiJson(res), "Répartition par appareil");
      if (!Array.isArray(data.overview)) throw new Error("Répartition par appareil : liste overview absente");
      setDeviceData(prev => ({ ...prev, [siteId]: data.overview as DeviceRow[] }));
      updateRequestError(errorKey, null);
      return true;
    } catch (error) {
      updateRequestError(
        errorKey,
        actionableRequestError(error, "Impossible de charger la répartition par appareil", hasOwn(deviceData, siteId)),
      );
      return false;
    } finally {
      updateDetailLoading(errorKey, false);
    }
  }

  async function switchTab(siteId: number, tab: TabType) {
    setActiveTab(prev => ({ ...prev, [siteId]: tab }));
    if (tab === "keywords") { await loadKeywords(siteId, period); void loadGains(siteId); }
    else if (tab === "gains") await loadGains(siteId);
    else if (tab === "analytics") await loadAnalytics(siteId, period);
    else if (tab === "device") await loadDeviceSplit(siteId, period);
  }

  async function changePeriod(p: Period) {
    const sitesLoaded = await fetchSites(undefined, p, true);
    if (!sitesLoaded) return;
    setPeriod(p);
    await Promise.all([
      ...Array.from(expandedIds, (id) => loadKeywords(id, p, true)),
      ...Object.keys(analytics).map((id) => loadAnalytics(Number(id), p, true)),
      ...Object.keys(deviceData).map((id) => loadDeviceSplit(Number(id), p, true)),
    ]);
  }

  function handleSiteTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, siteId: number, currentTab: TabType) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const currentIndex = SITE_TAB_ORDER.indexOf(currentTab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? SITE_TAB_ORDER.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + SITE_TAB_ORDER.length) % SITE_TAB_ORDER.length;
    const nextTab = SITE_TAB_ORDER[nextIndex];
    void switchTab(siteId, nextTab);
    requestAnimationFrame(() => document.getElementById(`site-tab-${siteId}-${nextTab}`)?.focus());
  }

  async function openHighVolPanel(siteId: number) {
    if (highVolPanel === siteId) {
      highVolRequestIdRef.current += 1;
      setHighVolPanelLoading(false);
      setHighVolPanel(null);
      return;
    }
    const requestId = highVolRequestIdRef.current + 1;
    highVolRequestIdRef.current = requestId;
    setHighVolPanel(siteId);
    setHighVolPanelLoading(true);
    try {
      const res = await timedFetch("High volume", `/api/keywords/high-volume?site_id=${siteId}&min_imp=30`);
      const data = requireSuccess(await readApiJson(res), "Découverte GSC");
      if (!Array.isArray(data.keywords)) throw new Error("Découverte GSC : liste de mots-clés absente");
      if (highVolRequestIdRef.current !== requestId) return;
      const untracked = (data.keywords as typeof highVolKws).filter(k => !k.already_tracked).slice(0, 40);
      setHighVolKws(untracked);
      // Keep discovery read-only by default. The user chooses what to track.
      setHighVolSelected(new Set());
      setHighVolFeedback(prev => { const next = { ...prev }; delete next[siteId]; return next; });
    } catch (error) {
      if (highVolRequestIdRef.current !== requestId) return;
      setHighVolFeedback(prev => ({
        ...prev,
        [siteId]: {
          type: "error",
          text: actionableRequestError(error, "Impossible de charger la découverte GSC"),
        },
      }));
      setHighVolPanel(null);
    } finally {
      if (highVolRequestIdRef.current === requestId) setHighVolPanelLoading(false);
    }
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
      const data = requireSuccess(await readApiJson(res), "Ajout au suivi");
      const added = Number(data.added);
      if (!Number.isInteger(added) || added < 0) throw new Error("Ajout au suivi : compteur added invalide");
      if (added === 0) {
        setHighVolFeedback(prev => ({ ...prev, [siteId]: { type: "error", text: "Aucun mot-clé n'a été ajouté. Ils sont peut-être déjà suivis ; actualise la découverte puis réessaie." } }));
        return;
      }
      setHighVolFeedback(prev => ({ ...prev, [siteId]: { type: "ok", text: `${added} mot(s)-clé(s) ajouté(s) au suivi sur ${toAdd.length} sélectionné(s).` } }));
      setHighVolPanel(null);
      await loadKeywords(siteId, period, true);
    } catch (error) {
      setHighVolFeedback(prev => ({
        ...prev,
        [siteId]: { type: "error", text: actionableRequestError(error, "Impossible d'ajouter les mots-clés au suivi") },
      }));
    } finally {
      setHighVolLoading(prev => { const n = new Set(prev); n.delete(siteId); return n; });
    }
  }

  async function openKwHistory(siteId: number, query: string, force = false) {
    if (!force && activeKw?.siteId === siteId && activeKw?.query === query) { setActiveKw(null); return; }
    setActiveKw({ siteId, query });
    setKwHistLoading(true);
    const errorKey = `history:${siteId}`;
    try {
      const res = await timedFetch("Historique mot-cle", `/api/keyword-history?siteId=${siteId}&query=${encodeURIComponent(query)}&days=90`);
      const data = await readApiJson(res);
      if (!Array.isArray(data)) throw new Error("Historique GSC : la réponse n'est pas une liste");
      const nextHistory = data.map((row) => {
        const record = requireRecord(row, "Historique GSC");
        if (typeof record.date !== "string") throw new Error("Historique GSC : date absente dans une ligne");
        return {
          date: record.date.slice(5),
          position: Math.round(Number(record.position) * 10) / 10,
          clicks: Number(record.clicks),
        };
      });
      setKwHistory(nextHistory);
      updateRequestError(errorKey, null);
    } catch (error) {
      updateRequestError(
        errorKey,
        actionableRequestError(error, "Impossible de charger l'historique du mot-clé"),
      );
    } finally {
      setKwHistLoading(false);
    }
  }

  const [syncMsg, setSyncMsg] = useState<{type: "ok"|"err"; text: string} | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await timedFetch("Sync GSC/GA4", "/api/sync", { method: "POST" });
      const data = requireRecord(await readApiJson(res), "Synchronisation GSC/GA4");
      if (!Array.isArray(data.results)) throw new Error("Synchronisation GSC/GA4 : liste de résultats absente");
      const results = data.results as Array<{
        gsc?: number | { rows?: number; status?: string };
      }>;
      const total = results.reduce((sum, result) => {
        const rows = typeof result.gsc === "number" ? result.gsc : Number(result.gsc?.rows ?? 0);
        return sum + rows;
      }, 0);
      const failed = results.filter((result) =>
        typeof result.gsc === "object" && result.gsc?.status === "error"
      ).length;
      if (data.success !== true || failed > 0) {
        throw new Error(`Synchronisation partielle : ${total} lignes GSC, ${failed || Number(data.errors) || 0} erreur(s)`);
      }
      setSyncMsg({ type: "ok", text: `Sync OK — ${total} lignes GSC importées` });
      await fetchSites(undefined, undefined, true);
      await fetchQuality();
    } catch (err) {
      setSyncMsg({
        type: "err",
        text: err instanceof ApiResponseError && err.status === 401
          ? "Connecte-toi Google d'abord → /login, puis relance la synchronisation."
          : actionableRequestError(err, "La synchronisation GSC/GA4 a échoué"),
      });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 8000);
    }
  }

  const totalClicks = sites.reduce((s, site) => s + (Number(site.gsc_clicks_30d) || 0), 0);
  const totalImpressions = sites.reduce((s, site) => s + (Number(site.gsc_impressions_30d) || 0), 0);
  const activeSites = sites.filter(s => Number(s.avg_position_30d) > 0);
  const avgPosition = weightedDashboardPosition(sites);
  const qualityById = new Map(qualitySites.map((site) => [site.id, site]));
  const latestTiming = serviceTimings[0];
  const avgServiceMs = serviceTimings.length
    ? serviceTimings.reduce((sum, item) => sum + item.ms, 0) / serviceTimings.length
    : 0;
  const sortedSites = [...sites].sort((a, b) => {
    let va = 0, vb = 0;
    if (siteSortCol === "impressions") { va = Number(a.gsc_impressions_30d); vb = Number(b.gsc_impressions_30d); }
    else if (siteSortCol === "position") { va = Number(a.avg_position_30d) || 999; vb = Number(b.avg_position_30d) || 999; }
    else { va = Number(a.gsc_clicks_30d); vb = Number(b.gsc_clicks_30d); }
    return siteSortDir === "asc" ? va - vb : vb - va;
  });
  const sitePageSize = 10;
  const sitePageCount = Math.max(1, Math.ceil(sortedSites.length / sitePageSize));
  const safeSitePage = Math.min(sitePage, sitePageCount);
  const visibleSites = sortedSites.slice((safeSitePage - 1) * sitePageSize, safeSitePage * sitePageSize);

  if (loading) return (
    <div role="status" aria-label="Chargement du cockpit SEO" className="min-h-dvh bg-slate-950 px-4 py-6 text-slate-100 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/10 text-blue-300">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        </span>
        <div>
          <div className="text-lg font-semibold text-white">Chargement du cockpit SEO</div>
          <div className="mt-1 text-sm text-slate-400">Lecture des domaines et des dernières mesures disponibles.</div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900/70 motion-reduce:animate-none" />)}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]" aria-hidden="true">
        <div className="h-44 animate-pulse rounded-xl border border-slate-800 bg-slate-900/70 motion-reduce:animate-none" />
        <div className="h-44 animate-pulse rounded-xl border border-slate-800 bg-slate-900/70 motion-reduce:animate-none" />
      </div>
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

  if (sites.length === 0 && requestErrors.sites) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
        <div role="alert" className="max-w-xl rounded-2xl border border-red-700/50 bg-red-950/30 p-8 shadow-xl">
          <h1 className="mb-3 text-xl font-bold text-red-200">Domaines indisponibles</h1>
          <p className="text-sm text-red-100">{requestErrors.sites}</p>
          <button
            type="button"
            onClick={() => void loadInitialDashboard()}
            className="mt-6 min-h-11 rounded-lg border border-red-600/60 bg-red-900/40 px-4 text-sm font-medium text-red-100 hover:bg-red-900/60"
          >
            Réessayer le chargement
          </button>
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
          onMouseDown={closeAiModal}
        >
          <div
            ref={aiDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-ai-dialog-title"
            className="bg-gray-900 border border-blue-500/30 rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-blue-400 font-semibold">Agent IA SEO · {aiModal.actionType}</div>
                <h2 id="dashboard-ai-dialog-title" className="text-lg font-bold mt-1 text-white">&ldquo;{aiModal.query}&rdquo;</h2>
              </div>
              <button
                ref={aiCloseButtonRef}
                type="button"
                onClick={closeAiModal}
                className="grid h-11 w-11 place-items-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                aria-label="Fermer"
              ><X className="h-5 w-5" aria-hidden="true" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {aiModal.loading && (
                <div role="status" className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <div className="text-sm">L&apos;IA analyse ton mot-clé et génère un plan d&apos;action...</div>
                </div>
              )}
              {aiModal.error && (
                <div role="alert" className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 text-red-300 text-sm">
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
                  className="inline-flex min-h-11 items-center gap-2 rounded bg-gray-800 px-3 text-xs text-gray-300 transition hover:bg-gray-700"
                ><Copy className="h-4 w-4" aria-hidden="true" />Copier</button>
                <button
                  type="button"
                  onClick={closeAiModal}
                  className="min-h-11 rounded bg-blue-600 px-4 text-xs text-white transition hover:bg-blue-700"
                >Fermer</button>
              </div>
            )}
          </div>
        </div>
      )}

      <DashboardControlBar
        siteCount={sites.length}
        search={search}
        onSearchChange={setSearch}
        period={period}
        onPeriodChange={(nextPeriod) => void changePeriod(nextPeriod)}
        country={langFilter}
        onCountryChange={(country) => void changeLangFilter(country)}
        syncing={syncing}
        onSync={() => void handleSync()}
      />

      {/* Sync feedback */}
      {syncMsg && (
        <div role={syncMsg.type === "ok" ? "status" : "alert"} className={`mx-4 mt-2 px-4 py-2 rounded-lg text-sm flex items-center gap-2 animate-in sm:mx-6 ${
          syncMsg.type === "ok"
            ? "bg-green-900/40 border border-green-700 text-green-300"
            : "bg-red-900/40 border border-red-700 text-red-300"
        }`}>
          {syncMsg.type === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />} {syncMsg.text}
        </div>
      )}

      {(["sites", "quality"] as const).map((key) => requestErrors[key] ? (
        <div key={key} role="alert" className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-700 bg-red-950/30 px-4 py-2 text-sm text-red-200 sm:mx-6">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{requestErrors[key]}</span>
          <button
            type="button"
            onClick={() => void (key === "sites" ? fetchSites(undefined, undefined, true) : fetchQuality())}
            className="min-h-9 rounded border border-red-600/60 px-3 text-xs font-medium text-red-100 hover:bg-red-900/50"
          >
            Réessayer
          </button>
        </div>
      ) : null)}

      {statsRefreshing && (
        <div role="status" className="mx-4 mt-2 px-4 py-2 rounded-lg text-sm flex items-center gap-2 bg-cyan-950/30 border border-cyan-800/50 text-cyan-200 sm:mx-6">
          <Loader2 className="w-4 h-4 animate-spin" />
          Stats SEO en chargement en arriere-plan. La page reste utilisable.
        </div>
      )}

      {qualityLoaded ? (
        <DashboardHealthOverview
          sites={qualitySites}
          period={period}
          totalClicks={totalClicks}
          totalImpressions={totalImpressions}
          weightedPosition={avgPosition}
          positionedSites={activeSites.length}
          serviceTiming={latestTiming ? `${formatMs(latestTiming.ms)} · moy. ${formatMs(avgServiceMs)}` : formatMs(pageLoadMs ?? 0)}
          serviceWarning={avgServiceMs > 1500}
          onRefresh={() => void fetchQuality()}
        />
      ) : !requestErrors.quality ? (
        <div className="mx-4 my-3 rounded-xl border border-gray-800 bg-gray-900/70 sm:mx-6">
          <DetailLoadingSkeleton label="Chargement de la qualité du dashboard…" />
        </div>
      ) : null}

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
              onClick={() => { setSitePage(1); if (active) setSiteSortDir(d => d === "desc" ? "asc" : "desc"); else { setSiteSortCol(col); setSiteSortDir(col === "position" ? "asc" : "desc"); } }}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}>
              {label}
              <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                <span className={active && siteSortDir === "asc" ? "text-white" : "opacity-40"}>▲</span>
                <span className={active && siteSortDir === "desc" ? "text-white" : "opacity-40"}>▼</span>
              </span>
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <span>{sortedSites.length} domaines</span>
          {expandedIds.size > 0 && (
            <button type="button" onClick={() => setExpandedIds(new Set())} className="min-h-10 rounded-lg border border-gray-700 bg-gray-800 px-3 font-medium text-gray-300 hover:border-gray-500 hover:text-white">
              Fermer les détails
            </button>
          )}
        </div>
      </div>

      {/* Sites */}
      <div className="px-6 pb-10 space-y-3">
        {visibleSites.map((site, i) => {
          const isOpen = expandedIds.has(site.id);
          const tab = activeTab[site.id] || "keywords";
          const quality = qualityById.get(site.id);
          const kwKey = `${site.id}-${period}-${langFilter || "all"}`;
          const hasKeywordData = hasOwn(keywords, kwKey);
          const hasGainData = hasOwn(gains, site.id);
          const hasAnalyticsData = hasOwn(analytics, site.id);
          const hasDeviceData = hasOwn(deviceData, site.id);
          const currentTabHasConfirmedData = tab === "keywords"
            ? hasKeywordData
            : tab === "gains"
              ? hasGainData
              : tab === "analytics"
                ? hasAnalyticsData
                : hasDeviceData;
          const currentTabError = requestErrors[`${tab}:${site.id}`];
          const currentTabLoading = tab === "keywords"
            ? kwLoadingIds.has(site.id)
            : detailLoadingKeys.has(`${tab}:${site.id}`);
          const currentTabLoadingLabel = tab === "keywords"
            ? "Chargement des mots-clés GSC…"
            : tab === "gains"
              ? "Chargement des gains GSC…"
              : tab === "analytics"
                ? "Chargement des données GA4…"
                : "Chargement des données par appareil…";
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
              <div className="flex flex-col gap-3 px-3 py-3 transition hover:bg-gray-800/50 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSite(site.id)}
                    aria-expanded={isOpen}
                    aria-controls={`site-panel-${site.id}`}
                    className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />}
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} aria-hidden="true" />
                    <span className="truncate font-semibold">{site.name}</span>
                    {top10 > 0 && isOpen && <span className="hidden rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400 sm:inline">{top10} top 10</span>}
                    {quality && <span className={`hidden rounded-full border px-2 py-0.5 text-xs sm:inline ${dashboardSiteStatusClass(quality)}`}>{dashboardSiteStatusLabel(quality)}</span>}
                  </button>
                  <a href={site.url} target="_blank" rel="noopener noreferrer" className="hidden min-h-11 max-w-64 items-center truncate rounded-lg px-2 text-xs text-gray-400 hover:text-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:flex">
                    {site.url}<ExternalLink className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                  </a>
                </div>
                <div className="flex items-center gap-4 overflow-x-auto text-sm lg:gap-6">
                  {quality && (
                    <div className="hidden lg:block text-right">
                      <div className="text-cyan-300 font-bold">{quality.kp_volumes_imported}</div>
                      <div className="text-xs text-gray-400">estimations KP importées</div>
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
                <div
                  id={`site-panel-${site.id}`}
                  role="tabpanel"
                  aria-labelledby={`site-tab-${site.id}-${tab}`}
                  aria-busy={currentTabLoading}
                  className="border-t border-gray-800"
                >
                  {/* Tabs */}
                  <div className="flex gap-1 overflow-x-auto px-4 pt-3 pb-0" role="tablist" aria-label={`Données de ${site.name}`}>
                    <button id={`site-tab-${site.id}-keywords`} type="button" role="tab" aria-selected={tab === "keywords"} aria-controls={`site-panel-${site.id}`} tabIndex={tab === "keywords" ? 0 : -1} onKeyDown={(event) => handleSiteTabKeyDown(event, site.id, "keywords")} onClick={() => switchTab(site.id, "keywords")}
                      className={`min-h-11 whitespace-nowrap px-3 py-1.5 rounded-t text-xs font-medium transition ${tab === "keywords" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      Mots clés ({period}j)
                    </button>
                    <button id={`site-tab-${site.id}-gains`} type="button" role="tab" aria-selected={tab === "gains"} aria-controls={`site-panel-${site.id}`} tabIndex={tab === "gains" ? 0 : -1} onKeyDown={(event) => handleSiteTabKeyDown(event, site.id, "gains")} onClick={() => switchTab(site.id, "gains")}
                      className={`min-h-11 whitespace-nowrap px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "gains" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      <TrendingUp className="w-3 h-3" /> Gains / semaine
                    </button>
                    <button id={`site-tab-${site.id}-analytics`} type="button" role="tab" aria-selected={tab === "analytics"} aria-controls={`site-panel-${site.id}`} tabIndex={tab === "analytics" ? 0 : -1} onKeyDown={(event) => handleSiteTabKeyDown(event, site.id, "analytics")} onClick={() => switchTab(site.id, "analytics")}
                      className={`min-h-11 whitespace-nowrap px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "analytics" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      <BarChart3 className="w-3 h-3" /> Analytics GA4
                    </button>
                    <button id={`site-tab-${site.id}-device`} type="button" role="tab" aria-selected={tab === "device"} aria-controls={`site-panel-${site.id}`} tabIndex={tab === "device" ? 0 : -1} onKeyDown={(event) => handleSiteTabKeyDown(event, site.id, "device")} onClick={() => switchTab(site.id, "device")}
                      className={`min-h-11 whitespace-nowrap px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "device" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-300"}`}>
                      <Smartphone className="w-3 h-3" /> Devices
                    </button>
                  </div>

                  {tab === "keywords" && (
                    <div className="flex items-center flex-wrap gap-2 px-4 py-2">
                      {(["all","important","highvolume","longtail","questions"] as const).map(f => (
                        <button key={f} type="button" aria-pressed={kwTypeFilter === f} onClick={() => setKwTypeFilter(f)}
                          className={`min-h-11 rounded px-3 py-1 text-xs font-medium transition ${kwTypeFilter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                          {f === "important" ? "Important" : f === "highvolume" ? "Fort volume 3000+" : f === "all" ? "Tous" : f === "longtail" ? "Long tail (4+ mots)" : "Questions"}
                        </button>
                      ))}
                      <button type="button" onClick={() => void openHighVolPanel(site.id)} aria-expanded={highVolPanel === site.id} className="ml-auto min-h-10 rounded-lg border border-cyan-700 bg-cyan-950/40 px-3 text-xs font-medium text-cyan-200 hover:bg-cyan-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                        {highVolPanel === site.id ? "Fermer la découverte" : "Découvrir les requêtes GSC"}
                      </button>
                      {emptyActiveFilter && (
                        <span className="ml-2 text-[11px] text-yellow-300">
                          Filtre actif sans resultat. Clique Tous pour revoir tous les mots-cles charges.
                        </span>
                      )}
                    </div>
                  )}
                  {highVolFeedback[site.id] && <div role={highVolFeedback[site.id].type === "error" ? "alert" : "status"} className={`mx-4 my-2 rounded-lg border px-3 py-2 text-xs ${highVolFeedback[site.id].type === "ok" ? "border-emerald-700 bg-emerald-950/30 text-emerald-200" : "border-red-700 bg-red-950/30 text-red-200"}`}>{highVolFeedback[site.id].text}</div>}

                  {((tab === "keywords" && hasKeywordData) || (tab === "gains" && hasGainData)) && (
                    <div className="px-4 py-2 border-t border-gray-800 bg-gray-950/40">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="px-2 py-1 rounded border border-green-500/25 bg-green-500/10 text-green-300">
                            {sourceVolumeCount} estimation(s) importée(s)
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
                            {highVolumeKeywords.length} estimation(s) à 3000+/mois
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
                        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-yellow-300">
                          {!highVolPanelLoading && <Zap className="h-4 w-4" aria-hidden="true" />}
                          {highVolPanelLoading ? "Découverte GSC en cours…" : `${highVolKws.length} mots-clés du secteur (requêtes GSC observées sur 90 jours)`}
                        </span>
                        <button type="button"
                          onClick={() => void addSelectedHighVol(site.id)}
                          disabled={highVolPanelLoading || highVolSelected.size === 0 || highVolLoading.has(site.id)}
                            className="min-h-11 rounded border border-yellow-500/60 bg-yellow-500/40 px-3 text-xs font-semibold text-yellow-100 hover:bg-yellow-500/60 disabled:opacity-40">
                          {highVolLoading.has(site.id) ? <Loader2 className="w-3 h-3 animate-spin inline" /> : null}
                          {` Ajouter (${highVolSelected.size})`}
                        </button>
                        <button type="button"
                          onClick={async () => {
                            if (highVolPanelLoading) return;
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
                              const data = requireSuccess(await readApiJson(res), "Ajout groupé au suivi");
                              const added = Number(data.added);
                              if (!Number.isInteger(added) || added < 0) throw new Error("Ajout groupé : compteur added invalide");
                              if (added === 0) {
                                setHighVolFeedback(prev => ({ ...prev, [site.id]: { type: "error", text: "Aucun mot-clé n'a été ajouté. Ils sont peut-être déjà suivis ; actualise la découverte puis réessaie." } }));
                                return;
                              }
                              setHighVolFeedback(prev => ({ ...prev, [site.id]: { type: "ok", text: `${added} mot(s)-clé(s) ajouté(s) au suivi sur ${highVolKws.length}.` } }));
                              setHighVolPanel(null);
                              await loadKeywords(site.id, period, true);
                            } catch (error) {
                              setHighVolFeedback(prev => ({
                                ...prev,
                                [site.id]: { type: "error", text: actionableRequestError(error, "Impossible d'ajouter tous les mots-clés au suivi") },
                              }));
                            } finally {
                              setHighVolLoading(prev => { const n = new Set(prev); n.delete(site.id); return n; });
                            }
                          }}
                          disabled={highVolPanelLoading}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded border border-yellow-500/50 bg-yellow-600/40 px-3 text-xs font-semibold text-yellow-100 transition hover:bg-yellow-600/60 disabled:opacity-40"
                          title="Ajouter tous les mots-clés affichés au suivi">
                          <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Tout ajouter
                        </button>
                        <button type="button" disabled={highVolPanelLoading} onClick={() => setHighVolSelected(new Set(highVolKws.map(k => k.keyword)))}
                          className="min-h-11 rounded bg-gray-700 px-3 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40">Tout</button>
                        <button type="button" disabled={highVolPanelLoading} onClick={() => setHighVolSelected(new Set())}
                          className="min-h-11 rounded bg-gray-700 px-3 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40">Aucun</button>
                        <button type="button" disabled={highVolPanelLoading} onClick={() => setHighVolKws(prev => [...prev].sort((a,b) => a.avg_position - b.avg_position))}
                          title="Trier par position (meilleures d'abord)"
                          className="min-h-11 rounded bg-gray-700 px-3 text-xs text-green-300 hover:bg-gray-600 disabled:opacity-40">Position</button>
                        <button type="button" disabled={highVolPanelLoading} onClick={() => setHighVolKws(prev => [...prev].sort((a,b) => b.impressions - a.impressions))}
                          title="Trier par impressions (les plus vus)"
                          className="min-h-11 rounded bg-gray-700 px-3 text-xs text-blue-300 hover:bg-gray-600 disabled:opacity-40">Impressions</button>
                        <button type="button" onClick={() => {
                          highVolRequestIdRef.current += 1;
                          setHighVolPanelLoading(false);
                          setHighVolPanel(null);
                        }}
                          className="grid h-11 w-11 place-items-center rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                          aria-label="Fermer la découverte de mots-clés"><X className="h-4 w-4" aria-hidden="true" /></button>
                      </div>
                      {/* Keyword list — flex rows to avoid table overflow conflicts */}
                      {highVolPanelLoading ? (
                        <DetailLoadingSkeleton label="Recherche des requêtes GSC…" />
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
                                  className={`flex min-h-11 w-20 shrink-0 items-center justify-end gap-1 text-right transition hover:text-white ${hvSortCol === col ? "text-yellow-300" : ""}`}>
                                  {["Imp. 90j","Pos.","Clics 90j"][i]}
                                  {hvSortCol === col && (hvSortDir === "asc"
                                    ? <ChevronUp className="h-3 w-3" aria-hidden="true" />
                                    : <ChevronDown className="h-3 w-3" aria-hidden="true" />)}
                                </button>
                              ))}
                            </div>
                            {/* Rows */}
                            <div className="max-h-72 overflow-y-auto">
                              {highVolKws.map((kw) => (
                                <label key={kw.keyword}
                                  className={`flex min-h-11 cursor-pointer items-center border-b border-gray-800/30 px-3 py-2 transition ${highVolSelected.has(kw.keyword) ? "bg-yellow-500/12 hover:bg-yellow-500/20" : "hover:bg-yellow-500/5"}`}>
                                  <span className="w-5 shrink-0 flex items-center">
                                    <input type="checkbox" checked={highVolSelected.has(kw.keyword)}
                                      onChange={() => setHighVolSelected(prev => {
                                        const next = new Set(prev);
                                        if (next.has(kw.keyword)) next.delete(kw.keyword);
                                        else next.add(kw.keyword);
                                        return next;
                                      })}
                                      aria-label={`Sélectionner ${kw.keyword}`}
                                      className="h-4 w-4 accent-yellow-400" />
                                  </span>
                                  <span className="flex-1 min-w-[160px] text-xs text-white font-medium truncate pr-2">{kw.keyword}</span>
                                  <span className="w-20 text-right text-xs text-blue-400 shrink-0">{kw.impressions.toLocaleString()}</span>
                                  <span className={`w-20 text-right text-xs shrink-0 ${kw.avg_position <= 10 ? "text-green-400" : kw.avg_position <= 20 ? "text-yellow-400" : "text-red-400"}`}>
                                    {kw.avg_position > 0 ? kw.avg_position.toFixed(1) : "—"}
                                  </span>
                                  <span className="w-20 text-right text-xs text-gray-400 shrink-0">{kw.clicks > 0 ? kw.clicks.toLocaleString() : "0"}</span>
                                </label>
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
                          <div className="text-[11px] text-gray-400">Volume Keyword Planner importé (estimation), seuil 3 000 recherches/mois</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setKwTypeFilter("highvolume")}
                          className="min-h-11 rounded border border-orange-500/40 bg-orange-500/10 px-3 text-xs text-orange-200 hover:bg-orange-500/20"
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

                  {currentTabError && (
                    <div role="alert" className="mx-4 my-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-700 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                      <span className="min-w-0 flex-1">{currentTabError}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (tab === "keywords") void loadKeywords(site.id, period, true);
                          else if (tab === "gains") void loadGains(site.id, true);
                          else if (tab === "analytics") void loadAnalytics(site.id, period, true);
                          else void loadDeviceSplit(site.id, period, true);
                        }}
                        className="min-h-9 rounded border border-red-600/60 px-3 font-medium text-red-100 hover:bg-red-900/50"
                      >
                        Réessayer
                      </button>
                    </div>
                  )}
                  {currentTabLoading ? (
                    <DetailLoadingSkeleton label={currentTabLoadingLabel} />
                  ) : !currentTabHasConfirmedData ? null : tab === "keywords" ? (
                    kws.length === 0 ? (
                      <div className="py-6 text-center text-gray-400 text-sm">
                        {rawKws.length === 0
                          ? `Aucune requete GSC pour ce site${langFilter ? " avec ce pays/langue" : ""}.`
                          : kwTypeFilter === "highvolume"
                            ? "Aucun mot-clé avec estimation importée >= 3000/mois pour ce site."
                            : "Aucun mot-cle ne correspond au filtre actif."}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                      <table className="w-full min-w-[880px] text-sm">
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
                                <th key={col} className="px-1 py-1 text-right" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                  <button type="button" aria-label={`Trier par ${labels[col]}${active ? `, ordre ${sortDir === "asc" ? "croissant" : "décroissant"}` : ""}`} onClick={() => { if (active) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir(col === "position" ? "asc" : "desc"); } }} className={`inline-flex min-h-11 w-full select-none items-center justify-end gap-1 rounded px-2 ${active ? "text-white" : "hover:bg-gray-800 hover:text-gray-300"}`}>
                                    {labels[col]}
                                    <span className="flex flex-col" aria-hidden="true">
                                      <ChevronUp className={`h-2.5 w-2.5 ${active && sortDir === "asc" ? "text-blue-400" : "opacity-30"}`} />
                                      <ChevronDown className={`h-2.5 w-2.5 ${active && sortDir === "desc" ? "text-blue-400" : "opacity-30"}`} />
                                    </span>
                                  </button>
                                </th>
                              );
                            })}
                            {(() => {
                              const col = "volume" as const;
                              const active = sortCol === col;
                              return (
                                <th className="px-1 py-1 text-right" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                                  <button type="button" aria-label={`Trier par volume source${active ? `, ordre ${sortDir === "asc" ? "croissant" : "décroissant"}` : ""}`} onClick={() => { if (active) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir("desc"); } }} className={`inline-flex min-h-11 w-full select-none items-center justify-end gap-1 rounded px-2 ${active ? "text-white" : "hover:bg-gray-800 hover:text-gray-300"}`}>
                                    Volume source
                                    <span className="flex flex-col" aria-hidden="true">
                                      <ChevronUp className={`h-2.5 w-2.5 ${active && sortDir === "asc" ? "text-blue-400" : "opacity-30"}`} />
                                      <ChevronDown className={`h-2.5 w-2.5 ${active && sortDir === "desc" ? "text-blue-400" : "opacity-30"}`} />
                                    </span>
                                  </button>
                                </th>
                              );
                            })()}
                            <th className="text-left py-2 px-5">Solution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kws.slice(0, KEYWORD_RENDER_LIMIT).map((kw, j) => (
                            <tr key={j} className={`border-b border-gray-800/40 hover:bg-gray-800/20 ${activeKw?.query === kw.query && activeKw?.siteId === site.id ? "bg-blue-900/10" : ""}`}>
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
                                  <button type="button" onClick={() => openKwHistory(site.id, kw.query)} aria-expanded={activeKw?.query === kw.query && activeKw?.siteId === site.id} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" aria-label={`Afficher l'historique de ${kw.query}`}>
                                    <ChevronDown className={`w-3 h-3 transition-transform ${activeKw?.query === kw.query && activeKw?.siteId === site.id ? "rotate-180" : ""}`} aria-hidden="true" />
                                  </button>
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
                      </div>
                    )
                  ) : tab === "gains" ? (
                    gainList.length === 0 ? (
                      <div className="py-6 text-center text-gray-400 text-sm">
                        Aucune variation hebdo comparable dans la derniere fenetre GSC importee.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                      <table className="w-full min-w-[1100px] text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs bg-gray-800/50">
                            <th className="text-left py-2 px-5">
                              <span className="inline-flex items-center gap-2">
                                Mot clé
                                <CopyKeywordsButton keywords={gainList.map((kw) => kw.query)} />
                              </span>
                            </th>
                            <th className="px-1 py-1 text-right" aria-sort={gainSortCol === "position_now" ? (gainSortDir === "asc" ? "ascending" : "descending") : "none"}>
                              <button type="button" onClick={() => { if (gainSortCol === "position_now") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("position_now"); setGainSortDir("asc"); } }} className={`inline-flex min-h-10 w-full flex-col items-end justify-center rounded px-1 ${gainSortCol === "position_now" ? "text-white" : "hover:bg-gray-800 hover:text-gray-300"}`}>
                                <span>Cette sem. {gainSortCol === "position_now" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}</span>
                                <span className="text-[9px] text-gray-600">{gainLabels?.w0 || ""}</span>
                              </button>
                            </th>
                            <th className="px-1 py-1 text-right" aria-sort={gainSortCol === "gain" ? (gainSortDir === "asc" ? "ascending" : "descending") : "none"}>
                              <button type="button" onClick={() => { if (gainSortCol === "gain") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("gain"); setGainSortDir("desc"); } }} className={`inline-flex min-h-10 w-full flex-col items-end justify-center rounded px-1 ${gainSortCol === "gain" ? "text-white" : "hover:bg-gray-800 hover:text-gray-300"}`}>
                                <span>S-1 {gainSortCol === "gain" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}</span>
                                <span className="text-[9px] text-gray-600">{gainLabels?.w1 || ""}</span>
                              </button>
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
                            <th className="px-1 py-1 text-right" aria-sort={gainSortCol === "clicks_gain" ? (gainSortDir === "asc" ? "ascending" : "descending") : "none"}>
                              <button type="button" onClick={() => { if (gainSortCol === "clicks_gain") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("clicks_gain"); setGainSortDir("desc"); } }} className={`min-h-10 w-full rounded px-2 text-right ${gainSortCol === "clicks_gain" ? "text-white" : "hover:bg-gray-800 hover:text-gray-300"}`}>Clics +/- {gainSortCol === "clicks_gain" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}</button>
                            </th>
                            <th className="px-1 py-1 text-right"
                              title="Tri sur volume source uniquement. Le signal GSC reste informatif."
                              aria-sort={gainSortCol === "volume" ? (gainSortDir === "asc" ? "ascending" : "descending") : "none"}>
                              <button type="button" onClick={() => { if (gainSortCol === "volume") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("volume"); setGainSortDir("desc"); } }} className={`min-h-10 w-full rounded px-2 text-right ${gainSortCol === "volume" ? "text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-300"}`}>
                                Volume source {gainSortCol === "volume" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}
                              </button>
                            </th>
                            <th className="px-1 py-1 text-right"
                              title="Score = clics gagnables si tu passes top 3. Tri = quick wins prioritaires."
                              aria-sort={gainSortCol === "opportunity" ? (gainSortDir === "asc" ? "ascending" : "descending") : "none"}>
                              <button type="button" onClick={() => { if (gainSortCol === "opportunity") setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol("opportunity"); setGainSortDir("desc"); } }} className={`min-h-10 w-full rounded px-2 text-right ${gainSortCol === "opportunity" ? "text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-300"}`}>
                                Opportunité {gainSortCol === "opportunity" ? (gainSortDir === "desc" ? "↓" : "↑") : ""}
                              </button>
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
                      </div>
                    )
                  ) : null}
                  {tab === "analytics" && !currentTabLoading && hasAnalyticsData && (() => {
                    const aData = analytics[site.id] || [];
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

                  {tab === "device" && !currentTabLoading && hasDeviceData && (() => {
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
                        <button type="button" onClick={() => setActiveKw(null)} aria-label="Fermer l'historique du mot-clé" className="grid h-11 w-11 place-items-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><X className="w-4 h-4" aria-hidden="true" /></button>
                      </div>
                      {kwHistLoading ? (
                        <DetailLoadingSkeleton label="Chargement de l'historique GSC…" />
                      ) : requestErrors[`history:${site.id}`] ? (
                        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-red-700 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                          <span className="min-w-0 flex-1">{requestErrors[`history:${site.id}`]}</span>
                          <button
                            type="button"
                            onClick={() => void openKwHistory(site.id, activeKw.query, true)}
                            className="min-h-9 rounded border border-red-600/60 px-3 font-medium text-red-100 hover:bg-red-900/50"
                          >
                            Réessayer
                          </button>
                        </div>
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
        {sitePageCount > 1 && (
          <nav aria-label="Pagination des domaines" className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-gray-400">Domaines {(safeSitePage - 1) * sitePageSize + 1}–{Math.min(safeSitePage * sitePageSize, sortedSites.length)} sur {sortedSites.length}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setSitePage((value) => Math.max(1, value - 1))} disabled={safeSitePage <= 1} className="min-h-11 rounded-lg border border-gray-700 px-3 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-30">Précédent</button>
              <span className="min-w-20 text-center text-sm tabular-nums text-gray-300">{safeSitePage} / {sitePageCount}</span>
              <button type="button" onClick={() => setSitePage((value) => Math.min(sitePageCount, value + 1))} disabled={safeSitePage >= sitePageCount} className="min-h-11 rounded-lg border border-gray-700 px-3 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-30">Suivant</button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
