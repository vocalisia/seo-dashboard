"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, TrendingDown, Zap } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; }

interface DecliningPage {
  page: string;
  clicks_now: number;
  clicks_prev: number;
  pos_now: number;
  pos_prev: number;
  clicks_decline: number;
  position_decline: number;
}

interface RefreshSuggestion {
  id: number;
  page_url: string;
  suggestions: Record<string, string>;
  status: string;
  created_at: string;
}

export default function RefreshPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [declining, setDeclining] = useState<DecliningPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<RefreshSuggestion[]>([]);

  const fetchSites = async () => {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) { setSites(list); if (!selectedSite) setSelectedSite(list[0].id); }
    } catch { /* ignore */ }
  };

  const fetchDeclining = async () => {
    if (!selectedSite) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/content-refresh?site_id=${selectedSite}`);
      const d = await res.json() as { declining?: DecliningPage[]; suggestions?: RefreshSuggestion[] };
      setDeclining(d.declining ?? []);
      setSuggestions(d.suggestions ?? []);
    } catch { setDeclining([]); }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchSites(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedSite) void fetchDeclining(); }, [selectedSite]);

  async function optimize(pageUrl: string) {
    if (!selectedSite) return;
    setOptimizing(pageUrl);
    try {
      const res = await fetch("/api/content-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, page_url: pageUrl }),
      });
      const d = await res.json() as { success: boolean };
      if (d.success) await fetchDeclining();
    } catch { /* ignore */ }
    setOptimizing(null);
  }

  function truncateUrl(url: string) {
    try {
      const u = new URL(url);
      return u.pathname.length > 50 ? u.pathname.slice(0, 50) + "…" : u.pathname;
    } catch { return url.slice(0, 50); }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <RefreshCw className="w-5 h-5 text-amber-400" />
        <h1 className="text-xl font-semibold">Content Refresh</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="text-xs text-gray-500">Pages en déclin → suggestions d&apos;optimisation IA</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : declining.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <TrendingDown className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <div className="text-gray-500 text-sm">Aucune page en déclin détectée (ou pas assez de données)</div>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                Pages en déclin ({declining.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left">Page</th>
                    <th className="px-5 py-3 text-right">Clics (avant)</th>
                    <th className="px-5 py-3 text-right">Clics (mnt)</th>
                    <th className="px-5 py-3 text-right">Pos. (avant)</th>
                    <th className="px-5 py-3 text-right">Pos. (mnt)</th>
                    <th className="px-5 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {declining.map((p, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-5 py-3">
                        <a href={p.page} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs">
                          {truncateUrl(p.page)}
                        </a>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-400">{p.clicks_prev}</td>
                      <td className="px-5 py-3 text-right text-red-400 font-medium">{p.clicks_now}</td>
                      <td className="px-5 py-3 text-right text-gray-400">{Number(p.pos_prev).toFixed(1)}</td>
                      <td className="px-5 py-3 text-right text-red-400">{Number(p.pos_now).toFixed(1)}</td>
                      <td className="px-5 py-3 text-center">
                        <button
                          onClick={() => optimize(p.page)}
                          disabled={optimizing === p.page}
                          className="px-3 py-1 bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 rounded text-xs font-medium flex items-center gap-1 mx-auto disabled:opacity-50"
                        >
                          {optimizing === p.page ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                          Optimiser
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Suggestions d&apos;optimisation ({suggestions.length})
              </h2>
            </div>
            <div className="divide-y divide-gray-800">
              {suggestions.map((s) => (
                <div key={s.id} className="px-5 py-4">
                  <div className="text-xs text-blue-400 mb-2">{truncateUrl(s.page_url)}</div>
                  <pre className="text-xs text-gray-300 bg-gray-800/50 rounded p-3 overflow-auto whitespace-pre-wrap max-h-[300px]">
                    {typeof s.suggestions === "string" ? s.suggestions : JSON.stringify(s.suggestions, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
