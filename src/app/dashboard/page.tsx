"use client";

import { useEffect, useState } from "react";
import {
  Globe, Search, ArrowUp, ArrowDown, MousePointerClick,
  BarChart3, RefreshCw, Loader2, ChevronDown, ChevronRight,
  PlaySquare, TrendingUp, TrendingDown, Minus, X, Smartphone
} from "lucide-react";
import Link from "next/link";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface Site {
  id: number; name: string; url: string;
  gsc_clicks_30d: number; gsc_impressions_30d: number; avg_position_30d: number;
}

interface QueryData {
  query: string; total_clicks: number; total_impressions: number;
  avg_ctr: number; avg_position: number;
}

interface GainData {
  query: string; position_now: number; position_prev: number;
  gain: number; clicks_now: number; clicks_prev: number; clicks_gain: number;
}

const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#ec4899","#f97316","#14b8a6","#6366f1","#84cc16","#f43f5e","#a855f7","#0ea5e9","#22c55e","#eab308"];

type Period = "7" | "30" | "90";
type TabType = "keywords" | "gains" | "analytics" | "device";

interface DeviceRow {
  device: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
}

interface AnalyticsDay {
  date: string; sessions: number; users: number; pageviews: number;
  organic_sessions: number; direct_sessions: number; referral_sessions: number; social_sessions: number;
  bounce_rate: number; avg_session_duration: number;
}

// Impression share par position (% des recherches où tu apparais)
function estimatedMonthlyVolume(impressions: number, position: number): number {
  const share = position <= 1 ? 0.90
    : position <= 2 ? 0.78
    : position <= 3 ? 0.65
    : position <= 5 ? 0.48
    : position <= 7 ? 0.35
    : position <= 10 ? 0.25
    : position <= 15 ? 0.14
    : position <= 20 ? 0.08
    : position <= 30 ? 0.04
    : position <= 50 ? 0.02
    : 0.01;
  return Math.round(impressions / share);
}

function volLabel(vol: number): { label: string; color: string } {
  if (vol >= 10000) return { label: `🔥 ${vol.toLocaleString()}`, color: "text-orange-400" };
  if (vol >= 1000) return { label: `⚡ ${vol.toLocaleString()}`, color: "text-yellow-400" };
  if (vol >= 100) return { label: `📈 ${vol.toLocaleString()}`, color: "text-blue-400" };
  return { label: `${vol.toLocaleString()}`, color: "text-gray-500" };
}

function solution(pos: number): string {
  if (pos <= 3) return "🏆 Top 3 — maintenir";
  if (pos <= 10) return "✅ Page 1 — optimise CTR (meta title/description)";
  if (pos <= 15) return "⚡ Quasi page 1 — améliore le contenu + maillage interne";
  if (pos <= 30) return "📝 Page 2-3 — renforce l'article, ajoute des backlinks";
  return "🔨 Loin — créer du contenu dédié sur ce mot clé";
}

