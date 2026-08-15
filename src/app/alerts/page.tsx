"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Bell, AlertTriangle, XCircle, Info, CheckCircle, Loader2, ExternalLink, MessageSquare } from "lucide-react";
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

interface BrandMention {
  id: number;
  site_id: number;
  source: string;
  title: string;
  url: string | null;
  score: number;
  created_at_external: string | null;
  body: string | null;
  sentiment: string;
  scanned_at: string;
  site_name: string | null;
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
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [filterSite, setFilterSite] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [mentions, setMentions] = useState<BrandMention[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentionsError, setMentionsError] = useState<string | null>(null);
  const [scanningMentions, setScanningMentions] = useState(false);
  const [markingReadId, setMarkingReadId] = useState<number | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function fetchMentions() {
    setMentionsLoading(true);
    setMentionsError(null);
    try {
      const res = await fetch("/api/brand-mentions?limit=30");
      const d = await res.json().catch(() => ({})) as {
        success?: boolean;
        mentions?: BrandMention[];
        error?: string;
      };
      if (!res.ok || d.success === false) {
        throw new Error(d.error || `Chargement impossible (HTTP ${res.status})`);
      }
      setMentions(d.mentions ?? []);
    } catch (error) {
      setMentionsError(errorMessage(error, "Impossible de charger les mentions."));
    } finally {
      setMentionsLoading(false);
    }
  }

  async function scanMentions() {
    setScanningMentions(true);
    setMentionsError(null);
    setOperationMessage(null);
    try {
      const res = await fetch("/api/brand-mentions/scan", { method: "POST" });
      const d = await res.json().catch(() => ({})) as {
        success?: boolean;
        summary?: Array<{ found?: number; inserted?: number }>;
        error?: string;
      };
      if (!res.ok || d.success !== true) {
        throw new Error(d.error || `Scan impossible (HTTP ${res.status})`);
      }
      await fetchMentions();
      const found = d.summary?.reduce((sum, item) => sum + (item.found ?? 0), 0) ?? 0;
      setOperationMessage(`Scan des mentions terminé : ${found} résultat${found > 1 ? "s" : ""} détecté${found > 1 ? "s" : ""}.`);
    } catch (error) {
      setMentionsError(errorMessage(error, "Le scan des mentions a échoué."));
    } finally {
      setScanningMentions(false);
    }
  }

  async function fetchAlerts() {
    setLoading(true);
    setAlertsError(null);
    try {
      const res = await fetch("/api/alerts");
      const d = await res.json().catch(() => ({})) as {
        success?: boolean;
        alerts?: Alert[];
        error?: string;
      };
      if (!res.ok || d.success !== true) {
        throw new Error(d.error || `Chargement impossible (HTTP ${res.status})`);
      }
      setAlerts(d.alerts ?? []);
    } catch (error) {
      setAlertsError(errorMessage(error, "Impossible de charger les alertes."));
    } finally {
      setLoading(false);
    }
  }

  async function runCheck() {
    setChecking(true);
    setAlertsError(null);
    setOperationMessage(null);
    try {
      const res = await fetch("/api/alerts/check", { method: "POST" });
      const d = await res.json().catch(() => ({})) as {
        success?: boolean;
        alerts?: number;
        error?: string;
      };
      if (!res.ok || d.success !== true) {
        throw new Error(d.error || `Vérification impossible (HTTP ${res.status})`);
      }
      await fetchAlerts();
      const count = d.alerts ?? 0;
      setOperationMessage(`Vérification terminée : ${count} alerte${count > 1 ? "s" : ""} détectée${count > 1 ? "s" : ""}.`);
    } catch (error) {
      setAlertsError(errorMessage(error, "La vérification des alertes a échoué."));
    } finally {
      setChecking(false);
    }
  }

