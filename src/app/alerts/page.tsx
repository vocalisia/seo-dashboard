"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bell, AlertTriangle, XCircle, Info, CheckCircle, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Alert {
  id: number;
  site_id: number;
  alert_type: string;
  severity: string;
  keyword: string | null;
  message: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  site_name: string | null;
  site_url: string | null;
}

const SEVERITY_STYLE: Record<string, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  critical: { icon: XCircle, color: "text-red-400", bg: "bg-red-900/20 border-red-800" },
  warning: { icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-900/20 border-yellow-800" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-900/20 border-blue-800" },
};

const TYPE_LABEL: Record<string, string> = {
  position_drop: "Chute position",
  not_indexed: "Non indexé",
  competitor_gain: "Concurrent monte",
};

function AlertDetails({ alert }: { alert: Alert }) {
  const { data, alert_type, keyword, severity } = alert;

  if (alert_type === "position_drop") {
    const prevAvg = typeof data.prev_avg === "number" ? Math.round(data.prev_avg) : null;
    const currAvg = typeof data.curr_avg === "number" ? Math.round(data.curr_avg) : null;
    const drop = typeof data.drop === "number" ? Math.round(data.drop) : null;

    return (
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
        {prevAvg !== null && <span>Position avant: <span className="text-gray-200">{prevAvg}</span></span>}
        {currAvg !== null && <span>Position après: <span className="text-gray-200">{currAvg}</span></span>}
        {drop !== null && (
          <span className={severity === "critical" ? "text-red-400" : ""}>
            Chute: <span className="font-medium">{drop} positions</span>
          </span>
        )}
        {keyword && (
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(keyword)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            Voir sur Google <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  if (alert_type === "not_indexed") {
    const statusCode = data.status_code !== undefined ? String(data.status_code) : null;
    const liveUrl = typeof data.live_url === "string" ? data.live_url : null;
    const runId = typeof data.run_id === "string" || typeof data.run_id === "number" ? String(data.run_id) : null;

    return (
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
        {statusCode !== null && (
          <span>
            Status HTTP: <span className="text-red-400 font-medium">{statusCode === "null" || statusCode === "" ? "timeout" : statusCode}</span>
          </span>
        )}
        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate"
          >
            <span className="truncate">{liveUrl}</span>
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        )}
        {runId && (
          <Link href={`/autopilot?run=${runId}`} className="text-blue-400 hover:text-blue-300 flex items-center gap-1 col-span-2">
            Voir le run autopilot <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>
    );
  }

  return null;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [filterSite, setFilterSite] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  async function fetchAlerts() {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts");
      const d = await res.json() as { alerts?: Alert[] };
      setAlerts(d.alerts ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function runCheck() {
    setChecking(true);
    try {
      await fetch("/api/alerts/check", { method: "POST" });
      await fetchAlerts();
    } catch { /* ignore */ }
    setChecking(false);
  }

  async function markRead(id: number) {
    try {
      await fetch(`/api/alerts/${id}/read`, { method: "POST" });
      setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, is_read: true } : a));
    } catch { /* ignore */ }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchAlerts(); }, []);

  const siteNames = Array.from(new Set(alerts.map((a) => a.site_name).filter((n): n is string => n !== null)));

  const filtered = alerts.filter((a) => {
    if (filterSite !== "all" && a.site_name !== filterSite) return false;
    if (filterSeverity !== "all" && a.severity !== filterSeverity) return false;
    if (filterType !== "all" && a.alert_type !== filterType) return false;
    if (unreadOnly && a.is_read) return false;
    return true;
  });

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warning = alerts.filter((a) => a.severity === "warning").length;
  const unread = alerts.filter((a) => !a.is_read).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Bell className="w-5 h-5 text-red-400" />
        <h1 className="text-xl font-semibold">Alertes SEO</h1>
        {unread > 0 && (
          <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{unread}</span>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Stats + actions */}
        <div className="flex items-center gap-4">
          <div className="flex gap-3">
            <div className="bg-red-900/20 border border-red-800 rounded-lg px-4 py-2 text-center">
              <div className="text-2xl font-bold text-red-400">{critical}</div>
              <div className="text-xs text-gray-400">Critical</div>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg px-4 py-2 text-center">
              <div className="text-2xl font-bold text-yellow-400">{warning}</div>
              <div className="text-xs text-gray-400">Warning</div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-center">
              <div className="text-2xl font-bold text-white">{alerts.length}</div>
              <div className="text-xs text-gray-400">Total</div>
            </div>
          </div>
          <button
            onClick={runCheck}
            disabled={checking}
            className="ml-auto px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            {checking ? "Scan en cours..." : "Vérifier maintenant"}
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl p-4">
          <select
            value={filterSite}
            onChange={(e) => setFilterSite(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-600"
          >
            <option value="all">Tous les sites</option>
            {siteNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-600"
          >
            <option value="all">Toutes sévérités</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-600"
          >
            <option value="all">Tous les types</option>
            <option value="position_drop">Chute position</option>
            <option value="not_indexed">Non indexé</option>
            <option value="competitor_gain">Concurrent monte</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="accent-red-500"
            />
            Non lues uniquement
          </label>

          {filtered.length !== alerts.length && (
            <span className="ml-auto text-xs text-gray-500">{filtered.length} / {alerts.length} alertes</span>
          )}
        </div>

        {/* Alerts list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <div className="text-lg font-medium text-green-400">Aucune alerte</div>
            <div className="text-sm text-gray-500 mt-1">Tout va bien sur tes 16 sites</div>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((alert) => {
              const style = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.info;
              const Icon = style.icon;
              const borderClass = !alert.is_read ? "border-2" : "border";
              return (
                <div
                  key={alert.id}
                  className={`${borderClass} rounded-xl p-4 flex items-start gap-3 ${style.bg} relative`}
                >
                  {!alert.is_read && (
                    <span className="absolute left-3 top-3 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded">NEW</span>
                  )}
                  <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${style.color} ${!alert.is_read ? "mt-5" : ""}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`flex items-center gap-2 mb-1 flex-wrap ${!alert.is_read ? "mt-4" : ""}`}>
                      <span className="text-xs font-medium text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
                        {TYPE_LABEL[alert.alert_type] ?? alert.alert_type}
                      </span>
                      {alert.site_name && (
                        <a
                          href={alert.site_url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50 flex items-center gap-1"
                        >
                          {alert.site_name}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <span className="text-xs text-gray-500">
                        {new Date(alert.created_at).toLocaleDateString("fr-FR", {
                          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="text-sm text-white">{alert.message}</div>
                    {alert.keyword && (
                      <div className="text-xs text-gray-400 mt-1">
                        Mot-clé: <span className="text-white font-medium">{alert.keyword}</span>
                      </div>
                    )}
                    <AlertDetails alert={alert} />
                  </div>
                  {!alert.is_read && (
                    <button
                      onClick={() => markRead(alert.id)}
                      title="Marquer comme lu"
                      className="absolute top-3 right-3 text-gray-500 hover:text-green-400 transition-colors"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
