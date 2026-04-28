"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, Sparkles } from "lucide-react";

interface Site { id: number; name: string }
interface AIORow {
  query: string; page: string; position: number;
  impressions: number; clicks: number;
  ctr_actual_pct: number; ctr_expected_pct: number; ctr_ratio: number;
  missed_clicks: number; aio_likely: boolean; recommendation: string;
}

export default function AIODetectorPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [rows, setRows] = useState<AIORow[]>([]);
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
    fetch(`/api/aio-detector?siteId=${siteId}&days=28&limit=100`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setRows(data as AIORow[]);
        setLoading(false);
      });
  }, [siteId]);

  const totalMissed = rows.reduce((s, r) => s + r.missed_clicks, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <Sparkles className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold">AI Overview Detector</h1>
          <span className="text-xs text-gray-500">queries informationnelles top 5 avec CTR anormalement bas</span>
        </div>
        <select value={siteId || ""} onChange={e => setSiteId(parseInt(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </header>

      <div className="px-6 py-3 mx-6 mt-4 bg-cyan-900/20 border border-cyan-700/40 rounded-lg text-xs text-cyan-200">
        💡 <strong>Méthode heuristique sans scraping</strong> — détection : queries informationnelles (comment/pourquoi/what/how) en top 5 avec CTR &lt; 50% du benchmark AWR. Pas 100% fiable, mais gratuit et instantané. Pour scraping SERP réel : intégrer Serper.dev / DataForSEO.
      </div>

      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Queries AIO suspect</div>
          <div className="text-2xl font-bold text-cyan-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Clics manqués (28j)</div>
          <div className="text-2xl font-bold text-red-400">-{totalMissed}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Très probable (ratio &lt; 0.3)</div>
          <div className="text-2xl font-bold text-red-500">{rows.filter(r => r.ctr_ratio < 0.3).length}</div>
        </div>
      </div>

      <div className="px-6 pb-10">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-cyan-500" /></div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Pas d&apos;impact AIO suspecté 🎯</div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-gray-400 text-xs">
                <tr>
                  <th className="text-left py-3 px-5">Query informationnelle</th>
                  <th className="text-right py-3 px-3">Pos</th>
                  <th className="text-right py-3 px-3">CTR actuel</th>
                  <th className="text-right py-3 px-3">CTR attendu</th>
                  <th className="text-right py-3 px-3">Ratio</th>
                  <th className="text-right py-3 px-3">Manqués</th>
                  <th className="text-left py-3 px-5">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="py-2 px-5 font-medium">
                      <a href={r.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {r.query}
                      </a>
                    </td>
                    <td className="text-right py-2 px-3 text-green-400">{r.position}</td>
                    <td className="text-right py-2 px-3 text-red-400">{r.ctr_actual_pct}%</td>
                    <td className="text-right py-2 px-3 text-gray-400">{r.ctr_expected_pct}%</td>
                    <td className="text-right py-2 px-3 font-bold text-cyan-400">{r.ctr_ratio}</td>
                    <td className="text-right py-2 px-3 text-orange-400 font-bold">-{r.missed_clicks}</td>
                    <td className="py-2 px-5 text-xs">{r.recommendation}</td>
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
