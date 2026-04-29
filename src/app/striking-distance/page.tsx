"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, TrendingUp, Target } from "lucide-react";

interface Site { id: number; name: string; url: string }
interface StrikingRow {
  query: string; page: string; clicks: number; impressions: number;
  position: number; ctr: number; uplift_estimate: number; priority: "P0"|"P1"|"P2";
  site_id?: number | null; site_name?: string | null;
}

type SiteFilter = number | "all";

export default function StrikingDistancePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<SiteFilter | null>(null);
  const [rows, setRows] = useState<StrikingRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/sites").then(r => r.json()).then((data: unknown) => {
      if (Array.isArray(data)) {
        setSites(data as Site[]);
        if (data.length > 0) setSiteId("all");
      }
    });
  }, []);

  useEffect(() => {
    if (siteId === null) return;
    setLoading(true);
    const limit = siteId === "all" ? 300 : 100;
    fetch(`/api/striking-distance?siteId=${siteId}&days=28&limit=${limit}`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setRows(data as StrikingRow[]);
        setLoading(false);
      });
  }, [siteId]);

  const totalUplift = rows.reduce((s, r) => s + r.uplift_estimate, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <Target className="w-6 h-6 text-orange-500" />
          <h1 className="text-xl font-bold">Striking Distance</h1>
          <span className="text-xs text-gray-500">Pos 8-20 → page 1 facile</span>
        </div>
        <select value={siteId ?? ""} onChange={e => setSiteId(e.target.value === "all" ? "all" : parseInt(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
          <option value="all">🌐 Tous les sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </header>

      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Opportunités</div>
          <div className="text-2xl font-bold text-orange-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Uplift cumulé estimé (clics/mois)</div>
          <div className="text-2xl font-bold text-green-400">+{totalUplift.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Priorité P0</div>
          <div className="text-2xl font-bold text-red-400">{rows.filter(r => r.priority === "P0").length}</div>
        </div>
      </div>

      <div className="px-6 pb-10">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Aucune opportunité striking distance pour ce site sur 28j</div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-gray-400 text-xs">
                <tr>
                  <th className="text-left py-3 px-5">Mot clé</th>
                  {siteId === "all" && <th className="text-left py-3 px-3">Site</th>}
                  <th className="text-right py-3 px-3">Position</th>
                  <th className="text-right py-3 px-3">Clics</th>
                  <th className="text-right py-3 px-3">Impressions</th>
                  <th className="text-right py-3 px-3">CTR</th>
                  <th className="text-right py-3 px-3">Uplift si pos 5</th>
                  <th className="text-center py-3 px-3">Prio</th>
                  <th className="text-left py-3 px-5">Page</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="py-2 px-5 font-medium text-gray-200">{r.query}</td>
                    {siteId === "all" && (
                      <td className="py-2 px-3">
                        {r.site_name
                          ? <button onClick={() => setSiteId(r.site_id!)} className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50">{r.site_name}</button>
                          : <span className="text-gray-500 text-xs">—</span>
                        }
                      </td>
                    )}
                    <td className="text-right py-2 px-3">
                      <span className={r.position <= 10 ? "text-yellow-400" : "text-gray-300"}>{r.position}</span>
                    </td>
                    <td className="text-right py-2 px-3 text-blue-400">{r.clicks}</td>
                    <td className="text-right py-2 px-3 text-gray-400">{r.impressions.toLocaleString()}</td>
                    <td className="text-right py-2 px-3 text-gray-400">{r.ctr}%</td>
                    <td className="text-right py-2 px-3">
                      <span className="text-green-400 font-bold flex items-center justify-end gap-1">
                        <TrendingUp className="w-3 h-3" />+{r.uplift_estimate}
                      </span>
                    </td>
                    <td className="text-center py-2 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        r.priority === "P0" ? "bg-red-500/20 text-red-400" :
                        r.priority === "P1" ? "bg-yellow-500/20 text-yellow-400" :
                        "bg-gray-700 text-gray-400"}`}>
                        {r.priority}
                      </span>
                    </td>
                    <td className="py-2 px-5 text-xs text-gray-500 truncate max-w-xs" title={r.page}>
                      <a href={r.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {r.page.replace(/^https?:\/\//, "")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
