"use client";

import { useEffect, useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid
} from "recharts";
import {
  Globe, MousePointerClick, Search, Users,
  Loader2, BarChart3, ArrowLeft, Activity,
  Filter, ChevronDown, AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown
} from "lucide-react";
import Link from "next/link";
import { isRecord, readApiJson } from "@/lib/api-response";

const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#f97316","#14b8a6","#6366f1","#84cc16","#f43f5e","#a855f7","#0ea5e9","#22c55e","#eab308"];

type Period = "3" | "7" | "30" | "90";
type OverviewPart = "summary" | "previous" | "gsc" | "ga4";
type ApiNumber = number | string;

interface SiteSummary {
  site_id: number; name: string; url: string;
  clicks: number; impressions: number; position: number;
  sessions: number; users: number; pageviews: number;
  organic_sessions: number; avg_duration: number; bounce_rate: number;
  days_with_data: number;
}

interface DayRow {
  site_id: number; name: string; date: string;
  clicks?: number; impressions?: number; position?: number;
  sessions?: number; users?: number; pageviews?: number;
}

interface ApiSiteSummary {
  site_id: ApiNumber; name: string; url: string;
  clicks: ApiNumber; impressions: ApiNumber; position: ApiNumber;
  sessions: ApiNumber; users: ApiNumber; pageviews: ApiNumber;
  organic_sessions: ApiNumber; avg_duration: ApiNumber; bounce_rate: ApiNumber;
  days_with_data: ApiNumber;
}

interface ApiDayRow {
  site_id: ApiNumber; name: string; date: string;
  clicks?: ApiNumber; impressions?: ApiNumber; position?: ApiNumber;
  sessions?: ApiNumber; users?: ApiNumber; pageviews?: ApiNumber;
}

const PART_LABELS: Record<OverviewPart, string> = {
  summary: "la synthèse",
  previous: "la période précédente",
  gsc: "la série GSC",
  ga4: "la série GA4",
};

