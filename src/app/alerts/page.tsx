"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bell, AlertTriangle, XCircle, Info, CheckCircle, Loader2 } from "lucide-react";
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
}

const SEVERITY_STYLE: Record<string, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  critical: { icon: XCircle, color: "text-red-400", bg: "bg-red-900/20 border-red-800" },
  warning: { icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-900/20 border-yellow-800" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-900/20 border-blue-800" },
};

const TYPE_LABEL: Record<string, string> = {
  position_drop: "📉 Chute position",
  not_indexed: "🔍 Non indexé",
  competitor_gain: "🎯 Concurrent monte",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => { void fetchAlerts(); }, []);

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

        {/* Alerts list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <div className="text-lg font-medium text-green-400">Aucune alerte</div>
            <div className="text-sm text-gray-500 mt-1">Tout va bien sur tes 16 sites</div>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const style = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.info;
              const Icon = style.icon;
              return (
                <div
                  key={alert.id}
                  className={`border rounded-xl p-4 flex items-start gap-3 ${style.bg}`}
                >
                  <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${style.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
                        {TYPE_LABEL[alert.alert_type] ?? alert.alert_type}
                      </span>
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
