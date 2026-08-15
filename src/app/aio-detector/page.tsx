"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, Sparkles, RefreshCw } from "lucide-react";

interface Site { id: number; name: string }
interface AIORow {
  query: string;
  page: string;
  position: number;
  site_id: number | null;
  site_name: string | null;
  impressions: number;
  clicks: number;
  ctr_actual_pct: number;
  ctr_expected_pct: number;
  ctr_ratio: number;
  missed_clicks: number;
  aio_likely: boolean;
  confidence?: "probable" | "watch";
  recommendation: string;
}

interface AIOSummary {
  site_id: number;
  site_name: string | null;
  candidates: number;
  probable: number;
  watch: number;
  missed_clicks: number;
  checked?: boolean;
}

interface AIOResponse {
  success?: boolean;
  rows?: AIORow[];
  summary?: AIOSummary[];
  coverage?: AIOSummary[];
  scanned?: number;
  sites_scanned?: number;
  sites_with_signals?: number;
  error?: string;
}

type SiteFilter = number | "all";

interface ParsedAIOResponse {
  rows: AIORow[];
  summary: AIOSummary[];
  coverage: AIOSummary[];
  scanned: number;
  sitesScanned: number;
  sitesWithSignals: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSite(value: unknown): value is Site {
  return isRecord(value)
    && isFiniteNumber(value.id)
    && typeof value.name === "string"
    && value.name.trim().length > 0;
}

function isAIORow(value: unknown): value is AIORow {
  if (!isRecord(value)) return false;
  const validSiteId = value.site_id === null || isFiniteNumber(value.site_id);
  const validSiteName = value.site_name === null || typeof value.site_name === "string";
  const validConfidence = value.confidence === undefined
    || value.confidence === "probable"
    || value.confidence === "watch";

  return typeof value.query === "string"
    && typeof value.page === "string"
    && validSiteId
    && validSiteName
    && isFiniteNumber(value.position)
    && isFiniteNumber(value.impressions)
    && isFiniteNumber(value.clicks)
    && isFiniteNumber(value.ctr_actual_pct)
    && isFiniteNumber(value.ctr_expected_pct)
    && isFiniteNumber(value.ctr_ratio)
    && isFiniteNumber(value.missed_clicks)
    && typeof value.aio_likely === "boolean"
    && validConfidence
    && typeof value.recommendation === "string";
}

function isAIOSummary(value: unknown): value is AIOSummary {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.site_id)
    && (value.site_name === null || typeof value.site_name === "string")
    && isFiniteNumber(value.candidates)
    && isFiniteNumber(value.probable)
    && isFiniteNumber(value.watch)
    && isFiniteNumber(value.missed_clicks)
    && (value.checked === undefined || typeof value.checked === "boolean");
}

function optionalCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function parseAIOResponse(value: unknown): ParsedAIOResponse | null {
  if (Array.isArray(value)) {
    if (!value.every(isAIORow)) return null;
    return {
      rows: value,
      summary: [],
      coverage: [],
      scanned: value.length,
      sitesScanned: 0,
      sitesWithSignals: 0,
    };
  }
  if (!isRecord(value)) return null;
  const response = value as AIOResponse;
  if (!Array.isArray(response.rows) || !response.rows.every(isAIORow)) return null;
  if (!Array.isArray(response.summary) || !response.summary.every(isAIOSummary)) return null;
  if (response.coverage !== undefined && (!Array.isArray(response.coverage) || !response.coverage.every(isAIOSummary))) return null;

  const scanned = optionalCount(response.scanned);
  const sitesScanned = optionalCount(response.sites_scanned);
  const sitesWithSignals = optionalCount(response.sites_with_signals);
  if (scanned === null || sitesScanned === null || sitesWithSignals === null) return null;

  return {
    rows: response.rows,
    summary: response.summary,
    coverage: response.coverage ?? response.summary,
    scanned,
    sitesScanned,
    sitesWithSignals: response.sites_with_signals === undefined ? response.summary.length : sitesWithSignals,
  };
}

function apiError(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (typeof value.message === "string" && value.message.trim()) return value.message;
  return fallback;
}

