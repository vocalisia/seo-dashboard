"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Filter, Loader2, Download, Copy, Check } from "lucide-react";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface BloatRow {
  url: string;
  reason: string;
  impressions90d: number;
  recommendation: "noindex" | "canonical" | "delete";
}

interface BloatResponse {
  total: number;
  bloat_count: number;
  rows: BloatRow[];
}

const REC_COLOR: Record<BloatRow["recommendation"], string> = {
  noindex: "text-yellow-400 bg-yellow-900/20",
  canonical: "text-blue-400 bg-blue-900/20",
  delete: "text-red-400 bg-red-900/20",
};

export default function IndexBloatPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BloatResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((d: unknown) => {
        if (Array.isArray(d)) setSites(d as Site[]);
      })
      .catch(() => undefined);
  }, []);

  async function runAnalysis() {
    if (!selectedSite) return;
    const site = sites.find((s) => s.id === selectedSite);
    if (!site) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/index-bloat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, site_url: site.url }),
      });
      const d = await res.json() as BloatResponse;
      setResult(d);
    } catch {
      setResult(null);
    }
    setLoading(false);
  }

  function copyNoindex() {
    if (!result) return;
    const urls = result.rows
      .filter((r) => r.recommendation === "noindex")
      .map((r) => r.url)
      .join("\n");
    navigator.clipboard.writeText(urls).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  function exportCsv() {
    if (!result) return;
    const header = "URL,Raison,Impressions 90j,Recommandation\n";
    const body = result.rows
      .map((r) => `"${r.url}","${r.reason}",${r.impressions90d},${r.recommendation}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "index-bloat.csv";
    a.click();
  }

  const noindexCount = result?.rows.filter((r) => r.recommendation === "noindex").length ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Filter className="w-5 h-5 text-orange-400" />
        <h1 className="text-xl font-semibold">Index Bloat</h1>
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
            onClick={runAnalysis}
            disabled={!selectedSite || loading}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
            {loading ? "Analyse..." : "Analyser"}
          </button>
        </div>

        {result && (
          <>
            {/* Counts */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-white">{result.total}</div>
                <div className="text-xs text-gray-400 mt-1">Pages analysées</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-orange-400">{result.bloat_count}</div>
                <div className="text-xs text-gray-400 mt-1">Pages problématiques</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-yellow-400">{noindexCount}</div>
                <div className="text-xs text-gray-400 mt-1">A noindexer</div>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-4 text-sm text-blue-300">
              <strong>Comment dé-indexer:</strong> Ajouter dans le{" "}
              <code className="bg-blue-900/40 px-1 rounded">&lt;head&gt;</code> de chaque page concernée:{" "}
              <code className="bg-blue-900/40 px-1 rounded text-xs">
                &lt;meta name="robots" content="noindex, nofollow" /&gt;
              </code>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={copyNoindex}
                className="flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copié !" : `Copier ${noindexCount} URLs noindex`}
              </button>
              <button
                onClick={exportCsv}
                className="flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg"
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>

            {/* Table */}
            {result.rows.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h2 className="font-medium text-gray-200">Pages à corriger</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-400 border-b border-gray-800">
                      <tr>
                        <th className="px-5 py-3 text-left">URL</th>
                        <th className="px-4 py-3 text-left">Raison</th>
                        <th className="px-4 py-3 text-right">Impressions 90j</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {result.rows.map((r) => (
                        <tr key={r.url} className="hover:bg-gray-800/50">
                          <td className="px-5 py-2.5 font-mono text-xs text-gray-300 truncate max-w-xs">{r.url}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-400">{r.reason}</td>
                          <td className="px-4 py-2.5 text-right text-gray-400">{r.impressions90d}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${REC_COLOR[r.recommendation]}`}>
                              {r.recommendation}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
