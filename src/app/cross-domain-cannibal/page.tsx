"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, GitMerge, ChevronDown, ChevronRight } from "lucide-react";

interface SitePerf {
  site_id: number; site_name: string; page: string;
  clicks: number; impressions: number; position: number;
}
interface Conflict {
  query: string;
  total_impressions: number; total_clicks: number;
  sites_count: number; sites: SitePerf[];
  best_site: string; worst_position_diff: number;
  suggested_action: string;
}

export default function CrossDomainCannibalPage() {
  const [rows, setRows] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cross-domain-cannibal?days=28&limit=100")
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setRows(data as Conflict[]);
        setLoading(false);
      });
  }, []);

  const totalImp = rows.reduce((s, r) => s + r.total_impressions, 0);
  const allSites = new Set<string>();
  rows.forEach(r => r.sites.forEach(s => allSites.add(s.site_name)));

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <GitMerge className="w-6 h-6 text-pink-500" />
          <h1 className="text-xl font-bold">Cross-domain Cannibalisation</h1>
          <span className="text-xs text-gray-500">Ton portfolio se bat contre lui-même</span>
        </div>
      </header>

      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Conflits inter-sites</div>
          <div className="text-2xl font-bold text-pink-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Sites impliqués</div>
          <div className="text-2xl font-bold text-purple-400">{allSites.size}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Impressions cumulées</div>
          <div className="text-2xl font-bold text-blue-400">{totalImp.toLocaleString()}</div>
        </div>
      </div>

      <div className="px-6 pb-10 space-y-2">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-pink-500" /></div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Aucun conflit cross-domain — tes sites se respectent 🎉</div>
        ) : (
          rows.map((r, i) => {
            const isOpen = expanded === r.query;
            return (
              <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-5 py-3 cursor-pointer hover:bg-gray-800/40 flex items-center justify-between"
                  onClick={() => setExpanded(isOpen ? null : r.query)}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className="font-medium">{r.query}</span>
                    <span className="text-xs text-gray-500">{r.sites_count} sites · best: {r.best_site}</span>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <div className="text-blue-400">{r.total_clicks}</div>
                      <div className="text-xs text-gray-500">clics</div>
                    </div>
                    <div className="text-right">
                      <div className="text-purple-400">{r.total_impressions.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">impressions</div>
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-gray-800 bg-gray-950/50 px-5 py-3">
                    <div className="text-xs text-yellow-400 mb-2">{r.suggested_action}</div>
                    <table className="w-full text-xs">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left py-1">Site</th>
                          <th className="text-left py-1">Page</th>
                          <th className="text-right py-1">Position</th>
                          <th className="text-right py-1">Impressions</th>
                          <th className="text-right py-1">Clics</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.sites.map((s, j) => (
                          <tr key={j} className="border-t border-gray-800/40">
                            <td className="py-1 font-medium text-pink-400">{s.site_name}</td>
                            <td className="py-1 truncate max-w-md text-gray-400">
                              <a href={s.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                                {s.page.replace(/^https?:\/\//, "").substring(0, 60)}
                              </a>
                            </td>
                            <td className={`text-right py-1 ${s.position <= 10 ? "text-green-400" : "text-gray-300"}`}>
                              {s.position.toFixed(1)}
                            </td>
                            <td className="text-right py-1 text-purple-400">{s.impressions.toLocaleString()}</td>
                            <td className="text-right py-1 text-blue-400">{s.clicks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
