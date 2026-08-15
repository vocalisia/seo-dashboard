"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Link2, Loader2, Globe, BarChart2, Shield, Activity } from "lucide-react";
import Link from "next/link";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface BacklinkEntry {
  site_name?: string;
  linking_domain: string;
  target_page: string;
  link_count: number;
}

interface BacklinksResult {
  links: BacklinkEntry[];
  totalDomains: number;
  totalLinks: number;
  authorityScore: number;
  source: string;
  sourceLabel?: string;
  scoreLabel?: string;
}

type BacklinkScope = number | "all";

const REQUEST_TIMEOUT_MS = 30_000;

function requestError(error: unknown, action: string): string {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `${action} a dépassé le délai autorisé. Réessayez; si cela recommence, vérifiez la source GSC et l’API.`;
  }
  if (error instanceof TypeError) {
    return `${action} est impossible : ${error.message}. Vérifiez la connexion puis réessayez.`;
  }
  return error instanceof Error
    ? `${error.message}. Rechargez la page si votre session a expiré, puis réessayez.`
    : `${action} a échoué. Réessayez.`;
}

function isSite(value: unknown): value is Site {
  return isRecord(value)
    && Number.isInteger(value.id)
    && typeof value.name === "string"
    && typeof value.url === "string";
}

function isSiteList(value: unknown): value is Site[] {
  return Array.isArray(value) && value.every(isSite);
}

function isBacklinkEntry(value: unknown): value is BacklinkEntry {
  return isRecord(value)
    && typeof value.linking_domain === "string"
    && typeof value.target_page === "string"
    && typeof value.link_count === "number"
    && Number.isFinite(value.link_count)
    && (value.site_name === undefined || typeof value.site_name === "string");
}

function isBacklinksResult(value: unknown): value is BacklinksResult {
  return isRecord(value)
    && Array.isArray(value.links)
    && value.links.every(isBacklinkEntry)
    && ["totalDomains", "totalLinks", "authorityScore"]
      .every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))
    && typeof value.source === "string"
    && (value.sourceLabel === undefined || typeof value.sourceLabel === "string")
    && (value.scoreLabel === undefined || typeof value.scoreLabel === "string");
}

