"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Link2, AlertTriangle, CheckCircle } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; }

interface AuditResult {
  success: boolean;
  total_articles: number;
  total_internal_links: number;
  avg_links_per_article: number;
  orphan_pages: string[];
  link_poor_pages: { slug: string; outgoing_links: number }[];
  suggestions: { from: string; to: string; reason: string }[];
  error?: string;
}

export default function InternalLinksPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) { setSites(list); if (!selectedSite) setSelectedSite("all"); }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const id = setTimeout(() => { void fetchSites(); }, 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAudit() {
    if (!selectedSite || selectedSite === "all") return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/internal-links/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite }),
      });
      const d = await res.json() as AuditResult;
      if (d.success) {
        setResult(d);
      } else {
        setError(d.error ?? "Erreur");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Link2 className="w-5 h-5 text-teal-400" />
        <h1 className="text-xl font-semibold">Audit Maillage Interne</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            <option value="all">🌐 Tous les sites</option>
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button
            onClick={runAudit}
            disabled={loading}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loading ? "Scan GitHub..." : "Lancer l'audit"}
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {result && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Articles scannés</div>
                <div className="text-3xl font-bold text-white mt-1">{result.total_articles}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Liens internes total</div>
                <div className="text-3xl font-bold text-teal-400 mt-1">{result.total_internal_links}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Moy. liens/article</div>
                <div className="text-3xl font-bold text-blue-400 mt-1">{result.avg_links_per_article.toFixed(1)}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Pages orphelines</div>
                <div className={`text-3xl font-bold mt-1 ${result.orphan_pages.length > 0 ? "text-red-400" : "text-green-400"}`}>
                  {result.orphan_pages.length}
                </div>
              </div>
            </div>

            {/* Orphan pages */}
            {result.orphan_pages.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="font-medium text-gray-200 flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Pages orphelines (aucun lien entrant)
                </h2>
                <div className="flex flex-wrap gap-2">
                  {result.orphan_pages.map((slug) => (
                    <span key={slug} className="bg-red-900/20 border border-red-800 rounded px-3 py-1 text-xs text-red-300">
                      {slug}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Link-poor pages */}
            {result.link_poor_pages.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="font-medium text-gray-200 flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  Pages avec peu de liens sortants (&lt;2)
                </h2>
                <div className="flex flex-wrap gap-2">
                  {result.link_poor_pages.map((p) => (
                    <span key={p.slug} className="bg-yellow-900/20 border border-yellow-800 rounded px-3 py-1 text-xs text-yellow-300">
                      {p.slug} ({p.outgoing_links} liens)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {result.suggestions.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h2 className="font-medium text-gray-200 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-teal-400" />
                    Suggestions de liens ({result.suggestions.length})
                  </h2>
                </div>
                <div className="divide-y divide-gray-800">
                  {result.suggestions.slice(0, 20).map((s, i) => (
                    <div key={i} className="px-5 py-3 flex items-center gap-3 text-sm">
                      <span className="text-blue-400 font-medium">{s.from}</span>
                      <span className="text-gray-600">→</span>
                      <span className="text-teal-400 font-medium">{s.to}</span>
                      <span className="text-xs text-gray-500 ml-auto">{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !result && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <Link2 className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <div className="text-gray-500 text-sm">Scanne les articles GitHub pour détecter les liens manquants</div>
          </div>
        )}
      </div>
    </div>
  );
}
