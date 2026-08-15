"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Link2, AlertTriangle, CheckCircle } from "lucide-react";
import Link from "next/link";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site { id: number; name: string; }

interface AuditResult {
  success: boolean;
  total_articles: number;
  total_internal_links: number;
  avg_links_per_article: number;
  orphan_pages: string[];
  link_poor_pages: { slug: string; outgoing_links: number }[];
  suggestions: { from: string; to: string; reason: string }[];
  error?: string;
}

const REQUEST_TIMEOUT_MS = 65_000;

function requestError(error: unknown, action: string): string {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `${action} a dépassé le délai autorisé. Réessayez; si cela recommence, vérifiez GitHub, le sitemap et l’API.`;
  }
  if (error instanceof TypeError) {
    return `${action} est impossible : ${error.message}. Vérifiez la connexion puis réessayez.`;
  }
  return error instanceof Error
    ? `${error.message}. Rechargez la page si votre session a expiré, puis réessayez.`
    : `${action} a échoué. Réessayez.`;
}

function isSite(value: unknown): value is Site {
  return isRecord(value) && Number.isInteger(value.id) && typeof value.name === "string";
}

function isSiteList(value: unknown): value is Site[] {
  return Array.isArray(value) && value.every(isSite);
}

function isAuditResult(value: unknown): value is AuditResult {
  return isRecord(value)
    && value.success === true
    && ["total_articles", "total_internal_links", "avg_links_per_article"]
      .every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))
    && Array.isArray(value.orphan_pages)
    && value.orphan_pages.every((slug) => typeof slug === "string")
    && Array.isArray(value.link_poor_pages)
    && value.link_poor_pages.every((page) => isRecord(page)
      && typeof page.slug === "string"
      && typeof page.outgoing_links === "number"
      && Number.isFinite(page.outgoing_links))
    && Array.isArray(value.suggestions)
    && value.suggestions.every((suggestion) => isRecord(suggestion)
      && typeof suggestion.from === "string"
      && typeof suggestion.to === "string"
      && typeof suggestion.reason === "string");
}

export default function InternalLinksPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [resultSiteId, setResultSiteId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchSites() {
      try {
        const response = await fetch("/api/sites", {
          signal: AbortSignal.timeout(30_000),
        });
        const payload = await readApiJson(response, isSiteList, "Le chargement des sites a échoué");
        if (!active) return;
        setSites(payload);
        setSitesError(payload.length === 0
          ? "Aucun site actif n’a été renvoyé. Vérifiez la configuration des sites."
          : null);
        if (payload.length > 0) setSelectedSite((current) => current ?? payload[0].id);
      } catch (fetchError) {
        if (active) setSitesError(requestError(fetchError, "Le chargement des sites"));
      }
    }

    void fetchSites();
    return () => { active = false; };
  }, []);

  async function runAudit() {
    if (!selectedSite || selectedSite === "all") {
      setError("Sélectionnez un site précis avant de lancer l’audit de maillage.");
      return;
    }
    const requestedSiteId = selectedSite;
    const hasConfirmedResult = result !== null && resultSiteId === requestedSiteId;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/internal-links/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: requestedSiteId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await readApiJson(response, isAuditResult, "L’audit de maillage a échoué");
      setResult(payload);
      setResultSiteId(requestedSiteId);
    } catch (auditError) {
      const message = requestError(auditError, "L’audit de maillage");
      setError(hasConfirmedResult ? `${message} Le dernier audit confirmé reste affiché.` : message);
    } finally {
      setLoading(false);
    }
  }

  const displayedResult = resultSiteId === selectedSite ? result : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Link2 className="w-5 h-5 text-teal-400" />
        <h1 className="text-xl font-semibold">Audit Maillage Interne</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            aria-label="Site à analyser"
            value={selectedSite ?? ""}
            onChange={(e) => {
              setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null);
              setError(null);
            }}
            disabled={loading}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            <option value="all">Tous les sites</option>
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button
            onClick={runAudit}
            disabled={loading || !selectedSite || selectedSite === "all"}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loading ? "Scan GitHub..." : "Lancer l'audit"}
          </button>
        </div>

        {sitesError && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300" role="alert">
            {sitesError}
          </div>
        )}

        {selectedSite === "all" && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 text-sm text-gray-400">
            L’audit de maillage s’exécute site par site. Sélectionnez un site précis pour continuer.
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300" role="alert">{error}</div>
        )}

        {displayedResult && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Articles scannés</div>
                <div className="text-3xl font-bold text-white mt-1">{displayedResult.total_articles}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Liens internes total</div>
                <div className="text-3xl font-bold text-teal-400 mt-1">{displayedResult.total_internal_links}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Moy. liens/article</div>
                <div className="text-3xl font-bold text-blue-400 mt-1">{displayedResult.avg_links_per_article.toFixed(1)}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <div className="text-sm text-gray-400">Pages orphelines</div>
                <div className={`text-3xl font-bold mt-1 ${displayedResult.orphan_pages.length > 0 ? "text-red-400" : "text-green-400"}`}>
                  {displayedResult.orphan_pages.length}
                </div>
              </div>
            </div>

            {/* Orphan pages */}
            {displayedResult.orphan_pages.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="font-medium text-gray-200 flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Pages orphelines (aucun lien entrant)
                </h2>
                <div className="flex flex-wrap gap-2">
                  {displayedResult.orphan_pages.map((slug) => (
                    <span key={slug} className="bg-red-900/20 border border-red-800 rounded px-3 py-1 text-xs text-red-300">
                      {slug}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Link-poor pages */}
            {displayedResult.link_poor_pages.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="font-medium text-gray-200 flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  Pages avec peu de liens sortants (&lt;2)
                </h2>
                <div className="flex flex-wrap gap-2">
                  {displayedResult.link_poor_pages.map((p) => (
                    <span key={p.slug} className="bg-yellow-900/20 border border-yellow-800 rounded px-3 py-1 text-xs text-yellow-300">
                      {p.slug} ({p.outgoing_links} liens)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions */}
            {displayedResult.suggestions.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h2 className="font-medium text-gray-200 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-teal-400" />
                    Suggestions de liens ({displayedResult.suggestions.length})
                  </h2>
                </div>
                <div className="divide-y divide-gray-800">
                  {displayedResult.suggestions.slice(0, 20).map((s, i) => (
                    <div key={i} className="px-5 py-3 flex items-center gap-3 text-sm">
                      <span className="text-blue-400 font-medium">{s.from}</span>
                      <span className="text-gray-600">→</span>
                      <span className="text-teal-400 font-medium">{s.to}</span>
                      <span className="text-xs text-gray-500 ml-auto">{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !displayedResult && !error && selectedSite !== "all" && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center">
            <Link2 className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <div className="text-gray-500 text-sm">Scanne les articles GitHub pour détecter les liens manquants</div>
          </div>
        )}
      </div>
    </div>
  );
}
