"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Download, Layers } from "lucide-react";
import Link from "next/link";

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
  difficulty: "easy" | "medium" | "hard";
  intent: string;
}

interface Cluster {
  cluster_name: string;
  keywords: string[];
}

const DIFF_COLORS: Record<string, string> = {
  easy: "text-green-400",
  medium: "text-yellow-400",
  hard: "text-red-400",
};

const INTENT_COLORS: Record<string, string> = {
  info: "text-blue-400",
  transac: "text-green-400",
  comm: "text-yellow-400",
  nav: "text-purple-400",
};

export default function KeywordsProPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [minClicks, setMinClicks] = useState(2000);
  const [minWords, setMinWords] = useState(3);
  const [posMin, setPosMin] = useState(1);
  const [posMax, setPosMax] = useState(100);
  const [loading, setLoading] = useState(false);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clustering, setClustering] = useState(false);
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [sortCol, setSortCol] = useState<keyof KeywordRow>("clicks");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/sites");
        const data = await res.json() as Site[] | { sites?: Site[] };
        const list = Array.isArray(data) ? data : (data.sites ?? []);
        setSites(list);
        if (list.length > 0) setSelectedSite(list[0].id);
      } catch { /* ignore */ }
    })();
  }, []);

  async function fetchKeywords() {
    if (!selectedSite) return;
    setLoading(true);
    setError(null);
    setClusters(null);
    try {
      const qs = new URLSearchParams({
        siteId: String(selectedSite),
        minClicks: String(minClicks),
        minWords: String(minWords),
        posMin: String(posMin),
        posMax: String(posMax),
      });
      const res = await fetch(`/api/keywords-pro?${qs}`);
      const data = await res.json() as { success: boolean; keywords?: KeywordRow[]; error?: string };
      if (data.success && data.keywords) {
        setKeywords(data.keywords);
      } else {
        setError(data.error ?? "Erreur");
        setKeywords([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    }
    setLoading(false);
  }

  async function clusterKeywords() {
    if (keywords.length === 0) return;
    setClustering(true);
    try {
      const res = await fetch("/api/keywords-pro/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: keywords.slice(0, 100).map((k) => k.keyword) }),
      });
      const data = await res.json() as { success: boolean; clusters?: Cluster[] };
      if (data.success && data.clusters) setClusters(data.clusters);
    } catch { /* ignore */ }
    setClustering(false);
  }

  function exportCSV() {
    const header = "Keyword,Clicks,Impressions,Position,Volume,Difficulty,Intent";
    const rows = sorted.map((k) =>
      `"${k.keyword.replace(/"/g, '""')}",${k.clicks},${k.impressions},${k.position.toFixed(1)},${k.volume},${k.difficulty},${k.intent}`
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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <span className="text-xl">Keywords Pro</span>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Filters */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="text-xs text-gray-400 uppercase block mb-1">Site</label>
              <select value={selectedSite ?? ""} onChange={(e) => setSelectedSite(parseInt(e.target.value, 10))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Min clics/mois</label>
              <input type="number" value={minClicks} onChange={(e) => setMinClicks(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Min mots ({minWords})</label>
              <input type="range" min={1} max={10} value={minWords} onChange={(e) => setMinWords(parseInt(e.target.value, 10))}
                className="w-full mt-2" />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Pos min</label>
              <input type="number" value={posMin} min={1} max={100} onChange={(e) => setPosMin(parseFloat(e.target.value) || 1)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase block mb-1">Pos max</label>
              <input type="number" value={posMax} min={1} max={100} onChange={(e) => setPosMax(parseFloat(e.target.value) || 100)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={fetchKeywords} disabled={loading || !selectedSite}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Chargement..." : "Filtrer mots-clés"}
            </button>
            {keywords.length > 0 && (
              <>
                <button onClick={clusterKeywords} disabled={clustering}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 rounded-lg text-sm transition-colors">
                  {clustering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                  Cluster IA
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

        {/* Clusters */}
        {clusters && clusters.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-medium text-gray-300 mb-4">Clusters sémantiques ({clusters.length})</h2>
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
              {keywords.length} mots-clés — {minClicks}+ clics/mois, {minWords}+ mots, pos {posMin}–{posMax}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                    <th className="px-5 py-3 text-left">Mot-clé</th>
                    {(["clicks", "impressions", "position", "volume"] as const).map((col) => (
                      <th key={col} onClick={() => toggleSort(col)}
                        className="px-4 py-3 text-right cursor-pointer select-none hover:text-gray-200">
                        <span className="inline-flex items-center gap-1">
                          {col === "clicks" ? "Clics" : col === "impressions" ? "Impressions" : col === "position" ? "Position" : "Vol. estimé"}
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
                      <td className="px-4 py-2.5 text-right text-blue-400">{Number(kw.clicks).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400">{Number(kw.impressions).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={Number(kw.position) <= 10 ? "text-green-400" : Number(kw.position) <= 20 ? "text-yellow-400" : "text-gray-400"}>
                          {Number(kw.position).toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-purple-400 font-medium">{Number(kw.volume).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs font-medium ${DIFF_COLORS[kw.difficulty] ?? "text-gray-400"}`}>{kw.difficulty}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs ${INTENT_COLORS[kw.intent] ?? "text-gray-400"}`}>{kw.intent}</span>
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

        {!loading && keywords.length === 0 && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center text-gray-500 text-sm">
            Sélectionne un site et clique &quot;Filtrer mots-clés&quot;
          </div>
        )}
      </div>
    </div>
  );
}
