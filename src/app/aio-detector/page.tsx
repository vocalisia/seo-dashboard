"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, Sparkles, RefreshCw } from "lucide-react";

interface Site { id: number; name: string }
interface AIORow {
  query: string;
  page: string;
  position: number;
  site_id: number | null;
  site_name: string | null;
  impressions: number;
  clicks: number;
  ctr_actual_pct: number;
  ctr_expected_pct: number;
  ctr_ratio: number;
  missed_clicks: number;
  aio_likely: boolean;
  confidence?: "probable" | "watch";
  recommendation: string;
}

interface AIOSummary {
  site_id: number;
  site_name: string | null;
  candidates: number;
  probable: number;
  watch: number;
  missed_clicks: number;
  checked?: boolean;
}

interface AIOResponse {
  rows?: AIORow[];
  summary?: AIOSummary[];
  coverage?: AIOSummary[];
  scanned?: number;
  sites_scanned?: number;
  sites_with_signals?: number;
  error?: string;
}

type SiteFilter = number | "all";

export default function AIODetectorPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<SiteFilter>("all");
  const [days, setDays] = useState<28 | 90>(28);
  const [rows, setRows] = useState<AIORow[]>([]);
  const [summary, setSummary] = useState<AIOSummary[]>([]);
  const [coverage, setCoverage] = useState<AIOSummary[]>([]);
  const [scanned, setScanned] = useState(0);
  const [sitesScanned, setSitesScanned] = useState(0);
  const [sitesWithSignals, setSitesWithSignals] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .catch(() => null)
      .then((data: unknown) => {
        if (Array.isArray(data)) setSites(data as Site[]);
      });
  }, []);

  async function runScan(nextSiteId: SiteFilter = siteId, nextDays: 28 | 90 = days) {
    setLoading(true);
    setError(null);
    const limit = nextSiteId === "all" ? 500 : 150;
    try {
      const res = await fetch(`/api/aio-detector?siteId=${nextSiteId}&days=${nextDays}&limit=${limit}&include_watch=1`);
      const data = await res.json() as AIOResponse | AIORow[];
      if (Array.isArray(data)) {
        setRows(data);
        setSummary([]);
        setCoverage([]);
        setScanned(data.length);
        setSitesScanned(0);
        setSitesWithSignals(0);
        return;
      }
      if (data.error) {
        setRows([]);
        setSummary([]);
        setCoverage([]);
        setScanned(0);
        setSitesScanned(0);
        setSitesWithSignals(0);
        setError(data.error);
        return;
      }
      setRows(data.rows ?? []);
      setSummary(data.summary ?? []);
      setCoverage(data.coverage ?? data.summary ?? []);
      setScanned(data.scanned ?? 0);
      setSitesScanned(data.sites_scanned ?? 0);
      setSitesWithSignals(data.sites_with_signals ?? data.summary?.length ?? 0);
    } catch (err) {
      setRows([]);
      setSummary([]);
      setCoverage([]);
      setScanned(0);
      setSitesScanned(0);
      setSitesWithSignals(0);
      setError(err instanceof Error ? err.message : "Erreur reseau");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runScan(siteId, days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const totalMissed = rows.reduce((sum, row) => sum + Math.max(0, Number(row.missed_clicks) || 0), 0);
  const probableCount = rows.filter((row) => row.confidence === "probable" || row.aio_likely).length;
  const visibleCoverage = coverage.length > 0 ? coverage : summary;
  const zeroSignalCount = Math.max(0, (sitesScanned || sites.length) - sitesWithSignals);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <Sparkles className="w-6 h-6 text-cyan-400 shrink-0" />
          <h1 className="text-xl font-bold whitespace-nowrap">AI Overview Detector</h1>
          <span className="text-xs text-gray-500 truncate">queries top 10 avec CTR anormalement bas</span>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Période d'analyse"
            value={days}
            onChange={(e) => {
              const next = Number(e.target.value) as 28 | 90;
              setDays(next);
              void runScan(siteId, next);
            }}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm"
          >
            <option value={28}>28j</option>
            <option value={90}>90j</option>
          </select>
          <select
            aria-label="Site à analyser"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm min-w-56"
          >
            <option value="all">Tous les sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void runScan()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Analyser
          </button>
        </div>
      </header>

      <div className="px-6 py-3 mx-6 mt-4 bg-cyan-900/20 border border-cyan-700/40 rounded-lg text-xs text-cyan-200">
        <strong>Methode heuristique sans scraping</strong> — probable: requete informationnelle en top 5 avec CTR tres bas. A verifier: CTR bas en top 10.
      </div>

      <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Signaux AIO / CTR bas</div>
          <div className="text-2xl font-bold text-cyan-400">{rows.length}</div>
          <div className="text-[11px] text-gray-500">
            {siteId === "all" ? `${sitesScanned || sites.length} sites controles - ` : ""}{scanned} requetes top 10 controlees
          </div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Clics manques ({days}j)</div>
          <div className="text-2xl font-bold text-red-400">-{totalMissed.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Tres probable</div>
          <div className="text-2xl font-bold text-red-500">{probableCount}</div>
          {siteId === "all" && (
            <div className="text-[11px] text-gray-500">{sitesWithSignals} sites avec signal - {zeroSignalCount} sans signal</div>
          )}
        </div>
      </div>

      <div className="px-6 pb-10">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-cyan-500" /></div>
        ) : error ? (
          <div className="py-12 text-center text-red-300">{error}</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            Aucun signal AIO detecte sur {days}j. {scanned > 0 ? `${scanned} requetes top 10 ont ete controlees.` : "Aucune requete top 10 suffisante a controler."}
          </div>
        ) : (
          <div className="space-y-4">
            {siteId === "all" && summary.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="text-sm font-semibold text-gray-200 mb-3">Sites les plus impactes</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {summary.slice(0, 9).map((item) => (
                    <button
                      key={item.site_id}
                      type="button"
                      onClick={() => setSiteId(item.site_id)}
                      className="text-left rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 hover:border-cyan-700"
                    >
                      <div className="text-sm text-cyan-300">{item.site_name ?? `Site ${item.site_id}`}</div>
                      <div className="text-xs text-gray-400">
                        {item.probable} probables · {item.watch} a verifier · -{item.missed_clicks.toLocaleString()} clics
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {siteId === "all" && visibleCoverage.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="text-sm font-semibold text-gray-200">Controle portfolio complet</div>
                  <div className="text-xs text-gray-500">
                    {sitesWithSignals} avec signal / {zeroSignalCount} sans signal
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  {visibleCoverage.slice(0, 40).map((item) => {
                    const hasSignal = (item.probable + item.watch) > 0;
                    return (
                      <button
                        key={item.site_id}
                        type="button"
                        onClick={() => setSiteId(item.site_id)}
                        className={`text-left rounded-lg border px-3 py-2 hover:border-cyan-700 ${
                          hasSignal ? "border-cyan-800 bg-cyan-950/20" : "border-gray-800 bg-gray-950"
                        }`}
                      >
                        <div className={hasSignal ? "text-sm text-cyan-300" : "text-sm text-gray-300"}>
                          {item.site_name ?? `Site ${item.site_id}`}
                        </div>
                        <div className="text-xs text-gray-500">
                          {item.candidates} requetes controlees - {hasSignal ? `${item.probable + item.watch} signaux` : "0 signal"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/50 text-gray-400 text-xs">
                  <tr>
                    <th className="text-left py-3 px-5">Query</th>
                    {siteId === "all" && <th className="text-left py-3 px-3">Site</th>}
                    <th className="text-right py-3 px-3">Pos</th>
                    <th className="text-right py-3 px-3">CTR actuel</th>
                    <th className="text-right py-3 px-3">CTR attendu</th>
                    <th className="text-right py-3 px-3">Ratio</th>
                    <th className="text-right py-3 px-3">Manques</th>
                    <th className="text-left py-3 px-3">Niveau</th>
                    <th className="text-left py-3 px-5">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.site_id ?? "site"}-${row.query}-${index}`} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-2 px-5 font-medium">
                        <a href={row.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                          {row.query}
                        </a>
                      </td>
                      {siteId === "all" && (
                        <td className="py-2 px-3">
                          {row.site_name && row.site_id
                            ? <button type="button" onClick={() => setSiteId(row.site_id!)} className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50">{row.site_name}</button>
                            : <span className="text-gray-500 text-xs">-</span>
                          }
                        </td>
                      )}
                      <td className="text-right py-2 px-3 text-green-400">{row.position}</td>
                      <td className="text-right py-2 px-3 text-red-400">{row.ctr_actual_pct}%</td>
                      <td className="text-right py-2 px-3 text-gray-400">{row.ctr_expected_pct}%</td>
                      <td className="text-right py-2 px-3 font-bold text-cyan-400">{row.ctr_ratio}</td>
                      <td className="text-right py-2 px-3 text-orange-400 font-bold">-{row.missed_clicks}</td>
                      <td className="py-2 px-3">
                        <span className={`rounded px-2 py-0.5 text-xs ${row.confidence === "probable" || row.aio_likely ? "bg-red-900/40 text-red-300" : "bg-yellow-900/40 text-yellow-300"}`}>
                          {row.confidence === "probable" || row.aio_likely ? "probable" : "a verifier"}
                        </span>
                      </td>
                      <td className="py-2 px-5 text-xs">{row.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
