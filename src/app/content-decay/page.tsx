"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Loader2, TrendingDown, Wrench } from "lucide-react";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";

interface Site {
  id: number;
  name: string;
}

interface DecayRow {
  page: string;
  query: string;
  clicks_recent: number;
  clicks_older: number;
  clicks_lost: number;
  clicks_drop_pct: number;
  position_recent: number;
  position_older: number;
  position_drop: number;
  ctr_drop_pct: number;
  severity: "CRIT" | "HIGH" | "MED";
  reason: string;
  action?: string;
  site_id?: number | null;
  site_name?: string | null;
}

type SiteFilter = number | "all";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSite(value: unknown): value is Site {
  return isRecord(value)
    && isFiniteNumber(value.id)
    && typeof value.name === "string"
    && value.name.trim().length > 0;
}

function isDecayRow(value: unknown): value is DecayRow {
  if (!isRecord(value)) return false;
  const validSeverity = value.severity === "CRIT" || value.severity === "HIGH" || value.severity === "MED";
  const validSiteId = value.site_id === undefined || value.site_id === null || isFiniteNumber(value.site_id);
  const validSiteName = value.site_name === undefined || value.site_name === null || typeof value.site_name === "string";
  return typeof value.page === "string"
    && value.page.trim().length > 0
    && typeof value.query === "string"
    && isFiniteNumber(value.clicks_recent)
    && isFiniteNumber(value.clicks_older)
    && isFiniteNumber(value.clicks_lost)
    && isFiniteNumber(value.clicks_drop_pct)
    && isFiniteNumber(value.position_recent)
    && isFiniteNumber(value.position_older)
    && isFiniteNumber(value.position_drop)
    && isFiniteNumber(value.ctr_drop_pct)
    && validSeverity
    && typeof value.reason === "string"
    && (value.action === undefined || typeof value.action === "string")
    && validSiteId
    && validSiteName;
}

function apiError(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (typeof value.message === "string" && value.message.trim()) return value.message;
  return fallback;
}

function pageLabel(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/$/, "");
    const label = path === "/" ? parsed.hostname : path;
    return label.length > 54 ? `${label.slice(0, 54)}...` : label;
  } catch {
    return url.length > 54 ? `${url.slice(0, 54)}...` : url;
  }
}

