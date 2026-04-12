"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Layers, Zap, TrendingUp } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; }

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

const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-green-900/30 text-green-400 border-green-700",
  medium: "bg-yellow-900/30 text-yellow-400 border-yellow-700",
  low: "bg-gray-800 text-gray-400 border-gray-700",
};

export default function ClustersPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { void fetchSites(); }, []);
  useEffect(() => { if (selectedSite) void fetchCached(); }, [selectedSite]);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) { setSites(list); if (!selectedSite) setSelectedSite(list[0].id); }
    } catch { /* ignore */ }
  }

  async function fetchCached() {
    if (!selectedSite) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/keyword-clusters?site_id=${selectedSite}&cached=true`);
      const d = await res.json() as { clusters?: Cluster[] };
      setClusters(d.clusters ?? []);
    } catch { setClusters([]); }
    setLoading(false);
  }

  async function generateClusters() {
    if (!selectedSite) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/keyword-clusters?site_id=${selectedSite}`);
      const d = await res.json() as { clusters?: Cluster[] };
      setClusters(d.clusters ?? []);
    } catch { /* ignore */ }
    setGenerating(false);
  }

  const totalKw = clusters.reduce((s, c) => s + (c.keywords?.length ?? 0), 0);
  const totalImpr = clusters.reduce((s, c) => s + (c.total_impressions ?? 0), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Layers className="w-5 h-5 text-violet-400" />
        <h1 className="text-xl font-semibold">Keyword Clusters</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button
            onClick={generateClusters}
            disabled={generating}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            {generating ? "Clustering IA..." : "Générer clusters"}
          </button>
        </div>

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
                    <span>pos. {(c.avg_position ?? 0).toFixed(1)}</span>
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

        {!loading && clusters.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <Layers className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <div className="text-gray-500 text-sm">Clique &quot;Générer clusters&quot; pour regrouper tes mots-clés par thématique</div>
          </div>
        )}
      </div>
    </div>
  );
}
