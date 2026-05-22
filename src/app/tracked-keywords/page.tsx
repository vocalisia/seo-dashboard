"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Filter, TrendingUp } from "lucide-react";

interface SiteRow {
  id: number;
  name: string;
  url: string;
}

interface KeywordRow {
  id: number;
  keyword: string;
  market: string | null;
  volume_fr: number | null;
  volume_market: number | null;
  current_position: number | null;
  current_impressions: number | null;
  current_clicks: number | null;
  site_id: number;
  site_name: string;
  site_url: string;
}

function positionColor(pos: number | null): string {
  if (pos === null) return "text-gray-500";
  if (pos <= 3) return "text-green-400 font-bold";
  if (pos <= 10) return "text-yellow-400";
  if (pos <= 20) return "text-orange-400";
  return "text-red-400";
}

function marketBadge(mkt: string | null): string {
  const map: Record<string, string> = {
    FR: "bg-blue-900 text-blue-200",
    CH: "bg-red-900 text-red-200",
    BE: "bg-yellow-900 text-yellow-200",
    CA: "bg-purple-900 text-purple-200",
    DE: "bg-gray-700 text-gray-200",
    IT: "bg-green-900 text-green-200",
  };
  return map[mkt || ""] || "bg-gray-700 text-gray-300";
}

export default function TrackedKeywordsPage() {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteId, setSiteId] = useState<string>("all");
  const [minVol, setMinVol] = useState<number>(0);
  const [onlyQuickWins, setOnlyQuickWins] = useState<boolean>(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, minVol, onlyQuickWins]);

  async function load(): Promise<void> {
    setLoading(true);
    const params = new URLSearchParams({
      siteId,
      minVol: String(minVol),
      quickWins: onlyQuickWins ? "1" : "0",
    });
    const r = await fetch(`/api/tracked-keywords?${params}`);
    const j = await r.json();
    setSites(j.sites || []);
    setKeywords(j.keywords || []);
    setLoading(false);
  }

  const totals = useMemo(() => {
    const totalVol = keywords.reduce((a, k) => a + (k.volume_market || 0), 0);
    const totalClicks = keywords.reduce((a, k) => a + (k.current_clicks || 0), 0);
    const totalImpr = keywords.reduce((a, k) => a + (k.current_impressions || 0), 0);
    return { totalVol, totalClicks, totalImpr };
  }, [keywords]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/dashboard" className="text-sm text-gray-400 hover:text-white flex items-center gap-1 mb-2">
              <ArrowLeft className="w-4 h-4" /> Dashboard
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-6 h-6" /> Tracked Keywords — Volumes & Positions
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              GSC data + volume estimates per market (FR/CH/BE/CA).
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-900 rounded-lg p-4 mb-4 flex flex-wrap items-center gap-3">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="all">All sites ({sites.length})</option>
            {sites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>

          <label className="text-sm flex items-center gap-2">
            Min volume:
            <input
              type="number"
              value={minVol}
              onChange={(e) => setMinVol(parseInt(e.target.value || "0", 10))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm w-24"
              min={0}
            />
          </label>

          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyQuickWins}
              onChange={(e) => setOnlyQuickWins(e.target.checked)}
              className="accent-green-500"
            />
            Quick-wins only (pos 4-15, vol &gt; 100)
          </label>

          <div className="ml-auto text-xs text-gray-400">
            <span className="mr-3">{keywords.length} keywords</span>
            <span className="mr-3">Vol total: {totals.totalVol.toLocaleString()}</span>
            <span className="mr-3">Impr total: {totals.totalImpr.toLocaleString()}</span>
            <span>Clicks total: {totals.totalClicks.toLocaleString()}</span>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : keywords.length === 0 ? (
          <div className="bg-gray-900 rounded-lg p-8 text-center text-gray-400">
            No keywords match these filters.
          </div>
        ) : (
          <div className="bg-gray-900 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Site</th>
                  <th className="px-2 py-3 text-center">Mkt</th>
                  <th className="px-4 py-3 text-left">Keyword</th>
                  <th className="px-3 py-3 text-right">Position</th>
                  <th className="px-3 py-3 text-right">Impr</th>
                  <th className="px-3 py-3 text-right">Clicks</th>
                  <th className="px-3 py-3 text-right">Vol FR</th>
                  <th className="px-3 py-3 text-right">Vol Market</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {keywords.map((k) => (
                  <tr key={k.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-xs text-gray-300">{k.site_name}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${marketBadge(k.market)}`}>
                        {k.market || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-100">{k.keyword}</td>
                    <td className={`px-3 py-2 text-right ${positionColor(k.current_position)}`}>
                      {k.current_position?.toFixed(1) || "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-400">{k.current_impressions ?? 0}</td>
                    <td className="px-3 py-2 text-right text-gray-200">{k.current_clicks ?? 0}</td>
                    <td className="px-3 py-2 text-right text-gray-400">
                      {k.volume_fr ? k.volume_fr.toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-yellow-300 font-medium">
                      {k.volume_market ? k.volume_market.toLocaleString() : "-"}
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
