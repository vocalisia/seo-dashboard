"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import Link from "next/link";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site { id: number; name: string; }

interface DayData { date: string; position: number | null; clicks: number; impressions: number; }
interface KwHistory { keyword: string; history: { date: string; position: number; clicks: number }[]; }
interface TrackerData { success: boolean; site_history: DayData[]; keywords: KwHistory[]; }

type FreshnessLevel = "fresh" | "partial" | "late" | "empty";

interface StatusEntry {
  total_keywords: number; checked_in_cycle: number; coverage_pct: number;
  latest_checked_at: string | null; age_hours: number | null; level: FreshnessLevel;
}
interface TrackerStatus {
  success: boolean; engine: string; cycle_days: number; limit_per_site: number;
  summary: StatusEntry & { total_sites: number };
  sites: Array<StatusEntry & { site_id: number; site_name: string }>;
}

type TrackerScope = number | "all";

const REQUEST_TIMEOUT_MS = 45_000;

function requestError(error: unknown, action: string): string {
  if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) {
    return `${action} a dépassé le délai autorisé. Réessayez; si cela recommence, vérifiez la base et l’API.`;
  }
  if (error instanceof TypeError) return `${action} est impossible : ${error.message}. Vérifiez la connexion puis réessayez.`;
  return error instanceof Error
    ? `${error.message}. Rechargez la page si votre session a expiré, puis réessayez.`
    : `${action} a échoué. Réessayez.`;
}

function isSite(value: unknown): value is Site {
  return isRecord(value) && Number.isInteger(value.id) && typeof value.name === "string";
}

const isSiteList = (value: unknown): value is Site[] => Array.isArray(value) && value.every(isSite);

function isDayData(value: unknown): value is DayData {
  return isRecord(value)
    && typeof value.date === "string"
    && (value.position === null || (typeof value.position === "number" && Number.isFinite(value.position)))
    && typeof value.clicks === "number"
    && Number.isFinite(value.clicks)
    && typeof value.impressions === "number"
    && Number.isFinite(value.impressions);
}

function isKwHistory(value: unknown): value is KwHistory {
  return isRecord(value)
    && typeof value.keyword === "string"
    && Array.isArray(value.history)
    && value.history.every((point) => isRecord(point)
      && typeof point.date === "string"
      && typeof point.position === "number"
      && Number.isFinite(point.position)
      && typeof point.clicks === "number"
      && Number.isFinite(point.clicks));
}

function isTrackerData(value: unknown): value is TrackerData {
  return isRecord(value)
    && value.success === true
    && Array.isArray(value.site_history)
    && value.site_history.every(isDayData)
    && Array.isArray(value.keywords)
    && value.keywords.every(isKwHistory);
}

function isFreshnessLevel(value: unknown): value is FreshnessLevel {
  return value === "fresh" || value === "partial" || value === "late" || value === "empty";
}

function isStatusEntry(value: unknown): boolean {
  return isRecord(value)
    && ["total_keywords", "checked_in_cycle", "coverage_pct"]
      .every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))
    && (value.latest_checked_at === null || typeof value.latest_checked_at === "string")
    && (value.age_hours === null || (typeof value.age_hours === "number" && Number.isFinite(value.age_hours)))
    && isFreshnessLevel(value.level);
}

function isTrackerStatus(value: unknown): value is TrackerStatus {
  return isRecord(value)
    && value.success === true
    && typeof value.engine === "string"
    && typeof value.cycle_days === "number"
    && Number.isFinite(value.cycle_days)
    && typeof value.limit_per_site === "number"
    && Number.isFinite(value.limit_per_site)
    && isStatusEntry(value.summary)
    && isRecord(value.summary)
    && typeof value.summary.total_sites === "number"
    && Number.isFinite(value.summary.total_sites)
    && Array.isArray(value.sites)
    && value.sites.every((site) => isStatusEntry(site)
      && isRecord(site)
      && Number.isInteger(site.site_id)
      && typeof site.site_name === "string");
}

function trackerEngineLabel(engine: string): string {
  if (engine === "public_web") return "web public (Bing + DuckDuckGo)";
  if (engine === "brave") return "Brave Search";
  return engine;
}

