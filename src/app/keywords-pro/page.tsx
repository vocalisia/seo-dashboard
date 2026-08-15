"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Download, Layers } from "lucide-react";
import Link from "next/link";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface KeywordRow {
  keyword: string;
  clicks: number;
  impressions: number;
  position: number;
  volume: number;
  volume_source?: string | null;
  volume_ch?: number | null;
  volume_fr?: number | null;
  difficulty: "easy" | "medium" | "hard" | "unknown";
  intent: string;
  site_name?: string;
}

interface Cluster {
  cluster_name: string;
  keywords: string[];
}

interface AppliedSearch {
  siteId: number | "all";
  minClicks: number;
  minWords: number;
  posMin: number;
  posMax: number;
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

function parseKeywords(payload: unknown): KeywordRow[] {
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error(getApiError(payload) ?? "le contrat success de l’API a échoué");
  }
  if (!Array.isArray(payload.keywords) || !payload.keywords.every((keyword) => (
    isRecord(keyword)
    && typeof keyword.keyword === "string"
    && typeof keyword.clicks === "number"
    && typeof keyword.impressions === "number"
    && typeof keyword.position === "number"
    && typeof keyword.volume === "number"
    && typeof keyword.difficulty === "string"
    && typeof keyword.intent === "string"
  ))) {
    throw new Error("contrat API invalide : mots-clés absents ou mal formés");
  }
  return payload.keywords as KeywordRow[];
}

function parseClusters(payload: unknown): { clusters: Cluster[]; notice?: string } {
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error(getApiError(payload) ?? "le contrat success de l’API a échoué");
  }
  if (!Array.isArray(payload.clusters) || !payload.clusters.every((cluster) => (
    isRecord(cluster)
    && typeof cluster.cluster_name === "string"
    && Array.isArray(cluster.keywords)
    && cluster.keywords.every((keyword) => typeof keyword === "string")
  ))) {
    throw new Error("contrat API invalide : groupes absents ou mal formés");
  }
  return {
    clusters: payload.clusters as Cluster[],
    notice: typeof payload.notice === "string" ? payload.notice : undefined,
  };
}

function actionableError(action: string, reason: unknown, retained: boolean): string {
  const detail = reason instanceof Error && reason.message.trim()
    ? ` Détail : ${reason.message.trim()}.`
    : "";
  const preservation = retained
    ? " Les résultats précédemment chargés restent affichés."
    : "";
  return `${action} impossible. Réessaie ; si le problème persiste, vérifie ta session et l’API.${preservation}${detail}`;
}

const DIFF_COLORS: Record<string, string> = {
  easy: "text-green-400",
  medium: "text-yellow-400",
  hard: "text-red-400",
  unknown: "text-gray-500",
};

const INTENT_COLORS: Record<string, string> = {
  info: "text-blue-400",
  transac: "text-green-400",
  comm: "text-yellow-400",
  nav: "text-purple-400",
};