export default function AIODetectorPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<SiteFilter>("all");
  const [days, setDays] = useState<28 | 90>(28);
  const [rows, setRows] = useState<AIORow[]>([]);
  const [summary, setSummary] = useState<AIOSummary[]>([]);
  const [coverage, setCoverage] = useState<AIOSummary[]>([]);
  const [scanned, setScanned] = useState(0);
  const [sitesScanned, setSitesScanned] = useState(0);
  const [sitesWithSignals, setSitesWithSignals] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const scanRequestId = useRef(0);

  useEffect(() => {
    fetch("/api/sites")
      .then(async (response) => {
        const data = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          throw new Error(apiError(data, `Liste des sites indisponible (HTTP ${response.status})`));
        }
        if (!Array.isArray(data) || !data.every(isSite)) {
          throw new Error("La liste des sites reçue est invalide.");
        }
        setSites(data);
        setSitesError(null);
      })
      .catch((reason) => setSitesError(reason instanceof Error ? reason.message : "Liste des sites indisponible"));
  }, []);

  async function runScan(nextSiteId: SiteFilter = siteId, nextDays: 28 | 90 = days) {
    const requestId = ++scanRequestId.current;
    const nextResultKey = `${nextSiteId}:${nextDays}`;
    setLoading(true);
    setError(null);
    const limit = nextSiteId === "all" ? 500 : 150;
    try {
      const res = await fetch(`/api/aio-detector?siteId=${nextSiteId}&days=${nextDays}&limit=${limit}&include_watch=1`);
      const data = await res.json().catch(() => null) as unknown;
      if (requestId !== scanRequestId.current) return;
      if (!res.ok) {
        throw new Error(apiError(data, `Analyse AIO impossible (HTTP ${res.status})`));
      }
      if (isRecord(data) && (data.success === false || typeof data.error === "string")) {
        throw new Error(apiError(data, "L'analyse AIO a échoué."));
      }
      const parsed = parseAIOResponse(data);
      if (!parsed) throw new Error("La réponse AIO reçue est incomplète ou invalide.");

      setRows(parsed.rows);
      setSummary(parsed.summary);
      setCoverage(parsed.coverage);
      setScanned(parsed.scanned);
      setSitesScanned(parsed.sitesScanned);
      setSitesWithSignals(parsed.sitesWithSignals);
      setResultKey(nextResultKey);
    } catch (err) {
      if (requestId !== scanRequestId.current) return;
      setError(err instanceof Error ? err.message : "Erreur réseau pendant l'analyse AIO.");
    } finally {
      if (requestId === scanRequestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void runScan(siteId, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const totalMissed = rows.reduce((sum, row) => sum + Math.max(0, Number(row.missed_clicks) || 0), 0);
  const probableCount = rows.filter((row) => row.confidence === "probable" || row.aio_likely).length;
  const visibleCoverage = coverage.length > 0 ? coverage : summary;
  const zeroSignalCount = Math.max(0, (sitesScanned || sites.length) - sitesWithSignals);
  const hasCurrentResult = resultKey === `${siteId}:${days}`;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <Sparkles className="w-6 h-6 text-cyan-400 shrink-0" />
          <h1 className="text-xl font-bold whitespace-nowrap">Signaux AIO</h1>
          <span className="text-xs text-gray-500 truncate">heuristique CTR sur les requêtes GSC en top 10</span>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Période d'analyse"
            value={days}
            onChange={(e) => {
              const next = Number(e.target.value) as 28 | 90;
              setDays(next);
              void runScan(siteId, next);
            }}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm"
          >
            <option value={28}>28j</option>
            <option value={90}>90j</option>
          </select>
          <select
            aria-label="Site à analyser"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm min-w-56"
          >
            <option value="all">Tous les sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Analyser
          </button>
        </div>
      </header>

      <div className="px-6 py-3 mx-6 mt-4 bg-cyan-900/20 border border-cyan-700/40 rounded-lg text-xs text-cyan-200">
        <strong>Méthode heuristique, sans observation de la SERP.</strong> Un CTR bas en top 10 peut venir d&apos;un aperçu IA, mais aussi du snippet, de l&apos;intention ou des fonctionnalités de résultats. Ces lignes sont des candidats à vérifier, pas des AIO confirmés.
      </div>
      {sitesError && <div role="alert" className="mx-6 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{sitesError} Le scan global reste disponible.</div>}
      {error && (
        <div role="alert" className="mx-6 mt-3 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          {error}{hasCurrentResult ? " Le dernier résultat valide reste affiché." : ""}
        </div>
      )}

      <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Signaux AIO / CTR bas</div>
          <div className="text-2xl font-bold text-cyan-400">{hasCurrentResult ? rows.length : "—"}</div>
          <div className="text-[11px] text-gray-500">
            {hasCurrentResult
              ? `${siteId === "all" ? `${sitesScanned || sites.length} sites contrôlés - ` : ""}${scanned} requêtes top 10 contrôlées`
              : loading ? "Analyse en cours" : "Aucune analyse valide pour ce filtre"}
          </div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Clics potentiels estimés ({days}j)</div>
          <div className="text-2xl font-bold text-amber-300">{hasCurrentResult ? totalMissed.toLocaleString() : "—"}</div>
          <div className="text-[11px] text-gray-500">écart à une courbe CTR théorique, non mesuré</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Signaux forts</div>
          <div className="text-2xl font-bold text-red-500">{hasCurrentResult ? probableCount : "—"}</div>
          {hasCurrentResult && siteId === "all" && (
            <div className="text-[11px] text-gray-500">{sitesWithSignals} sites avec signal - {zeroSignalCount} sans signal</div>
          )}
        </div>
      </div>

      <div className="px-6 pb-10">
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-500" /> Analyse AIO en cours...
          </div>
        ) : !hasCurrentResult ? null : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            Analyse terminée : aucun signal AIO détecté sur {days}j. {scanned > 0 ? `${scanned} requêtes top 10 ont été contrôlées.` : "Aucune requête top 10 suffisante n'a pu être contrôlée."}
          </div>
        ) : (
          <div className="space-y-4">
            {siteId === "all" && summary.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="text-sm font-semibold text-gray-200 mb-3">Sites les plus impactes</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {summary.slice(0, 9).map((item) => (
                    <button
                      key={item.site_id}
                      type="button"
                      onClick={() => setSiteId(item.site_id)}
                      className="text-left rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 hover:border-cyan-700"
                    >
                      <div className="text-sm text-cyan-300">{item.site_name ?? `Site ${item.site_id}`}</div>
                      <div className="text-xs text-gray-400">
                        {item.probable} probables · {item.watch} a verifier · -{item.missed_clicks.toLocaleString()} clics
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {siteId === "all" && visibleCoverage.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="text-sm font-semibold text-gray-200">Controle portfolio complet</div>
                  <div className="text-xs text-gray-500">
                    {sitesWithSignals} avec signal / {zeroSignalCount} sans signal
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  {visibleCoverage.slice(0, 40).map((item) => {
                    const hasSignal = (item.probable + item.watch) > 0;
                    return (
                      <button
                        key={item.site_id}
                        type="button"
                        onClick={() => setSiteId(item.site_id)}
                        className={`text-left rounded-lg border px-3 py-2 hover:border-cyan-700 ${
                          hasSignal ? "border-cyan-800 bg-cyan-950/20" : "border-gray-800 bg-gray-950"
                        }`}
                      >
                        <div className={hasSignal ? "text-sm text-cyan-300" : "text-sm text-gray-300"}>
                          {item.site_name ?? `Site ${item.site_id}`}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.candidates} requetes controlees - {hasSignal ? `${item.probable + item.watch} signaux` : "0 signal"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/50 text-gray-400 text-xs">
                  <tr>
                    <th className="text-left py-3 px-5">Query</th>
                    {siteId === "all" && <th className="text-left py-3 px-3">Site</th>}
                    <th className="text-right py-3 px-3">Pos</th>
                    <th className="text-right py-3 px-3">CTR actuel</th>
                    <th className="text-right py-3 px-3">CTR attendu</th>
                    <th className="text-right py-3 px-3">Ratio</th>
                    <th className="text-right py-3 px-3">Manques</th>
                    <th className="text-left py-3 px-3">Niveau</th>
                    <th className="text-left py-3 px-5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.site_id ?? "site"}-${row.query}-${index}`} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-2 px-5 font-medium">
                        <a href={row.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                          {row.query}
                        </a>
                      </td>
                      {siteId === "all" && (
                        <td className="py-2 px-3">
                          {row.site_name && row.site_id
                            ? <button type="button" onClick={() => setSiteId(row.site_id!)} className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50">{row.site_name}</button>
                            : <span className="text-gray-500 text-xs">-</span>
                          }
                        </td>
                      )}
                      <td className="text-right py-2 px-3 text-green-400">{row.position}</td>
                      <td className="text-right py-2 px-3 text-red-400">{row.ctr_actual_pct}%</td>
                      <td className="text-right py-2 px-3 text-gray-400">{row.ctr_expected_pct}%</td>
                      <td className="text-right py-2 px-3 font-bold text-cyan-400">{row.ctr_ratio}</td>
                      <td className="text-right py-2 px-3 text-orange-400 font-bold">-{row.missed_clicks}</td>
                      <td className="py-2 px-3">
                        <span className={`rounded px-2 py-0.5 text-xs ${row.confidence === "probable" || row.aio_likely ? "bg-red-900/40 text-red-300" : "bg-yellow-900/40 text-yellow-300"}`}>
                          {row.confidence === "probable" || row.aio_likely ? "probable" : "a verifier"}
                        </span>
                      </td>
                      <td className="py-2 px-5 text-xs">{row.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