export default function ContentDecayPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<SiteFilter | null>(null);
  const [rows, setRows] = useState<DecayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadedSiteId, setLoadedSiteId] = useState<SiteFilter | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/sites", { signal: controller.signal });
        const data = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          throw new Error(apiError(data, `Liste des sites indisponible (HTTP ${response.status})`));
        }
        if (!Array.isArray(data) || !data.every(isSite)) {
          throw new Error("La liste des sites reçue est invalide.");
        }
        setSites(data);
        setSiteId("all");
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Liste des sites indisponible");
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (siteId === null) return;
    const controller = new AbortController();
    const limit = siteId === "all" ? 300 : 100;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/content-decay?siteId=${siteId}&limit=${limit}`, { signal: controller.signal });
        const data = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          throw new Error(apiError(data, `Analyse des contenus impossible (HTTP ${response.status})`));
        }
        if (!Array.isArray(data) || !data.every(isDecayRow)) {
          throw new Error("La réponse reçue pour le Content Decay est invalide.");
        }
        setRows(data);
        setHasLoaded(true);
        setLoadedSiteId(siteId);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Erreur réseau pendant l'analyse des contenus.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [siteId]);

  const hasCurrentResult = hasLoaded && loadedSiteId === siteId;
  const crit = rows.filter((r) => r.severity === "CRIT").length;
  const totalLost = rows.reduce((sum, row) => sum + Number(row.clicks_lost || Math.max(0, row.clicks_older - row.clicks_recent)), 0);
  const topLost = hasCurrentResult ? rows[0] : undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <TrendingDown className="w-6 h-6 text-red-500" />
          <h1 className="text-xl font-bold">Content Decay</h1>
          <span className="text-xs text-gray-500">pages SEO qui perdent des clics GSC</span>
        </div>
        <select
          aria-label="Site à analyser"
          value={siteId ?? ""}
          onChange={(e) => {
            setLoading(true);
            setError(null);
            setSiteId(e.target.value === "all" ? "all" : parseInt(e.target.value, 10));
          }}
          className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">Tous les sites</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </header>

      <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Pages à examiner</div>
          <div className="text-2xl font-bold text-red-400">{hasCurrentResult ? rows.length : "—"}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Priorité critique</div>
          <div className="text-2xl font-bold text-red-500">{hasCurrentResult ? crit : "—"}</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="text-xs text-gray-400">Baisse de clics observée</div>
          <div className="text-2xl font-bold text-orange-400">{hasCurrentResult ? `-${totalLost}` : "—"}</div>
        </div>
      </div>

      <div className="px-6 pb-10">
        <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-100">
          <div className="font-semibold mb-1">A quoi sert cette page ?</div>
          <div>
            Elle repère les pages qui avaient des clics Google avant et qui en perdent maintenant.
            Utilité : savoir quelles pages vérifier avant de rafraîchir le contenu, renforcer le maillage interne ou retravailler le snippet.
          </div>
          {topLost && (
            <div className="mt-2 text-blue-200">
              Priorite actuelle: <span className="font-semibold">{pageLabel(topLost.page)}</span>
              {topLost.site_name ? ` sur ${topLost.site_name}` : ""}.
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}{hasCurrentResult ? " Le dernier résultat valide reste affiché." : ""}</div>
        )}

        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin text-red-500" /> Analyse des contenus en cours...
          </div>
        ) : !hasCurrentResult ? null : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Analyse terminée : aucune page en perte nette détectée sur cette période.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-sm">
              <thead className="bg-gray-800/50 text-gray-400 text-xs">
                <tr>
                  <th className="text-center py-3 px-3">Sev.</th>
                  <th className="text-left py-3 px-3">
                    <span className="inline-flex items-center gap-2">
                      Page a verifier
                      <CopyKeywordsButton keywords={rows.map((row) => row.page)} />
                    </span>
                  </th>
                  {siteId === "all" && <th className="text-left py-3 px-3">Site</th>}
                  <th className="text-left py-3 px-3">Requetes touchees</th>
                  <th className="text-right py-3 px-3">Recent</th>
                  <th className="text-right py-3 px-3">Avant</th>
                  <th className="text-right py-3 px-3">Perdus</th>
                  <th className="text-right py-3 px-3">Delta clics</th>
                  <th className="text-right py-3 px-3">Pos.</th>
                  <th className="text-left py-3 px-5">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.page}-${index}`} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="text-center py-2 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                        row.severity === "CRIT" ? "bg-red-500/30 text-red-300" :
                        row.severity === "HIGH" ? "bg-orange-500/20 text-orange-400" :
                        "bg-yellow-500/20 text-yellow-400"
                      }`}>
                        {row.severity}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium">
                      <a href={row.page} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-blue-400">
                        {pageLabel(row.page)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    {siteId === "all" && (
                      <td className="py-2 px-3">
                        {row.site_name && row.site_id
                          ? <button onClick={() => setSiteId(row.site_id!)} className="bg-blue-900/30 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-xs hover:bg-blue-900/50">{row.site_name}</button>
                          : <span className="text-gray-500 text-xs">-</span>
                        }
                      </td>
                    )}
                    <td className="py-2 px-3 text-xs text-gray-300 max-w-[260px] truncate" title={row.query}>{row.query || "-"}</td>
                    <td className="text-right py-2 px-3 text-blue-400">{row.clicks_recent}</td>
                    <td className="text-right py-2 px-3 text-gray-400">{row.clicks_older}</td>
                    <td className="text-right py-2 px-3 text-orange-300 font-bold">-{row.clicks_lost}</td>
                    <td className="text-right py-2 px-3 font-bold text-red-400">{row.clicks_drop_pct}%</td>
                    <td className="text-right py-2 px-3">{row.position_recent}</td>
                    <td className="py-2 px-5 text-xs">
                      <div className="flex items-start gap-2">
                        <Wrench className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-300" />
                        <div>
                          <div className="font-semibold text-gray-200">{row.reason}</div>
                          <div className="text-gray-400">{row.action}</div>
                        </div>
                      </div>
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
