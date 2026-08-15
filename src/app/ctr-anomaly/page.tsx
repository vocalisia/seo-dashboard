"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, Loader2, MousePointerClick } from "lucide-react";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site { id: number; name: string }
interface Anomaly {
  query: string; page: string; position: number;
  impressions: number; clicks: number;
  ctr_actual: number; ctr_expected: number;
  gap_pct: number; missed_clicks: number; diagnosis: string;
}
type LoadState = "loading-sites" | "loading" | "ready" | "empty-sites" | "error";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSiteList(payload: unknown): payload is Site[] {
  return Array.isArray(payload) && payload.every((site) =>
    isRecord(site) && isFiniteNumber(site.id) && typeof site.name === "string"
  );
}

function isAnomalyList(payload: unknown): payload is Anomaly[] {
  return Array.isArray(payload) && payload.every((row) =>
    isRecord(row)
    && typeof row.query === "string"
    && typeof row.page === "string"
    && typeof row.diagnosis === "string"
    && [row.position, row.impressions, row.clicks, row.ctr_actual, row.ctr_expected, row.gap_pct, row.missed_clicks].every(isFiniteNumber)
  );
}

export default function CTRAnomalyPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [rows, setRows] = useState<Anomaly[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading-sites");
  const [error, setError] = useState<string | null>(null);

  const loadSites = useCallback(async () => {
    try {
      const response = await fetch("/api/sites");
      const list = await readApiJson(response, isSiteList, "Impossible de charger les sites");
      setSites(list);
      if (list.length === 0) {
        setSiteId(null);
        setLoadState("empty-sites");
        return;
      }
      setRows([]);
      setError(null);
      setLoadState("loading");
      setSiteId(list[0].id);
    } catch (caught) {
      setSites([]);
      setSiteId(null);
      setRows([]);
      setError(caught instanceof Error ? caught.message : "Impossible de charger les sites");
      setLoadState("error");
    }
  }, []);

  const loadAnomalies = useCallback(async (selectedSiteId: number) => {
    try {
      const response = await fetch(`/api/ctr-anomaly?siteId=${selectedSiteId}&days=28&limit=100`);
      const data = await readApiJson(response, isAnomalyList, "Impossible de charger les anomalies CTR");
      setRows(data);
      setLoadState("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de charger les anomalies CTR");
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(loadSites); }, [loadSites]);
  useEffect(() => { if (siteId !== null) void Promise.resolve(siteId).then(loadAnomalies); }, [loadAnomalies, siteId]);

  const totalMissed = rows.reduce((s, r) => s + r.missed_clicks, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white"><ChevronLeft className="w-5 h-5" /></Link>
          <MousePointerClick className="w-6 h-6 text-purple-500" />
          <h1 className="text-xl font-bold">CTR Anomaly Detector</h1>
          <span className="text-xs text-gray-500">vs benchmark AWR 2026</span>
        </div>
        <select aria-label="Site à analyser" value={siteId || ""} disabled={sites.length === 0} onChange={e => {
          setRows([]); setError(null); setLoadState("loading"); setSiteId(parseInt(e.target.value, 10));
        }}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm">
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </header>

      {loadState === "ready" && <div className="px-6 py-4 grid grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Anomalies CTR</div>
          <div className="text-2xl font-bold text-purple-400">{rows.length}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Clics manqués (28j)</div>
          <div className="text-2xl font-bold text-red-400">-{totalMissed.toLocaleString()}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Gain potentiel mensuel</div>
          <div className="text-2xl font-bold text-green-400">+{Math.round(totalMissed * 30 / 28).toLocaleString()}</div>
        </div>
      </div>}

      <div className="px-6 pb-10">
        {loadState === "loading" || loadState === "loading-sites" ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-purple-500" /></div>
        ) : loadState === "error" ? (
          <div role="alert" className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            Erreur de chargement : {error ?? "réponse indisponible"}
          </div>
        ) : loadState === "empty-sites" ? (
          <div className="py-12 text-center text-gray-500">Aucun site actif disponible pour lancer l’analyse CTR.</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Aucune anomalie CTR — tout est dans la norme</div>
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
                  <th className="text-right py-3 px-3">Position</th>
                  <th className="text-right py-3 px-3">CTR actuel</th>
                  <th className="text-right py-3 px-3">CTR attendu</th>
                  <th className="text-right py-3 px-3">Gap</th>
                  <th className="text-right py-3 px-3">Clics manqués</th>
                  <th className="text-left py-3 px-5">Diagnostic</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="py-2 px-5 font-medium text-gray-200">
                      <a href={r.page} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {r.query}
                      </a>
                    </td>
                    <td className="text-right py-2 px-3">{r.position}</td>
                    <td className="text-right py-2 px-3 text-red-400">{r.ctr_actual}%</td>
                    <td className="text-right py-2 px-3 text-gray-400">{r.ctr_expected}%</td>
                    <td className="text-right py-2 px-3 font-bold text-red-400">{r.gap_pct}%</td>
                    <td className="text-right py-2 px-3 text-orange-400 font-bold">-{r.missed_clicks}</td>
                    <td className="py-2 px-5 text-xs">{r.diagnosis}</td>
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
