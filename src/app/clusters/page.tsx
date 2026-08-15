"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Layers, Zap, ExternalLink, Activity } from "lucide-react";
import Link from "next/link";
import { formatFixed, toFiniteNumber } from "@/lib/safe-number";

interface Site { id: number; name: string; url: string; }

interface Cluster {
  id?: number;
  cluster_name: string;
  keywords: string[];
  total_clicks: number;
  total_impressions: number;
  avg_position: number;
  content_suggestion: string;
  priority: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getApiError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const key of ["error", "message"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`réponse JSON illisible (HTTP ${response.status})`);
  }
}

function parseSites(payload: unknown): Site[] {
  if (isRecord(payload) && "success" in payload && payload.success !== true) {
    throw new Error(getApiError(payload) ?? "le contrat success de l’API a échoué");
  }
  const candidate = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.sites)
      ? payload.sites
      : null;
  if (!candidate || !candidate.every((site) => (
    isRecord(site)
    && typeof site.id === "number"
    && typeof site.name === "string"
    && typeof site.url === "string"
  ))) {
    throw new Error("contrat API invalide : liste de sites absente ou mal formée");
  }
  return candidate as Site[];
}

function parseClusters(payload: unknown): Cluster[] {
  if (!isRecord(payload)) {
    throw new Error("contrat API invalide : objet de réponse absent");
  }
  if ("success" in payload && payload.success !== true) {
    throw new Error(getApiError(payload) ?? "le contrat success de l’API a échoué");
  }
  if (!Array.isArray(payload.clusters) || !payload.clusters.every((cluster) => (
    isRecord(cluster)
    && typeof cluster.cluster_name === "string"
    && Array.isArray(cluster.keywords)
  ))) {
    throw new Error("contrat API invalide : clusters absents ou mal formés");
  }
  return payload.clusters as Cluster[];
}

function actionableError(action: string, reason: unknown, retained: boolean): string {
  const detail = reason instanceof Error && reason.message.trim()
    ? ` Détail : ${reason.message.trim()}.`
    : "";
  const preservation = retained
    ? " Les clusters précédemment chargés restent affichés."
    : "";
  return `${action} impossible. Réessaie ; si le problème persiste, vérifie ta session et l’API.${preservation}${detail}`;
}

async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<{ response: Response; ms: number }> {
  const started = performance.now();
  const response = await fetch(input, init);
  return { response, ms: performance.now() - started };
}

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-green-900/30 text-green-400 border-green-700",
  medium: "bg-yellow-900/30 text-yellow-400 border-yellow-700",
  low: "bg-gray-800 text-gray-400 border-gray-700",
};

