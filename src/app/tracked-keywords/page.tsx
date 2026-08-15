"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Filter, TrendingUp, BarChart3 } from "lucide-react";
import { Sparkline } from "@/components/Sparkline";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { isRecord, readApiJson } from "@/lib/api-response";

interface SiteRow {
  id: number;
  name: string;
  url: string;
}

interface KeywordRow {
  id: number;
  keyword: string;
  market: string | null;
  volume_fr: number | null;
  volume_ch: number | null;
  volume_market: number | null;
  current_position: number | null;
  current_impressions: number | null;
  current_clicks: number | null;
  latest_data_date: string | null;
  position_source: "gsc_query_level" | "not_observed";
  site_id: number;
  site_name: string;
  site_url: string;
}

interface TrackedKeywordsPayload {
  source: string;
  ranking_notice: string;
  generated_at: string;
  sites: SiteRow[];
  keywords: KeywordRow[];
}

type ApiNumber = number | string;

interface ApiTrackedKeywordsPayload {
  source: string;
  ranking_notice: string;
  generated_at: string;
  sites: Array<{ id: ApiNumber; name: string; url: string }>;
  keywords: Array<{
    id: ApiNumber;
    keyword: string;
    market: string | null;
    volume_fr: ApiNumber | null;
    volume_ch: ApiNumber | null;
    volume_market: ApiNumber | null;
    current_position: ApiNumber | null;
    current_impressions: ApiNumber | null;
    current_clicks: ApiNumber | null;
    latest_data_date: string | null;
    position_source: "gsc_query_level" | "not_observed";
    site_id: ApiNumber;
    site_name: string;
    site_url: string;
  }>;
}

interface KeywordTrendPayload {
  keyword: string;
  geo: string;
  cached: boolean;
  stale?: boolean;
  warning?: string;
  points: Array<{ value: ApiNumber }>;
}

function isApiNumber(value: unknown): value is ApiNumber {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function isNullableApiNumber(value: unknown): value is ApiNumber | null {
  return value === null || isApiNumber(value);
}

function isPositiveInteger(value: unknown): value is ApiNumber {
  return isApiNumber(value) && Number.isInteger(Number(value)) && Number(value) > 0;
}

function isApiTrackedKeywordsPayload(value: unknown): value is ApiTrackedKeywordsPayload {
  if (!isRecord(value)
    || typeof value.source !== "string"
    || typeof value.ranking_notice !== "string"
    || typeof value.generated_at !== "string"
    || Number.isNaN(Date.parse(value.generated_at))
    || !Array.isArray(value.sites)
    || !Array.isArray(value.keywords)) {
    return false;
  }

  const validSites = value.sites.every((site) =>
    isRecord(site)
    && isPositiveInteger(site.id)
    && typeof site.name === "string"
    && typeof site.url === "string"
  );
  const validKeywords = value.keywords.every((row) =>
    isRecord(row)
    && isPositiveInteger(row.id)
    && typeof row.keyword === "string"
    && row.keyword.trim().length > 0
    && (row.market === null || typeof row.market === "string")
    && isNullableApiNumber(row.volume_fr)
    && isNullableApiNumber(row.volume_ch)
    && isNullableApiNumber(row.volume_market)
    && isNullableApiNumber(row.current_position)
    && isNullableApiNumber(row.current_impressions)
    && isNullableApiNumber(row.current_clicks)
    && (row.latest_data_date === null || typeof row.latest_data_date === "string")
    && (row.position_source === "gsc_query_level" || row.position_source === "not_observed")
    && isPositiveInteger(row.site_id)
    && typeof row.site_name === "string"
    && typeof row.site_url === "string"
  );
  return validSites && validKeywords;
}

function normalizeTrackedKeywordsPayload(payload: ApiTrackedKeywordsPayload): TrackedKeywordsPayload {
  return {
    source: payload.source,
    ranking_notice: payload.ranking_notice,
    generated_at: payload.generated_at,
    sites: payload.sites.map((site) => ({ ...site, id: Number(site.id) })),
    keywords: payload.keywords.map((row) => ({
      ...row,
      id: Number(row.id),
      site_id: Number(row.site_id),
      volume_fr: toNumberOrNull(row.volume_fr),
      volume_ch: toNumberOrNull(row.volume_ch),
      volume_market: toNumberOrNull(row.volume_market),
      current_position: toNumberOrNull(row.current_position),
      current_impressions: toNumberOrNull(row.current_impressions),
      current_clicks: toNumberOrNull(row.current_clicks),
    })),
  };
}

function isKeywordTrendPayload(value: unknown): value is KeywordTrendPayload {
  return isRecord(value)
    && typeof value.keyword === "string"
    && typeof value.geo === "string"
    && typeof value.cached === "boolean"
    && (value.stale === undefined || typeof value.stale === "boolean")
    && (value.warning === undefined || typeof value.warning === "string")
    && Array.isArray(value.points)
    && value.points.every((point) =>
      isRecord(point)
      && isApiNumber(point.value)
      && Number(point.value) >= 0
      && Number(point.value) <= 100
    );
}

function visibleRequestError(error: unknown, action: string): string {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return `${action} a dépassé le délai autorisé. Réessaie.`;
  }
  return error instanceof Error
    ? `${action} : ${error.message}`
    : `${action} a échoué. Réessaie.`;
}