export default function DashboardPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Record<number, TabType>>({});
  const [period, setPeriod] = useState<Period>("30");
  const [keywords, setKeywords] = useState<Record<string, QueryData[]>>({});
  const [gains, setGains] = useState<Record<number, GainData[]>>({});
  const [kwLoading, setKwLoading] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [siteSortCol, setSiteSortCol] = useState<"clicks"|"impressions"|"position">("clicks");
  const [siteSortDir, setSiteSortDir] = useState<"asc"|"desc">("desc");
  const [sortCol, setSortCol] = useState<"clicks"|"impressions"|"ctr"|"position"|"volume">("clicks");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [gainSortCol, setGainSortCol] = useState<"gain"|"position_now"|"clicks_gain">("gain");
  const [gainSortDir, setGainSortDir] = useState<"asc"|"desc">("desc");
  const [analytics, setAnalytics] = useState<Record<number, AnalyticsDay[]>>({});
  const [activeKw, setActiveKw] = useState<{siteId: number; query: string} | null>(null);
  const [kwHistory, setKwHistory] = useState<{date: string; position: number; clicks: number}[]>([]);
  const [kwHistLoading, setKwHistLoading] = useState(false);
  const [deviceData, setDeviceData] = useState<Record<number, DeviceRow[]>>({});
  const [langFilter, setLangFilter] = useState<string>(""); // "" | "fr" | "en" | "de" | ...

  useEffect(() => { fetchSites(); }, []);

  async function fetchSites(lang?: string) {
    setLoading(true);
    try {
      const langQs = (lang || langFilter) ? `?language=${lang || langFilter}` : "";
      const res = await fetch(`/api/sites${langQs}`);
      const data = await res.json();
      if (Array.isArray(data)) setSites(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function loadKeywords(siteId: number, p: Period) {
    const key = `${siteId}-${p}-${langFilter || "all"}`;
    if (keywords[key]) return;
    setKwLoading(siteId);
    try {
      const langQs = langFilter ? `&language=${langFilter}` : "";
      const res = await fetch(`/api/search-console?siteId=${siteId}&type=queries&days=${p}&limit=300${langQs}`);
      const data = await res.json();
      if (Array.isArray(data)) setKeywords(prev => ({ ...prev, [key]: data }));
    } catch { /* ignore */ }
    setKwLoading(null);
  }

  async function loadGains(siteId: number) {
    const key = `${siteId}-${langFilter || "all"}`;
    if (gains[siteId] && !langFilter) return;
    try {
      const langQs = langFilter ? `&language=${langFilter}` : "";
      const res = await fetch(`/api/search-console?siteId=${siteId}&type=gains&limit=200${langQs}`);
      const data = await res.json();
      if (Array.isArray(data)) setGains(prev => ({ ...prev, [siteId]: data }));
    } catch { /* ignore */ }
    void key;
  }

  async function changeLangFilter(lang: string) {
    setLangFilter(lang);
    // Invalidate ALL cache — sites stats + keywords + gains
    setKeywords({});
    setGains({});
    setAnalytics({});
    setDeviceData({});

    // Re-fetch sites with new country filter → updates clics/impr/position per site
    await fetchSites(lang);

    // Re-fetch keywords for expanded site
    if (expanded) {
      const p = period;
      const langQs = lang ? `&language=${lang}` : "";
      setKwLoading(expanded);
      try {
        const res = await fetch(`/api/search-console?siteId=${expanded}&type=queries&days=${p}&limit=300${langQs}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          const key = `${expanded}-${p}-${lang || "all"}`;
          setKeywords({ [key]: data });
        }
      } catch { /* ignore */ }
      setKwLoading(null);
    }
  }

  async function toggleSite(siteId: number) {
    if (expanded === siteId) { setExpanded(null); return; }
    setExpanded(siteId);
    const tab = activeTab[siteId] || "keywords";
    if (tab === "keywords") {
      await loadKeywords(siteId, period);
      loadGains(siteId); // load gains silently for delta display
    } else await loadGains(siteId);
  }

  async function switchTab(siteId: number, tab: TabType) {
    setActiveTab(prev => ({ ...prev, [siteId]: tab }));
    if (tab === "keywords") { await loadKeywords(siteId, period); loadGains(siteId); }
    else if (tab === "gains") await loadGains(siteId);
    else if (tab === "analytics") await loadAnalytics(siteId, period);
    else if (tab === "device") await loadDeviceSplit(siteId, period);
  }

  async function changePeriod(p: Period) {
    setPeriod(p);
    if (expanded) await loadKeywords(expanded, p);
  }

  async function loadAnalytics(siteId: number, p: Period) {
    if (analytics[siteId]) return;
    try {
      const res = await fetch(`/api/analytics?siteId=${siteId}&days=${p}`);
      const data = await res.json();
      if (Array.isArray(data)) setAnalytics(prev => ({ ...prev, [siteId]: data.map((r: AnalyticsDay) => ({ ...r, date: r.date.toString().slice(5, 10) })) }));
    } catch { /* ignore */ }
  }

  async function loadDeviceSplit(siteId: number, p: Period) {
    if (deviceData[siteId]) return;
    try {
      const res = await fetch(`/api/device-split?site_id=${siteId}&days=${p}`);
      const data = await res.json() as { overview?: DeviceRow[] };
      if (data.overview && Array.isArray(data.overview)) {
        setDeviceData(prev => ({ ...prev, [siteId]: data.overview as DeviceRow[] }));
      }
    } catch { /* ignore */ }
  }

  async function openKwHistory(siteId: number, query: string) {
    if (activeKw?.siteId === siteId && activeKw?.query === query) { setActiveKw(null); return; }
    setActiveKw({ siteId, query });
    setKwHistLoading(true);
    try {
      const res = await fetch(`/api/keyword-history?siteId=${siteId}&query=${encodeURIComponent(query)}&days=90`);
      const data = await res.json();
      if (Array.isArray(data)) setKwHistory(data.map(r => ({ date: r.date.slice(5), position: Math.round(Number(r.position) * 10) / 10, clicks: Number(r.clicks) })));
    } catch { setKwHistory([]); }
    setKwHistLoading(false);
  }

  const [syncMsg, setSyncMsg] = useState<{type: "ok"|"err"; text: string} | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (res.status === 401 || data.error?.includes("authentifié")) {
        setSyncMsg({ type: "err", text: "Connecte-toi Google d'abord → /login" });
      } else if (data.error) {
        setSyncMsg({ type: "err", text: data.error });
      } else {
        const results = data.results || [];
        const total = results.reduce((s: number, r: { gsc?: number }) => s + (r.gsc || 0), 0);
        setSyncMsg({ type: "ok", text: `Sync OK — ${total} lignes GSC importées` });
        setKeywords({}); setGains({});
        await fetchSites();
      }
    } catch (err) {
      setSyncMsg({ type: "err", text: err instanceof Error ? err.message : "Erreur réseau" });
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(null), 8000);
  }

  const totalClicks = sites.reduce((s, site) => s + (Number(site.gsc_clicks_30d) || 0), 0);
  const totalImpressions = sites.reduce((s, site) => s + (Number(site.gsc_impressions_30d) || 0), 0);
  const activeSites = sites.filter(s => Number(s.avg_position_30d) > 0);
  const avgPosition = activeSites.length > 0
    ? activeSites.reduce((s, site) => s + Number(site.avg_position_30d), 0) / activeSites.length
    : 0;

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-7 h-7 text-blue-500" />
          <h1 className="text-xl font-bold">SEO Dashboard</h1>
          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">{sites.length} sites</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text" placeholder="Filtrer mots clés..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:border-blue-500"
          />
          <div className="flex bg-gray-800 border border-gray-700 rounded-lg overflow-hidden text-sm">
            {(["7","30","90"] as Period[]).map(p => (
              <button key={p} onClick={() => changePeriod(p)}
                className={`px-3 py-2 transition ${period === p ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
                {p}j
              </button>
            ))}
          </div>
          <select
            value={langFilter}
            onChange={(e) => changeLangFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            title="Filtrer les mots-clés par langue/pays"
          >
            <option value="">🌍 Tous pays</option>
            <option value="fr">🇫🇷 France (FR)</option>
            <option value="en">🇬🇧 UK/US (EN)</option>
            <option value="de">🇩🇪 DE/AT/CH (DE)</option>
            <option value="es">🇪🇸 Espagne (ES)</option>
            <option value="it">🇮🇹 Italie (IT)</option>
            <option value="nl">🇳🇱 Pays-Bas (NL)</option>
            <option value="pt">🇵🇹 Portugal/BR (PT)</option>
          </select>
          <Link href="/overview" className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <Globe className="w-4 h-4" /> Vue globale
          </Link>
          <Link href="/reports" className="bg-green-600/20 hover:bg-green-600/40 text-green-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4" /> Rapports IA
          </Link>
          <Link href="/youtube" className="bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <PlaySquare className="w-4 h-4" /> YouTube
          </Link>
          <Link href="/opportunities" className="bg-green-600/20 hover:bg-green-600/40 text-green-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4" /> Opportunités
          </Link>
          <Link href="/audit" className="bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <Search className="w-4 h-4" /> Audit
          </Link>
          <Link href="/backlinks" className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            <Globe className="w-4 h-4" /> Backlinks
          </Link>
          <Link href="/autopilot" className="bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            ⚡ Autopilot
          </Link>
          <Link href="/countries" className="bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            🌍 Pays
          </Link>
          <Link href="/competitors" className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold">
            🎯 Concurrents
          </Link>
          <Link href="/tracker" className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            📊 Tracker
          </Link>
          <Link href="/calendar" className="bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            📅 Calendrier
          </Link>
          <Link href="/alerts" className="bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🚨 Alertes
          </Link>
          <Link href="/refresh" className="bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🔄 Refresh
          </Link>
          <Link href="/clusters" className="bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🧩 Clusters
          </Link>
          <Link href="/internal-links" className="bg-teal-600/20 hover:bg-teal-600/40 text-teal-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🔗 Maillage
          </Link>
          <Link href="/authority" className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            🛡 Autorité
          </Link>
          <Link href="/compare" className="bg-pink-600/20 hover:bg-pink-600/40 text-pink-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            ⚖ Comparer
          </Link>
          <Link href="/health" className="bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 px-3 py-2 rounded-lg flex items-center gap-2 text-sm">
            💊 Santé SEO
          </Link>
          <button onClick={handleSync} disabled={syncing}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
              syncing
                ? "bg-yellow-600 animate-pulse text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            } disabled:cursor-wait`}>
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? "Sync en cours..." : "Synchroniser"}
          </button>
        </div>
      </header>

      {/* Sync feedback */}
      {syncMsg && (
        <div className={`mx-6 mt-2 px-4 py-2 rounded-lg text-sm flex items-center gap-2 animate-in ${
          syncMsg.type === "ok"
            ? "bg-green-900/40 border border-green-700 text-green-300"
            : "bg-red-900/40 border border-red-700 text-red-300"
        }`}>
          {syncMsg.type === "ok" ? "✅" : "❌"} {syncMsg.text}
        </div>
      )}

      {/* KPIs globaux */}
      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1"><MousePointerClick className="w-3 h-3" /> Clics GSC ({period}j)</div>
          <div className="text-2xl font-bold text-blue-400">{totalClicks.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">~{Math.round(totalClicks / parseInt(period))}/jour</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Search className="w-3 h-3" /> Impressions ({period}j)</div>
          <div className="text-2xl font-bold text-purple-400">{totalImpressions.toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">~{Math.round(totalImpressions / parseInt(period))}/jour</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1"><Globe className="w-3 h-3" /> Position moy. globale</div>
          <div className="text-2xl font-bold text-green-400">{avgPosition > 0 ? avgPosition.toFixed(1) : "—"}</div>
          <div className="text-xs text-gray-500 mt-1">{activeSites.length} sites avec données</div>
        </div>
      </div>

      {/* Sort bar sites */}
      <div className="px-6 pb-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">Classer par :</span>
        {([
          { col: "clicks" as const, label: "Clics" },
          { col: "impressions" as const, label: "Impressions" },
          { col: "position" as const, label: "Position" },
        ]).map(({ col, label }) => {
          const active = siteSortCol === col;
          return (
            <button key={col}
              onClick={() => { if (active) setSiteSortDir(d => d === "desc" ? "asc" : "desc"); else { setSiteSortCol(col); setSiteSortDir(col === "position" ? "asc" : "desc"); } }}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}>
              {label}
              <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                <span className={active && siteSortDir === "asc" ? "text-white" : "opacity-40"}>▲</span>
                <span className={active && siteSortDir === "desc" ? "text-white" : "opacity-40"}>▼</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Sites */}
      <div className="px-6 pb-10 space-y-3">
        {[...sites].sort((a, b) => {
          let va = 0, vb = 0;
          if (siteSortCol === "impressions") { va = Number(a.gsc_impressions_30d); vb = Number(b.gsc_impressions_30d); }
          else if (siteSortCol === "position") { va = Number(a.avg_position_30d) || 999; vb = Number(b.avg_position_30d) || 999; }
          else { va = Number(a.gsc_clicks_30d); vb = Number(b.gsc_clicks_30d); }
          return siteSortDir === "asc" ? va - vb : vb - va;
        }).map((site, i) => {
          const isOpen = expanded === site.id;
          const tab = activeTab[site.id] || "keywords";
          const kwKey = `${site.id}-${period}-${langFilter || "all"}`;
          const kws = (keywords[kwKey] || [])
            .filter(k => !search || k.query.toLowerCase().includes(search.toLowerCase()))
            .sort((a, b) => {
              let va = 0, vb = 0;
              if (sortCol === "position") { va = Number(a.avg_position); vb = Number(b.avg_position); }
              else if (sortCol === "impressions") { va = Number(a.total_impressions); vb = Number(b.total_impressions); }
              else if (sortCol === "ctr") { va = Number(a.avg_ctr); vb = Number(b.avg_ctr); }
              else if (sortCol === "volume") { va = estimatedMonthlyVolume(Number(a.total_impressions), Number(a.avg_position)); vb = estimatedMonthlyVolume(Number(b.total_impressions), Number(b.avg_position)); }
              else { va = Number(a.total_clicks); vb = Number(b.total_clicks); }
              return sortDir === "asc" ? va - vb : vb - va;
            });
          const gainList = (gains[site.id] || [])
            .filter(g => !search || g.query.toLowerCase().includes(search.toLowerCase()))
            .sort((a, b) => {
              let va = 0, vb = 0;
              if (gainSortCol === "position_now") { va = Number(a.position_now); vb = Number(b.position_now); }
              else if (gainSortCol === "clicks_gain") { va = Number(a.clicks_gain); vb = Number(b.clicks_gain); }
              else { va = Number(a.gain); vb = Number(b.gain); }
              return gainSortDir === "asc" ? va - vb : vb - va;
            });
          const top10 = kws.filter(k => Number(k.avg_position) <= 10).length;

          return (
            <div key={site.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              {/* Site header */}
              <div onClick={() => toggleSite(site.id)}
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/50 transition">
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="font-semibold">{site.name}</span>
                  <span className="text-xs text-gray-500 hidden md:block">{site.url}</span>
                  {top10 > 0 && isOpen && (
                    <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">{top10} top10</span>
                  )}
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <div className="text-blue-400 font-bold">{(Number(site.gsc_clicks_30d)||0).toLocaleString()}</div>
                    <div className="text-xs text-gray-500">clics/30j</div>
                  </div>
                  <div className="text-right">
                    <div className="text-purple-400 font-bold">{(Number(site.gsc_impressions_30d)||0).toLocaleString()}</div>
                    <div className="text-xs text-gray-500">impressions</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${Number(site.avg_position_30d) > 0 && Number(site.avg_position_30d) <= 10 ? "text-green-400" : Number(site.avg_position_30d) <= 20 ? "text-yellow-400" : "text-gray-400"}`}>
                      {Number(site.avg_position_30d) > 0 ? Number(site.avg_position_30d).toFixed(1) : "—"}
                    </div>
                    <div className="text-xs text-gray-500">position moy.</div>
                  </div>
                </div>
              </div>

              {/* Content */}
              {isOpen && (
                <div className="border-t border-gray-800">
                  {/* Tabs */}
                  <div className="flex gap-1 px-4 pt-3 pb-0">
                    <button onClick={() => switchTab(site.id, "keywords")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition ${tab === "keywords" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"}`}>
                      Mots clés ({period}j)
                    </button>
                    <button onClick={() => switchTab(site.id, "gains")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "gains" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"}`}>
                      <TrendingUp className="w-3 h-3" /> Gains / semaine
                    </button>
                    <button onClick={() => switchTab(site.id, "analytics")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "analytics" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"}`}>
                      <BarChart3 className="w-3 h-3" /> Analytics GA4
                    </button>
                    <button onClick={() => switchTab(site.id, "device")}
                      className={`px-3 py-1.5 rounded-t text-xs font-medium transition flex items-center gap-1 ${tab === "device" ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"}`}>
                      <Smartphone className="w-3 h-3" /> Devices
                    </button>
                  </div>

                  {kwLoading === site.id ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                  ) : tab === "keywords" ? (
                    kws.length === 0 ? (
                      <div className="py-6 text-center text-gray-500 text-sm">Aucune donnée GSC pour cette période</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500 text-xs bg-gray-800/50">
                            <th className="text-left py-2 px-5">#</th>
                            <th className="text-left py-2 px-3">Mot clé</th>
                            {(["clicks","impressions","ctr","position"] as const).map(col => {
                              const labels = { clicks: "Clics", impressions: "Impressions", ctr: "CTR", position: "Position" };
                              const active = sortCol === col;
                              return (
                                <th key={col} className="text-right py-2 px-3 cursor-pointer select-none"
                                  onClick={() => { if (active) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir(col === "position" ? "asc" : "desc"); } }}>
                                  <span className={`inline-flex items-center justify-end gap-1 ${active ? "text-white" : "hover:text-gray-300"}`}>
                                    {labels[col]}
                                    <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                                      <span className={active && sortDir === "asc" ? "text-blue-400" : "opacity-30"}>▲</span>
                                      <span className={active && sortDir === "desc" ? "text-blue-400" : "opacity-30"}>▼</span>
                                    </span>
                                  </span>
                                </th>
                              );
                            })}
                            {(() => {
                              const col = "volume" as const;
                              const active = sortCol === col;
                              return (
                                <th className="text-right py-2 px-3 cursor-pointer select-none"
                                  onClick={() => { if (active) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortCol(col); setSortDir("desc"); } }}>
                                  <span className={`inline-flex items-center justify-end gap-1 ${active ? "text-white" : "hover:text-gray-300"}`}>
                                    Vol./mois
                                    <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                                      <span className={active && sortDir === "asc" ? "text-blue-400" : "opacity-30"}>▲</span>
                                      <span className={active && sortDir === "desc" ? "text-blue-400" : "opacity-30"}>▼</span>
                                    </span>
                                  </span>
                                </th>
                              );
                            })()}
                            <th className="text-left py-2 px-5">Solution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kws.slice(0, 100).map((kw, j) => (
                            <tr key={j} className={`border-b border-gray-800/40 hover:bg-gray-800/20 cursor-pointer ${activeKw?.query === kw.query && activeKw?.siteId === site.id ? "bg-blue-900/10" : ""}`}
                              onClick={() => openKwHistory(site.id, kw.query)}>
                              <td className="py-2 px-5 text-gray-600 text-xs">{j + 1}</td>
                              <td className="py-2 px-3 font-medium text-gray-200 flex items-center gap-1">
                                {kw.query}
                                <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${activeKw?.query === kw.query && activeKw?.siteId === site.id ? "rotate-180" : ""}`} />
                              </td>
                              <td className="text-right py-2 px-3 text-blue-400 font-semibold">{Number(kw.total_clicks)}</td>
                              <td className="text-right py-2 px-3 text-gray-400">{Number(kw.total_impressions).toLocaleString()}</td>
                              <td className="text-right py-2 px-3 text-gray-400">{(Number(kw.avg_ctr) * 100).toFixed(1)}%</td>
                              <td className="text-right py-2 px-3">
                                <div className="inline-flex flex-col items-end gap-0.5">
                                  <span className={`font-semibold ${Number(kw.avg_position) <= 10 ? "text-green-400" : Number(kw.avg_position) <= 20 ? "text-yellow-400" : "text-red-400"}`}>
                                    {Number(kw.avg_position).toFixed(1)}
                                  </span>
                                  {(() => {
                                    const g = gainList.find(x => x.query === kw.query);
                                    if (!g) return <span className="text-xs text-gray-600">vs sem. ?</span>;
                                    const gain = Number(g.gain);
                                    if (gain > 0) return <span className="text-xs text-green-400 flex items-center gap-0.5"><TrendingUp className="w-2.5 h-2.5" />+{gain} vs sem.</span>;
                                    if (gain < 0) return <span className="text-xs text-red-400 flex items-center gap-0.5"><TrendingDown className="w-2.5 h-2.5" />{gain} vs sem.</span>;
                                    return <span className="text-xs text-gray-500">= vs sem.</span>;
                                  })()}
                                </div>
                              </td>
                              <td className="text-right py-2 px-3">
                                {(() => {
                                  const vol = estimatedMonthlyVolume(Number(kw.total_impressions), Number(kw.avg_position));
                                  const { label, color } = volLabel(vol);
                                  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
                                })()}
                              </td>
                              <td className="py-2 px-5 text-xs text-gray-400">{solution(Number(kw.avg_position))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : (
                    gainList.length === 0 ? (
                      <div className="py-6 text-center text-gray-500 text-sm">Pas encore assez d&apos;historique pour calculer les gains</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500 text-xs bg-gray-800/50">
                            <th className="text-left py-2 px-5">Mot clé</th>
                            {([
                              { col: "position_now" as const, label: "Position cette sem." },
                              { col: "gain" as const, label: "Gain positions" },
                              { col: "clicks_gain" as const, label: "Clics +/-" },
                            ]).map(({ col, label }) => {
                              const active = gainSortCol === col;
                              return (
                                <th key={col} className="text-right py-2 px-3 cursor-pointer select-none"
                                  onClick={() => { if (active) setGainSortDir(d => d === "desc" ? "asc" : "desc"); else { setGainSortCol(col); setGainSortDir("desc"); } }}>
                                  <span className={`inline-flex items-center justify-end gap-1 ${active ? "text-white" : "hover:text-gray-300"}`}>
                                    {label}
                                    <span className="flex flex-col leading-none" style={{fontSize:"8px"}}>
                                      <span className={active && gainSortDir === "asc" ? "text-blue-400" : "opacity-30"}>▲</span>
                                      <span className={active && gainSortDir === "desc" ? "text-blue-400" : "opacity-30"}>▼</span>
                                    </span>
                                  </span>
                                </th>
                              );
                            })}
                            <th className="text-right py-2 px-3 text-gray-500">Sem. dernière</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gainList.slice(0, 100).map((g, j) => (
                            <tr key={j} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                              <td className="py-2 px-5 font-medium text-gray-200">{g.query}</td>
                              <td className="text-right py-2 px-3 font-semibold text-white">{g.position_now}</td>
                              <td className="text-right py-2 px-3">
                                {Number(g.gain) > 0 ? (
                                  <span className="text-green-400 font-bold flex items-center justify-end gap-1"><TrendingUp className="w-3 h-3" />+{g.gain}</span>
                                ) : Number(g.gain) < 0 ? (
                                  <span className="text-red-400 font-bold flex items-center justify-end gap-1"><TrendingDown className="w-3 h-3" />{g.gain}</span>
                                ) : (
                                  <span className="text-gray-500 flex items-center justify-end gap-1"><Minus className="w-3 h-3" />0</span>
                                )}
                              </td>
                              <td className="text-right py-2 px-3">
                                <span className={Number(g.clicks_gain) > 0 ? "text-green-400" : Number(g.clicks_gain) < 0 ? "text-red-400" : "text-gray-500"}>
                                  {Number(g.clicks_gain) > 0 ? "+" : ""}{g.clicks_gain}
                                </span>
                              </td>
                              <td className="text-right py-2 px-3 text-gray-500">{g.position_prev}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  )}
                  {tab === "analytics" && (() => {
                    const aData = analytics[site.id] || [];
                    if (kwLoading === site.id) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;
                    if (aData.length === 0) return (
                      <div className="py-8 text-center space-y-2">
                        <p className="text-gray-500 text-sm">Pas de données GA4 pour ce site</p>
                        <p className="text-gray-600 text-xs">Ajoute <span className="text-blue-400 font-mono">seo-dashboard@businessdeveloperia.iam.gserviceaccount.com</span> dans GA4 → Admin → Gestion des accès à la propriété</p>
                        <p className="text-gray-600 text-xs">Puis renseigne le Property ID numérique (ex: 123456789) dans la DB pour ce site</p>
                      </div>
                    );
                    const totalSessions = aData.reduce((s, d) => s + Number(d.sessions), 0);
                    const totalUsers = aData.reduce((s, d) => s + Number(d.users), 0);
                    const totalPageviews = aData.reduce((s, d) => s + Number(d.pageviews), 0);
                    const totalOrganic = aData.reduce((s, d) => s + Number(d.organic_sessions), 0);
                    return (
                      <div className="px-5 py-4 space-y-4">
                        {/* KPIs */}
                        <div className="grid grid-cols-4 gap-3">
                          {[
                            { label: "Sessions", value: totalSessions.toLocaleString(), color: "text-blue-400" },
                            { label: "Utilisateurs", value: totalUsers.toLocaleString(), color: "text-purple-400" },
                            { label: "Pages vues", value: totalPageviews.toLocaleString(), color: "text-green-400" },
                            { label: "Trafic organique", value: `${totalSessions > 0 ? Math.round(totalOrganic/totalSessions*100) : 0}%`, color: "text-yellow-400" },
                          ].map(k => (
                            <div key={k.label} className="bg-gray-800/60 rounded-lg p-3">
                              <div className={`text-lg font-bold ${k.color}`}>{k.value}</div>
                              <div className="text-xs text-gray-500">{k.label}</div>
                            </div>
                          ))}
                        </div>
                        {/* Sessions chart */}
                        <div>
                          <div className="text-xs text-gray-500 mb-2">Sessions par jour</div>
                          <ResponsiveContainer width="100%" height={160}>
                            <LineChart data={aData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
                              <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                                labelStyle={{ color: "#9ca3af", fontSize: 11 }}
                                formatter={(v: unknown) => [(v as number).toLocaleString()]} />
                              <Line type="monotone" dataKey="sessions" stroke="#3b82f6" strokeWidth={2} dot={false} name="sessions" />
                              <Line type="monotone" dataKey="organic_sessions" stroke="#10b981" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="organic_sessions" />
                            </LineChart>
                          </ResponsiveContainer>
                          <div className="flex gap-4 text-xs text-gray-500 mt-1">
                            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400 inline-block" /> Sessions totales</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-400 inline-block border-dashed border-b" /> Organique</span>
                          </div>
                        </div>
                        {/* Sources */}
                        <div>
                          <div className="text-xs text-gray-500 mb-2">Sources de trafic ({period}j)</div>
                          <div className="flex gap-3 flex-wrap">
                            {[
                              { label: "Organique", val: totalOrganic, color: "bg-green-500" },
                              { label: "Direct", val: aData.reduce((s,d)=>s+Number(d.direct_sessions),0), color: "bg-blue-500" },
                              { label: "Référents", val: aData.reduce((s,d)=>s+Number(d.referral_sessions),0), color: "bg-purple-500" },
                              { label: "Social", val: aData.reduce((s,d)=>s+Number(d.social_sessions),0), color: "bg-pink-500" },
                            ].map(src => (
                              <div key={src.label} className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
                                <div className={`w-2 h-2 rounded-full ${src.color}`} />
                                <span className="text-xs text-gray-400">{src.label}</span>
                                <span className="text-xs font-bold text-white">{src.val.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {tab === "device" && (() => {
                    const devRows = deviceData[site.id] || [];
                    const totalClicks = devRows.reduce((s, r) => s + r.clicks, 0);
                    return devRows.length === 0 ? (
                      <div className="py-6 text-center text-gray-500 text-sm">Aucune donnée device disponible</div>
                    ) : (
                      <div className="px-5 py-4 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          {devRows.map(r => (
                            <div key={r.device} className="bg-gray-800/60 rounded-xl p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <Smartphone className="w-4 h-4 text-gray-400" />
                                <span className="text-sm font-semibold capitalize">{r.device.toLowerCase()}</span>
                                <span className="ml-auto text-xs text-gray-500">{totalClicks > 0 ? Math.round(r.clicks / totalClicks * 100) : 0}%</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div><div className="text-gray-500">Clics</div><div className="text-blue-400 font-bold text-sm">{r.clicks.toLocaleString()}</div></div>
                                <div><div className="text-gray-500">Impressions</div><div className="text-purple-400 font-bold text-sm">{r.impressions.toLocaleString()}</div></div>
                                <div><div className="text-gray-500">CTR</div><div className="text-gray-300">{(r.ctr * 100).toFixed(1)}%</div></div>
                                <div><div className="text-gray-500">Position</div><div className={r.position <= 10 ? "text-green-400" : "text-yellow-400"}>{r.position.toFixed(1)}</div></div>
                              </div>
                              <div className="mt-3 bg-gray-700 rounded-full h-1.5">
                                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${totalClicks > 0 ? Math.round(r.clicks / totalClicks * 100) : 0}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {tab === "keywords" && activeKw?.siteId === site.id && (
                    <div className="border-t border-gray-800 bg-gray-950 px-5 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-sm font-semibold text-white">"{activeKw.query}"</span>
                          <span className="text-xs text-gray-500 ml-2">— évolution position 90 jours</span>
                        </div>
                        <button onClick={() => setActiveKw(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
                      </div>
                      {kwHistLoading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
                      ) : kwHistory.length === 0 ? (
                        <div className="text-center py-6 text-gray-500 text-sm">Pas assez d&apos;historique pour ce mot clé</div>
                      ) : (
                        <ResponsiveContainer width="100%" height={180}>
                          <LineChart data={kwHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                            <YAxis reversed domain={['auto','auto']} tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} width={28} />
                            <Tooltip
                              contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                              labelStyle={{ color: "#9ca3af", fontSize: 11 }}
                              formatter={(v: unknown) => [`Position ${v}`, ""]}
                            />
                            <ReferenceLine y={10} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} label={{ value: "Top 10", fill: "#10b981", fontSize: 9 }} />
                            <Line type="monotone" dataKey="position" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  )}
                  {tab === "keywords" && kws.length > 100 && (
                    <div className="py-2 text-center text-xs text-gray-500">{kws.length - 100} mots clés supplémentaires — affine le filtre</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
