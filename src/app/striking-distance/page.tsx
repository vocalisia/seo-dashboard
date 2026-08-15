"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, ChevronLeft, TrendingUp, Target } from "lucide-react";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site { id: number; name: string }
interface StrikingRow {
  query: string; page: string; clicks: number; impressions: number;
  position: number; ctr: number; uplift_estimate: number; priority: "P0"|"P1"|"P2";
  site_id?: number | null; site_name?: string | null;
}

type SiteFilter = number | "all";
type LoadState = "loading-sites" | "loading" | "ready" | "empty-sites" | "error";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSiteList(payload: unknown): payload is Site[] {
  return Array.isArray(payload) && payload.every((site) =>
    isRecord(site) && isFiniteNumber(site.id) && typeof site.name === "string"
  );
}

function isStrikingRowList(payload: unknown): payload is StrikingRow[] {
  return Array.isArray(payload) && payload.every((row) =>
    isRecord(row)
    && typeof row.query === "string"
    && typeof row.page === "string"
    && [row.clicks, row.impressions, row.position, row.ctr, row.uplift_estimate].every(isFiniteNumber)
    && (row.priority === "P0" || row.priority === "P1" || row.priority === "P2")
    && (row.site_id === undefined || row.site_id === null || isFiniteNumber(row.site_id))
    && (row.site_name === undefined || row.site_name === null || typeof row.site_name === "string")
  );
}

export default function StrikingDistancePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<SiteFilter | null>(null);
  const [rows, setRows] = useState<StrikingRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading-sites");
  const [error, setError] = useState<string | null>(null);

  const loadSites = useCallback(async () => {
    try {
      const response = await fetch("/api/sites");
      const data = await readApiJson(response, isSiteList, "Impossible de charger les sites");
      setSites(data);
      if (data.length === 0) {
        setSiteId(null);
        setLoadState("empty-sites");
        return;
      }
      setRows([]);
      setError(null);
      setLoadState("loading");
      setSiteId("all");
    } catch (caught) {
      setSites([]);
      setSiteId(null);
      setRows([]);
      setError(caught instanceof Error ? caught.message : "Impossible de charger les sites");
      setLoadState("error");
    }
  }, []);

  const loadRows = useCallback(async (selectedSiteId: SiteFilter) => {
    const limit = selectedSiteId === "all" ? 300 : 100;
    try {
      const response = await fetch(`/api/striking-distance?siteId=${selectedSiteId}&days=28&limit=${limit}`);
      const data = await readApiJson(response, isStrikingRowList, "Impossible de charger les opportunités striking distance");
      setRows(data);
      setLoadState("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de charger les opportunités striking distance");
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(loadSites); }, [loadSites]);
  useEffect(() => { if (siteId !== null) void Promise.resolve(siteId).then(loadRows); }, [loadRows, siteId]);

  function selectSite(nextSiteId: SiteFilter) {
    setRows([]);
    setError(null);
    setLoadState("loading");
    setSiteId(nextSiteId);
  }

  const totalUplift = rows.reduce((s, r) => s + r.uplift_estimate, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <Target className="w-6 h-6 text-orange-500" />
          <h1 className="text-xl font-bold">Striking Distance</h1>
          <span className="text-xs text-gray-500">Pos 8-20 → page 1 facile</span>
        </div>
        <select aria-label="Site à analyser" value={siteId ?? ""} disabled={sites.length === 0} onChange={e => {
          selectSite(e.target.value === "all" ? "all" : parseInt(e.target.value));
        }}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
          <option value="all">Tous les sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </header>

      {loadState === "ready" && <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Opportunités</div>
          <div className="text-2xl font-bold text-orange-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Uplift cumulé estimé (clics/mois)</div>
          <div className="text-2xl font-bold text-green-400">+{totalUplift.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Priorité P0</div>
          <div className="text-2xl font-bold text-red-400">{rows.filter(r => r.priority === "P0").length}</div>
        </div>
      </div>}

      <div className="px-6 pb-10">
        {loadState === "loading" || loadState === "loading-sites" ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-orange-500" /></div>
        ) : loadState === "error" ? (
          <div role="alert" className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            Erreur de chargement : {error ?? "réponse indisponible"}
          </div>
        ) : loadState === "empty-sites" ? (
          <div className="py-12 text-center text-gray-500">Aucun site actif disponible pour cette analyse.</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Aucune opportunité striking distance pour ce site sur 28j</div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-gray-400 text-xs">
                <tr>
                  <th className="text-left py-3 px-5">
                    <span className="inline-flex items-center gap-2">
                      Mot clé
                      <CopyKeywordsButton keywords={rows.map((r) => r.query)} />
                    </span>
                  </th>
                  {siteId === "all" && <th className="text-left py-3 px-3">Site</th>}
                  <th className="text-right py-3 px-3">Position</th>
                  <th className="text-right py-3 px-3">Clics</th>
                  <th className="text-right py-3 px-3">Impressions</th>
                  <th className="text-right py-3 px-3">CTR</th>
                  <th className="text-right py-3 px-3">Uplift si pos 5</th>
                  <th className="text-center py-3 px-3">Prio</th>
                  <th className="text-left py-3 px-5">Page</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="py-2 px-5 font-medium text-gray-200">{r.query}</td>
                    {siteId === "all" && (
                      <td className="py-2 px-3">
                        {r.site_name
                          ? <button onClick={() => selectSite(r.site_id!)} className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50">{r.site_name}</button>
                          : <span className="text-gray-500 text-xs">—</span>
                        }
                      </td>
                    )}
                    <td className="text-right py-2 px-3">
                      <span className={r.position <= 10 ? "text-yellow-400" : "text-gray-300"}>{r.position}</span>
                    </td>
                    <td className="text-right py-2 px-3 text-blue-400">{r.clicks}</td>
                    <td className="text-right py-2 px-3 text-gray-400">{r.impressions.toLocaleString()}</td>
                    <td className="text-right py-2 px-3 text-gray-400">{r.ctr}%</td>
                    <td className="text-right py-2 px-3">
                      <span className="text-green-400 font-bold flex items-center justify-end gap-1">
                        <TrendingUp className="w-3 h-3" />+{r.uplift_estimate}
                      </span>
                    </td>
                    <td className="text-center py-2 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        r.priority === "P0" ? "bg-red-500/20 text-red-400" :
                        r.priority === "P1" ? "bg-yellow-500/20 text-yellow-400" :
                        "bg-gray-700 text-gray-400"}`}>
                        {r.priority}
                      </span>
                    </td>
                    <td className="py-2 px-5 text-xs text-gray-500 truncate max-w-xs" title={r.page}>
                      <a href={r.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {r.page.replace(/^https?:\/\//, "")}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
