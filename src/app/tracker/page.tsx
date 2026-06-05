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

type FreshnessLevel = "fresh" | "partial" | "late" | "empty";

interface TrackerStatus {
  success: boolean;
  engine: string;
  cycle_days: number;
  limit_per_site: number;
  summary: {
    total_sites: number;
    total_keywords: number;
    checked_in_cycle: number;
    coverage_pct: number;
    latest_checked_at: string | null;
    age_hours: number | null;
    level: FreshnessLevel;
  };
  sites: Array<{
    site_id: number;
    site_name: string;
    total_keywords: number;
    checked_in_cycle: number;
    coverage_pct: number;
    latest_checked_at: string | null;
    age_hours: number | null;
    level: FreshnessLevel;
  }>;
}

export default function TrackerPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [data, setData] = useState<TrackerData | null>(null);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  const fetchSites = async () => {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[];
      const list = Array.isArray(d) ? d : [];
      if (list.length > 0) { setSites(list); if (!selectedSite) setSelectedSite("all"); }
    } catch { /* ignore */ }
  };

  const fetchData = async () => {
    if (!selectedSite || selectedSite === "all") {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/position-history?site_id=${selectedSite}&days=90`);
      if (!res.ok) {
        setData({ success: false, site_history: [], keywords: [] });
        return;
      }
      const d = await res.json() as TrackerData;
      // Defensive normalization: API may return malformed shape on errors
      setData({
        success: d?.success ?? false,
        site_history: Array.isArray(d?.site_history) ? d.site_history : [],
        keywords: Array.isArray(d?.keywords) ? d.keywords : [],
      });
    } catch {
      setData({ success: false, site_history: [], keywords: [] });
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    if (!selectedSite) return;
    setStatusLoading(true);
    try {
      const siteParam = selectedSite === "all" ? "all" : String(selectedSite);
      const res = await fetch(`/api/rank-tracker/status?site_id=${siteParam}&cycle_days=4&engine=brave`);
      const d = await res.json() as TrackerStatus;
      setStatus(d?.success ? d : null);
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchSites(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedSite) {
      void fetchStatus();
      void fetchData();
    }
  }, [selectedSite]);

  const FRESHNESS_COPY: Record<FreshnessLevel, { label: string; hint: string; dot: string; ping: string; border: string }> = {
    fresh: {
      label: "Tracker a jour",
      hint: "Cycle 4 jours couvert.",
      dot: "bg-emerald-400",
      ping: "bg-emerald-400",
      border: "border-emerald-800/50",
    },
    partial: {
      label: "Cycle en cours",
      hint: "Couverture partielle, donnees exploitables.",
      dot: "bg-yellow-400",
      ping: "bg-yellow-400",
      border: "border-yellow-800/50",
    },
    late: {
      label: "Tracker en retard",
      hint: "Une partie des mots-cles depasse le cycle.",
      dot: "bg-orange-400",
      ping: "bg-orange-400",
      border: "border-orange-800/50",
    },
    empty: {
      label: "Aucun check recent",
      hint: "Aucune donnee rank tracker sur ce cycle.",
      dot: "bg-gray-500",
      ping: "bg-gray-600",
      border: "border-gray-800",
    },
  };

  function formatLastChecked(value: string | null): string {
    if (!value) return "Jamais";
    return new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  function currentStatus() {
    if (!status) return null;
    if (selectedSite !== "all") {
      const siteStatus = status.sites.find((s) => s.site_id === selectedSite);
      if (siteStatus) return siteStatus;
    }
    return status.summary;
  }

  // Mini sparkline chart (pure CSS). Static class names so Tailwind doesn't purge them.
  function Sparkline({ values, color = "emerald", inverted = false }: { values: number[]; color?: "emerald" | "red"; inverted?: boolean }) {
    const clean = values.filter((v): v is number => Number.isFinite(v));
    if (clean.length < 2) return <span className="text-gray-600 text-xs">—</span>;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const range = max - min || 1;
    const barClass = color === "red" ? "bg-red-500/60" : "bg-emerald-500/60";

    return (
      <div className="flex items-end gap-[1px] h-8">
        {clean.slice(-30).map((v, i) => {
          const pct = inverted ? (1 - (v - min) / range) : (v - min) / range;
          return (
            <div
              key={i}
              className={`w-1.5 rounded-sm ${barClass}`}
              style={{ height: `${Math.max(8, pct * 100)}%` }}
            />
          );
        })}
      </div>
    );
  }

  // Simple bar chart
  function BarChart({ data: chartData, label }: { data: { date: string; value: number }[]; label: string }) {
    if (!Array.isArray(chartData) || chartData.length === 0) {
      return <div className="text-xs text-gray-600 py-6 text-center">{label}: pas de données</div>;
    }
    const max = Math.max(...chartData.map((d) => Number(d.value) || 0), 1);
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
            onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
          >
            <option value="all">🌐 Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {selectedSite === "all" && (
            <span className="text-xs text-gray-500">Vue globale du statut VPS. Selectionner un site pour voir les courbes.</span>
          )}
        </div>

        {statusLoading && !status ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Statut tracker...
          </div>
        ) : status && currentStatus() ? (
          (() => {
            const s = currentStatus();
            if (!s) return null;
            const copy = FRESHNESS_COPY[s.level];
            return (
              <section className={`bg-gray-900 border ${copy.border} rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-4`}>
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${copy.ping}`} />
                    <span className={`relative inline-flex h-3 w-3 rounded-full ${copy.dot}`} />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-gray-100">{copy.label}</div>
                    <div className="text-xs text-gray-500">
                      {copy.hint} Moteur {status.engine}, top {status.limit_per_site} mots-cles/site.
                    </div>
                  </div>
                </div>

                <div className="md:ml-auto grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-gray-500">Couverture</div>
                    <div className="text-gray-100 font-semibold">{s.coverage_pct}%</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Cycle</div>
                    <div className="text-gray-100 font-semibold">{status.cycle_days} jours</div>
                  </div>
                  <div>
                    <div className="text-gray-500">Dernier check</div>
                    <div className="text-gray-100 font-semibold">{formatLastChecked(s.latest_checked_at)}</div>
                  </div>
                </div>
              </section>
            );
          })()
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm">
            <div className="text-gray-300 font-medium">Statut indisponible</div>
            <div className="text-xs text-gray-500 mt-1">Impossible de lire la fraicheur du rank tracker pour le moment.</div>
          </div>
        )}

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