export default function TrackerPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [data, setData] = useState<TrackerData | null>(null);
  const [dataSiteId, setDataSiteId] = useState<number | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [statusScope, setStatusScope] = useState<TrackerScope | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function fetchSites() {
      try {
        const response = await fetch("/api/sites", {
          signal: AbortSignal.timeout(30_000),
        });
        const payload = await readApiJson(response, isSiteList, "Le chargement des sites a échoué");
        if (!active) return;
        setSites(payload);
        setSitesError(payload.length === 0
          ? "Aucun site actif n’a été renvoyé. Vérifiez la configuration des sites."
          : null);
        if (payload.length > 0) setSelectedSite((current) => current ?? "all");
      } catch (fetchError) {
        if (active) setSitesError(requestError(fetchError, "Le chargement des sites"));
      }
    }

    void fetchSites();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedSite) return;
    let active = true;
    const requestedScope = selectedSite;

    async function fetchStatus() {
      setStatusLoading(true);
      setStatusError(null);
      try {
        const response = await fetch(
          `/api/rank-tracker/status?site_id=${requestedScope}&cycle_days=14`,
          { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
        const payload = await readApiJson(
          response,
          isTrackerStatus,
          "Le chargement du statut tracker a échoué",
        );
        if (typeof requestedScope === "number" && !payload.sites.some((site) => site.site_id === requestedScope)) {
          throw new Error("Le statut confirmé ne contient pas le site sélectionné");
        }
        if (!active) return;
        setStatus(payload);
        setStatusScope(requestedScope);
      } catch (fetchError) {
        if (active) {
          setStatusError(
            `${requestError(fetchError, "Le chargement du statut tracker")} Les dernières données confirmées restent conservées lorsqu’elles existent.`,
          );
        }
      } finally {
        if (active) setStatusLoading(false);
      }
    }

    async function fetchData(siteId: number) {
      setLoading(true);
      setDataError(null);
      try {
        const response = await fetch(`/api/position-history?site_id=${siteId}&days=90`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const payload = await readApiJson(
          response,
          isTrackerData,
          "Le chargement de l’historique de positions a échoué",
        );
        if (!active) return;
        setData(payload);
        setDataSiteId(siteId);
      } catch (fetchError) {
        if (active) {
          setDataError(
            `${requestError(fetchError, "Le chargement de l’historique de positions")} Les dernières données confirmées restent conservées lorsqu’elles existent.`,
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchStatus();
    if (requestedScope === "all") {
      setLoading(false);
      setDataError(null);
    } else {
      void fetchData(requestedScope);
    }

    return () => { active = false; };
  }, [selectedSite]);

  const displayedData = typeof selectedSite === "number" && dataSiteId === selectedSite ? data : null;
  const displayedStatus = statusScope === selectedSite ? status : null;

  const FRESHNESS_COPY: Record<FreshnessLevel, { label: string; hint: string; dot: string; ping: string; border: string }> = {
    fresh: {
      label: "Tracker a jour",
      hint: "Cycle de suivi couvert.",
      dot: "bg-emerald-400",
      ping: "bg-emerald-400",
      border: "border-emerald-800/50",
    },
    partial: {
      label: "Cycle en cours",
      hint: "Couverture partielle, donnees exploitables.",
      dot: "bg-yellow-400",
      ping: "bg-yellow-400",
      border: "border-yellow-800/50",
    },
    late: {
      label: "Tracker en retard",
      hint: "Une partie des mots-cles depasse le cycle.",
      dot: "bg-orange-400",
      ping: "bg-orange-400",
      border: "border-orange-800/50",
    },
    empty: {
      label: "Aucun check recent",
      hint: "Aucune donnee rank tracker sur ce cycle.",
      dot: "bg-gray-500",
      ping: "bg-gray-600",
      border: "border-gray-800",
    },
  };

  function formatLastChecked(value: string | null): string {
    if (!value) return "Jamais";
    return new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  function currentStatus(trackerStatus: TrackerStatus) {
    if (selectedSite !== "all") {
      return trackerStatus.sites.find((s) => s.site_id === selectedSite) ?? null;
    }
    return trackerStatus.summary;
  }

  // Mini sparkline chart (pure CSS). Static class names so Tailwind doesn't purge them.
  function Sparkline({ values, color = "emerald", inverted = false }: { values: number[]; color?: "emerald" | "red"; inverted?: boolean }) {
    const clean = values.filter((v): v is number => Number.isFinite(v));
    if (clean.length < 2) return <span className="text-gray-600 text-xs">—</span>;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const barClass = color === "red" ? "bg-red-500/60" : "bg-emerald-500/60";

    return (
      <div className="flex items-end gap-[1px] h-8">
        {clean.slice(-30).map((v, i) => {
          const pct = inverted ? (1 - (v - min) / range) : (v - min) / range;
          return (
            <div
              key={i}
              className={`w-1.5 rounded-sm ${barClass}`}
              style={{ height: `${Math.max(8, pct * 100)}%` }}
            />
          );
        })}
      </div>
    );
  }

  // Simple bar chart
  function BarChart({ data: chartData, label }: { data: { date: string; value: number }[]; label: string }) {
    if (!Array.isArray(chartData) || chartData.length === 0) {
      return <div className="text-xs text-gray-600 py-6 text-center">{label}: pas de données</div>;
    }
    const max = Math.max(...chartData.map((d) => Number(d.value) || 0), 1);
    return (
      <div>
        <div className="text-xs text-gray-400 mb-2">{label}</div>
        <div className="flex items-end gap-[2px] h-24">
          {chartData.slice(-30).map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center group relative">
              <div
                className="w-full bg-blue-500/50 rounded-t-sm hover:bg-blue-400/70 transition-colors"
                style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
              />
              <div className="absolute -top-6 hidden group-hover:block bg-gray-800 text-xs text-white px-1.5 py-0.5 rounded whitespace-nowrap">
                {d.date.slice(5)}: {d.value}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>{chartData[Math.max(0, chartData.length - 30)]?.date.slice(5)}</span>
          <span>{chartData[chartData.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <BarChart3 className="w-5 h-5 text-blue-400" />
        <h1 className="text-xl font-semibold">Position Tracker</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            aria-label="Site suivi"
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
          >
            <option value="all">Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {selectedSite === "all" && (
            <span className="text-xs text-gray-500">Vue globale du statut VPS. Selectionner un site pour voir les courbes.</span>
          )}
        </div>

        {sitesError && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300" role="alert">
            {sitesError}
          </div>
        )}

        {statusError && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300" role="alert">
            {statusError}
          </div>
        )}

        {statusLoading && displayedStatus && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Actualisation du dernier statut confirmé...
          </div>
        )}

        {statusLoading && !displayedStatus ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Statut tracker...
          </div>
        ) : displayedStatus && currentStatus(displayedStatus) ? (
          (() => {
            const s = currentStatus(displayedStatus);
            if (!s) return null;
            const copy = FRESHNESS_COPY[s.level];
            return (
              <section className={`bg-gray-900 border ${copy.border} rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-4`}>
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${copy.ping}`} />
                    <span className={`relative inline-flex h-3 w-3 rounded-full ${copy.dot}`} />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-100">{copy.label}</div>
                    <div className="text-xs text-gray-500">
                      {copy.hint} Moteur {trackerEngineLabel(displayedStatus.engine)}, top {displayedStatus.limit_per_site} mots-cles/site.
                    </div>
                  </div>
                </div>

                <div className="md:ml-auto grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-gray-500">Couverture</div>
                    <div className="text-gray-100 font-semibold">{s.coverage_pct}%</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Cycle</div>
                    <div className="text-gray-100 font-semibold">{displayedStatus.cycle_days} jours</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Dernier check</div>
                    <div className="text-gray-100 font-semibold">{formatLastChecked(s.latest_checked_at)}</div>
                  </div>
                </div>
              </section>
            );
          })()
        ) : null}

        {dataError && selectedSite !== "all" && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300" role="alert">
            {dataError}
          </div>
        )}

        {loading && displayedData && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Actualisation du dernier historique confirmé...
          </div>
        )}

        {loading && !displayedData && selectedSite !== "all" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        )}

        {displayedData && (
          <>
            {/* Site-level charts */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <BarChart
                  data={displayedData.site_history.map((d) => ({ date: d.date, value: d.clicks }))}
                  label="Clics / jour (30 derniers jours)"
                />
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <BarChart
                  data={displayedData.site_history.map((d) => ({ date: d.date, value: d.impressions }))}
                  label="Impressions / jour (30 derniers jours)"
                />
              </div>
            </div>

            {/* Keywords position evolution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-medium text-gray-200 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Top 10 mots-clés — évolution position (90j)
                </h2>
              </div>
              {displayedData.keywords.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">Pas assez de données</div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {displayedData.keywords.map((kw) => {
                    const hist = kw.history;
                    const positions = hist.map((h) => h.position);
                    const first = positions[0];
                    const last = positions[positions.length - 1];
                    const delta = first && last ? first - last : 0; // positive = improvement

                    return (
                      <div key={kw.keyword} className="px-5 py-4 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{kw.keyword}</div>
                          <div className="text-xs text-gray-500">
                            {hist.length} points · pos {last?.toFixed(1) ?? "—"}
                          </div>
                        </div>
                        <div className="w-40">
                          <Sparkline values={positions} color={delta > 0 ? "emerald" : "red"} inverted />
                        </div>
                        <div className={`flex items-center gap-1 w-20 justify-end text-sm font-semibold ${
                          delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-gray-500"
                        }`}>
                          {delta > 0 ? <TrendingUp className="w-4 h-4" /> : delta < 0 ? <TrendingDown className="w-4 h-4" /> : null}
                          {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