export default function BacklinksPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<number | "all" | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacklinksResult | null>(null);
  const [resultScope, setResultScope] = useState<BacklinkScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTiming, setLastTiming] = useState<{
    label: string;
    ms: number;
    server: string | null;
    scope: BacklinkScope;
  } | null>(null);

  const selectedSite = typeof selectedSiteId === "number"
    ? sites.find((site) => site.id === selectedSiteId) ?? null
    : null;
  const canLoad = selectedSiteId === "all" || !!selectedSite;

  useEffect(() => {
    let active = true;

    async function loadSites() {
      try {
        const response = await fetch("/api/sites", {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const payload = await readApiJson(response, isSiteList, "Le chargement des sites a échoué");
        if (!active) return;
        setSites(payload);
        setSitesError(payload.length === 0
          ? "Aucun site actif n’a été renvoyé. Vérifiez la configuration des sites."
          : null);
        if (payload.length > 0) {
          setSelectedSiteId((current) => current ?? payload[0].id);
        }
      } catch (fetchError) {
        if (active) setSitesError(requestError(fetchError, "Le chargement des sites"));
      }
    }

    void loadSites();
    return () => { active = false; };
  }, []);

  async function loadBacklinks() {
    if (!canLoad || selectedSiteId === null) {
      setError("Sélectionnez un site valide avant de charger les backlinks.");
      return;
    }
    const requestedScope = selectedSiteId;
    const hasConfirmedResult = result !== null && resultScope === requestedScope;
    setLoading(true);
    setError(null);
    try {
      const started = performance.now();
      const response = await fetch(`/api/gsc-links?site_id=${requestedScope}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await readApiJson(response, isBacklinksResult, "Le chargement des backlinks a échoué");
      setResult(payload);
      setResultScope(requestedScope);
      setLastTiming({
        label: "Backlinks",
        ms: performance.now() - started,
        server: response.headers.get("X-Response-Time"),
        scope: requestedScope,
      });
    } catch (fetchError) {
      const message = requestError(fetchError, "Le chargement des backlinks");
      setError(hasConfirmedResult ? `${message} Les dernières données confirmées restent affichées.` : message);
    } finally {
      setLoading(false);
    }
  }

  const displayedResult = resultScope === selectedSiteId ? result : null;
  const visibleTiming = lastTiming?.scope === selectedSiteId ? lastTiming : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" aria-label="Retour au dashboard" className="text-gray-400 hover:text-white transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Link2 className="w-6 h-6 text-blue-400" />
        <h1 className="text-xl font-bold">Backlinks &amp; Autorité</h1>
        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">GSC</span>
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          {visibleTiming ? `${visibleTiming.label} — dernière réussite: ${visibleTiming.ms >= 1000 ? `${(visibleTiming.ms / 1000).toFixed(1)}s` : `${Math.round(visibleTiming.ms)}ms`}${visibleTiming.server ? ` serveur ${visibleTiming.server}` : ""}` : "vitesse en attente"}
        </div>
      </header>

      <div className="px-6 py-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap gap-3 mb-8">
          <select
            aria-label="Site à analyser"
            value={selectedSiteId ?? ""}
            onChange={(e) => {
              setSelectedSiteId(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null);
              setError(null);
            }}
            disabled={loading}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.url}</option>
            ))}
          </select>

          <button
            onClick={loadBacklinks}
            disabled={loading || !canLoad}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loading ? "Chargement..." : "Charger les backlinks"}
          </button>
        </div>

        {sitesError && (
          <div className="mb-6 bg-red-900/20 border border-red-800 text-red-300 rounded-xl p-4" role="alert">
            {sitesError}
          </div>
        )}

        {loading && displayedResult && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Actualisation des dernières données confirmées...
          </div>
        )}

        {loading && !displayedResult && (
          <div className="flex flex-col items-center gap-4 py-16 text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p>Récupération des données de liens...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 rounded-xl p-4" role="alert">
            {error}
          </div>
        )}

        {displayedResult && (
          <div className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
                  <Globe className="w-3 h-3" /> Domaines référents
                </div>
                <div className="text-3xl font-bold text-blue-400">{displayedResult.totalDomains.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
                  <BarChart2 className="w-3 h-3" /> Total liens
                </div>
                <div className="text-3xl font-bold text-purple-400">{displayedResult.totalLinks.toLocaleString()}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
                  <Shield className="w-3 h-3" /> {displayedResult.scoreLabel ?? "Score autorité"}
                </div>
                <div className={`text-3xl font-bold ${displayedResult.authorityScore >= 50 ? "text-green-400" : displayedResult.authorityScore >= 25 ? "text-yellow-400" : "text-red-400"}`}>
                  {displayedResult.authorityScore}/100
                </div>
              </div>
            </div>

            {/* Links table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Liens entrants</h2>
                <span className={`text-xs px-2 py-1 rounded ${displayedResult.source === "gsc_impressions_fallback" ? "text-yellow-400 bg-yellow-500/10" : "text-green-400 bg-green-500/10"}`}>
                  {displayedResult.sourceLabel ?? displayedResult.source}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                      {selectedSiteId === "all" && <th className="py-3 px-4 text-left">Site</th>}
                      <th className="py-3 px-4 text-left">Domaine référent</th>
                      <th className="py-3 px-4 text-left">Page cible</th>
                      <th className="py-3 px-4 text-right">Nb liens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedResult.links.map((link, i) => (
                      <tr key={i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition">
                        {selectedSiteId === "all" && <td className="py-3 px-4 text-gray-300">{link.site_name ?? "—"}</td>}
                        <td className="py-3 px-4 text-blue-400 font-medium">{link.linking_domain}</td>
                        <td className="py-3 px-4 text-gray-400 text-xs max-w-xs truncate">{link.target_page}</td>
                        <td className="py-3 px-4 text-right text-gray-300">{link.link_count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-xs text-gray-600 text-center">
              {displayedResult.source === "gsc_impressions_fallback"
                ? "Estimation basée sur les impressions GSC, pas sur de vrais backlinks exportés."
                : "Données backlinks récupérées via Google Search Console."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