function positionColor(pos: number | null): string {
  if (pos === null) return "text-gray-500";
  if (pos <= 3) return "text-green-400 font-bold";
  if (pos <= 10) return "text-yellow-400";
  if (pos <= 20) return "text-orange-400";
  return "text-red-400";
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("fr-FR");
}

function keywordVolume(row: KeywordRow): number | null {
  return row.volume_market ?? row.volume_ch ?? row.volume_fr;
}

function dataQueryKey(siteId: string, minVol: number, onlyQuickWins: boolean): string {
  return `${siteId}::${minVol}::${onlyQuickWins ? "1" : "0"}`;
}

function marketBadge(mkt: string | null): string {
  const map: Record<string, string> = {
    FR: "bg-blue-900 text-blue-200",
    CH: "bg-red-900 text-red-200",
    BE: "bg-yellow-900 text-yellow-200",
    CA: "bg-purple-900 text-purple-200",
    DE: "bg-gray-700 text-gray-200",
    IT: "bg-green-900 text-green-200",
  };
  return map[mkt || ""] || "bg-gray-700 text-gray-300";
}

export default function TrackedKeywordsPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteId, setSiteId] = useState<string>("all");
  const [minVol, setMinVol] = useState<number>(0);
  const [onlyQuickWins, setOnlyQuickWins] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dataMeta, setDataMeta] = useState<Pick<TrackedKeywordsPayload, "source" | "ranking_notice" | "generated_at"> | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [trendsByKw, setTrendsByKw] = useState<Record<string, number[] | "loading" | "failed">>({});
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const loadRequestId = useRef(0);

  async function loadTrends(): Promise<void> {
    const visible = displayedKeywords.slice(0, 50);
    if (visible.length === 0) {
      setTrendsError("Aucun mot-clé chargé ne permet de demander une tendance.");
      return;
    }
    const sourceLoadId = loadRequestId.current;
    setTrendsLoading(true);
    setTrendsError(null);
    setTrendsByKw((prev) => {
      const next = { ...prev };
      for (const k of visible) {
        const key = `${k.site_id}::${k.keyword.toLowerCase()}`;
        if (!next[key]) next[key] = "loading";
      }
      return next;
    });
    const failures: string[] = [];
    const warnings: string[] = [];
    for (const k of visible) {
      if (loadRequestId.current !== sourceLoadId) return;
      const key = `${k.site_id}::${k.keyword.toLowerCase()}`;
      try {
        const geo = k.market || "";
        const response = await fetch(
          `/api/keyword-trends?keyword=${encodeURIComponent(k.keyword)}&geo=${encodeURIComponent(geo)}&site_id=${k.site_id}`,
          { signal: AbortSignal.timeout(30_000) },
        );
        const payload = await readApiJson(
          response,
          isKeywordTrendPayload,
          `La tendance de « ${k.keyword} » est indisponible`,
        );
        if (loadRequestId.current !== sourceLoadId) return;
        if (payload.keyword.trim().toLowerCase() !== k.keyword.trim().toLowerCase()
          || payload.geo.trim().toUpperCase() !== geo.trim().toUpperCase()) {
          throw new Error("la réponse ne correspond pas au mot-clé ou au marché demandé");
        }
        const values = payload.points.map((point) => Number(point.value));
        if (values.length < 2) {
          throw new Error("la série contient moins de deux points valides");
        }
        if (payload.stale || payload.warning) {
          warnings.push(payload.warning || `La tendance de « ${k.keyword} » provient du dernier relevé disponible.`);
        }
        setTrendsByKw((prev) => ({ ...prev, [key]: values }));
      } catch (caught) {
        if (loadRequestId.current !== sourceLoadId) return;
        failures.push(visibleRequestError(caught, `La tendance de « ${k.keyword} »`));
        setTrendsByKw((prev) => ({
          ...prev,
          [key]: Array.isArray(prev[key]) ? prev[key] : "failed",
        }));
      }
    }
    if (loadRequestId.current !== sourceLoadId) return;
    const notices: string[] = [];
    if (failures.length > 0) notices.push(`${failures.length} tendance${failures.length > 1 ? "s" : ""} sur ${visible.length} n’ont pas pu être actualisées. ${failures[0]}`);
    if (warnings.length > 0) notices.push(`${warnings.length} série${warnings.length > 1 ? "s" : ""} utilise${warnings.length > 1 ? "nt" : ""} un relevé antérieur. ${warnings[0]}`);
    setTrendsError(notices.length > 0 ? notices.join(" ") : null);
    setTrendsLoading(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      loadRequestId.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, minVol, onlyQuickWins]);

  async function load(signal?: AbortSignal): Promise<void> {
    const requestId = ++loadRequestId.current;
    const requestedQueryKey = dataQueryKey(siteId, minVol, onlyQuickWins);
    const hasConfirmedData = loadedQueryKey === requestedQueryKey;
    setLoading(true);
    setError(null);
    setTrendsLoading(false);
    setTrendsError(null);
    try {
      const params = new URLSearchParams({
        siteId,
        minVol: String(minVol),
        quickWins: onlyQuickWins ? "1" : "0",
      });
      const response = await fetch(`/api/tracked-keywords?${params}`, { signal });
      const rawPayload = await readApiJson(
        response,
        isApiTrackedKeywordsPayload,
        "Le chargement des mots-clés suivis a échoué",
      );
      if (signal?.aborted || requestId !== loadRequestId.current) return;
      const payload = normalizeTrackedKeywordsPayload(rawPayload);
      setSites(payload.sites);
      setKeywords(payload.keywords);
      setLoadedQueryKey(requestedQueryKey);
      setDataMeta({
        source: payload.source,
        ranking_notice: payload.ranking_notice,
        generated_at: payload.generated_at,
      });
    } catch (caught) {
      if (signal?.aborted || requestId !== loadRequestId.current) return;
      const message = visibleRequestError(caught, "Le chargement des mots-clés suivis");
      setError(hasConfirmedData ? `${message} Les dernières données confirmées restent affichées.` : message);
    } finally {
      if (!signal?.aborted && requestId === loadRequestId.current) setLoading(false);
    }
  }

  const currentQueryKey = dataQueryKey(siteId, minVol, onlyQuickWins);
  const hasCurrentData = loadedQueryKey === currentQueryKey;
  const displayedKeywords = useMemo(
    () => (hasCurrentData ? keywords : []),
    [hasCurrentData, keywords],
  );
  const displayedDataMeta = hasCurrentData ? dataMeta : null;

  const totals = useMemo(() => {
    const sumKnown = (values: Array<number | null>) => values.reduce(
      (total, value) => value === null
        ? total
        : { value: total.value + value, known: total.known + 1 },
      { value: 0, known: 0 },
    );
    return {
      volume: sumKnown(displayedKeywords.map(keywordVolume)),
      clicks: sumKnown(displayedKeywords.map((keyword) => keyword.current_clicks)),
      impressions: sumKnown(displayedKeywords.map((keyword) => keyword.current_impressions)),
    };
  }, [displayedKeywords]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/dashboard" className="min-h-11 text-sm text-gray-400 hover:text-white inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-6 h-6" aria-hidden="true" /> Mots-clés suivis — volumes et positions
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Positions et performances observées dans GSC, avec les volumes Keyword Planner importés par marché.
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-900 rounded-lg p-4 mb-4 flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-gray-400" aria-hidden="true" />
          <select
            aria-label="Filtrer les mots-clés suivis par site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="min-h-11 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="all">Tous les sites ({sites.length})</option>
            {sites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>

          <label htmlFor="tracked-min-volume" className="min-h-11 text-sm flex items-center gap-2">
            Volume minimum :
            <input
              id="tracked-min-volume"
              type="number"
              value={minVol}
              onChange={(e) => setMinVol(parseInt(e.target.value || "0", 10))}
              className="min-h-11 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm w-24"
              min={0}
            />
          </label>

          <label className="min-h-11 text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyQuickWins}
              onChange={(e) => setOnlyQuickWins(e.target.checked)}
              className="h-5 w-5 accent-green-500"
            />
            Opportunités rapides uniquement (positions 4 à 15, volume &gt; 100)
          </label>

          <button
            type="button"
            onClick={() => void loadTrends()}
            disabled={trendsLoading || loading || displayedKeywords.length === 0}
            aria-busy={trendsLoading}
            className="min-h-11 text-xs px-3 py-1 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-1"
            title="Charger les tendances Google sur 12 mois pour les 50 premières lignes"
          >
            {trendsLoading ? (
              <><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Chargement des tendances…</>
            ) : (
              <><BarChart3 className="w-3 h-3" aria-hidden="true" /> Charger les tendances</>
            )}
          </button>

          <div className="ml-auto text-xs text-gray-400">
            {loading && !hasCurrentData ? (
              <span role="status">Chargement des données…</span>
            ) : (
              <>
                <span className="mr-3">{displayedKeywords.length} mots-clés</span>
                <span className="mr-3">Volume connu : {totals.volume.known > 0 ? totals.volume.value.toLocaleString("fr-FR") : "—"}</span>
                <span className="mr-3">Impressions GSC connues : {totals.impressions.known > 0 ? totals.impressions.value.toLocaleString("fr-FR") : "—"}</span>
                <span>Clics GSC connus : {totals.clicks.known > 0 ? totals.clicks.value.toLocaleString("fr-FR") : "—"}</span>
              </>
            )}
          </div>
        </div>

        {loading && hasCurrentData && (
          <div className="bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-200 mb-4" role="status" aria-live="polite">
            Actualisation en cours. Les dernières données confirmées restent affichées.
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300 mb-4 flex flex-wrap items-center justify-between gap-3" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="min-h-11 rounded border border-red-700 px-3 py-2 font-medium hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Réessayer
            </button>
          </div>
        )}

        {trendsError && (
          <div className="bg-amber-900/20 border border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-200 mb-4" role="alert">
            {trendsError}
          </div>
        )}

        {displayedDataMeta && (
          <div className="bg-cyan-900/20 border border-cyan-800 rounded-lg px-4 py-3 text-xs text-cyan-100 mb-4">
            {displayedDataMeta.ranking_notice} Source : {displayedDataMeta.source}. Réponse générée le{" "}
            {new Date(displayedDataMeta.generated_at).toLocaleString("fr-FR")}.
          </div>
        )}

        {/* Table */}
        {loading && !hasCurrentData ? (
          <div className="flex items-center justify-center gap-3 py-20 text-gray-400" role="status" aria-live="polite">
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" /> Chargement des mots-clés suivis…
          </div>
        ) : !hasCurrentData && error ? null : displayedKeywords.length === 0 ? (
          <div className="bg-gray-900 rounded-lg p-8 text-center text-gray-400" role="status">
            Aucun mot-clé suivi ne correspond à ces filtres.
          </div>
        ) : (
          <div className="bg-gray-900 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Site</th>
                  <th className="px-2 py-3 text-center">Marché</th>
                  <th className="px-4 py-3 text-left">
                    <span className="inline-flex items-center gap-2">
                      Mot-clé
                      <CopyKeywordsButton className="h-11 w-11" keywords={displayedKeywords.map((k) => k.keyword)} />
                    </span>
                  </th>
                  <th className="px-3 py-3 text-right">Position</th>
                  <th className="px-3 py-3 text-right">Impressions</th>
                  <th className="px-3 py-3 text-right">Clics</th>
                  <th className="px-3 py-3 text-right">Vol. FR</th>
                  <th className="px-3 py-3 text-right">Vol. CH</th>
                  <th className="px-3 py-3 text-right">Vol. marché</th>
                  <th className="px-3 py-3 text-left">Tendance 12 mois</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {displayedKeywords.map((k) => (
                  <tr key={k.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-xs text-gray-300">{k.site_name}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${marketBadge(k.market)}`}>
                        {k.market || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-100">{k.keyword}</td>
                    <td className={`px-3 py-2 text-right ${positionColor(toNumberOrNull(k.current_position))}`}>
                      {k.current_position !== null ? k.current_position.toFixed(1) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-400">{formatNumber(k.current_impressions)}</td>
                    <td className="px-3 py-2 text-right text-gray-200">{formatNumber(k.current_clicks)}</td>
                    <td className="px-3 py-2 text-right text-gray-400">
                      {formatNumber(k.volume_fr)}
                    </td>
                    <td className="px-3 py-2 text-right text-red-300">
                      {formatNumber(k.volume_ch)}
                    </td>
                    <td className="px-3 py-2 text-right text-yellow-300 font-medium">
                      {formatNumber(keywordVolume(k))}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const key = `${k.site_id}::${k.keyword.toLowerCase()}`;
                        const t = trendsByKw[key];
                        if (t === "loading") return <span className="text-xs text-gray-500">Chargement…</span>;
                        if (t === "failed" || t === undefined)
                          return <span className="text-xs text-gray-600">{t === "failed" ? "Indisponible" : "Non chargée"}</span>;
                        return <Sparkline values={t} color="blue" />;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
