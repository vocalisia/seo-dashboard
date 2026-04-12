"use client";

import { useEffect, useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, Legend, CartesianGrid
} from "recharts";
import {
  Globe, MousePointerClick, Search, TrendingUp, Users,
  Eye, Loader2, BarChart3, ArrowLeft, Clock, Activity,
  Filter, ChevronDown
} from "lucide-react";
import Link from "next/link";

const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#f97316","#14b8a6","#6366f1","#84cc16","#f43f5e","#a855f7","#0ea5e9","#22c55e","#eab308"];

type Period = "3" | "7" | "30" | "90";

interface SiteSummary {
  site_id: number; name: string; url: string;
  clicks: number; impressions: number; position: number;
  sessions: number; users: number; pageviews: number;
  organic_sessions: number; avg_duration: number; bounce_rate: number;
  days_with_data: number;
}

interface DayRow {
  site_id: number; name: string; date: string;
  clicks?: number; impressions?: number; position?: number;
  sessions?: number; users?: number; pageviews?: number;
}

export default function OverviewPage() {
  const [period, setPeriod] = useState<Period>("30");
  // GSC has 2-3 day delay, GA4 has 1 day delay
  const [summary, setSummary] = useState<SiteSummary[]>([]);
  const [gscSeries, setGscSeries] = useState<DayRow[]>([]);
  const [ga4Series, setGa4Series] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSites, setSelectedSites] = useState<number[]>([]);
  const [sortMetric, setSortMetric] = useState<"clicks"|"impressions"|"sessions"|"position">("clicks");
  const [tableSortCol, setTableSortCol] = useState<"clicks"|"sessions"|"position"|"avg_duration"|"impressions">("clicks");
  const [tableSortDir, setTableSortDir] = useState<"asc"|"desc">("desc");
  const [showSiteFilter, setShowSiteFilter] = useState(false);
  const [activePanel, setActivePanel] = useState<"clicks"|"impressions"|"sessions"|"position">("clicks");

  useEffect(() => { loadAll(); }, [period]);

  async function loadAll() {
    setLoading(true);
    const [s, g, a] = await Promise.all([
      fetch(`/api/overview?type=summary&days=${period}`).then(r => r.json()),
      fetch(`/api/overview?type=gsc&days=${period}`).then(r => r.json()),
      fetch(`/api/overview?type=ga4&days=${period}`).then(r => r.json()),
    ]);
    if (Array.isArray(s)) { setSummary(s); if (selectedSites.length === 0) setSelectedSites(s.map((x: SiteSummary) => x.site_id)); }
    if (Array.isArray(g)) setGscSeries(g);
    if (Array.isArray(a)) setGa4Series(a);
    setLoading(false);
  }

  // Build time-series aggregated by date for selected sites
  const timeSeriesData = useMemo(() => {
    const src = activePanel === "sessions" || activePanel === "position" && ga4Series.length > 0 ? null : gscSeries;
    const series = activePanel === "sessions" ? ga4Series : gscSeries;
    const filtered = series.filter(r => selectedSites.includes(Number(r.site_id)));
    const byDate: Record<string, Record<string, number>> = {};
    filtered.forEach(r => {
      const d = r.date?.slice(5, 10) || r.date;
      if (!byDate[d]) byDate[d] = {};
      const key = r.name.length > 10 ? r.name.slice(0, 10) : r.name;
      const val = activePanel === "clicks" ? Number(r.clicks) || 0
        : activePanel === "impressions" ? Number(r.impressions) || 0
        : activePanel === "sessions" ? Number(r.sessions) || 0
        : Number(r.position) || 0;
      byDate[d] = { ...byDate[d], [key]: (byDate[d][key] || 0) + val };
    });
    return Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, vals]) => ({ date, ...vals }));
  }, [gscSeries, ga4Series, selectedSites, activePanel]);

  // Summary sorted (for bar chart)
  const sortedSummary = useMemo(() => {
    return [...summary].sort((a, b) => {
      if (sortMetric === "position") return (Number(a.position)||999) - (Number(b.position)||999);
      if (sortMetric === "impressions") return Number(b.impressions) - Number(a.impressions);
      if (sortMetric === "sessions") return Number(b.sessions||0) - Number(a.sessions||0);
      return Number(b.clicks) - Number(a.clicks);
    });
  }, [summary, sortMetric]);

  // Table sorted independently
  const tableSorted = useMemo(() => {
    return [...summary].sort((a, b) => {
      let va = 0, vb = 0;
      if (tableSortCol === "clicks") { va = Number(a.clicks||0); vb = Number(b.clicks||0); }
      else if (tableSortCol === "impressions") { va = Number(a.impressions||0); vb = Number(b.impressions||0); }
      else if (tableSortCol === "sessions") { va = Number(a.sessions||0); vb = Number(b.sessions||0); }
      else if (tableSortCol === "position") { va = Number(a.position)||999; vb = Number(b.position)||999; }
      else if (tableSortCol === "avg_duration") { va = Number(a.avg_duration||0); vb = Number(b.avg_duration||0); }
      return tableSortDir === "asc" ? va - vb : vb - va;
    });
  }, [summary, tableSortCol, tableSortDir]);

  function toggleTableSort(col: typeof tableSortCol) {
    if (tableSortCol === col) setTableSortDir(d => d === "desc" ? "asc" : "desc");
    else { setTableSortCol(col); setTableSortDir(col === "position" ? "asc" : "desc"); }
  }

  function SortArrow({ col }: { col: typeof tableSortCol }) {
    if (tableSortCol !== col) return <span className="text-gray-700 ml-0.5">⇅</span>;
    return <span className="text-blue-400 ml-0.5">{tableSortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const totals = useMemo(() => ({
    clicks: summary.reduce((s, x) => s + Number(x.clicks||0), 0),
    impressions: summary.reduce((s, x) => s + Number(x.impressions||0), 0),
    sessions: summary.reduce((s, x) => s + Number(x.sessions||0), 0),
    users: summary.reduce((s, x) => s + Number(x.users||0), 0),
    activeSites: summary.filter(x => Number(x.clicks) > 0).length,
    avgPos: (() => { const a = summary.filter(x => Number(x.position) > 0); return a.length ? a.reduce((s,x)=>s+Number(x.position),0)/a.length : 0; })(),
  }), [summary]);

  const periodLabel = { "3": "3 derniers jours", "7": "7 jours", "30": "30 jours", "90": "90 jours" };
  const siteNames = useMemo(() => {
    const m: Record<number, string> = {};
    summary.forEach((s, i) => { m[s.site_id] = s.name; });
    return m;
  }, [summary]);

  const panelMeta = [
    { key: "clicks" as const, label: "Clics", icon: MousePointerClick, color: "#3b82f6", total: totals.clicks },
    { key: "impressions" as const, label: "Impressions", icon: Search, color: "#8b5cf6", total: totals.impressions },
    { key: "sessions" as const, label: "Sessions GA4", icon: Users, color: "#10b981", total: totals.sessions },
    { key: "position" as const, label: "Position moy.", icon: Globe, color: "#f59e0b", total: totals.avgPos, isAvg: true },
  ];

  const lineKeys = useMemo(() => {
    if (timeSeriesData.length === 0) return [];
    const keys = Object.keys(timeSeriesData[0]).filter(k => k !== "date");
    return keys.slice(0, 8); // max 8 lines
  }, [timeSeriesData]);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* ── TOP BANNER ── */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-3 overflow-x-auto">
        <div className="flex items-center gap-6 min-w-max">
          <div className="flex items-center gap-2 text-xs text-gray-500 font-medium mr-2">
            <Activity className="w-3.5 h-3.5" /> VISITES PAR SITE
          </div>
          {summary.slice(0, 12).map((s, i) => (
            <div key={s.site_id} className="flex items-center gap-2 text-xs border-r border-gray-700 pr-5 last:border-0">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <div>
                <div className="text-gray-300 font-medium truncate max-w-[80px]">{s.name}</div>
                <div className="text-blue-400 font-bold">{Number(s.clicks||0).toLocaleString()} clics</div>
                {s.sessions > 0 && <div className="text-green-400">{Number(s.sessions).toLocaleString()} sess.</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HEADER ── */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white"><ArrowLeft className="w-5 h-5" /></Link>
          <BarChart3 className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-bold">Vue Globale</h1>
          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">{summary.length} sites</span>
          <span className="text-xs text-gray-600 hidden md:block">· GSC délai 2-3j · GA4 délai 1j</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period */}
          <div className="flex bg-gray-800 border border-gray-700 rounded-lg overflow-hidden text-xs">
            {(["3","7","30","90"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-2 transition ${period === p ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
                {p === "3" ? "3j" : `${p}j`}
              </button>
            ))}
          </div>
          {/* Site filter */}
          <div className="relative">
            <button onClick={() => setShowSiteFilter(!showSiteFilter)}
              className="flex items-center gap-1.5 bg-gray-800 border border-gray-700 px-3 py-2 rounded-lg text-xs text-gray-300 hover:text-white">
              <Filter className="w-3.5 h-3.5" />
              {selectedSites.length === summary.length ? "Tous les sites" : `${selectedSites.length} sites`}
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSiteFilter && (
              <div className="absolute right-0 top-10 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-3 w-56 space-y-1 max-h-64 overflow-y-auto">
                <button onClick={() => setSelectedSites(summary.map(s => s.site_id))}
                  className="w-full text-left text-xs text-blue-400 hover:text-blue-300 px-2 py-1">Tout sélectionner</button>
                <button onClick={() => setSelectedSites([])}
                  className="w-full text-left text-xs text-gray-500 hover:text-gray-300 px-2 py-1">Tout déselectionner</button>
                <div className="border-t border-gray-700 pt-1">
                  {summary.map((s, i) => (
                    <label key={s.site_id} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-800 rounded cursor-pointer text-xs">
                      <input type="checkbox" checked={selectedSites.includes(s.site_id)}
                        onChange={e => setSelectedSites(prev => e.target.checked ? [...prev, s.site_id] : prev.filter(id => id !== s.site_id))}
                        className="accent-blue-500" />
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="truncate text-gray-300">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Sort */}
          <select value={sortMetric} onChange={e => setSortMetric(e.target.value as typeof sortMetric)}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2">
            <option value="clicks">Trier: Clics</option>
            <option value="impressions">Trier: Impressions</option>
            <option value="sessions">Trier: Sessions</option>
            <option value="position">Trier: Position</option>
          </select>
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <div className="flex-1 px-6 py-5 space-y-5">

          {/* ── KPI CARDS ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {panelMeta.map(m => (
              <button key={m.key} onClick={() => setActivePanel(m.key)}
                className={`text-left bg-gray-900 rounded-xl border p-4 transition ${activePanel === m.key ? "border-blue-500" : "border-gray-800 hover:border-gray-600"}`}>
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-2"><m.icon className="w-3.5 h-3.5" />{m.label} ({periodLabel[period]})</div>
                <div className="text-2xl font-bold" style={{ color: m.color }}>
                  {m.isAvg ? (m.total > 0 ? m.total.toFixed(1) : "—") : m.total.toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">~{m.isAvg ? "moy." : Math.round(m.total / parseInt(period))}/jour</div>
              </button>
            ))}
          </div>

          {/* ── EVOLUTION CHART (MULTI-SITE) ── */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold text-gray-300">
                Évolution — {panelMeta.find(m => m.key === activePanel)?.label} · {periodLabel[period]}
                <span className="text-xs text-gray-500 ml-2">(clic sur les KPIs pour changer)</span>
              </div>
            </div>
            {timeSeriesData.length === 0 ? (
              <div className="py-10 text-center text-gray-500 text-sm">Pas de données pour la période sélectionnée</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timeSeriesData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} width={40}
                    reversed={activePanel === "position"} />
                  <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: "#9ca3af" }} />
                  {lineKeys.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── 2 PANELS CÔTE À CÔTE ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Classement barre */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <div className="text-sm font-semibold text-gray-300 mb-4">
                Classement — {sortMetric === "clicks" ? "Clics" : sortMetric === "impressions" ? "Impressions" : sortMetric === "sessions" ? "Sessions" : "Position"} ({periodLabel[period]})
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart layout="vertical"
                  data={sortedSummary.slice(0, 10).map((s, i) => ({
                    name: s.name.length > 14 ? s.name.slice(0, 14) + "…" : s.name,
                    value: sortMetric === "clicks" ? Number(s.clicks||0)
                      : sortMetric === "impressions" ? Number(s.impressions||0)
                      : sortMetric === "sessions" ? Number(s.sessions||0)
                      : Number(s.position||0),
                    color: COLORS[summary.findIndex(x => x.site_id === s.site_id) % COLORS.length],
                  }))}
                  margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 10 }} tickLine={false} axisLine={false} width={90} />
                  <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="value" radius={[0,4,4,0]}>
                    {sortedSummary.slice(0, 10).map((s, i) => (
                      <Cell key={i} fill={COLORS[summary.findIndex(x => x.site_id === s.site_id) % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table détaillée */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 overflow-auto">
              <div className="text-sm font-semibold text-gray-300 mb-3">Tous les sites — détail</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 pr-3">Site</th>
                    {([
                      { col: "clicks" as const, label: "Clics" },
                      { col: "sessions" as const, label: "Sessions" },
                      { col: "position" as const, label: "Pos." },
                      { col: "avg_duration" as const, label: "Dur. moy." },
                    ]).map(({ col, label }) => (
                      <th key={col} onClick={() => toggleTableSort(col)}
                        className="text-right py-1.5 px-2 cursor-pointer hover:text-gray-300 select-none whitespace-nowrap">
                        {label}<SortArrow col={col} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableSorted.map((s, i) => {
                    const pos = Number(s.position||0);
                    const dur = Number(s.avg_duration||0);
                    return (
                      <tr key={s.site_id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[summary.findIndex(x=>x.site_id===s.site_id) % COLORS.length] }} />
                            <span className="text-gray-200 truncate max-w-[100px]">{s.name}</span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 text-blue-400 font-bold">{Number(s.clicks||0).toLocaleString()}</td>
                        <td className="text-right py-2 px-2 text-green-400">{Number(s.sessions||0) > 0 ? Number(s.sessions).toLocaleString() : "—"}</td>
                        <td className={`text-right py-2 px-2 font-bold ${pos > 0 && pos <= 10 ? "text-green-400" : pos <= 20 ? "text-yellow-400" : pos > 0 ? "text-red-400" : "text-gray-600"}`}>
                          {pos > 0 ? pos.toFixed(1) : "—"}
                        </td>
                        <td className="text-right py-2 pl-2 text-gray-400">
                          {dur > 0 ? `${Math.floor(dur/60)}m${Math.floor(dur%60)}s` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── MINI CARDS GRILLE ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {sortedSummary.map((s, i) => {
              const pos = Number(s.position||0);
              const idx = summary.findIndex(x => x.site_id === s.site_id);
              const dur = Number(s.avg_duration||0);
              return (
                <div key={s.site_id} className="bg-gray-900 rounded-xl border border-gray-800 p-3 hover:border-gray-600 transition">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <span className="text-xs font-semibold truncate">{s.name}</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-gray-500">Clics</span><span className="text-blue-400 font-bold">{Number(s.clicks||0).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Impressions</span><span className="text-purple-400">{Number(s.impressions||0).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Sessions</span><span className="text-green-400">{s.sessions > 0 ? Number(s.sessions).toLocaleString() : "—"}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Position</span>
                      <span className={`font-bold ${pos <= 10 ? "text-green-400" : pos <= 20 ? "text-yellow-400" : "text-red-400"}`}>{pos > 0 ? pos.toFixed(1) : "—"}</span>
                    </div>
                    {dur > 0 && <div className="flex justify-between"><span className="text-gray-500">Durée</span><span className="text-gray-300">{Math.floor(dur/60)}m{Math.floor(dur%60)}s</span></div>}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}
