"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Activity, CheckCircle, CircleDashed, AlertCircle, RefreshCw, Loader2 } from "lucide-react";

interface SiteGA4Status {
  id: number;
  name: string;
  url: string;
  ga_property_id: string | null;
  status: "ok" | "no_data" | "not_configured";
  last_data_date: string | null;
  sessions_7d: number;
  sessions_30d: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSiteGA4Status(value: unknown): value is SiteGA4Status {
  if (!isRecord(value)) return false;
  const validStatus = value.status === "ok" || value.status === "no_data" || value.status === "not_configured";
  const validPropertyId = value.ga_property_id === null || typeof value.ga_property_id === "string";
  const validLastDate = value.last_data_date === null || typeof value.last_data_date === "string";
  return typeof value.id === "number"
    && Number.isFinite(value.id)
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.url === "string"
    && value.url.trim().length > 0
    && validPropertyId
    && validStatus
    && validLastDate
    && isFiniteNonNegativeNumber(value.sessions_7d)
    && isFiniteNonNegativeNumber(value.sessions_30d);
}

function apiError(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (typeof value.message === "string" && value.message.trim()) return value.message;
  return fallback;
}

const STATUS_META = {
  ok: {
    label: "Données observées",
    icon: CheckCircle,
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/30",
    badge: "bg-green-500/20 text-green-400",
  },
  no_data: {
    label: "Aucune donnée observée",
    icon: CircleDashed,
    color: "text-amber-300",
    bg: "bg-amber-500/10 border-amber-500/30",
    badge: "bg-amber-500/20 text-amber-200",
  },
  not_configured: {
    label: "Property ID absent",
    icon: AlertCircle,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    badge: "bg-yellow-500/20 text-yellow-400",
  },
};

export default function GA4AuditPage() {
  const [sites, setSites] = useState<SiteGA4Status[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  async function fetchAudit(signal?: AbortSignal): Promise<SiteGA4Status[]> {
    const res = await fetch("/api/ga4-audit", { signal, cache: "no-store" });
    const data = await res.json().catch(() => null) as unknown;
    if (!res.ok) {
      throw new Error(`Audit GA4 indisponible : ${apiError(data, `erreur HTTP ${res.status}`)}`);
    }
    if (!Array.isArray(data) || !data.every(isSiteGA4Status)) {
      throw new Error("La réponse reçue pour l'audit GA4 est invalide.");
    }
    return data;
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAudit();
      setSites(data);
      setHasLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Audit GA4 indisponible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetchAudit(controller.signal)
      .then((data) => {
        setSites(data);
        setHasLoaded(true);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Audit GA4 indisponible");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const ok = sites.filter(s => s.status === "ok").length;
  const noData = sites.filter(s => s.status === "no_data").length;
  const notConfigured = sites.filter(s => s.status === "not_configured").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <Activity className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold">Audit des données GA4</h1>
          <span className="text-xs text-gray-500">configuration et présence de données importées, sans inspection du tag</span>
        </div>
        <button type="button" onClick={refresh} disabled={loading}
          className="flex min-h-11 items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 rounded-lg text-sm transition disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Actualiser
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-3">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Avec données importées</div>
          <div className="text-2xl font-bold text-green-400">{hasLoaded ? ok : "—"}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Sans donnée observée</div>
          <div className="text-2xl font-bold text-amber-300">{hasLoaded ? noData : "—"}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Property ID absent</div>
          <div className="text-2xl font-bold text-yellow-400">{hasLoaded ? notConfigured : "—"}</div>
        </div>
      </div>

      <div className="px-6 pb-10">
        {error && <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}{sites.length > 0 ? " Les dernières données valides restent affichées." : ""}</div>}
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /> Chargement de l&apos;audit GA4...</div>
        ) : !error && sites.length === 0 && hasLoaded ? (
          <div className="py-12 text-center text-gray-500">Audit terminé : aucun site actif n&apos;a été renvoyé.</div>
        ) : (
          <div className="space-y-2">
            {(["no_data", "not_configured", "ok"] as const).map(status =>
              sites.filter(s => s.status === status).map(site => {
                const meta = STATUS_META[site.status];
                const Icon = meta.icon;
                return (
                  <div key={site.id} className={`flex flex-col gap-4 rounded-xl border px-5 py-4 lg:flex-row lg:items-center lg:justify-between ${meta.bg}`}>
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <Icon className={`w-5 h-5 ${meta.color}`} aria-hidden="true" />
                      <div>
                        <div className="font-medium">{site.name}</div>
                        <div className="text-xs text-gray-500">{site.url}</div>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:text-right">
                      {site.ga_property_id ? (
                        <div>
                          <div className="text-xs text-gray-500">Property ID</div>
                          <div className="text-gray-300 font-mono text-xs">{site.ga_property_id}</div>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-600 italic">Pas de property ID</div>
                      )}
                      <div>
                        <div className="text-xs text-gray-500">Sessions 7j</div>
                        <div className={site.sessions_7d > 0 ? "text-green-400" : "text-gray-600"}>
                          {site.sessions_7d.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Sessions 30j</div>
                        <div className={site.sessions_30d > 0 ? "text-blue-400" : "text-gray-600"}>
                          {site.sessions_30d.toLocaleString()}
                        </div>
                      </div>
                      {site.last_data_date && (
                        <div>
                          <div className="text-xs text-gray-500">Dernière data</div>
                          <div className="text-gray-400 text-xs">{site.last_data_date}</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {!loading && noData + notConfigured > 0 && (
        <div className="px-6 pb-8">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 className="font-semibold text-sm text-gray-300 mb-3">Vérifications à effectuer</h2>
            <div className="space-y-2 text-xs text-gray-400">
              {noData > 0 && (
                <div className="flex gap-2">
                  <CircleDashed className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                  <span><span className="text-amber-300 font-semibold">Aucune donnée observée</span> — La propriété est renseignée, mais la base ne contient aucune session récente. Cela ne prouve pas que le tag est cassé : vérifier séparément l&apos;accès Data API, l&apos;ID numérique de propriété, la période, le consentement et la présence du tag sur le site.</span>
                </div>
              )}
              {notConfigured > 0 && (
                <div className="flex gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <span><span className="text-yellow-400 font-semibold">Property ID absent</span> — Aucun identifiant numérique de propriété GA4 n&apos;est saisi pour ce site. Le Measurement ID au format G-XXXXXXXX n&apos;est pas le Property ID utilisé par la Data API.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
