"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, TrendingDown } from "lucide-react";

interface Site { id: number; name: string }
interface DecayRow {
  page: string; query: string;
  clicks_recent: number; clicks_older: number; clicks_drop_pct: number;
  position_recent: number; position_older: number; position_drop: number;
  ctr_drop_pct: number;
  severity: "CRIT"|"HIGH"|"MED"; reason: string;
}

export default function ContentDecayPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [rows, setRows] = useState<DecayRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/sites").then(r => r.json()).then((data: unknown) => {
      if (Array.isArray(data)) {
        setSites(data as Site[]);
        if (data.length > 0) setSiteId((data[0] as Site).id);
      }
    });
  }, []);

  useEffect(() => {
    if (!siteId) return;
    setLoading(true);
    fetch(`/api/content-decay?siteId=${siteId}&limit=100`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setRows(data as DecayRow[]);
        setLoading(false);
      });
  }, [siteId]);

  const crit = rows.filter(r => r.severity === "CRIT").length;
  const totalLost = rows.reduce((s, r) => s + Math.max(0, r.clicks_older - r.clicks_recent), 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <TrendingDown className="w-6 h-6 text-red-500" />
          <h1 className="text-xl font-bold">Content Decay</h1>
          <span className="text-xs text-gray-500">14j récents vs 28j précédents</span>
        </div>
        <select value={siteId || ""} onChange={e => setSiteId(parseInt(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </header>

      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Pages en déclin</div>
          <div className="text-2xl font-bold text-red-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">CRITIQUE (chute &gt;50%)</div>
          <div className="text-2xl font-bold text-red-500">{crit}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Clics perdus 14j</div>
          <div className="text-2xl font-bold text-orange-400">-{totalLost}</div>
        </div>
      </div>

      <div className="px-6 pb-10">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-red-500" /></div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Aucun contenu en déclin détecté 🎉</div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-gray-400 text-xs">
                <tr>
                  <th className="text-center py-3 px-3">Sév.</th>
                  <th className="text-left py-3 px-3">Mot clé</th>
                  <th className="text-right py-3 px-3">Clics récent</th>
                  <th className="text-right py-3 px-3">Clics ancien</th>
                  <th className="text-right py-3 px-3">Δ clics</th>
                  <th className="text-right py-3 px-3">Pos. récente</th>
                  <th className="text-right py-3 px-3">Δ pos.</th>
                  <th className="text-left py-3 px-5">Diagnostic</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="text-center py-2 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        r.severity === "CRIT" ? "bg-red-500/30 text-red-300" :
                        r.severity === "HIGH" ? "bg-orange-500/20 text-orange-400" :
                        "bg-yellow-500/20 text-yellow-400"}`}>
                        {r.severity}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium">
                      <a href={r.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {r.query}
                      </a>
                    </td>
                    <td className="text-right py-2 px-3 text-blue-400">{r.clicks_recent}</td>
                    <td className="text-right py-2 px-3 text-gray-400">{r.clicks_older}</td>
                    <td className="text-right py-2 px-3 font-bold text-red-400">{r.clicks_drop_pct}%</td>
                    <td className="text-right py-2 px-3">{r.position_recent}</td>
                    <td className={`text-right py-2 px-3 font-bold ${r.position_drop >= 2 ? "text-red-400" : "text-gray-500"}`}>
                      {r.position_drop > 0 ? "+" : ""}{r.position_drop}
                    </td>
                    <td className="py-2 px-5 text-xs">{r.reason}</td>
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
