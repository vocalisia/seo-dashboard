"use client";

import { useEffect, useState } from "react";
import {
  Globe, TrendingUp, Users, Eye, Search, ArrowUp, ArrowDown,
  MousePointerClick, BarChart3, RefreshCw, Loader2
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from "recharts";

interface Site {
  id: number; name: string; url: string;
  total_sessions_30d: number; total_users_30d: number;
  total_pageviews_30d: number; organic_sessions_30d: number;
  gsc_clicks_30d: number; gsc_impressions_30d: number;
  avg_position_30d: number;
}

interface AnalyticsDay {
  date: string; sessions: number; users: number; pageviews: number;
  organic_sessions: number; bounce_rate: number;
}

interface QueryData {
  query: string; total_clicks: number; total_impressions: number;
  avg_ctr: number; avg_position: number;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316", "#14b8a6", "#6366f1"];

export default function DashboardPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsDay[]>([]);
  const [queries, setQueries] = useState<QueryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "analytics" | "search" | "keywords">("overview");

  useEffect(() => {
    fetchSites();
  }, []);

  useEffect(() => {
    if (selectedSite) {
      fetchAnalytics(selectedSite.id);
      fetchQueries(selectedSite.id);
    }
  }, [selectedSite]);

  async function fetchSites() {
    setLoading(true);
    try {
      const res = await fetch("/api/sites");
      const data = await res.json();
      if (Array.isArray(data)) {
        setSites(data);
        if (data.length > 0) setSelectedSite(data[0]);
      }
    } catch {
      console.error("Failed to fetch sites");
    }
    setLoading(false);
  }

  async function fetchAnalytics(siteId: number) {
    try {
      const res = await fetch(`/api/analytics?siteId=${siteId}&days=30`);
      const data = await res.json();
      if (Array.isArray(data)) setAnalytics(data);
    } catch {
      console.error("Failed to fetch analytics");
    }
  }

  async function fetchQueries(siteId: number) {
    try {
      const res = await fetch(`/api/search-console?siteId=${siteId}&type=queries&limit=50`);
      const data = await res.json();
      if (Array.isArray(data)) setQueries(data);
    } catch {
      console.error("Failed to fetch queries");
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      await fetchSites();
      if (selectedSite) {
        await fetchAnalytics(selectedSite.id);
        await fetchQueries(selectedSite.id);
      }
    } catch {
      console.error("Sync failed");
    }
    setSyncing(false);
  }

  const totalSessions = sites.reduce((s, site) => s + (site.total_sessions_30d || 0), 0);
  const totalUsers = sites.reduce((s, site) => s + (site.total_users_30d || 0), 0);
  const totalClicks = sites.reduce((s, site) => s + (site.gsc_clicks_30d || 0), 0);
  const totalImpressions = sites.reduce((s, site) => s + (site.gsc_impressions_30d || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-8 h-8 text-blue-500" />
            <h1 className="text-xl font-bold">SEO Dashboard</h1>
            <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">
              {sites.length} sites
            </span>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={selectedSite?.id || ""}
              onChange={(e) => {
                const site = sites.find((s) => s.id === parseInt(e.target.value));
                if (site) setSelectedSite(site);
              }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </select>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? "Sync..." : "Synchroniser"}
            </button>
          </div>
        </div>
      </header>

      <main className="p-6">
        {/* KPI Cards - Global */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KPICard icon={<Users />} label="Utilisateurs (30j)" value={totalUsers.toLocaleString()} color="blue" />
          <KPICard icon={<Eye />} label="Sessions (30j)" value={totalSessions.toLocaleString()} color="green" />
          <KPICard icon={<MousePointerClick />} label="Clics GSC (30j)" value={totalClicks.toLocaleString()} color="purple" />
          <KPICard icon={<Search />} label="Impressions (30j)" value={totalImpressions.toLocaleString()} color="orange" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(["overview", "analytics", "search", "keywords"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === tab ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {tab === "overview" ? "Vue globale" : tab === "analytics" ? "Analytics" : tab === "search" ? "Search Console" : "Mots-clés"}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sites Table */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 col-span-full">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-400" /> Tous les sites
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-800">
                      <th className="text-left py-3 px-2">Site</th>
                      <th className="text-right py-3 px-2">Sessions</th>
                      <th className="text-right py-3 px-2">Users</th>
                      <th className="text-right py-3 px-2">Organic</th>
                      <th className="text-right py-3 px-2">Clics GSC</th>
                      <th className="text-right py-3 px-2">Impressions</th>
                      <th className="text-right py-3 px-2">Position moy.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((site, i) => (
                      <tr
                        key={site.id}
                        onClick={() => setSelectedSite(site)}
                        className={`border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer ${
                          selectedSite?.id === site.id ? "bg-blue-500/10" : ""
                        }`}
                      >
                        <td className="py-3 px-2 flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="font-medium">{site.name}</span>
                        </td>
                        <td className="text-right py-3 px-2">{(site.total_sessions_30d || 0).toLocaleString()}</td>
                        <td className="text-right py-3 px-2">{(site.total_users_30d || 0).toLocaleString()}</td>
                        <td className="text-right py-3 px-2 text-green-400">{(site.organic_sessions_30d || 0).toLocaleString()}</td>
                        <td className="text-right py-3 px-2 text-blue-400">{(site.gsc_clicks_30d || 0).toLocaleString()}</td>
                        <td className="text-right py-3 px-2">{(site.gsc_impressions_30d || 0).toLocaleString()}</td>
                        <td className="text-right py-3 px-2">
                          {site.avg_position_30d ? parseFloat(String(site.avg_position_30d)).toFixed(1) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sessions pie chart */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-sm font-semibold text-gray-400 mb-4">Répartition Sessions par site</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={sites.filter(s => s.total_sessions_30d > 0).map((s, i) => ({
                      name: s.name, value: s.total_sessions_30d || 0, fill: COLORS[i % COLORS.length]
                    }))}
                    cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name }) => name}
                  >
                    {sites.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Clicks pie chart */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-sm font-semibold text-gray-400 mb-4">Répartition Clics GSC par site</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={sites.filter(s => s.gsc_clicks_30d > 0).map((s, i) => ({
                      name: s.name, value: s.gsc_clicks_30d || 0, fill: COLORS[i % COLORS.length]
                    }))}
                    cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name }) => name}
                  >
                    {sites.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === "analytics" && selectedSite && (
          <div className="space-y-6">
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-4">
                Sessions & Users - {selectedSite.name} (30 jours)
              </h3>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={analytics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                  />
                  <YAxis stroke="#6b7280" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString("fr-FR")}
                  />
                  <Line type="monotone" dataKey="sessions" stroke="#3b82f6" strokeWidth={2} dot={false} name="Sessions" />
                  <Line type="monotone" dataKey="users" stroke="#10b981" strokeWidth={2} dot={false} name="Users" />
                  <Line type="monotone" dataKey="organic_sessions" stroke="#f59e0b" strokeWidth={2} dot={false} name="Organic" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h3 className="text-lg font-semibold mb-4">Pageviews quotidiens</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={analytics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString("fr-FR", { day: "2-digit" })}
                  />
                  <YAxis stroke="#6b7280" />
                  <Tooltip contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px" }} />
                  <Bar dataKey="pageviews" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Pageviews" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Search Console Tab */}
        {activeTab === "search" && selectedSite && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Search className="w-5 h-5 text-purple-400" />
              Top 50 requêtes - {selectedSite.name}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-3 px-2">#</th>
                    <th className="text-left py-3 px-2">Requête</th>
                    <th className="text-right py-3 px-2">Clics</th>
                    <th className="text-right py-3 px-2">Impressions</th>
                    <th className="text-right py-3 px-2">CTR</th>
                    <th className="text-right py-3 px-2">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                      <td className="py-2 px-2 font-medium">{q.query}</td>
                      <td className="text-right py-2 px-2 text-blue-400 font-semibold">{q.total_clicks}</td>
                      <td className="text-right py-2 px-2">{q.total_impressions?.toLocaleString()}</td>
                      <td className="text-right py-2 px-2">
                        {(parseFloat(String(q.avg_ctr)) * 100).toFixed(1)}%
                      </td>
                      <td className="text-right py-2 px-2">
                        <span className={`inline-flex items-center gap-1 ${
                          parseFloat(String(q.avg_position)) <= 10 ? "text-green-400" :
                          parseFloat(String(q.avg_position)) <= 20 ? "text-yellow-400" : "text-red-400"
                        }`}>
                          {parseFloat(String(q.avg_position)) <= 10 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                          {parseFloat(String(q.avg_position)).toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {queries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-500">
                        Aucune donnée. Cliquez sur "Synchroniser" pour importer les données GSC.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Keywords Tab */}
        {activeTab === "keywords" && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-400" />
              Suivi de mots-clés (prochaine version)
            </h3>
            <p className="text-gray-400">
              Le rank tracker sera ajouté dans la V2 avec un service externe (pas de Puppeteer sur Vercel).
              En attendant, utilisez les données Search Console ci-dessus pour suivre vos positions.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function KPICard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "text-blue-400 bg-blue-500/10",
    green: "text-green-400 bg-green-500/10",
    purple: "text-purple-400 bg-purple-500/10",
    orange: "text-orange-400 bg-orange-500/10",
  };
  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>{icon}</div>
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
