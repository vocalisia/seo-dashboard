"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Link2, Loader2, Globe, BarChart2, Shield } from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface BacklinkEntry {
  linking_domain: string;
  target_page: string;
  link_count: number;
}

interface BacklinksResult {
  links: BacklinkEntry[];
  totalDomains: number;
  totalLinks: number;
  authorityScore: number;
  source: string;
  sourceLabel?: string;
  scoreLabel?: string;
}

export default function BacklinksPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacklinksResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSite = selectedSiteId
    ? sites.find((site) => site.id === selectedSiteId) ?? null
    : null;

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const list = data as Site[];
          setSites(list);
          if (list.length > 0) setSelectedSiteId(list[0].id);
        }
      })
      .catch(() => {});
  }, []);

  async function loadBacklinks() {
    if (!selectedSite) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/gsc-links?site_id=${selectedSite.id}`);
      const data = await res.json() as BacklinksResult & { error?: string };
      if (data.error) { setError(data.error); return; }
      setResult(data);
    } catch {
      setError("Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-400 hover:text-white transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Link2 className="w-6 h-6 text-blue-400" />
        <h1 className="text-xl font-bold">Backlinks &amp; Autorité</h1>
        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">GSC</span>
      </header>

      <div className="px-6 py-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap gap-3 mb-8">
          <select
            value={selectedSiteId ?? ""}
            onChange={(e) => {
              setSelectedSiteId(e.target.value ? parseInt(e.target.value, 10) : null);
              setResult(null);
            }}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.url}</option>
            ))}
          </select>

          <button
            onClick={loadBacklinks}
            disabled={loading || !selectedSite}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loading ? "Chargement..." : "Charger les backlinks"}
          </button>
        </div>

        {loading && (
          <div className="flex flex-col items-center gap-4 py-16 text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p>Récupération des données de liens...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 rounded-xl p-4">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
                  <Globe className="w-3 h-3" /> Domaines référents
                </div>
                <div className="text-3xl font-bold text-blue-400">{result.totalDomains.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
                  <BarChart2 className="w-3 h-3" /> Total liens
                </div>
                <div className="text-3xl font-bold text-purple-400">{result.totalLinks.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
                  <Shield className="w-3 h-3" /> {result.scoreLabel ?? "Score autorité"}
                </div>
                <div className={`text-3xl font-bold ${result.authorityScore >= 50 ? "text-green-400" : result.authorityScore >= 25 ? "text-yellow-400" : "text-red-400"}`}>
                  {result.authorityScore}/100
                </div>
              </div>
            </div>

            {/* Links table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Liens entrants</h2>
                <span className={`text-xs px-2 py-1 rounded ${result.source === "gsc_impressions_fallback" ? "text-yellow-400 bg-yellow-500/10" : "text-green-400 bg-green-500/10"}`}>
                  {result.sourceLabel ?? result.source}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                      <th className="py-3 px-4 text-left">Domaine référent</th>
                      <th className="py-3 px-4 text-left">Page cible</th>
                      <th className="py-3 px-4 text-right">Nb liens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.links.map((link, i) => (
                      <tr key={i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition">
                        <td className="py-3 px-4 text-blue-400 font-medium">{link.linking_domain}</td>
                        <td className="py-3 px-4 text-gray-400 text-xs max-w-xs truncate">{link.target_page}</td>
                        <td className="py-3 px-4 text-right text-gray-300">{link.link_count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-gray-600 text-center">
              {result.source === "gsc_impressions_fallback"
                ? "Estimation basée sur les impressions GSC, pas sur de vrais backlinks exportés."
                : "Données backlinks récupérées via Google Search Console."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
