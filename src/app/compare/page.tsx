"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, ArrowLeftRight, TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; }

interface SiteStats {
  name: string;
  clicks: number;
  impressions: number;
  avg_position: number;
  sessions: number;
  users: number;
  articles: number;
  top_keywords: string[];
}

interface CompareData {
  success: boolean;
  site_a: SiteStats;
  site_b: SiteStats;
}

function DeltaCell({ a, b, inverted = false }: { a: number; b: number; inverted?: boolean }) {
  const diff = a - b;
  const better = inverted ? diff < 0 : diff > 0;
  const color = diff === 0 ? "text-gray-500" : better ? "text-emerald-400" : "text-red-400";
  return (
    <span className={`text-xs font-medium ${color}`}>
      {diff > 0 ? "+" : ""}{inverted ? diff.toFixed(1) : diff.toLocaleString()}
    </span>
  );
}

function StatRow({ label, valA, valB, inverted = false, format = "number" }: {
  label: string; valA: number; valB: number; inverted?: boolean; format?: string;
}) {
  const fmtA = format === "decimal" ? valA.toFixed(1) : valA.toLocaleString();
  const fmtB = format === "decimal" ? valB.toFixed(1) : valB.toLocaleString();
  const betterA = inverted ? valA < valB : valA > valB;
  const betterB = inverted ? valB < valA : valB > valA;

  return (
    <div className="grid grid-cols-[1fr_100px_80px_100px_1fr] items-center py-3 border-b border-gray-800/50">
      <div className={`text-right text-sm font-semibold ${betterA ? "text-emerald-400" : "text-white"}`}>
        {fmtA}
      </div>
      <div className="text-center">
        {betterA ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mx-auto" /> :
         betterB ? <TrendingDown className="w-3.5 h-3.5 text-red-400 mx-auto" /> :
         <span className="text-gray-600">—</span>}
      </div>
      <div className="text-center text-xs text-gray-400 font-medium">{label}</div>
      <div className="text-center">
        {betterB ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mx-auto" /> :
         betterA ? <TrendingDown className="w-3.5 h-3.5 text-red-400 mx-auto" /> :
         <span className="text-gray-600">—</span>}
      </div>
      <div className={`text-left text-sm font-semibold ${betterB ? "text-emerald-400" : "text-white"}`}>
        {fmtB}
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteA, setSiteA] = useState<number | null>(null);
  const [siteB, setSiteB] = useState<number | null>(null);
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      setSites(list);
      if (list.length >= 2) {
        setSiteA(list[0].id);
        setSiteB(list[1].id);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const id = setTimeout(() => { void fetchSites(); }, 0);
    return () => clearTimeout(id);
  }, []);

  async function compare() {
    if (!siteA || !siteB) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/compare?site_a=${siteA}&site_b=${siteB}`);
      const d = await res.json() as CompareData;
      if (d.success) setData(d);
    } catch { setData(null); }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <ArrowLeftRight className="w-5 h-5 text-pink-400" />
        <h1 className="text-xl font-semibold">Comparer 2 Sites</h1>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {sites.length < 2 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 text-sm text-gray-400">
            Tu dois avoir au moins 2 sites pour comparer. Ajoute-en via{" "}
            <Link href="/dashboard" className="text-blue-400 hover:text-blue-300 underline">Dashboard</Link>.
          </div>
        )}
        {/* Selectors */}
        <div className="flex items-center gap-4 justify-center">
          <select value={siteA ?? ""} onChange={(e) => setSiteA(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-52">
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <ArrowLeftRight className="w-5 h-5 text-gray-500" />
          <select value={siteB ?? ""} onChange={(e) => setSiteB(parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-52">
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button onClick={compare} disabled={loading || !siteA || !siteB}
            className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            Comparer
          </button>
        </div>

        {data && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            {/* Headers */}
            <div className="grid grid-cols-[1fr_100px_80px_100px_1fr] items-center pb-4 border-b border-gray-700 mb-2">
              <div className="text-right text-lg font-bold text-white">{data.site_a.name}</div>
              <div />
              <div className="text-center text-xs text-gray-500">VS</div>
              <div />
              <div className="text-left text-lg font-bold text-white">{data.site_b.name}</div>
            </div>

            <StatRow label="Clics" valA={data.site_a.clicks} valB={data.site_b.clicks} />
            <StatRow label="Impr." valA={data.site_a.impressions} valB={data.site_b.impressions} />
            <StatRow label="Position" valA={data.site_a.avg_position} valB={data.site_b.avg_position} inverted format="decimal" />
            <StatRow label="Sessions" valA={data.site_a.sessions} valB={data.site_b.sessions} />
            <StatRow label="Users" valA={data.site_a.users} valB={data.site_b.users} />
            <StatRow label="Articles" valA={data.site_a.articles} valB={data.site_b.articles} />

            {/* Top keywords comparison */}
            <div className="grid grid-cols-2 gap-6 mt-6 pt-4 border-t border-gray-700">
              <div>
                <div className="text-xs text-gray-400 mb-2 font-medium">Top mots-clés — {data.site_a.name}</div>
                <div className="space-y-1">
                  {data.site_a.top_keywords.map((kw, i) => (
                    <div key={i} className="text-xs text-gray-300 bg-gray-800/50 rounded px-2 py-1">{kw}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-2 font-medium">Top mots-clés — {data.site_b.name}</div>
                <div className="space-y-1">
                  {data.site_b.top_keywords.map((kw, i) => (
                    <div key={i} className="text-xs text-gray-300 bg-gray-800/50 rounded px-2 py-1">{kw}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