export default function ClustersPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTiming, setLastTiming] = useState<{ label: string; ms: number } | null>(null);
  const [hasLoadedClusters, setHasLoadedClusters] = useState(false);
  const clusterRequestId = useRef(0);
  const siteRequestId = useRef(0);
  const hasLoadedClustersRef = useRef(false);

  const fetchSites = useCallback(async () => {
    const requestId = ++siteRequestId.current;
    try {
      const { response, ms } = await timedFetch("/api/sites");
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(getApiError(payload) ?? `HTTP ${response.status}`);
      }
      const list = parseSites(payload);
      if (requestId !== siteRequestId.current) return;
      setSites(list);
      setSelectedSite((current) => current ?? list[0]?.id ?? null);
      setLastTiming({ label: "Sites", ms });
      setError(null);
    } catch (reason) {
      if (requestId === siteRequestId.current) {
        setError(actionableError("Chargement des sites", reason, false));
      }
    }
  }, []);

  const fetchCached = useCallback(async () => {
    if (!selectedSite) return;
    const requestSite = selectedSite;
    const requestId = ++clusterRequestId.current;
    setLoading(true);
    setGenerating(false);
    setError(null);
    try {
      const { response, ms } = await timedFetch(`/api/keyword-clusters?site_id=${requestSite}&cached=true`);
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(getApiError(payload) ?? `HTTP ${response.status}`);
      }
      const nextClusters = parseClusters(payload);
      if (requestId !== clusterRequestId.current) return;
      setClusters(nextClusters);
      setHasLoadedClusters(true);
      hasLoadedClustersRef.current = true;
      setLastTiming({ label: "Clusters cache", ms });
    } catch (reason) {
      if (requestId === clusterRequestId.current) {
        setError(actionableError("Chargement des clusters en cache", reason, hasLoadedClustersRef.current));
      }
    } finally {
      if (requestId === clusterRequestId.current) setLoading(false);
    }
  }, [selectedSite]);

  async function generateClusters() {
    if (!selectedSite) return;
    const requestSite = selectedSite;
    const requestId = ++clusterRequestId.current;
    setGenerating(true);
    setLoading(false);
    setError(null);
    try {
      const { response, ms } = await timedFetch(`/api/keyword-clusters?site_id=${requestSite}`);
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(getApiError(payload) ?? `HTTP ${response.status}`);
      }
      const nextClusters = parseClusters(payload);
      if (requestId !== clusterRequestId.current) return;
      setClusters(nextClusters);
      setHasLoadedClusters(true);
      hasLoadedClustersRef.current = true;
      setLastTiming({ label: "Clusters generation", ms });
    } catch (reason) {
      if (requestId === clusterRequestId.current) {
        setError(actionableError("Génération des clusters", reason, hasLoadedClustersRef.current));
      }
    } finally {
      if (requestId === clusterRequestId.current) setGenerating(false);
    }
  }

  useEffect(() => { void fetchSites(); }, [fetchSites]);
  useEffect(() => { void fetchCached(); }, [fetchCached]);

  const totalKw = clusters.reduce((s, c) => s + (c.keywords?.length ?? 0), 0);
  const totalImpr = clusters.reduce((s, c) => s + toFiniteNumber(c.total_impressions), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Layers className="w-5 h-5 text-violet-400" />
        <h1 className="text-xl font-semibold">Keyword Clusters</h1>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          {lastTiming ? `${lastTiming.label}: ${lastTiming.ms >= 1000 ? `${(lastTiming.ms / 1000).toFixed(1)}s` : `${Math.round(lastTiming.ms)}ms`}` : "vitesse en attente"}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            aria-label="Site à regrouper"
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            <option value="all">Tous les sites</option>
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
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
            onClick={generateClusters}
            disabled={generating || loading || !selectedSite}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            {generating ? "Clustering..." : selectedSite === "all" ? "Charger portfolio" : "Générer clusters"}
          </button>
        </div>

        {error && (
          <div className="bg-red-950/30 border border-red-800/50 text-red-300 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Stats */}
        {clusters.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Clusters</div>
              <div className="text-3xl font-bold text-violet-400 mt-1">{clusters.length}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Mots-clés groupés</div>
              <div className="text-3xl font-bold text-white mt-1">{totalKw}</div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-sm text-gray-400">Impressions totales</div>
              <div className="text-3xl font-bold text-blue-400 mt-1">{totalImpr.toLocaleString()}</div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        )}

        {/* Clusters */}
        {!loading && clusters.length > 0 && (
          <div className="space-y-4">
            {clusters.map((c, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-white text-lg">{c.cluster_name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded border ${PRIORITY_STYLE[c.priority] ?? PRIORITY_STYLE.low}`}>
                      {c.priority}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>{c.keywords?.length ?? 0} mots-clés</span>
                    <span>{(c.total_impressions ?? 0).toLocaleString()} impr.</span>
                    <span>pos. {formatFixed(c.avg_position)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {(c.keywords ?? []).map((kw, j) => (
                    <span key={j} className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-300">
                      {kw}
                    </span>
                  ))}
                </div>

                {c.content_suggestion && (
                  <div className="flex items-start gap-2 mt-2 bg-violet-900/10 border border-violet-800/30 rounded-lg px-3 py-2">
                    <Zap className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-violet-300">{c.content_suggestion}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && hasLoadedClusters && clusters.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <Layers className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <div className="text-gray-500 text-sm">Clique &quot;Générer clusters&quot; pour regrouper tes mots-clés par thématique</div>
          </div>
        )}
      </div>
    </div>
  );
}
