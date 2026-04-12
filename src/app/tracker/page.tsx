"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; }

interface DayData {
  date: string;
  position: number | null;
  clicks: number;
  impressions: number;
}

interface KwHistory {
  keyword: string;
  history: { date: string; position: number; clicks: number }[];
}

interface TrackerData {
  success: boolean;
  site_history: DayData[];
  keywords: KwHistory[];
}

export default function TrackerPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { void fetchSites(); }, []);
  useEffect(() => { if (selectedSite) void fetchData(); }, [selectedSite]);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) { setSites(list); if (!selectedSite) setSelectedSite(list[0].id); }
    } catch { /* ignore */ }
  }

  async function fetchData() {
    if (!selectedSite) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/position-history?site_id=${selectedSite}&days=90`);
      const d = await res.json() as TrackerData;
      setData(d);
    } catch { setData(null); }
    setLoading(false);
  }

  // Mini sparkline chart (pure CSS)
  function Sparkline({ values, color = "emerald", inverted = false }: { values: number[]; color?: string; inverted?: boolean }) {
    if (values.length < 2) return <span className="text-gray-600 text-xs">—</span>;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return (
      <div className="flex items-end gap-[1px] h-8">
        {values.slice(-30).map((v, i) => {
          const pct = inverted ? (1 - (v - min) / range) : (v - min) / range;
          return (
            <div
              key={i}
              className={`w-1.5 rounded-sm bg-${color}-500/60`}
              style={{ height: `${Math.max(8, pct * 100)}%` }}
            />
          );
        })}
      </div>
    );
  }

  // Simple bar chart
  function BarChart({ data: chartData, label }: { data: { date: string; value: number }[]; label: string }) {
    if (chartData.length === 0) return null;
    const max = Math.max(...chartData.map((d) => d.value), 1);
    return (
      <div>
        <div className="text-xs text-gray-400 mb-2">{label}</div>
        <div className="flex items-end gap-[2px] h-24">
          {chartData.slice(-30).map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center group relative">
              <div
                className="w-full bg-blue-500/50 rounded-t-sm hover:bg-blue-400/70 transition-colors"
                style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
              />
              <div className="absolute -top-6 hidden group-hover:block bg-gray-800 text-xs text-white px-1.5 py-0.5 rounded whitespace-nowrap">
                {d.date.slice(5)}: {d.value}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>{chartData[Math.max(0, chartData.length - 30)]?.date.slice(5)}</span>
          <span>{chartData[chartData.length - 1]?.date.slice(5)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <BarChart3 className="w-5 h-5 text-blue-400" />
        <h1 className="text-xl font-semibold">Position Tracker</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        )}

        {!loading && data && (
          <>
            {/* Site-level charts */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <BarChart
                  data={data.site_history.map((d) => ({ date: d.date, value: d.clicks }))}
                  label="Clics / jour (30 derniers jours)"
                />
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <BarChart
                  data={data.site_history.map((d) => ({ date: d.date, value: d.impressions }))}
                  label="Impressions / jour (30 derniers jours)"
                />
              </div>
            </div>

            {/* Keywords position evolution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-medium text-gray-200 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Top 10 mots-clés — évolution position (90j)
                </h2>
              </div>
              {data.keywords.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">Pas assez de données</div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {data.keywords.map((kw) => {
                    const hist = kw.history;
                    const positions = hist.map((h) => h.position);
                    const first = positions[0];
                    const last = positions[positions.length - 1];
                    const delta = first && last ? first - last : 0; // positive = improvement

                    return (
                      <div key={kw.keyword} className="px-5 py-4 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{kw.keyword}</div>
                          <div className="text-xs text-gray-500">
                            {hist.length} points · pos {last?.toFixed(1) ?? "—"}
                          </div>
                        </div>
                        <div className="w-40">
                          <Sparkline values={positions} color={delta > 0 ? "emerald" : "red"} inverted />
                        </div>
                        <div className={`flex items-center gap-1 w-20 justify-end text-sm font-semibold ${
                          delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-gray-500"
                        }`}>
                          {delta > 0 ? <TrendingUp className="w-4 h-4" /> : delta < 0 ? <TrendingDown className="w-4 h-4" /> : null}
                          {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
