"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp, TrendingDown, Globe, CheckCircle, XCircle, Minus, ExternalLink } from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface RoiArticle {
  id: number;
  keyword: string;
  language: string;
  created_at: string;
  before: { position: number; clicks: number; impressions: number };
  after_7d: { position: number; clicks: number; impressions: number };
  after_30d: { position: number; clicks: number; impressions: number };
  improvement: number;
}

interface IndexArticle {
  id: number;
  keyword: string;
  language: string;
  url: string;
  status_code: number;
  indexed: boolean;
}

const LANG_FLAG: Record<string, string> = {
  fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹",
};

export default function RoiPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [roi, setRoi] = useState<RoiArticle[]>([]);
  const [indexation, setIndexation] = useState<IndexArticle[]>([]);
  const [loadingRoi, setLoadingRoi] = useState(false);
  const [loadingIdx, setLoadingIdx] = useState(false);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const d = await res.json() as Site[] | { sites?: Site[] };
      const list = Array.isArray(d) ? d : d.sites ?? [];
      if (list.length > 0) {
        setSites(list);
        if (!selectedSite) setSelectedSite(list[0].id);
      }
    } catch { /* ignore */ }
  }

  async function fetchRoi() {
    if (!selectedSite) return;
    setLoadingRoi(true);
    try {
      const res = await fetch(`/api/autopilot/roi?site_id=${selectedSite}`);
      const d = await res.json() as { articles?: RoiArticle[] };
      setRoi(d.articles ?? []);
    } catch { setRoi([]); }
    setLoadingRoi(false);
  }

  async function fetchIndexation() {
    if (!selectedSite) return;
    setLoadingIdx(true);
    try {
      const res = await fetch(`/api/autopilot/indexation?site_id=${selectedSite}`);
      const d = await res.json() as { articles?: IndexArticle[] };
      setIndexation(d.articles ?? []);
    } catch { setIndexation([]); }
    setLoadingIdx(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchSites();
  }, []);

  useEffect(() => {
    if (selectedSite) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchRoi();
      void fetchIndexation();
    }
  }, [selectedSite]);

  const totalImprovement = roi.reduce((s, a) => s + a.improvement, 0);
  const indexedCount = indexation.filter((a) => a.indexed).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/autopilot" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Autopilot
        </Link>
        <TrendingUp className="w-5 h-5 text-emerald-400" />
        <h1 className="text-xl font-semibold">ROI &amp; Indexation</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Site selector */}
        <div className="flex items-center gap-4">
          <select
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-64"
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {(() => {
            const current = sites.find((s) => s.id === selectedSite);
            return current?.url ? (
              <a href={current.url} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm">
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : null;
          })()}
          <button onClick={() => { void fetchRoi(); void fetchIndexation(); }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium">
            Actualiser
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Articles publiés</div>
            <div className="text-3xl font-bold text-white mt-1">{roi.length}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Gain position moyen</div>
            <div className={`text-3xl font-bold mt-1 ${totalImprovement > 0 ? "text-emerald-400" : totalImprovement < 0 ? "text-red-400" : "text-gray-400"}`}>
              {roi.length > 0 ? (totalImprovement / roi.length).toFixed(1) : "—"}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="text-sm text-gray-400">Indexés Google</div>
            <div className="text-3xl font-bold text-white mt-1">
              {indexation.length > 0 ? `${indexedCount}/${indexation.length}` : "—"}
            </div>
          </div>
        </div>

        {/* ROI Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="font-medium text-gray-200 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Impact SEO des articles publiés
            </h2>
          </div>
          {loadingRoi ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : roi.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              Aucun article publié — lance l&apos;autopilot d&apos;abord
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left">Lang</th>
                    <th className="px-5 py-3 text-left">Mot-clé</th>
                    <th className="px-5 py-3 text-right">Pos. avant</th>
                    <th className="px-5 py-3 text-right">Pos. +7j</th>
                    <th className="px-5 py-3 text-right">Pos. +30j</th>
                    <th className="px-5 py-3 text-right">Gain</th>
                    <th className="px-5 py-3 text-right">Clics +30j</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.map((a) => (
                    <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-5 py-3">{LANG_FLAG[a.language] ?? a.language}</td>
                      <td className="px-5 py-3 font-medium text-white">{a.keyword}</td>
                      <td className="px-5 py-3 text-right text-gray-400">{a.before.position > 0 ? a.before.position.toFixed(1) : "—"}</td>
                      <td className="px-5 py-3 text-right text-gray-400">{a.after_7d.position > 0 ? a.after_7d.position.toFixed(1) : "—"}</td>
                      <td className="px-5 py-3 text-right text-gray-400">{a.after_30d.position > 0 ? a.after_30d.position.toFixed(1) : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`flex items-center justify-end gap-1 ${
                          a.improvement > 0 ? "text-emerald-400" : a.improvement < 0 ? "text-red-400" : "text-gray-500"
                        }`}>
                          {a.improvement > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : a.improvement < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                          {a.improvement > 0 ? "+" : ""}{a.improvement.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-blue-400">{a.after_30d.clicks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Indexation Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="font-medium text-gray-200 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400" />
              Statut d&apos;indexation ({indexedCount}/{indexation.length})
            </h2>
          </div>
          {loadingIdx ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : indexation.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              Aucun article publié
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left">Lang</th>
                    <th className="px-5 py-3 text-left">Mot-clé</th>
                    <th className="px-5 py-3 text-left">URL</th>
                    <th className="px-5 py-3 text-center">Indexé</th>
                  </tr>
                </thead>
                <tbody>
                  {indexation.map((a) => (
                    <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-5 py-3">{LANG_FLAG[a.language] ?? a.language}</td>
                      <td className="px-5 py-3 font-medium text-white">{a.keyword}</td>
                      <td className="px-5 py-3">
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-xs truncate block max-w-[300px]">
                          {a.url}
                        </a>
                      </td>
                      <td className="px-5 py-3 text-center">
                        {a.indexed ? (
                          <CheckCircle className="w-5 h-5 text-emerald-400 mx-auto" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400 mx-auto" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