function isApiNumber(value: unknown): value is ApiNumber {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function isPositiveInteger(value: unknown): value is ApiNumber {
  return isApiNumber(value) && Number.isInteger(Number(value)) && Number(value) > 0;
}

function isApiSiteSummary(value: unknown): value is ApiSiteSummary {
  return isRecord(value)
    && isPositiveInteger(value.site_id)
    && typeof value.name === "string"
    && typeof value.url === "string"
    && [
      value.clicks,
      value.impressions,
      value.position,
      value.sessions,
      value.users,
      value.pageviews,
      value.organic_sessions,
      value.avg_duration,
      value.bounce_rate,
      value.days_with_data,
    ].every(isApiNumber);
}

function isApiSiteSummaryList(value: unknown): value is ApiSiteSummary[] {
  return Array.isArray(value) && value.every(isApiSiteSummary);
}

function isApiGscDayRow(value: unknown): value is ApiDayRow {
  return isRecord(value)
    && isPositiveInteger(value.site_id)
    && typeof value.name === "string"
    && typeof value.date === "string"
    && isApiNumber(value.clicks)
    && isApiNumber(value.impressions)
    && isApiNumber(value.position);
}

function isApiGa4DayRow(value: unknown): value is ApiDayRow {
  return isRecord(value)
    && isPositiveInteger(value.site_id)
    && typeof value.name === "string"
    && typeof value.date === "string"
    && isApiNumber(value.sessions)
    && isApiNumber(value.users)
    && isApiNumber(value.pageviews);
}

function isApiGscDayRowList(value: unknown): value is ApiDayRow[] {
  return Array.isArray(value) && value.every(isApiGscDayRow);
}

function isApiGa4DayRowList(value: unknown): value is ApiDayRow[] {
  return Array.isArray(value) && value.every(isApiGa4DayRow);
}

function normalizeSiteSummaries(rows: ApiSiteSummary[]): SiteSummary[] {
  return rows.map((row) => ({
    ...row,
    site_id: Number(row.site_id),
    clicks: Number(row.clicks),
    impressions: Number(row.impressions),
    position: Number(row.position),
    sessions: Number(row.sessions),
    users: Number(row.users),
    pageviews: Number(row.pageviews),
    organic_sessions: Number(row.organic_sessions),
    avg_duration: Number(row.avg_duration),
    bounce_rate: Number(row.bounce_rate),
    days_with_data: Number(row.days_with_data),
  }));
}

function normalizeDayRows(rows: ApiDayRow[]): DayRow[] {
  return rows.map((row) => ({
    ...row,
    site_id: Number(row.site_id),
    clicks: row.clicks === undefined ? undefined : Number(row.clicks),
    impressions: row.impressions === undefined ? undefined : Number(row.impressions),
    position: row.position === undefined ? undefined : Number(row.position),
    sessions: row.sessions === undefined ? undefined : Number(row.sessions),
    users: row.users === undefined ? undefined : Number(row.users),
    pageviews: row.pageviews === undefined ? undefined : Number(row.pageviews),
  }));
}

async function fetchJsonWithTimeout<T>(
  url: string,
  isExpectedPayload: (payload: unknown) => payload is T,
  fallbackMessage: string,
  parentSignal: AbortSignal,
  timeoutMs = 12_000,
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return await readApiJson(response, isExpectedPayload, fallbackMessage);
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

function visibleRequestError(error: unknown, part: OverviewPart): string {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return `Le chargement de ${PART_LABELS[part]} a dépassé le délai autorisé.`;
  }
  return error instanceof Error
    ? `Impossible de charger ${PART_LABELS[part]} : ${error.message}`
    : `Impossible de charger ${PART_LABELS[part]}.`;
}

export default function OverviewPage() {
  const [period, setPeriod] = useState<Period>("7");
  // GSC has 2-3 day delay, GA4 has 1 day delay
  const [summary, setSummary] = useState<SiteSummary[]>([]);
  const [summaryPeriod, setSummaryPeriod] = useState<Period | null>(null);
  const [previousSummary, setPreviousSummary] = useState<SiteSummary[]>([]);
  const [previousPeriod, setPreviousPeriod] = useState<Period | null>(null);
  const [gscSeries, setGscSeries] = useState<DayRow[]>([]);
  const [gscPeriod, setGscPeriod] = useState<Period | null>(null);
  const [ga4Series, setGa4Series] = useState<DayRow[]>([]);
  const [ga4Period, setGa4Period] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingParts, setLoadingParts] = useState<Record<OverviewPart, boolean>>({
    summary: false,
    previous: false,
    gsc: false,
    ga4: false,
  });
  const [loadErrors, setLoadErrors] = useState<Partial<Record<OverviewPart, string>>>({});
  const [lastLoadMs, setLastLoadMs] = useState<number | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedSites, setSelectedSites] = useState<number[]>([]);
  const [sortMetric, setSortMetric] = useState<"clicks"|"impressions"|"sessions"|"position">("clicks");
  const [tableSortCol, setTableSortCol] = useState<"clicks"|"sessions"|"position"|"avg_duration"|"impressions">("clicks");
  const [tableSortDir, setTableSortDir] = useState<"asc"|"desc">("desc");
  const [showSiteFilter, setShowSiteFilter] = useState(false);
  const [activePanel, setActivePanel] = useState<"clicks"|"impressions"|"sessions"|"position">("clicks");

  async function loadAll(signal: AbortSignal): Promise<void> {
    const started = performance.now();
    const requestedPeriod = period;
    setLoading(true);
    setLoadErrors({});
    setLastLoadMs(null);
    setLoadingParts({ summary: true, previous: false, gsc: false, ga4: false });

    async function settlePart<T>(
      part: Exclude<OverviewPart, "summary">,
      request: Promise<T>,
      apply: (value: T) => void,
    ): Promise<void> {
      try {
        const value = await request;
        if (!signal.aborted) apply(value);
      } catch (caught) {
        if (!signal.aborted) {
          setLoadErrors((current) => ({ ...current, [part]: visibleRequestError(caught, part) }));
        }
      } finally {
        if (!signal.aborted) {
          setLoadingParts((current) => ({ ...current, [part]: false }));
        }
      }
    }

    try {
      const rawSummary = await fetchJsonWithTimeout(
        `/api/overview?type=summary&days=${requestedPeriod}`,
        isApiSiteSummaryList,
        "Le chargement de la synthèse a échoué",
        signal,
      );
      if (signal.aborted) return;
      const nextSummary = normalizeSiteSummaries(rawSummary);
      setSummary(nextSummary);
      setSummaryPeriod(requestedPeriod);
      setSelectedSites((current) => current.length === 0
        ? nextSummary.map((site) => site.site_id)
        : current.filter((id) => nextSummary.some((site) => site.site_id === id)));

      setLoadingParts({ summary: false, previous: true, gsc: true, ga4: true });
      void settlePart(
        "previous",
        fetchJsonWithTimeout(
          `/api/overview?type=summary&days=${requestedPeriod}&offset=${requestedPeriod}`,
          isApiSiteSummaryList,
          "Le chargement de la période précédente a échoué",
          signal,
        ),
        (rows) => {
          setPreviousSummary(normalizeSiteSummaries(rows));
          setPreviousPeriod(requestedPeriod);
        },
      );
      void settlePart(
        "gsc",
        fetchJsonWithTimeout(
          `/api/overview?type=gsc&days=${requestedPeriod}`,
          isApiGscDayRowList,
          "Le chargement de la série GSC a échoué",
          signal,
        ),
        (rows) => {
          setGscSeries(normalizeDayRows(rows));
          setGscPeriod(requestedPeriod);
        },
      );
      void settlePart(
        "ga4",
        fetchJsonWithTimeout(
          `/api/overview?type=ga4&days=${requestedPeriod}`,
          isApiGa4DayRowList,
          "Le chargement de la série GA4 a échoué",
          signal,
        ),
        (rows) => {
          setGa4Series(normalizeDayRows(rows));
          setGa4Period(requestedPeriod);
        },
      );
    } catch (caught) {
      if (!signal.aborted) {
        setLoadErrors((current) => ({ ...current, summary: visibleRequestError(caught, "summary") }));
        setLoadingParts({ summary: false, previous: false, gsc: false, ga4: false });
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setLoadingParts((current) => ({ ...current, summary: false }));
        setLastLoadMs(performance.now() - started);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadAll(controller.signal);
    return () => controller.abort();
  }, [period, reloadVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayedPeriod = summaryPeriod ?? period;
  const displayedPreviousSummary = useMemo(
    () => previousPeriod === displayedPeriod ? previousSummary : [],
    [displayedPeriod, previousPeriod, previousSummary],
  );
  const displayedGscSeries = useMemo(
    () => gscPeriod === displayedPeriod ? gscSeries : [],
    [displayedPeriod, gscPeriod, gscSeries],
  );
  const displayedGa4Series = useMemo(
    () => ga4Period === displayedPeriod ? ga4Series : [],
    [displayedPeriod, ga4Period, ga4Series],
  );

  // Build time-series aggregated by date for selected sites
  const timeSeriesData = useMemo(() => {
    const series = activePanel === "sessions" ? displayedGa4Series : displayedGscSeries;
    const filtered = series.filter(r => selectedSites.includes(Number(r.site_id)));
    const byDate: Record<string, Record<string, number>> = {};
    filtered.forEach(r => {
      const d = r.date?.slice(5, 10) || r.date;
      if (!byDate[d]) byDate[d] = {};
      const key = r.name.length > 10 ? r.name.slice(0, 10) : r.name;
      const val = activePanel === "clicks" ? Number(r.clicks) || 0
        : activePanel === "impressions" ? Number(r.impressions) || 0
        : activePanel === "sessions" ? Number(r.sessions) || 0
        : Number(r.position) || 0;
      byDate[d] = { ...byDate[d], [key]: (byDate[d][key] || 0) + val };
    });
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, vals]) => ({ date, ...vals }));
  }, [displayedGscSeries, displayedGa4Series, selectedSites, activePanel]);

  // Summary sorted (for bar chart)
  const sortedSummary = useMemo(() => {
    return [...summary].sort((a, b) => {
      if (sortMetric === "position") return (Number(a.position)||999) - (Number(b.position)||999);
      if (sortMetric === "impressions") return Number(b.impressions) - Number(a.impressions);
      if (sortMetric === "sessions") return Number(b.sessions||0) - Number(a.sessions||0);
      return Number(b.clicks) - Number(a.clicks);
    });
  }, [summary, sortMetric]);

  // Table sorted independently
  const tableSorted = useMemo(() => {
    return [...summary].sort((a, b) => {
      let va = 0, vb = 0;
      if (tableSortCol === "clicks") { va = Number(a.clicks||0); vb = Number(b.clicks||0); }
      else if (tableSortCol === "impressions") { va = Number(a.impressions||0); vb = Number(b.impressions||0); }
      else if (tableSortCol === "sessions") { va = Number(a.sessions||0); vb = Number(b.sessions||0); }
      else if (tableSortCol === "position") { va = Number(a.position)||999; vb = Number(b.position)||999; }
      else if (tableSortCol === "avg_duration") { va = Number(a.avg_duration||0); vb = Number(b.avg_duration||0); }
      return tableSortDir === "asc" ? va - vb : vb - va;
    });
  }, [summary, tableSortCol, tableSortDir]);

  function toggleTableSort(col: typeof tableSortCol) {
    if (tableSortCol === col) setTableSortDir(d => d === "desc" ? "asc" : "desc");
    else { setTableSortCol(col); setTableSortDir(col === "position" ? "asc" : "desc"); }
  }

  function SortArrow({ col }: { col: typeof tableSortCol }) {
    if (tableSortCol !== col) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-gray-600" aria-hidden="true" />;
    return tableSortDir === "asc"
      ? <ArrowUp className="ml-1 h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
      : <ArrowDown className="ml-1 h-3.5 w-3.5 text-blue-400" aria-hidden="true" />;
  }

  const totals = useMemo(() => ({
    clicks: summary.reduce((s, x) => s + Number(x.clicks||0), 0),
    impressions: summary.reduce((s, x) => s + Number(x.impressions||0), 0),
    sessions: summary.reduce((s, x) => s + Number(x.sessions||0), 0),
    organicSessions: summary.reduce((s, x) => s + Number(x.organic_sessions||0), 0),
    avgPos: (() => { const a = summary.filter(x => Number(x.position) > 0); return a.length ? a.reduce((s,x)=>s+Number(x.position),0)/a.length : 0; })(),
  }), [summary]);

  const previousTotals = useMemo(() => ({
    clicks: displayedPreviousSummary.reduce((s, x) => s + Number(x.clicks||0), 0),
    impressions: displayedPreviousSummary.reduce((s, x) => s + Number(x.impressions||0), 0),
    sessions: displayedPreviousSummary.reduce((s, x) => s + Number(x.sessions||0), 0),
    organicSessions: displayedPreviousSummary.reduce((s, x) => s + Number(x.organic_sessions||0), 0),
    avgPos: (() => { const a = displayedPreviousSummary.filter(x => Number(x.position) > 0); return a.length ? a.reduce((s,x)=>s+Number(x.position),0)/a.length : 0; })(),
  }), [displayedPreviousSummary]);

  const previousBySite = useMemo(() => {
    const map = new Map<number, SiteSummary>();
    displayedPreviousSummary.forEach((site) => map.set(site.site_id, site));
    return map;
  }, [displayedPreviousSummary]);

  const gscKnownSiteIds = useMemo(
    () => new Set(summary.filter((site) => site.days_with_data > 0).map((site) => site.site_id)),
    [summary],
  );
  const ga4KnownSiteIds = useMemo(() => {
    const ids = new Set(displayedGa4Series.map((row) => row.site_id));
    summary.forEach((site) => {
      if (site.sessions > 0 || site.users > 0 || site.pageviews > 0 || site.organic_sessions > 0) {
        ids.add(site.site_id);
      }
    });
    return ids;
  }, [displayedGa4Series, summary]);
  const gscHasData = gscKnownSiteIds.size > 0;
  const ga4HasData = ga4KnownSiteIds.size > 0;
  const previousGscHasData = displayedPreviousSummary.some((site) => site.days_with_data > 0);
  const previousGa4HasData = displayedPreviousSummary.some((site) =>
    site.sessions > 0 || site.users > 0 || site.pageviews > 0 || site.organic_sessions > 0
  );

  const chartSummary = useMemo(() => sortedSummary.filter((site) => {
    if (sortMetric === "sessions") return ga4KnownSiteIds.has(site.site_id);
    if (!gscKnownSiteIds.has(site.site_id)) return false;
    return sortMetric !== "position" || site.position > 0;
  }), [ga4KnownSiteIds, gscKnownSiteIds, sortMetric, sortedSummary]);

  function pctChange(current: number, previous: number) {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (previous === 0) return current === 0 ? 0 : null;
    return ((current - previous) / Math.abs(previous)) * 100;
  }

  function formatDelta(current: number, previous: number, lowerIsBetter = false) {
    const change = pctChange(current, previous);
    if (change == null) return "n/a";
    const adjusted = lowerIsBetter ? -change : change;
    const sign = adjusted > 0 ? "+" : "";
    return `${sign}${adjusted.toFixed(0)}%`;
  }

  const alerts = useMemo(() => {
    const out: Array<{ level: "danger" | "warn" | "info"; site: string; text: string }> = [];
    summary.forEach((site) => {
      const prev = previousBySite.get(site.site_id);
      if (!prev) return;
      const hasCurrentGsc = gscKnownSiteIds.has(site.site_id);
      const hasPreviousGsc = prev.days_with_data > 0;
      const hasCurrentGa4 = ga4KnownSiteIds.has(site.site_id);
      const clicks = Number(site.clicks || 0);
      const prevClicks = Number(prev.clicks || 0);
      const impressions = Number(site.impressions || 0);
      const prevImpressions = Number(prev.impressions || 0);
      const sessions = Number(site.sessions || 0);
      const prevSessions = Number(prev.sessions || 0);
      const pos = Number(site.position || 0);
      const prevPos = Number(prev.position || 0);
      const clickDrop = hasCurrentGsc && hasPreviousGsc ? pctChange(clicks, prevClicks) : null;
      const impressionChange = hasCurrentGsc && hasPreviousGsc ? pctChange(impressions, prevImpressions) : null;
      const sessionDrop = hasCurrentGa4 && prevSessions > 0 ? pctChange(sessions, prevSessions) : null;
      const posWorse = hasCurrentGsc && hasPreviousGsc && prevPos > 0 && pos > 0 ? pos - prevPos : 0;
      const bridgeRate = hasCurrentGsc && hasCurrentGa4 && clicks > 0
        ? (Number(site.organic_sessions || 0) / clicks) * 100
        : null;

      if (clickDrop != null && clickDrop <= -30 && prevClicks >= 5) {
        out.push({ level: "danger", site: site.name, text: `clics GSC ${clickDrop.toFixed(0)} % par rapport à la période précédente` });
      }
      if (impressionChange != null && impressionChange >= 25 && clickDrop != null && clickDrop <= -10) {
        out.push({ level: "warn", site: site.name, text: "impressions GSC en hausse mais clics en baisse" });
      }
      if (sessionDrop != null && sessionDrop <= -30 && prevSessions >= 20) {
        out.push({ level: "warn", site: site.name, text: `sessions GA4 ${sessionDrop.toFixed(0)} % par rapport à la période précédente` });
      }
      if (posWorse >= 8) {
        out.push({ level: "warn", site: site.name, text: `position GSC dégradée de ${posWorse.toFixed(1)} places` });
      }
      if (bridgeRate != null && clicks >= 5 && (bridgeRate < 35 || bridgeRate > 180)) {
        out.push({ level: "info", site: site.name, text: `écart GA4/GSC à vérifier (${bridgeRate.toFixed(0)} %)` });
      }
    });
    const weight = { danger: 0, warn: 1, info: 2 };
    return out.sort((a, b) => weight[a.level] - weight[b.level]).slice(0, 8);
  }, [ga4KnownSiteIds, gscKnownSiteIds, previousBySite, summary]);

  const periodLabel = { "3": "3 derniers jours", "7": "7 jours", "30": "30 jours", "90": "90 jours" };
  const panelMeta = [
    { key: "clicks" as const, label: "Clics Google", source: "GSC", icon: MousePointerClick, color: "#3b82f6", total: totals.clicks, previous: previousTotals.clicks, hasData: gscHasData, hasPreviousData: previousGscHasData, isLoading: false },
    { key: "impressions" as const, label: "Impressions Google", source: "GSC", icon: Search, color: "#8b5cf6", total: totals.impressions, previous: previousTotals.impressions, hasData: gscHasData, hasPreviousData: previousGscHasData, isLoading: false },
    { key: "sessions" as const, label: "Sessions site", source: "GA4", icon: Users, color: "#10b981", total: totals.sessions, previous: previousTotals.sessions, hasData: ga4HasData, hasPreviousData: previousGa4HasData, isLoading: loadingParts.ga4 && !ga4HasData },
    { key: "position" as const, label: "Position Google", source: "GSC", icon: Globe, color: "#f59e0b", total: totals.avgPos, previous: previousTotals.avgPos, isAvg: true, hasData: totals.avgPos > 0, hasPreviousData: previousTotals.avgPos > 0, isLoading: false },
  ];

  function clickToOrganicSessionRate(site?: SiteSummary) {
    if (site && (!gscKnownSiteIds.has(site.site_id) || !ga4KnownSiteIds.has(site.site_id))) return null;
    if (!site && (!gscHasData || !ga4HasData)) return null;
    const clicks = Number(site?.clicks ?? totals.clicks) || 0;
    const organicSessions = Number(site?.organic_sessions ?? totals.organicSessions) || 0;
    if (clicks <= 0) return null;
    return (organicSessions / clicks) * 100;
  }

  const lineKeys = useMemo(() => {
    if (timeSeriesData.length === 0) return [];
    const keys = Object.keys(timeSeriesData[0]).filter(k => k !== "date");
    return keys.slice(0, 8); // max 8 lines
  }, [timeSeriesData]);

  const supportingErrors = (["previous", "gsc", "ga4"] as const)
    .flatMap((part) => loadErrors[part] ? [{ part, message: loadErrors[part] }] : []);
  const hasAnyLoadError = Object.keys(loadErrors).length > 0;
  const activeSeriesPart: "gsc" | "ga4" = activePanel === "sessions" ? "ga4" : "gsc";
  const activeSeriesError = loadErrors[activeSeriesPart];
  const activeSeriesHasConfirmedData = activeSeriesPart === "ga4"
    ? displayedGa4Series.length > 0
    : displayedGscSeries.length > 0;
  const organicSessionRate = clickToOrganicSessionRate();

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* ── TOP BANNER ── */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 overflow-x-auto">
        <div className="flex items-center gap-6 min-w-max">
          <div className="flex items-center gap-2 text-xs text-gray-400 font-medium mr-2">
            <Activity className="w-3.5 h-3.5" /> VISITES PAR SITE
          </div>
          {!loading && !loadErrors.summary && summary.slice(0, 12).map((s, i) => (
            <div key={s.site_id} className="flex items-center gap-2 text-xs border-r border-gray-700 pr-5 last:border-0">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <div>
                <div className="text-gray-300 font-medium truncate max-w-[80px]">{s.name}</div>
                <div className="text-blue-400 font-bold">
                  {gscKnownSiteIds.has(s.site_id) ? `${s.clicks.toLocaleString("fr-FR")} clics` : "GSC —"}
                </div>
                {ga4KnownSiteIds.has(s.site_id) && (
                  <div className="text-green-400">{s.sessions.toLocaleString("fr-FR")} sess.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HEADER ── */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="inline-flex h-11 w-11 items-center justify-center text-gray-400 hover:text-white"><ArrowLeft className="w-5 h-5" aria-hidden="true" /></Link>
          <BarChart3 className="w-5 h-5 text-blue-400" aria-hidden="true" />
          <h1 className="text-lg font-bold">Vue Globale</h1>
          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
            {loading || loadErrors.summary ? "—" : summary.length} sites
          </span>
          <span aria-live="polite" className={`text-xs px-2 py-0.5 rounded-full ${
            hasAnyLoadError ? "bg-red-500/20 text-red-300" :
            loadingParts.gsc || loadingParts.ga4 ? "bg-cyan-500/20 text-cyan-300" :
            "bg-gray-800 text-gray-400"
          }`}>
            {hasAnyLoadError
              ? loadErrors.summary ? "chargement en erreur" : "chargement partiel"
              : loadingParts.gsc || loadingParts.ga4
                ? "séries en cours"
                : lastLoadMs !== null
                  ? `chargé en ${lastLoadMs >= 1000 ? `${(lastLoadMs / 1000).toFixed(1)} s` : `${Math.round(lastLoadMs)} ms`}`
                  : "prêt"}
          </span>
          <span className="text-xs text-gray-600 hidden md:block">· GSC délai 2-3j · GA4 délai 1j</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period */}
          <div className="flex bg-gray-800 border border-gray-700 rounded-lg overflow-hidden text-xs" role="group" aria-label="Période d'analyse">
            {(["3","7","30","90"] as Period[]).map(p => (
              <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p}
                className={`min-h-11 px-3 py-2 transition ${period === p ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
                {p === "3" ? "3j" : `${p}j`}
              </button>
            ))}
          </div>
          {/* Site filter */}
          <div className="relative">
            <button type="button" onClick={() => setShowSiteFilter(!showSiteFilter)} aria-expanded={showSiteFilter} aria-controls="overview-site-filter"
              className="min-h-11 flex items-center gap-1.5 bg-gray-800 border border-gray-700 px-3 py-2 rounded-lg text-xs text-gray-300 hover:text-white">
              <Filter className="w-3.5 h-3.5" aria-hidden="true" />
              {selectedSites.length === summary.length ? "Tous les sites" : `${selectedSites.length} sites`}
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            </button>
            {showSiteFilter && (
              <div id="overview-site-filter" className="absolute right-0 top-12 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-3 w-56 space-y-1 max-h-64 overflow-y-auto">
                <button type="button" onClick={() => setSelectedSites(summary.map(s => s.site_id))}
                  className="min-h-11 w-full text-left text-xs text-blue-400 hover:text-blue-300 px-2 py-1">Tout sélectionner</button>
                <button type="button" onClick={() => setSelectedSites([])}
                  className="min-h-11 w-full text-left text-xs text-gray-400 hover:text-gray-300 px-2 py-1">Tout désélectionner</button>
                <div className="border-t border-gray-700 pt-1">
                  {summary.map((s, i) => (
                    <label key={s.site_id} className="flex min-h-11 items-center gap-2 px-2 py-1 hover:bg-gray-800 rounded cursor-pointer text-xs">
                      <input type="checkbox" checked={selectedSites.includes(s.site_id)}
                        onChange={e => setSelectedSites(prev => e.target.checked ? [...prev, s.site_id] : prev.filter(id => id !== s.site_id))}
                        className="accent-blue-500" />
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="truncate text-gray-300">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Sort */}
          <select aria-label="Trier les sites" value={sortMetric} onChange={e => setSortMetric(e.target.value as typeof sortMetric)}
            className="min-h-11 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2">
            <option value="clicks">Trier: Clics Google (GSC)</option>
            <option value="impressions">Trier: Impressions Google (GSC)</option>
            <option value="sessions">Trier: Sessions site (GA4)</option>
            <option value="position">Trier: Position Google (GSC)</option>
          </select>
        </div>
      </header>

      {loading && summary.length === 0 ? (
        <div className="flex-1 flex items-center justify-center gap-3 text-gray-400" role="status" aria-live="polite">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" aria-hidden="true" /> Chargement de la vue globale…
        </div>
      ) : loadErrors.summary && summary.length === 0 ? (
        <div className="flex-1 px-6 py-10">
          <div className="mx-auto max-w-2xl rounded-xl border border-red-800 bg-red-900/20 p-6 text-center" role="alert">
            <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-red-300" aria-hidden="true" />
            <h2 className="font-semibold text-red-100">Vue globale indisponible</h2>
            <p className="mt-2 text-sm text-red-200">{loadErrors.summary}</p>
            <button
              type="button"
              onClick={() => setReloadVersion((version) => version + 1)}
              className="mt-4 min-h-11 rounded-lg border border-red-700 px-3 py-2 text-sm text-red-100 hover:bg-red-900/40"
            >
              Réessayer
            </button>
          </div>
        </div>
      ) : summary.length === 0 ? (
        <div className="flex-1 px-6 py-10">
          <div className="mx-auto max-w-2xl rounded-xl border border-gray-800 bg-gray-900 p-6 text-center text-gray-300" role="status">
            Aucune donnée de synthèse n’est disponible pour cette période. Aucun zéro n’est déduit de cette absence.
          </div>
        </div>
      ) : (
        <div className="flex-1 px-6 py-5 space-y-5">
          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Actualisation sur {periodLabel[period]} en cours; les dernières données confirmées ({periodLabel[displayedPeriod]}) restent affichées.
            </div>
          )}
          {loadErrors.summary && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
              {loadErrors.summary} Les dernières données confirmées ({periodLabel[displayedPeriod]}) restent affichées.
              <button
                type="button"
                onClick={() => setReloadVersion((version) => version + 1)}
                className="ml-3 min-h-11 rounded-lg border border-red-700 px-3 text-sm text-red-100 hover:bg-red-900/40"
              >
                Réessayer
              </button>
            </div>
          )}
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-100">
            GSC mesure les clics et impressions depuis Google. GA4 mesure les sessions sur le site après chargement, consentement et suivi. Les deux sources ne doivent pas être égales ; le ratio organique GA4 / clics GSC sert seulement d&apos;indicateur de cohérence.
          </div>
          {supportingErrors.length > 0 && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-3 text-sm text-amber-100" role="alert">
              <div className="font-medium">Certaines données complémentaires sont indisponibles.</div>
              <p className="mt-1 text-xs">Les dernières données confirmées de la même période peuvent rester affichées ; aucun zéro de remplacement n’est créé.</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {supportingErrors.map(({ part, message }) => <li key={part}>{message}</li>)}
              </ul>
            </div>
          )}

          {/* ── KPI CARDS ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {panelMeta.map(m => (
              <button key={m.key} type="button" onClick={() => setActivePanel(m.key)} aria-pressed={activePanel === m.key}
                className={`min-h-11 text-left bg-gray-900 rounded-xl border p-4 transition ${activePanel === m.key ? "border-blue-500" : "border-gray-800 hover:border-gray-600"}`}>
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                  <m.icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{m.label}</span>
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">{m.source}</span>
                  <span>({periodLabel[displayedPeriod]})</span>
                </div>
                <div className="text-2xl font-bold" style={{ color: m.color }}>
                  {m.isLoading
                    ? "Chargement…"
                    : !m.hasData
                      ? "—"
                      : m.isAvg ? m.total.toFixed(1) : m.total.toLocaleString("fr-FR")}
                </div>
                {!m.isLoading && m.hasData && (
                  <div className="text-xs text-gray-400 mt-1">~{m.isAvg ? "moy." : Math.round(m.total / parseInt(displayedPeriod, 10))}/jour</div>
                )}
                {m.hasPreviousData && m.hasData && (
                  <div className={`text-xs mt-2 ${formatDelta(m.total, m.previous, Boolean(m.isAvg)).startsWith("+") ? "text-green-300" : "text-red-300"}`}>
                    {formatDelta(m.total, m.previous, Boolean(m.isAvg))} par rapport à la période précédente
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* ── EVOLUTION CHART (MULTI-SITE) ── */}
          {alerts.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-orange-800/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-orange-200 mb-3">
                <AlertTriangle className="h-4 w-4" />
                Alertes automatiques
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {alerts.map((alert, index) => (
                  <div key={`${alert.site}-${index}`} className={`rounded-lg border px-3 py-2 text-xs ${
                    alert.level === "danger" ? "border-red-800 bg-red-900/20 text-red-200" :
                    alert.level === "warn" ? "border-orange-800 bg-orange-900/20 text-orange-200" :
                    "border-cyan-800 bg-cyan-900/20 text-cyan-200"
                  }`}>
                    <span className="font-semibold">{alert.site}</span> - {alert.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="text-xs text-gray-400 mb-1">Sessions organiques GA4</div>
              <div className="text-xl font-bold text-green-400">
                {loadingParts.ga4 && !ga4HasData
                  ? "Chargement…"
                  : ga4HasData ? totals.organicSessions.toLocaleString("fr-FR") : "—"}
              </div>
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="text-xs text-gray-400 mb-1">Ratio organique GA4 / clics GSC</div>
              <div className="text-xl font-bold text-cyan-300">
                {organicSessionRate == null ? "—" : `${organicSessionRate.toFixed(0)} %`}
              </div>
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="text-xs text-gray-400 mb-1">Lecture correcte</div>
              <div className="text-sm text-gray-300">GSC = entrée Google. GA4 = visites mesurées sur le site.</div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-gray-300">
                Évolution — {panelMeta.find(m => m.key === activePanel)?.label} · {periodLabel[displayedPeriod]}
                <span className="text-xs text-gray-400 ml-2">(clic sur les KPIs pour changer)</span>
              </div>
            </div>
            {loadingParts[activeSeriesPart] && !activeSeriesHasConfirmedData ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Chargement de la série {activeSeriesPart.toUpperCase()}…
              </div>
            ) : activeSeriesError && !activeSeriesHasConfirmedData ? (
              <div className="py-10 text-center text-sm text-red-300" role="alert">{activeSeriesError}</div>
            ) : selectedSites.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm" role="status">Sélectionne au moins un site pour afficher la série.</div>
            ) : timeSeriesData.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm" role="status">Aucune donnée confirmée pour la période sélectionnée.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timeSeriesData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} width={40}
                    reversed={activePanel === "position"} />
                  <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: "#9ca3af" }} />
                  {lineKeys.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 2 PANELS CÔTE À CÔTE ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Classement barre */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <div className="text-sm font-semibold text-gray-300 mb-4">
                Classement — {sortMetric === "clicks" ? "Clics" : sortMetric === "impressions" ? "Impressions" : sortMetric === "sessions" ? "Sessions" : "Position"} ({periodLabel[displayedPeriod]})
              </div>
              {sortMetric === "sessions" && loadingParts.ga4 && !ga4HasData ? (
                <div className="flex h-[220px] items-center justify-center gap-2 text-sm text-gray-400" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement des données GA4…
                </div>
              ) : chartSummary.length === 0 ? (
                <div className="flex h-[220px] items-center justify-center text-center text-sm text-gray-400" role="status">
                  Aucune donnée confirmée pour ce classement.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart layout="vertical"
                    data={chartSummary.slice(0, 10).map((s) => ({
                      name: s.name.length > 14 ? s.name.slice(0, 14) + "…" : s.name,
                      value: sortMetric === "clicks" ? s.clicks
                        : sortMetric === "impressions" ? s.impressions
                        : sortMetric === "sessions" ? s.sessions
                        : s.position,
                      color: COLORS[summary.findIndex(x => x.site_id === s.site_id) % COLORS.length],
                    }))}
                    margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={false} width={90} />
                    <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="value" radius={[0,4,4,0]}>
                      {chartSummary.slice(0, 10).map((s) => (
                        <Cell key={s.site_id} fill={COLORS[summary.findIndex(x => x.site_id === s.site_id) % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Table détaillée */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 overflow-auto">
              <div className="text-sm font-semibold text-gray-300 mb-3">Tous les sites — détail</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-3">Site</th>
                    {([
                      { col: "clicks" as const, label: "Clics GSC" },
                      { col: "sessions" as const, label: "Sessions GA4" },
                      { col: "position" as const, label: "Pos. GSC" },
                      { col: "avg_duration" as const, label: "Dur. moy." },
                    ]).map(({ col, label }) => (
                      <th
                        key={col}
                        aria-sort={tableSortCol === col ? (tableSortDir === "asc" ? "ascending" : "descending") : "none"}
                        className="px-2 text-right whitespace-nowrap"
                      >
                        <button
                          type="button"
                          onClick={() => toggleTableSort(col)}
                          className="inline-flex min-h-11 w-full items-center justify-end text-right hover:text-gray-300"
                          aria-label={`Trier par ${label}`}
                        >
                          {label}<SortArrow col={col} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableSorted.map((s) => {
                    const pos = Number(s.position||0);
                    const dur = Number(s.avg_duration||0);
                    const hasGscData = gscKnownSiteIds.has(s.site_id);
                    const hasGa4Data = ga4KnownSiteIds.has(s.site_id);
                    return (
                      <tr key={s.site_id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[summary.findIndex(x=>x.site_id===s.site_id) % COLORS.length] }} />
                            <span className="text-gray-200 truncate max-w-[100px]">{s.name}</span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 text-blue-400 font-bold">{hasGscData ? s.clicks.toLocaleString("fr-FR") : "—"}</td>
                        <td className="text-right py-2 px-2 text-green-400">{hasGa4Data ? s.sessions.toLocaleString("fr-FR") : "—"}</td>
                        <td className={`text-right py-2 px-2 font-bold ${!hasGscData || pos <= 0 ? "text-gray-600" : pos <= 10 ? "text-green-400" : pos <= 20 ? "text-yellow-400" : "text-red-400"}`}>
                          {hasGscData && pos > 0 ? pos.toFixed(1) : "—"}
                        </td>
                        <td className="text-right py-2 pl-2 text-gray-400">
                          {hasGa4Data ? `${Math.floor(dur/60)}m${Math.floor(dur%60)}s` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── MINI CARDS GRILLE ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {sortedSummary.map((s) => {
              const pos = Number(s.position||0);
              const idx = summary.findIndex(x => x.site_id === s.site_id);
              const dur = Number(s.avg_duration||0);
              const hasGscData = gscKnownSiteIds.has(s.site_id);
              const hasGa4Data = ga4KnownSiteIds.has(s.site_id);
              return (
                <div key={s.site_id} className="bg-gray-900 rounded-xl border border-gray-800 p-3 hover:border-gray-600 transition">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <span className="text-xs font-semibold truncate">{s.name}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-gray-400">Clics</span><span className="text-blue-400 font-bold">{hasGscData ? s.clicks.toLocaleString("fr-FR") : "—"}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Impressions</span><span className="text-purple-400">{hasGscData ? s.impressions.toLocaleString("fr-FR") : "—"}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Sessions</span><span className="text-green-400">{hasGa4Data ? s.sessions.toLocaleString("fr-FR") : "—"}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Position</span>
                      <span className={`font-bold ${!hasGscData || pos <= 0 ? "text-gray-600" : pos <= 10 ? "text-green-400" : pos <= 20 ? "text-yellow-400" : "text-red-400"}`}>{hasGscData && pos > 0 ? pos.toFixed(1) : "—"}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-gray-400">Durée</span><span className="text-gray-300">{hasGa4Data ? `${Math.floor(dur/60)}m${Math.floor(dur%60)}s` : "—"}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}
