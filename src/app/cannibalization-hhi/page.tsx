"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

interface Site { id: number; name: string }
interface CannibRow {
  query: string; url_count: number;
  total_impressions: number; total_clicks: number;
  pages: { page: string; impressions: number; clicks: number; position: number }[];
  hhi: number;
  severity: "HIGH"|"MED"|"LOW";
  estimated_loss: number;
  suggested_action: string;
  site_id?: number | null; site_name?: string | null;
}

type SiteFilter = number | "all";
type SeverityOrder = "default" | "HIGH" | "MED" | "LOW";

const SEV_RANK: Record<string, number> = { HIGH: 3, MED: 2, LOW: 1 };

export default function CannibalizationHHIPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<SiteFilter | null>(null);
  const [rows, setRows] = useState<CannibRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [severitySort, setSeveritySort] = useState<SeverityOrder>("default");
  const [groupBySite, setGroupBySite] = useState(false);

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
    const limit = siteId === "all" ? 150 : 50;
    fetch(`/api/cannibalization-hhi?siteId=${siteId}&days=28&limit=${limit}`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setRows(data as CannibRow[]);
        setLoading(false);
      });
  }, [siteId]);

  const totalLoss = rows.reduce((s, r) => s + r.estimated_loss, 0);
  const high = rows.filter(r => r.severity === "HIGH").length;

  const sortedRows = [...rows].sort((a, b) => {
    if (severitySort === "default") return 0;
    const ra = SEV_RANK[a.severity] ?? 0;
    const rb = SEV_RANK[b.severity] ?? 0;
    return severitySort === "HIGH" ? rb - ra : ra - rb;
  });

  const groupedRows: { site: string; items: CannibRow[] }[] =
    groupBySite && siteId === "all"
      ? Object.entries(
          sortedRows.reduce<Record<string, CannibRow[]>>((acc, r) => {
            const key = r.site_name ?? "Sans site";
            (acc[key] ??= []).push(r);
            return acc;
          }, {})
        ).map(([site, items]) => ({ site, items }))
      : [{ site: "", items: sortedRows }];

  function cycleSeverity() {
    setSeveritySort(prev =>
      prev === "default" ? "HIGH" : prev === "HIGH" ? "LOW" : "default"
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <AlertTriangle className="w-6 h-6 text-red-500" />
          <h1 className="text-xl font-bold">Cannibalisation (HHI score)</h1>
        </div>
        <select value={siteId ?? ""} onChange={e => setSiteId(e.target.value === "all" ? "all" : parseInt(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
          <option value="all">🌐 Tous les sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </header>

      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Conflits détectés</div>
          <div className="text-2xl font-bold text-red-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Sévérité HIGH</div>
          <div className="text-2xl font-bold text-red-500">{high}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Clics perdus estimés (28j)</div>
          <div className="text-2xl font-bold text-orange-400">{totalLoss.toLocaleString()}</div>
        </div>
      </div>

      <div className="px-6 pb-10 space-y-2">
        {!loading && rows.length > 0 && (
          <div className="flex items-center gap-2 pb-2">
            <button onClick={cycleSeverity}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${severitySort !== "default" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              {severitySort === "default" ? "Trier: sévérité" : severitySort === "HIGH" ? "HIGH ↓" : "LOW ↑"}
            </button>
            {siteId === "all" && (
              <button onClick={() => setGroupBySite(g => !g)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${groupBySite ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                Grouper par site
              </button>
            )}
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-red-500" /></div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Pas de cannibalisation détectée 🎉</div>
        ) : (
          groupedRows.map(({ site, items }) => (
            <div key={site}>
              {groupBySite && siteId === "all" && site && (
                <div className="px-2 py-1.5 text-xs font-semibold text-blue-300 uppercase tracking-wider">
                  {site} <span className="text-gray-500 font-normal">({items.length})</span>
                </div>
              )}
              {items.map((r, i) => {
            const isOpen = expanded === r.query;
            return (
              <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-5 py-3 cursor-pointer hover:bg-gray-800/40 flex items-center justify-between"
                  onClick={() => setExpanded(isOpen ? null : r.query)}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      r.severity === "HIGH" ? "bg-red-500/20 text-red-400" :
                      r.severity === "MED" ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-gray-700 text-gray-400"}`}>
                      {r.severity}
                    </span>
                    <span className="font-medium truncate">{r.query}</span>
                    {siteId === "all" && r.site_name && (
                      <button onClick={e => { e.stopPropagation(); setSiteId(r.site_id!); }}
                        className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50 flex-shrink-0">
                        {r.site_name}
                      </button>
                    )}
                    <span className="text-xs text-gray-500">{r.url_count} URLs · HHI {r.hhi}</span>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <div className="text-orange-400 font-bold">-{r.estimated_loss}</div>
                      <div className="text-xs text-gray-500">clics perdus</div>
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
                          <th className="text-left py-1">Page</th>
                          <th className="text-right py-1">Position</th>
                          <th className="text-right py-1">Impressions</th>
                          <th className="text-right py-1">Clics</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.pages.map((p, j) => (
                          <tr key={j} className="border-t border-gray-800/40">
                            <td className="py-1 truncate max-w-md">
                              <a href={p.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                                {p.page.replace(/^https?:\/\//, "")}
                              </a>
                            </td>
                            <td className="text-right py-1">{p.position.toFixed(1)}</td>
                            <td className="text-right py-1 text-purple-400">{p.impressions.toLocaleString()}</td>
                            <td className="text-right py-1 text-blue-400">{p.clicks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
