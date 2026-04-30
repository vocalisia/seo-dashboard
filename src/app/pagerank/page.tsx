"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitBranch, Loader2 } from "lucide-react";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface PageRankResult {
  rank: number;
  url: string;
  score: number;
  inLinks: number;
  outLinks: number;
  clicks: number;
}

interface PRResponse {
  top20: PageRankResult[];
  orphans: string[];
  suggestions: string[];
  total: number;
}

export default function PageRankPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PRResponse | null>(null);
  const [tab, setTab] = useState<"top" | "orphans" | "suggestions">("top");

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((d: unknown) => {
        if (Array.isArray(d)) setSites(d as Site[]);
      })
      .catch(() => undefined);
  }, []);

  async function calculate() {
    if (!selectedSite) return;
    const site = sites.find((s) => s.id === selectedSite);
    if (!site) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/pagerank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, site_url: site.url }),
      });
      const d = await res.json() as PRResponse;
      setResult(d);
    } catch {
      setResult(null);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <GitBranch className="w-5 h-5 text-teal-400" />
        <h1 className="text-xl font-semibold">Internal PageRank</h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <select
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            <option value="">Sélectionner un site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={calculate}
            disabled={!selectedSite || loading}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
            {loading ? "Calcul PageRank..." : "Calculer PageRank"}
          </button>
          {loading && (
            <span className="text-xs text-gray-400">Crawl jusqu'à 100 pages — peut prendre 30-60s</span>
          )}
        </div>

        {result && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-teal-400">{result.total}</div>
                <div className="text-xs text-gray-400 mt-1">Pages crawlées</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-orange-400">{result.orphans.length}</div>
                <div className="text-xs text-gray-400 mt-1">Pages orphelines</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-purple-400">{result.suggestions.length}</div>
                <div className="text-xs text-gray-400 mt-1">Suggestions maillage</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-gray-800 pb-0">
              {(["top", "orphans", "suggestions"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                    tab === t
                      ? "border-teal-500 text-teal-400"
                      : "border-transparent text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {t === "top" && `Top 20`}
                  {t === "orphans" && `Orphelines (${result.orphans.length})`}
                  {t === "suggestions" && `Suggestions (${result.suggestions.length})`}
                </button>
              ))}
            </div>

            {/* Top 20 */}
            {tab === "top" && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-400 border-b border-gray-800">
                      <tr>
                        <th className="px-5 py-3 text-center w-10">#</th>
                        <th className="px-4 py-3 text-left">URL</th>
                        <th className="px-4 py-3 text-right">PR Score</th>
                        <th className="px-4 py-3 text-right">Liens entrants</th>
                        <th className="px-4 py-3 text-right">Liens sortants</th>
                        <th className="px-4 py-3 text-right">Clics GSC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {result.top20.map((r) => {
                        const highPrLowTraffic = r.score > 0.01 && r.clicks === 0;
                        return (
                          <tr key={r.url} className={`hover:bg-gray-800/50 ${highPrLowTraffic ? "bg-yellow-900/10" : ""}`}>
                            <td className="px-5 py-2.5 text-center text-gray-500 font-medium">{r.rank}</td>
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-300 truncate max-w-xs">
                              {r.url}
                              {highPrLowTraffic && (
                                <span className="ml-2 text-yellow-400 text-xs">opp.</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right text-teal-400 font-mono">{r.score.toFixed(4)}</td>
                            <td className="px-4 py-2.5 text-right text-blue-400">{r.inLinks}</td>
                            <td className="px-4 py-2.5 text-right text-gray-400">{r.outLinks}</td>
                            <td className="px-4 py-2.5 text-right text-gray-300">{r.clicks}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-5 py-3 border-t border-gray-800 text-xs text-gray-500">
                  <span className="text-yellow-400">opp.</span> = PR élevé mais 0 clics GSC — opportunité de boost
                </div>
              </div>
            )}

            {/* Orphans */}
            {tab === "orphans" && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2">
                {result.orphans.length === 0 ? (
                  <p className="text-gray-400 text-sm">Aucune page orpheline détectée.</p>
                ) : (
                  result.orphans.map((url) => (
                    <div key={url} className="font-mono text-xs text-orange-300 py-1 border-b border-gray-800 last:border-0">
                      {url}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Suggestions */}
            {tab === "suggestions" && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
                {result.suggestions.length === 0 ? (
                  <p className="text-gray-400 text-sm">Aucune suggestion disponible.</p>
                ) : (
                  result.suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <span className="text-teal-400 font-bold mt-0.5">→</span>
                      <span className="text-gray-300">{s}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
