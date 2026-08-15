"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronLeft, AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site { id: number; name: string }
interface CannibRow {
  query: string; url_count: number;
  total_impressions: number; total_clicks: number;
  pages: { page: string; impressions: number; clicks: number; position: number }[];
  hhi: number;
  severity: "HIGH"|"MED"|"LOW";
  estimated_loss: number;
  suggested_action: string;
  site_id?: number | null; site_name?: string | null;
}

type SiteFilter = number | "all";
type SeverityOrder = "default" | "HIGH" | "MED" | "LOW";
type LoadState = "loading-sites" | "loading" | "ready" | "empty-sites" | "error";

const SEV_RANK: Record<string, number> = { HIGH: 3, MED: 2, LOW: 1 };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSiteList(payload: unknown): payload is Site[] {
  return Array.isArray(payload) && payload.every((site) =>
    isRecord(site) && isFiniteNumber(site.id) && typeof site.name === "string"
  );
}

function isCannibRowList(payload: unknown): payload is CannibRow[] {
  return Array.isArray(payload) && payload.every((row) =>
    isRecord(row)
    && typeof row.query === "string"
    && typeof row.suggested_action === "string"
    && [row.url_count, row.total_impressions, row.total_clicks, row.hhi, row.estimated_loss].every(isFiniteNumber)
    && (row.severity === "HIGH" || row.severity === "MED" || row.severity === "LOW")
    && (row.site_id === undefined || row.site_id === null || isFiniteNumber(row.site_id))
    && (row.site_name === undefined || row.site_name === null || typeof row.site_name === "string")
    && Array.isArray(row.pages)
    && row.pages.every((page) => isRecord(page)
      && typeof page.page === "string"
      && [page.impressions, page.clicks, page.position].every(isFiniteNumber))
  );
}

