"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, Globe, CheckCircle, Minus, ExternalLink } from "lucide-react";
import Link from "next/link";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { formatFixed } from "@/lib/safe-number";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface RoiArticle {
  id: number;
  keyword: string;
  language: string;
  created_at: string;
  before: GscWindow;
  after_7d: GscWindow;
  after_30d: GscWindow;
  improvement: number;
}

interface GscWindow {
  position: number | null;
  clicks: number;
  impressions: number;
}

interface IndexArticle {
  id: number;
  keyword: string;
  language: string;
  url: string;
  status_code: number | null;
  gsc_impressions: number;
  gsc_last_seen: string | null;
  indexed: boolean;
}

interface AutopilotRun {
  id: number;
  status: string;
}

type UnknownRecord = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 60_000;
const PUBLISHED_STATUSES = new Set(["published", "published_pending_live", "verified_live"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getApiError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  for (const key of ["error", "message", "detail"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

async function fetchJson(
  input: string,
  label: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${label}: réponse JSON illisible (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(`${label}: ${getApiError(payload, `échec HTTP ${response.status}`)}.`);
    }

    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${label}: délai dépassé après ${Math.round(timeoutMs / 1000)} secondes.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function requireSuccessfulPayload(payload: unknown, label: string): UnknownRecord {
  if (!isRecord(payload)) {
    throw new Error(`${label}: format de réponse invalide.`);
  }
  if (payload.success !== true) {
    throw new Error(`${label}: ${getApiError(payload, "succès API non confirmé")}.`);
  }
  return payload;
}

function parseSites(payload: unknown): Site[] {
  if (!Array.isArray(payload)) {
    throw new Error("Chargement des sites: la liste attendue est absente.");
  }

  return payload.map((item, index) => {
    if (
      !isRecord(item)
      || !isFiniteNumber(item.id)
      || typeof item.name !== "string"
      || typeof item.url !== "string"
    ) {
      throw new Error(`Chargement des sites: entrée ${index + 1} invalide.`);
    }
    return { id: item.id, name: item.name, url: item.url };
  });
}

function parseGscWindow(value: unknown, label: string): GscWindow {
  if (!isRecord(value)) throw new Error(`${label}: fenêtre GSC invalide.`);
  const position = value.position;
  if (position !== null && !isFiniteNumber(position)) {
    throw new Error(`${label}: position GSC invalide.`);
  }
  if (!isFiniteNumber(value.clicks) || !isFiniteNumber(value.impressions)) {
    throw new Error(`${label}: clics ou impressions GSC invalides.`);
  }
  return { position, clicks: value.clicks, impressions: value.impressions };
}

function parseRoiArticles(payload: unknown): RoiArticle[] {
  const root = requireSuccessfulPayload(payload, "Chargement du suivi GSC");
  if (!Array.isArray(root.articles)) {
    throw new Error("Chargement du suivi GSC: tableau articles absent.");
  }

  return root.articles.map((item, index) => {
    const label = `Article ROI ${index + 1}`;
    if (
      !isRecord(item)
      || !isFiniteNumber(item.id)
      || typeof item.keyword !== "string"
      || typeof item.language !== "string"
      || typeof item.created_at !== "string"
      || !isFiniteNumber(item.improvement)
    ) {
      throw new Error(`${label}: contrat invalide.`);
    }
    return {
      id: item.id,
      keyword: item.keyword,
      language: item.language,
      created_at: item.created_at,
      before: parseGscWindow(item.before, label),
      after_7d: parseGscWindow(item.after_7d, label),
      after_30d: parseGscWindow(item.after_30d, label),
      improvement: item.improvement,
    };
  });
}

function parseIndexationArticles(payload: unknown): IndexArticle[] {
  const root = requireSuccessfulPayload(payload, "Chargement des preuves live/indexation");
  if (!Array.isArray(root.articles)) {
    throw new Error("Chargement des preuves live/indexation: tableau articles absent.");
  }

  return root.articles.map((item, index) => {
    if (
      !isRecord(item)
      || !isFiniteNumber(item.id)
      || typeof item.keyword !== "string"
      || typeof item.language !== "string"
      || typeof item.url !== "string"
      || (item.status_code !== null && !isFiniteNumber(item.status_code))
      || !isFiniteNumber(item.gsc_impressions)
      || (item.gsc_last_seen !== null && typeof item.gsc_last_seen !== "string")
      || typeof item.indexed !== "boolean"
      || item.indexed !== (item.gsc_impressions > 0)
    ) {
      throw new Error(`Preuve live/indexation ${index + 1}: contrat invalide.`);
    }
    return {
      id: item.id,
      keyword: item.keyword,
      language: item.language,
      url: item.url,
      status_code: item.status_code,
      gsc_impressions: item.gsc_impressions,
      gsc_last_seen: item.gsc_last_seen,
      indexed: item.indexed,
    };
  });
}

function parsePublicationRuns(payload: unknown): AutopilotRun[] {
  const root = requireSuccessfulPayload(payload, "Chargement des états de publication");
  if (!Array.isArray(root.runs)) {
    throw new Error("Chargement des états de publication: tableau runs absent.");
  }
  return root.runs.map((item, index) => {
    if (!isRecord(item) || !isFiniteNumber(item.id) || typeof item.status !== "string") {
      throw new Error(`État de publication ${index + 1}: contrat invalide.`);
    }
    return { id: item.id, status: item.status };
  });
}

function actionableError(error: unknown, action: string): string {
  const message = error instanceof Error ? error.message : "Erreur inconnue.";
  return `${message} ${action} Les dernières données confirmées sont conservées.`;
}

function isWindowComplete(createdAt: string, days: number): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && Date.now() >= created + days * 86_400_000;
}

function measuredImprovement(article: RoiArticle): number | null {
  if (!isWindowComplete(article.created_at, 30)) return null;
  if (
    article.before.position === null
    || article.after_30d.position === null
    || article.before.position <= 0
    || article.after_30d.position <= 0
  ) return null;
  return article.improvement;
}

function publicationLabel(status: string | undefined): string {
  if (status === "verified_live") return "Live vérifié";
  if (status === "published_pending_live") return "Publié, live à vérifier";
  if (status === "published") return "Publié (live non attesté)";
  return "État non confirmé";
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 border-b border-amber-800/50 bg-amber-950/30 px-5 py-3 text-sm text-amber-100">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 rounded border border-amber-700 px-3 py-1 text-xs hover:bg-amber-900/50">
        Réessayer
      </button>
    </div>
  );
}

const LANG_FLAG: Record<string, string> = {
  fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹",
};

export default function RoiPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [roi, setRoi] = useState<RoiArticle[]>([]);
  const [roiSiteId, setRoiSiteId] = useState<number | null>(null);
  const [indexation, setIndexation] = useState<IndexArticle[]>([]);
  const [indexationSiteId, setIndexationSiteId] = useState<number | null>(null);
  const [publicationRuns, setPublicationRuns] = useState<AutopilotRun[]>([]);
  const [publicationSiteId, setPublicationSiteId] = useState<number | null>(null);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loadingRoi, setLoadingRoi] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState(false);
  const [loadingPublication, setLoadingPublication] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [roiError, setRoiError] = useState<string | null>(null);
  const [indexationError, setIndexationError] = useState<string | null>(null);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const sitesRequest = useRef(0);
  const roiRequest = useRef(0);
  const indexationRequest = useRef(0);
  const publicationRequest = useRef(0);

  async function fetchSites() {
    const requestId = ++sitesRequest.current;
    setLoadingSites(true);
    setSitesError(null);
    try {
      const payload = await fetchJson("/api/sites", "Chargement des sites");
      const list = parseSites(payload);
      if (requestId !== sitesRequest.current) return;
      setSites(list);
      setSelectedSite((current) => {
        if (current !== null && list.some((site) => site.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch (error) {
      if (requestId !== sitesRequest.current) return;
      setSitesError(actionableError(error, "Réessaie; si nécessaire, reconnecte-toi au dashboard."));
    } finally {
      if (requestId === sitesRequest.current) setLoadingSites(false);
    }
  }

  async function fetchRoi(siteId: number) {
    const requestId = ++roiRequest.current;
    setLoadingRoi(true);
    setRoiError(null);
    try {
      const payload = await fetchJson(
        `/api/autopilot/roi?site_id=${siteId}`,
        "Chargement du suivi GSC",
      );
      const articles = parseRoiArticles(payload);
      if (requestId !== roiRequest.current) return;
      setRoi(articles);
      setRoiSiteId(siteId);
    } catch (error) {
      if (requestId !== roiRequest.current) return;
      setRoiError(actionableError(error, "Relance l’actualisation du suivi GSC."));
    } finally {
      if (requestId === roiRequest.current) setLoadingRoi(false);
    }
  }

  async function fetchIndexation(siteId: number) {
    const requestId = ++indexationRequest.current;
    setLoadingIdx(true);
    setIndexationError(null);
    try {
      const payload = await fetchJson(
        `/api/autopilot/indexation?site_id=${siteId}`,
        "Chargement des preuves live/indexation",
        undefined,
        120_000,
      );
      const articles = parseIndexationArticles(payload);
      if (requestId !== indexationRequest.current) return;
      setIndexation(articles);
      setIndexationSiteId(siteId);
    } catch (error) {
      if (requestId !== indexationRequest.current) return;
      setIndexationError(actionableError(error, "Relance la vérification live/indexation."));
    } finally {
      if (requestId === indexationRequest.current) setLoadingIdx(false);
    }
  }

  async function fetchPublicationRuns(siteId: number) {
    const requestId = ++publicationRequest.current;
    setLoadingPublication(true);
    setPublicationError(null);
    try {
      const payload = await fetchJson(
        `/api/autopilot/history?site_id=${siteId}`,
        "Chargement des états de publication",
      );
      const runs = parsePublicationRuns(payload);
      if (requestId !== publicationRequest.current) return;
      setPublicationRuns(runs);
      setPublicationSiteId(siteId);
    } catch (error) {
      if (requestId !== publicationRequest.current) return;
      setPublicationError(actionableError(error, "Relance le chargement des états de publication."));
    } finally {
      if (requestId === publicationRequest.current) setLoadingPublication(false);
    }
  }

  function refreshSiteData(siteId: number | null = selectedSite) {
    if (siteId === null) return;
    void fetchRoi(siteId);
    void fetchIndexation(siteId);
    void fetchPublicationRuns(siteId);
  }

  useEffect(() => {
    void fetchSites();
  }, []);

  useEffect(() => {
    if (selectedSite !== null) {
      refreshSiteData(selectedSite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite]);

  const runStatusById = new Map(publicationRuns.map((run) => [run.id, run.status]));
  const measuredArticles = roi
    .map((article) => measuredImprovement(article))
    .filter((value): value is number => value !== null);
  const averageImprovement = measuredArticles.length > 0
    ? measuredArticles.reduce((sum, value) => sum + value, 0) / measuredArticles.length
    : null;
  const publishedCount = publicationRuns.filter((run) => PUBLISHED_STATUSES.has(run.status)).length;
  const liveVerifiedCount = publicationRuns.filter((run) => run.status === "verified_live").length;
  const indexedCount = indexation.filter((a) => a.indexed).length;
  const selectedSiteName = sites.find((site) => site.id === selectedSite)?.name ?? "le site sélectionné";
  const roiSourceName = sites.find((site) => site.id === roiSiteId)?.name;
  const indexationSourceName = sites.find((site) => site.id === indexationSiteId)?.name;
  const publicationSourceName = sites.find((site) => site.id === publicationSiteId)?.name;
  const refreshing = loadingRoi || loadingIdx || loadingPublication;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/autopilot" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Autopilot
        </Link>
        <TrendingUp className="w-5 h-5 text-emerald-400" />
        <h1 className="text-xl font-semibold">Publication, live &amp; indexation</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Site selector */}
        <div className="flex items-center gap-4">
          <select
            aria-label="Site à analyser"
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            disabled={loadingSites || sites.length === 0}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-64"
          >
            {sites.length === 0 && <option value="">Aucun site confirmé</option>}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {(() => {
            const current = sites.find((s) => s.id === selectedSite);
            return current?.url ? (
              <a href={current.url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${current.url} dans un nouvel onglet`}
                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm">
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : null;
          })()}
          <button
            type="button"
            onClick={() => refreshSiteData()}
            disabled={selectedSite === null || refreshing}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 rounded-lg text-sm font-medium"
          >
            {refreshing ? "Actualisation…" : "Actualiser"}
          </button>
        </div>

        {sitesError && (
          <div className="overflow-hidden rounded-xl border border-amber-800/50">
            <ErrorNotice message={sitesError} onRetry={() => void fetchSites()} />
          </div>
        )}

        {publicationError && (
          <div className="overflow-hidden rounded-xl border border-amber-800/50">
            <ErrorNotice
              message={`${publicationError}${publicationSiteId !== null && publicationSiteId !== selectedSite ? ` Données affichées: ${publicationSourceName ?? `site ${publicationSiteId}`}.` : ""}`}
              onRetry={() => selectedSite !== null && void fetchPublicationRuns(selectedSite)}
            />
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Marqués publiés</div>
            <div className="text-3xl font-bold text-white mt-1">
              {publicationSiteId !== null ? publishedCount : "—"}
            </div>
            <div className="mt-1 text-xs text-gray-500">50 derniers runs maximum</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Live vérifiés</div>
            <div className="text-3xl font-bold text-white mt-1">
              {publicationSiteId !== null ? liveVerifiedCount : "—"}
            </div>
            <div className="mt-1 text-xs text-gray-500">Statut verified_live uniquement</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Indexation confirmée</div>
            <div className="text-3xl font-bold text-white mt-1">
              {indexationSiteId !== null ? `${indexedCount}/${indexation.length}` : "—"}
            </div>
            <div className="mt-1 text-xs text-gray-500">Preuve: impressions GSC sur 90 jours</div>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Publié, live vérifié et indexé sont trois états distincts. Sans impression GSC, l’indexation reste non confirmée — elle n’est pas déclarée absente.
        </p>

        {/* ROI Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Évolution GSC après publication
              </h2>
              {loadingRoi && roi.length > 0 && (
                <span className="flex items-center gap-2 text-xs text-gray-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Actualisation…
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Variation de requête observée, sans attribution causale ni ROI financier.
              {averageImprovement !== null
                ? ` Moyenne comparable à 30 jours: ${averageImprovement > 0 ? "+" : ""}${formatFixed(averageImprovement)} sur ${measuredArticles.length} article${measuredArticles.length > 1 ? "s" : ""}.`
                : " Aucune fenêtre complète et comparable à 30 jours n’est confirmée."}
            </p>
          </div>
          {roiError && (
            <ErrorNotice
              message={`${roiError}${roiSiteId !== null && roiSiteId !== selectedSite ? ` Données affichées: ${roiSourceName ?? `site ${roiSiteId}`}, pas ${selectedSiteName}.` : ""}`}
              onRetry={() => selectedSite !== null && void fetchRoi(selectedSite)}
            />
          )}
          {!roiError && roi.length > 0 && roiSiteId !== selectedSite && (
            <div className="border-b border-amber-800/50 bg-amber-950/20 px-5 py-3 text-xs text-amber-100">
              Actualisation de {selectedSiteName}; les dernières données confirmées de {roiSourceName ?? `site ${roiSiteId}`} restent affichées.
            </div>
          )}
          {loadingRoi && roi.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : roi.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              {roiSiteId === selectedSite && !roiError
                ? "Aucune mesure GSC confirmée pour ce site."
                : "Aucune donnée GSC confirmée n’a encore été chargée."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left">Lang</th>
                    <th className="px-5 py-3 text-left">
                      <span className="inline-flex items-center gap-2">
                        Mot-clé
                        <CopyKeywordsButton keywords={roi.map((a) => a.keyword)} />
                      </span>
                    </th>
                    <th className="px-5 py-3 text-left">Publication</th>
                    <th className="px-5 py-3 text-right">Pos. avant</th>
                    <th className="px-5 py-3 text-right">Pos. +7j</th>
                    <th className="px-5 py-3 text-right">Pos. +30j</th>
                    <th className="px-5 py-3 text-right">Variation</th>
                    <th className="px-5 py-3 text-right">Clics +30j</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.map((a) => {
                    const after7Complete = isWindowComplete(a.created_at, 7);
                    const after30Complete = isWindowComplete(a.created_at, 30);
                    const variation = measuredImprovement(a);
                    const status = runStatusById.get(a.id);
                    return (
                      <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-5 py-3">{LANG_FLAG[a.language] ?? a.language}</td>
                        <td className="px-5 py-3 font-medium text-white">{a.keyword}</td>
                        <td className="px-5 py-3 text-xs text-gray-400">{publicationLabel(status)}</td>
                        <td className="px-5 py-3 text-right text-gray-400">
                          {a.before.position !== null && a.before.position > 0 ? formatFixed(a.before.position) : "Non mesurée"}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-400">
                          {!after7Complete ? "En cours" : a.after_7d.position !== null && a.after_7d.position > 0 ? formatFixed(a.after_7d.position) : "Non mesurée"}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-400">
                          {!after30Complete ? "En cours" : a.after_30d.position !== null && a.after_30d.position > 0 ? formatFixed(a.after_30d.position) : "Non mesurée"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {variation === null ? (
                            <span className="text-gray-500">—</span>
                          ) : (
                            <span className={`flex items-center justify-end gap-1 ${variation > 0 ? "text-emerald-400" : variation < 0 ? "text-red-400" : "text-gray-500"}`}>
                              {variation > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : variation < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                              {variation > 0 ? "+" : ""}{formatFixed(variation)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-blue-400">
                          {after30Complete ? a.after_30d.clicks.toLocaleString("fr-FR") : "En cours"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Indexation Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" />
                Vérification live et indexation ({indexedCount}/{indexation.length} confirmées)
              </h2>
              {loadingIdx && indexation.length > 0 && (
                <span className="flex items-center gap-2 text-xs text-gray-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Actualisation…
                </span>
              )}
            </div>
          </div>
          {indexationError && (
            <ErrorNotice
              message={`${indexationError}${indexationSiteId !== null && indexationSiteId !== selectedSite ? ` Données affichées: ${indexationSourceName ?? `site ${indexationSiteId}`}, pas ${selectedSiteName}.` : ""}`}
              onRetry={() => selectedSite !== null && void fetchIndexation(selectedSite)}
            />
          )}
          {!indexationError && indexation.length > 0 && indexationSiteId !== selectedSite && (
            <div className="border-b border-amber-800/50 bg-amber-950/20 px-5 py-3 text-xs text-amber-100">
              Vérification de {selectedSiteName} en cours; les dernières preuves confirmées de {indexationSourceName ?? `site ${indexationSiteId}`} restent affichées.
            </div>
          )}
          {loadingIdx && indexation.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : indexation.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              {indexationSiteId === selectedSite && !indexationError
                ? "Aucune URL publiée n’est disponible pour une vérification confirmée."
                : "Aucune preuve live/indexation confirmée n’a encore été chargée."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left">Lang</th>
                    <th className="px-5 py-3 text-left">
                      <span className="inline-flex items-center gap-2">
                        Mot-clé
                        <CopyKeywordsButton keywords={indexation.map((a) => a.keyword)} />
                      </span>
                    </th>
                    <th className="px-5 py-3 text-left">Publication</th>
                    <th className="px-5 py-3 text-left">URL</th>
                    <th className="px-5 py-3 text-center">Live</th>
                    <th className="px-5 py-3 text-center">Indexation</th>
                  </tr>
                </thead>
                <tbody>
                  {indexation.map((a) => {
                    const isLive = a.status_code !== null && a.status_code >= 200 && a.status_code < 300;
                    return (
                      <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-5 py-3">{LANG_FLAG[a.language] ?? a.language}</td>
                        <td className="px-5 py-3 font-medium text-white">{a.keyword}</td>
                        <td className="px-5 py-3 text-xs text-gray-400">{publicationLabel(runStatusById.get(a.id))}</td>
                        <td className="px-5 py-3">
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs truncate block max-w-[300px]">
                            {a.url}
                          </a>
                        </td>
                        <td className="px-5 py-3 text-center text-xs">
                          {isLive ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <CheckCircle className="h-4 w-4" /> HTTP {a.status_code}
                            </span>
                          ) : a.status_code === null ? (
                            <span className="inline-flex items-center gap-1 text-gray-400">
                              <Minus className="h-4 w-4" /> Non vérifié
                            </span>
                          ) : (
                            <span className="text-amber-300">Échec HTTP {a.status_code}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-center text-xs">
                          {a.indexed ? (
                            <span className="inline-flex flex-col items-center text-emerald-400" title={`${a.gsc_impressions} impressions GSC; dernière visibilité ${a.gsc_last_seen ?? "inconnue"}`}>
                              <span className="inline-flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Confirmée par GSC</span>
                              <span className="text-[10px] text-gray-500">{a.gsc_impressions} impressions</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-gray-400" title="Aucune impression GSC sur 90 jours; cela ne prouve pas une non-indexation.">
                              <Minus className="h-4 w-4" /> Non confirmée
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