  async function markRead(id: number) {
    setMarkingReadId(id);
    setAlertsError(null);
    try {
      const res = await fetch(`/api/alerts/${id}/read`, { method: "POST" });
      const d = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!res.ok || d.success !== true) {
        throw new Error(d.error || `Mise à jour impossible (HTTP ${res.status})`);
      }
      setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, is_read: true } : a));
    } catch (error) {
      setAlertsError(errorMessage(error, "Impossible de marquer cette alerte comme lue."));
    } finally {
      setMarkingReadId(null);
    }
  }

  // Initial load is intentionally tied to the page mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchAlerts(); void fetchMentions(); }, []);

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
        {operationMessage && (
          <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
            {operationMessage}
          </div>
        )}

        {alertsError && (
          <div role="alert" className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <span className="font-medium">Données d’alertes indisponibles.</span> {alertsError}
          </div>
        )}

        {/* Stats + actions */}
        <div className="flex items-center gap-4">
          <div className="flex gap-3">
            <div className="bg-red-900/20 border border-red-800 rounded-lg px-4 py-2 text-center">
              <div className="text-2xl font-bold text-red-400">{loading && alerts.length === 0 ? "—" : critical}</div>
              <div className="text-xs text-gray-400">Critiques</div>
            </div>
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg px-4 py-2 text-center">
              <div className="text-2xl font-bold text-yellow-400">{loading && alerts.length === 0 ? "—" : warning}</div>
              <div className="text-xs text-gray-400">Avertissements</div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-center">
              <div className="text-2xl font-bold text-white">{loading && alerts.length === 0 ? "—" : alerts.length}</div>
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
            aria-label="Filtrer les alertes par site"
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
            aria-label="Filtrer les alertes par sévérité"
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
            aria-label="Filtrer les alertes par type"
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
        {loading && alerts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
          </div>
        ) : alertsError && alerts.length === 0 ? (
          <div className="rounded-xl border border-red-900 bg-gray-900 px-6 py-12 text-center text-sm text-gray-300">
            Le serveur n’a pas renvoyé les alertes. Relance la vérification après avoir corrigé l’erreur affichée ci-dessus.
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <div className="text-lg font-medium text-green-400">Aucune alerte dans cette vue</div>
            <div className="text-sm text-gray-500 mt-1">Ce résultat correspond aux données chargées et aux filtres actifs.</div>
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
                      {alert.site_url && (
                        <span className="text-xs text-gray-500 font-mono">
                          {alert.site_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </span>
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
                      disabled={markingReadId === alert.id}
                      title="Marquer comme lu"
                      className="absolute top-2 right-2 grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-800 hover:text-green-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-wait disabled:opacity-50"
                    >
                      {markingReadId === alert.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Mentions Reddit / HackerNews */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
            <MessageSquare className="w-4 h-4 text-orange-400" />
            <h2 className="font-medium text-gray-200">Mentions Reddit / HackerNews</h2>
            <span className="text-xs text-gray-500">{mentions.length} récentes</span>
            <button
              onClick={scanMentions}
              disabled={scanningMentions}
              className="ml-auto px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-xs font-medium flex items-center gap-2"
            >
              {scanningMentions ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
              {scanningMentions ? "Scan…" : "Scanner maintenant"}
            </button>
          </div>
          <div className="p-4">
            {mentionsError && (
              <div role="alert" className="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                <span className="font-medium">Mentions indisponibles.</span> {mentionsError}
              </div>
            )}
            {mentionsLoading && mentions.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
              </div>
            ) : mentionsError && mentions.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-500">
                Aucun résultat fiable n’est affiché tant que le chargement échoue.
              </div>
            ) : mentions.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-6">
                Aucune mention pour le moment. Lance un scan pour interroger Reddit + HackerNews.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {mentions.map((m) => {
                  const sentimentColor =
                    m.sentiment === "positive"
                      ? "text-emerald-400"
                      : m.sentiment === "negative"
                      ? "text-red-400"
                      : "text-gray-400";
                  return (
                    <a
                      key={m.id}
                      href={m.url ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-gray-800/50 border border-gray-700 hover:border-orange-700 rounded-lg p-3 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1.5 text-xs">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${m.source === "reddit" ? "bg-orange-900/40 text-orange-300" : "bg-yellow-900/40 text-yellow-300"}`}>
                          {m.source === "reddit" ? "Reddit" : "HN"}
                        </span>
                        {m.site_name && (
                          <span className="text-blue-400">{m.site_name}</span>
                        )}
                        <span className={sentimentColor}>{m.sentiment}</span>
                        <span className="text-gray-500 ml-auto">score {m.score}</span>
                      </div>
                      <div className="text-sm text-white line-clamp-2">{m.title}</div>
                      {m.created_at_external && (
                        <div className="text-xs text-gray-500 mt-1.5">
                          {new Date(m.created_at_external).toLocaleDateString("fr-FR", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                          })}
                        </div>
                      )}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