export default function CannibalizationHHIPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<SiteFilter | null>(null);
  const [rows, setRows] = useState<CannibRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading-sites");
  const [error, setError] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [severitySort, setSeveritySort] = useState<SeverityOrder>("default");
  const [severityFilter, setSeverityFilter] = useState<"ALL"|"HIGH"|"MED"|"LOW">("ALL");
  const [groupBySite, setGroupBySite] = useState(false);

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
    const limit = selectedSiteId === "all" ? 150 : 50;
    try {
      const response = await fetch(`/api/cannibalization-hhi?siteId=${selectedSiteId}&days=28&limit=${limit}`);
      const data = await readApiJson(response, isCannibRowList, "Impossible de charger la cannibalisation HHI");
      setRows(data);
      setLoadState("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de charger la cannibalisation HHI");
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(loadSites); }, [loadSites]);
  useEffect(() => { if (siteId !== null) void Promise.resolve(siteId).then(loadRows); }, [loadRows, siteId]);

  function selectSite(nextSiteId: SiteFilter) {
    setRows([]); setError(null); setLoadState("loading"); setSiteId(nextSiteId);
  }

  const totalLoss = rows.reduce((s, r) => s + r.estimated_loss, 0);
  const high = rows.filter(r => r.severity === "HIGH").length;

  const sortedRows = [...rows]
    .filter(r => severityFilter === "ALL" || r.severity === severityFilter)
    .sort((a, b) => {
      if (severitySort === "default") return 0;
      const ra = SEV_RANK[a.severity] ?? 0;
      const rb = SEV_RANK[b.severity] ?? 0;
      return severitySort === "HIGH" ? rb - ra : ra - rb;
    });

  const groupedRows: { site: string; items: CannibRow[] }[] =
    groupBySite && siteId === "all"
      ? Object.entries(
          sortedRows.reduce<Record<string, CannibRow[]>>((acc, r) => {
            const key = r.site_name ?? "Sans site";
            (acc[key] ??= []).push(r);
            return acc;
          }, {})
        ).map(([site, items]) => ({ site, items }))
      : [{ site: "", items: sortedRows }];

  function cycleSeverity() {
    setSeveritySort(prev =>
      prev === "default" ? "HIGH" : prev === "HIGH" ? "LOW" : "default"
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <AlertTriangle className="w-6 h-6 text-red-500" />
          <h1 className="text-xl font-bold">Cannibalisation (HHI score)</h1>
        </div>
        <select aria-label="Site à analyser" value={siteId ?? ""} disabled={sites.length === 0} onChange={e => selectSite(e.target.value === "all" ? "all" : parseInt(e.target.value))}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
          <option value="all">Tous les sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </header>

      {loadState === "ready" && <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Conflits détectés</div>
          <div className="text-2xl font-bold text-red-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Sévérité HIGH</div>
          <div className="text-2xl font-bold text-red-500">{high}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Clics perdus estimés (28j)</div>
          <div className="text-2xl font-bold text-orange-400">{totalLoss.toLocaleString()}</div>
        </div>
      </div>}

      <div className="px-6 pb-10 space-y-2">
        {loadState === "ready" && rows.length > 0 && (
          <div className="flex items-center gap-2 pb-2 flex-wrap">
            {(["ALL","HIGH","MED","LOW"] as const).map(s => (
              <button type="button" key={s} onClick={() => setSeverityFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  severityFilter === s
                    ? s === "HIGH" ? "bg-red-600 text-white"
                      : s === "MED" ? "bg-yellow-600 text-white"
                      : s === "LOW" ? "bg-gray-600 text-white"
                      : "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}>
                {s === "ALL" ? "Tous" : s}
              </button>
            ))}
            <div className="w-px h-4 bg-gray-700 mx-1" />
            <button type="button" onClick={cycleSeverity}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${severitySort !== "default" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              {severitySort === "default" ? "Trier: sévérité" : severitySort === "HIGH" ? "HIGH ↓" : "LOW ↑"}
            </button>
            {siteId === "all" && (
              <button onClick={() => setGroupBySite(g => !g)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${groupBySite ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                Grouper par site
              </button>
            )}
            <div className="ml-auto">
              <button type="button"
                onClick={() => {
                  const allKeys = sortedRows.map(r => r.query);
                  if (expandedKeys.size === allKeys.length) {
                    setExpandedKeys(new Set());
                  } else {
                    setExpandedKeys(new Set(allKeys));
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-400 hover:text-white transition">
                {expandedKeys.size === sortedRows.length ? <ChevronsDownUp className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3" />}
                {expandedKeys.size === sortedRows.length ? "Tout fermer" : "Tout ouvrir"}
              </button>
            </div>
          </div>
        )}
        {loadState === "loading" || loadState === "loading-sites" ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-red-500" /></div>
        ) : loadState === "error" ? (
          <div role="alert" className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            Erreur de chargement : {error ?? "réponse indisponible"}
          </div>
        ) : loadState === "empty-sites" ? (
          <div className="py-12 text-center text-gray-500">Aucun site actif disponible pour cette analyse.</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Pas de cannibalisation détectée</div>
        ) : (
          groupedRows.map(({ site, items }) => (
            <div key={site}>
              {groupBySite && siteId === "all" && site && (
                <div className="px-2 py-1.5 text-xs font-semibold text-blue-300 uppercase tracking-wider">
                  {site} <span className="text-gray-500 font-normal">({items.length})</span>
                </div>
              )}
              {items.map((r, i) => {
            const isOpen = expandedKeys.has(r.query);
            return (
              <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-5 py-3 cursor-pointer hover:bg-gray-800/40 flex items-center justify-between"
                  onClick={() => setExpandedKeys(prev => {
                    const next = new Set(prev);
                    if (isOpen) {
                      next.delete(r.query);
                    } else {
                      next.add(r.query);
                    }
                    return next;
                  })}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      r.severity === "HIGH" ? "bg-red-500/20 text-red-400" :
                      r.severity === "MED" ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-gray-700 text-gray-400"}`}>
                      {r.severity}
                    </span>
                    <span className="font-medium truncate">{r.query}</span>
                    {siteId === "all" && r.site_name && (
                      <button onClick={e => { e.stopPropagation(); selectSite(r.site_id!); }}
                        className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50 flex-shrink-0">
                        {r.site_name}
                      </button>
                    )}
                    <span className="text-xs text-gray-500">{r.url_count} URLs · HHI {r.hhi}</span>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-right">
                      <div className="text-orange-400 font-bold">-{r.estimated_loss}</div>
                      <div className="text-xs text-gray-500">clics perdus</div>
                    </div>
                    <div className="text-right">
                      <div className="text-purple-400">{r.total_impressions.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">impressions</div>
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-gray-800 bg-gray-950/50 px-5 py-3">
                    <div className="text-xs text-yellow-400 mb-2">{r.suggested_action}</div>
                    <table className="w-full text-xs">
                      <thead className="text-gray-500">
                        <tr>
                          <th className="text-left py-1">Page</th>
                          <th className="text-right py-1">Position</th>
                          <th className="text-right py-1">Impressions</th>
                          <th className="text-right py-1">Clics</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.pages.map((p, j) => (
                          <tr key={j} className="border-t border-gray-800/40">
                            <td className="py-1 truncate max-w-md">
                              <a href={p.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                                {p.page.replace(/^https?:\/\//, "")}
                              </a>
                            </td>
                            <td className="text-right py-1">{p.position.toFixed(1)}</td>
                            <td className="text-right py-1 text-purple-400">{p.impressions.toLocaleString()}</td>
                            <td className="text-right py-1 text-blue-400">{p.clicks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
