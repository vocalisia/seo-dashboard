"use client";

import { useEffect, useState } from "react";
import { Loader2, Target, TrendingUp, AlertTriangle, RefreshCw } from "lucide-react";

interface Action {
  site_id: number;
  site_name: string;
  site_url: string;
  query: string;
  position: number;
  impressions: number;
  clicks: number;
  monthly_volume: number;
  potential_clicks: number;
  action_type: "push" | "optimize" | "maintain" | "create";
}

interface ApiResp {
  success: boolean;
  generated_at?: string;
  total_potential_clicks?: number;
  actions?: Action[];
  ai_summary?: string;
  error?: string;
}

const TYPE_COLOR: Record<Action["action_type"], string> = {
  push: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  optimize: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  maintain: "bg-gray-700/30 text-gray-300 border-gray-600/40",
  create: "bg-purple-500/20 text-purple-300 border-purple-500/40",
};

const TYPE_LABEL: Record<Action["action_type"], string> = {
  push: "🚀 Pousser top 10",
  optimize: "✨ Optimiser CTR",
  maintain: "🏆 Maintenir",
  create: "📝 Créer contenu",
};

export default function WeeklyActionsPage() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/weekly-actions");
      const json = await res.json() as ApiResp;
      setData(json);
    } catch (e) {
      setData({ success: false, error: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Target className="w-7 h-7 text-orange-500" />
          <h1 className="text-xl font-bold">Action de la semaine</h1>
          <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-full">Top 10 quick wins</span>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Recalculer
        </button>
      </header>

      <main className="p-6 space-y-6">
        {loading && !data && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <div>Calcul des opportunités multi-sites...</div>
          </div>
        )}

        {data?.error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 text-red-300">
            <AlertTriangle className="inline w-4 h-4 mr-2" />
            {data.error}
          </div>
        )}

        {data?.success && data.actions && data.actions.length === 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center text-gray-400">
            Pas de quick wins détectés cette semaine. Synchronise GSC ou attends plus de données.
          </div>
        )}

        {data?.success && data.actions && data.actions.length > 0 && (
          <>
            {/* Header KPI */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Potentiel total
                </div>
                <div className="text-3xl font-bold text-orange-400">+{data.total_potential_clicks?.toLocaleString()}</div>
                <div className="text-xs text-gray-500 mt-1">clics/mois si top 3 atteint</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Mots-clés ciblés</div>
                <div className="text-3xl font-bold text-blue-400">{data.actions.length}</div>
                <div className="text-xs text-gray-500 mt-1">opportunités détectées</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Généré</div>
                <div className="text-sm font-semibold text-gray-300">{data.generated_at ? new Date(data.generated_at).toLocaleString("fr-FR") : "—"}</div>
                <div className="text-xs text-gray-500 mt-1">re-clic pour rafraîchir</div>
              </div>
            </div>

            {/* AI summary */}
            {data.ai_summary && (
              <div className="bg-gradient-to-br from-blue-950/40 to-purple-950/40 border border-blue-500/30 rounded-xl p-6">
                <div className="text-xs uppercase tracking-wider text-blue-400 font-semibold mb-3 flex items-center gap-2">
                  🤖 Plan d&apos;action — Head of SEO IA
                </div>
                <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                  {data.ai_summary}
                </div>
              </div>
            )}

            {/* Top 10 actions */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                <h2 className="font-semibold text-gray-200">Top 10 quick wins (triés par potentiel)</h2>
                <span className="text-xs text-gray-500">cliquer un lien = ouvrir l&apos;URL ciblée</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-800/50">
                  <tr className="text-gray-400 text-xs">
                    <th className="text-left py-2 px-4">#</th>
                    <th className="text-left py-2 px-4">Mot-clé</th>
                    <th className="text-left py-2 px-4">Site</th>
                    <th className="text-right py-2 px-4">Position</th>
                    <th className="text-right py-2 px-4">Volume / mois</th>
                    <th className="text-right py-2 px-4">Potentiel</th>
                    <th className="text-left py-2 px-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.actions.map((a, i) => (
                    <tr key={`${a.site_id}-${a.query}`} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-3 px-4 text-gray-500">{i + 1}</td>
                      <td className="py-3 px-4 font-medium text-gray-100">{a.query}</td>
                      <td className="py-3 px-4">
                        <a href={a.site_url} target="_blank" rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-xs">
                          {a.site_name}
                        </a>
                      </td>
                      <td className="text-right py-3 px-4">
                        <span className={`font-semibold ${a.position <= 10 ? "text-green-400" : a.position <= 20 ? "text-yellow-400" : "text-gray-300"}`}>
                          {a.position.toFixed(1)}
                        </span>
                      </td>
                      <td className="text-right py-3 px-4 text-gray-300">{a.monthly_volume.toLocaleString()}</td>
                      <td className="text-right py-3 px-4 text-orange-400 font-bold">+{a.potential_clicks.toLocaleString()}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded border ${TYPE_COLOR[a.action_type]}`}>
                          {TYPE_LABEL[a.action_type]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