export default function KeywordsProPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [minClicks, setMinClicks] = useState(1);
  const [minWords, setMinWords] = useState(1);
  const [posMin, setPosMin] = useState(1);
  const [posMax, setPosMax] = useState(100);
  const [loading, setLoading] = useState(false);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [clustering, setClustering] = useState(false);
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [clusterNotice, setClusterNotice] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<keyof KeywordRow>("clicks");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [appliedSearch, setAppliedSearch] = useState<AppliedSearch | null>(null);
  const keywordRequestId = useRef(0);
  const clusterRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/sites");
        const payload = await readJson(res);
        if (!res.ok) {
          throw new Error(getApiError(payload) ?? `HTTP ${res.status}`);
        }
        const list = parseSites(payload);
        if (cancelled) return;
        setSites(list);
        setSelectedSite((current) => current ?? list[0]?.id ?? null);
        setError(null);
      } catch (reason) {
        if (!cancelled) setError(actionableError("Chargement des sites", reason, false));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedSite) void fetchKeywords();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite]);

  async function fetchKeywords(overrides?: Partial<{ minClicks: number; minWords: number; posMin: number; posMax: number }>) {
    if (!selectedSite) return;
    const requestSite = selectedSite;
    const requestId = ++keywordRequestId.current;
    const nextMinClicks = overrides?.minClicks ?? minClicks;
    const nextMinWords = overrides?.minWords ?? minWords;
    const nextPosMin = overrides?.posMin ?? posMin;
    const nextPosMax = overrides?.posMax ?? posMax;
    clusterRequestId.current += 1;
    setLoading(true);
    setClustering(false);
    setError(null);
    try {
      const qs = new URLSearchParams({
        siteId: String(requestSite),
        minClicks: String(nextMinClicks),
        minWords: String(nextMinWords),
        posMin: String(nextPosMin),
        posMax: String(nextPosMax),
      });
      const res = await fetch(`/api/keywords-pro?${qs}`);
      const payload = await readJson(res);
      if (!res.ok) {
        throw new Error(getApiError(payload) ?? `HTTP ${res.status}`);
      }
      const nextKeywords = parseKeywords(payload);
      if (requestId !== keywordRequestId.current) return;
      setKeywords(nextKeywords);
      setClusters(null);
      setClusterNotice(null);
      setHasSearched(true);
      setAppliedSearch({
        siteId: requestSite,
        minClicks: nextMinClicks,
        minWords: nextMinWords,
        posMin: nextPosMin,
        posMax: nextPosMax,
      });
    } catch (reason) {
      if (requestId === keywordRequestId.current) {
        setError(actionableError("Chargement des mots-clés", reason, appliedSearch !== null));
      }
    } finally {
      if (requestId === keywordRequestId.current) setLoading(false);
    }
  }

  async function relaxFilters() {
    setMinClicks(0);
    setMinWords(1);
    setPosMin(1);
    setPosMax(100);
    await fetchKeywords({ minClicks: 0, minWords: 1, posMin: 1, posMax: 100 });
  }

  async function clusterKeywords() {
    if (keywords.length === 0) return;
    const requestId = ++clusterRequestId.current;
    const requestedKeywords = keywords.slice(0, 100).map((keyword) => keyword.keyword);
    setClustering(true);
    setError(null);
    try {
      const res = await fetch("/api/keywords-pro/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: requestedKeywords }),
      });
      const payload = await readJson(res);
      if (!res.ok) {
        throw new Error(getApiError(payload) ?? `HTTP ${res.status}`);
      }
      const result = parseClusters(payload);
      if (requestId !== clusterRequestId.current) return;
      setClusters(result.clusters);
      setClusterNotice(result.notice ?? "Regroupement lexical local, sans appel API.");
    } catch (reason) {
      if (requestId === clusterRequestId.current) {
        setError(actionableError("Regroupement local", reason, clusters !== null));
      }
    } finally {
      if (requestId === clusterRequestId.current) setClustering(false);
    }
  }

  function exportCSV() {
    const showSite = appliedSearch?.siteId === "all";
    const header = showSite
      ? "Site,Keyword,Clicks,Impressions,Position,Volume,VolumeSource,Difficulty,Intent"
      : "Keyword,Clicks,Impressions,Position,Volume,VolumeSource,Difficulty,Intent";
    const rows = sorted.map((k) =>
      showSite
        ? `"${(k.site_name ?? "").replace(/"/g, '""')}","${k.keyword.replace(/"/g, '""')}",${k.clicks},${k.impressions},${k.position.toFixed(1)},${k.volume},"${k.volume_source ?? ""}",${k.difficulty},${k.intent}`
        : `"${k.keyword.replace(/"/g, '""')}",${k.clicks},${k.impressions},${k.position.toFixed(1)},${k.volume},"${k.volume_source ?? ""}",${k.difficulty},${k.intent}`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keywords-pro.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleSort(col: keyof KeywordRow) {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(col); setSortDir("desc"); }
  }

  const sorted = [...keywords].sort((a, b) => {
    const va = a[sortCol] as number;
    const vb = b[sortCol] as number;
    return sortDir === "asc" ? va - vb : vb - va;
  });
  const resultSite = appliedSearch?.siteId ?? selectedSite;
  const currentSearchMatchesApplied = appliedSearch !== null
    && appliedSearch.siteId === selectedSite
    && appliedSearch.minClicks === minClicks
    && appliedSearch.minWords === minWords
    && appliedSearch.posMin === posMin
    && appliedSearch.posMax === posMax;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <h1 className="text-xl">Mots-clés GSC avancés</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Filters */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-gray-400 uppercase block mb-1">Site</label>
              <select aria-label="Site à analyser" value={selectedSite ?? ""} onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="all">Tous les sites</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Min clics GSC · 30 j</label>
              <input aria-label="Nombre minimal de clics mensuels" type="number" value={minClicks} onChange={(e) => setMinClicks(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Min mots ({minWords})</label>
              <input aria-label="Nombre minimal de mots" type="range" min={1} max={10} value={minWords} onChange={(e) => setMinWords(parseInt(e.target.value, 10))}
                className="w-full mt-2" />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Pos min</label>
              <input aria-label="Position minimale" type="number" value={posMin} min={1} max={100} onChange={(e) => setPosMin(parseFloat(e.target.value) || 1)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Pos max</label>
              <input aria-label="Position maximale" type="number" value={posMax} min={1} max={100} onChange={(e) => setPosMax(parseFloat(e.target.value) || 100)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => fetchKeywords()} disabled={loading || !selectedSite}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Chargement..." : "Filtrer mots-clés"}
            </button>
            {keywords.length > 0 && (
              <>
                <button onClick={clusterKeywords} disabled={clustering || loading}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded-lg text-sm transition-colors">
                  {clustering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                  Regrouper localement
                </button>
                <button onClick={exportCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
                  <Download className="w-4 h-4" /> CSV
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {clusterNotice && !error && !loading && !clustering && (
          <div role="status" className="rounded-lg border border-blue-800/60 bg-blue-950/30 px-4 py-3 text-sm text-blue-100">{clusterNotice}</div>
        )}

        {/* Clusters */}
        {clusters && clusters.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-medium text-gray-300 mb-4">Groupes lexicaux ({clusters.length})</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {clusters.map((c, i) => (
                <div key={i} className="bg-gray-800 rounded-lg p-3">
                  <div className="text-sm font-medium text-purple-400 mb-2">{c.cluster_name}</div>
                  <div className="flex flex-wrap gap-1">
                    {c.keywords.slice(0, 6).map((kw, j) => (
                      <span key={j} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{kw}</span>
                    ))}
                    {c.keywords.length > 6 && <span className="text-xs text-gray-500">+{c.keywords.length - 6}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Table */}
        {keywords.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 text-xs text-gray-400">
              {keywords.length} mots-clés — {appliedSearch?.minClicks ?? minClicks}+ clics GSC sur 30 jours, {appliedSearch?.minWords ?? minWords}+ mots, positions {appliedSearch?.posMin ?? posMin}–{appliedSearch?.posMax ?? posMax}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                    <th className="px-5 py-3 text-left">
                      <span className="inline-flex items-center gap-2">
                        Mot-clé
                        <CopyKeywordsButton keywords={sorted.slice(0, 200).map((k) => k.keyword)} />
                      </span>
                    </th>
                    {resultSite === "all" && <th className="px-4 py-3 text-left">Site</th>}
                    {(["clicks", "impressions", "position", "volume"] as const).map((col) => (
                      <th key={col} onClick={() => toggleSort(col)}
                        className="px-4 py-3 text-right cursor-pointer select-none hover:text-gray-200">
                        <span className="inline-flex items-center gap-1">
                          {col === "clicks" ? "Clics" : col === "impressions" ? "Impressions" : col === "position" ? "Position GSC" : "Volume sourcé"}
                          {sortCol === col && <span>{sortDir === "desc" ? "↓" : "↑"}</span>}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center">Difficulté</th>
                    <th className="px-4 py-3 text-center">Intent</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 200).map((kw, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="px-5 py-2.5 text-gray-200 font-medium">{kw.keyword}</td>
                      {resultSite === "all" && <td className="px-4 py-2.5 text-xs text-gray-400">{kw.site_name ?? "—"}</td>}
                      <td className="px-4 py-2.5 text-right text-blue-400">{Number(kw.clicks).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400">{Number(kw.impressions).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={Number(kw.position) <= 10 ? "text-green-400" : Number(kw.position) <= 20 ? "text-yellow-400" : "text-gray-400"}>
                          {Number(kw.position).toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {Number(kw.volume) > 0 ? (
                          <span className="text-purple-400 font-medium" title={kw.volume_source ?? "Source volume"}>
                            {Number(kw.volume).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-600" title="Aucun volume fiable importé">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs font-medium ${DIFF_COLORS[kw.difficulty] ?? "text-gray-400"}`}>{kw.difficulty === "unknown" ? "Non calculée" : kw.difficulty}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs ${INTENT_COLORS[kw.intent] ?? "text-gray-400"}`}>{kw.intent === "transac" ? "Transactionnel" : kw.intent === "comm" ? "Commercial" : kw.intent === "nav" ? "Navigationnel" : "Informationnel"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sorted.length > 200 && (
              <div className="py-2 text-center text-xs text-gray-500">{sorted.length - 200} mots-clés supplémentaires — affine les filtres</div>
            )}
          </div>
        )}

        {!loading && keywords.length === 0 && !error && hasSearched && (
          <div className="bg-gray-900 border border-yellow-800/60 rounded-xl py-12 px-6 text-center text-sm">
            <div className="text-yellow-300 font-semibold mb-2">
              {currentSearchMatchesApplied ? "Aucun mot-clé avec ces filtres." : "Filtres modifiés depuis la dernière recherche."}
            </div>
            <div className="text-gray-400 mb-4">
              {currentSearchMatchesApplied
                ? "Baisse le minimum de clics, reduis le nombre de mots ou garde positions 1-100."
                : "Relance la recherche pour confirmer le résultat avec les filtres affichés."}
            </div>
            <button onClick={relaxFilters}
              className="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-medium">
              Relâcher les filtres
            </button>
          </div>
        )}

        {!loading && keywords.length === 0 && !error && !hasSearched && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center text-gray-500 text-sm">
            Sélectionne un site et clique &quot;Filtrer mots-clés&quot;
          </div>
        )}
      </div>
    </div>
  );
}
