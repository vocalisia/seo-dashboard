"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Activity, CheckCircle, XCircle, AlertCircle, RefreshCw, Loader2 } from "lucide-react";

interface SiteGA4Status {
  id: number;
  name: string;
  url: string;
  ga_property_id: string | null;
  status: "ok" | "broken" | "not_configured";
  last_data_date: string | null;
  sessions_7d: number;
  sessions_30d: number;
}

const STATUS_META = {
  ok: {
    label: "OK",
    icon: CheckCircle,
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/30",
    badge: "bg-green-500/20 text-green-400",
  },
  broken: {
    label: "Tag cassé",
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    badge: "bg-red-500/20 text-red-400",
  },
  not_configured: {
    label: "Non configuré",
    icon: AlertCircle,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    badge: "bg-yellow-500/20 text-yellow-400",
  },
};

export default function GA4AuditPage() {
  const [sites, setSites] = useState<SiteGA4Status[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/ga4-audit");
      const data = await res.json();
      if (Array.isArray(data)) setSites(data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const ok = sites.filter(s => s.status === "ok").length;
  const broken = sites.filter(s => s.status === "broken").length;
  const notConfigured = sites.filter(s => s.status === "not_configured").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <Activity className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold">Audit balises GA4</h1>
          <span className="text-xs text-gray-500">Détection problèmes analytics par site</span>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg text-sm transition disabled:opacity-50">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Actualiser
        </button>
      </header>

      <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Tags OK</div>
          <div className="text-2xl font-bold text-green-400">{ok}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Tags cassés</div>
          <div className="text-2xl font-bold text-red-400">{broken}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Non configurés</div>
          <div className="text-2xl font-bold text-yellow-400">{notConfigured}</div>
        </div>
      </div>

      <div className="px-6 pb-10">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>
        ) : sites.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Aucun site trouvé</div>
        ) : (
          <div className="space-y-2">
            {(["broken", "not_configured", "ok"] as const).map(status =>
              sites.filter(s => s.status === status).map(site => {
                const meta = STATUS_META[site.status];
                const Icon = meta.icon;
                return (
                  <div key={site.id} className={`rounded-xl border px-5 py-4 flex items-center justify-between ${meta.bg}`}>
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${meta.color}`} />
                      <div>
                        <div className="font-medium">{site.name}</div>
                        <div className="text-xs text-gray-500">{site.url}</div>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-right">
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

      {!loading && broken + notConfigured > 0 && (
        <div className="px-6 pb-8">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <h2 className="font-semibold text-sm text-gray-300 mb-3">Comment réparer</h2>
            <div className="space-y-2 text-xs text-gray-400">
              {broken > 0 && (
                <div className="flex gap-2">
                  <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <span><span className="text-red-400 font-semibold">Tag cassé</span> — Property ID configuré mais aucune donnée reçue depuis 30 jours. Vérifier que le tag GA4 est bien présent dans le HTML et que la property ID correspond.</span>
                </div>
              )}
              {notConfigured > 0 && (
                <div className="flex gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <span><span className="text-yellow-400 font-semibold">Non configuré</span> — Aucun GA4 property ID saisi pour ce site. Aller dans Paramètres → Sites pour ajouter l&apos;ID (format G-XXXXXXXX).</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
