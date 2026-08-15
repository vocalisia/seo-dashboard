"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Filter, Loader2, Download, Copy, Check } from "lucide-react";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface BloatRow {
  url: string;
  reason: string;
  impressions90d: number;
  recommendation: "noindex" | "canonical" | "delete";
}

interface BloatResponse {
  success: true;
  total: number;
  bloat_count: number;
  rows: BloatRow[];
  partial?: boolean;
  duration_ms?: number;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSite(value: unknown): value is Site {
  return isRecord(value)
    && typeof value.id === "number"
    && Number.isFinite(value.id)
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.url === "string"
    && value.url.trim().length > 0;
}

function isBloatRow(value: unknown): value is BloatRow {
  if (!isRecord(value)) return false;
  const validRecommendation = value.recommendation === "noindex"
    || value.recommendation === "canonical"
    || value.recommendation === "delete";
  return typeof value.url === "string"
    && value.url.trim().length > 0
    && typeof value.reason === "string"
    && value.reason.trim().length > 0
    && isFiniteNonNegativeNumber(value.impressions90d)
    && validRecommendation;
}

function isBloatResponse(value: unknown): value is BloatResponse {
  if (!isRecord(value)) return false;
  return value.success === true
    && Number.isInteger(value.total)
    && isFiniteNonNegativeNumber(value.total)
    && Number.isInteger(value.bloat_count)
    && isFiniteNonNegativeNumber(value.bloat_count)
    && Array.isArray(value.rows)
    && value.rows.every(isBloatRow)
    && (value.partial === undefined || typeof value.partial === "boolean")
    && (value.duration_ms === undefined || isFiniteNonNegativeNumber(value.duration_ms));
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

const REC_COLOR: Record<BloatRow["recommendation"], string> = {
  noindex: "text-yellow-400 bg-yellow-900/20",
  canonical: "text-blue-400 bg-blue-900/20",
  delete: "text-red-400 bg-red-900/20",
};

export default function IndexBloatPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BloatResponse | null>(null);
  const [resultSiteId, setResultSiteId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/sites", { signal: controller.signal });
        const data = await readApiJson(
          response,
          (payload): payload is Site[] => Array.isArray(payload) && payload.every(isSite),
          "Liste des sites indisponible",
        );
        setSites(data);
        setSelectedSite(data[0]?.id ?? null);
        setSitesError(null);
      } catch (reason) {
        if (reason instanceof Error && reason.name === "AbortError") return;
        setSitesError(reason instanceof Error ? reason.message : "Liste des sites indisponible.");
      } finally {
        if (!controller.signal.aborted) setSitesLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function runAnalysis() {
    if (!selectedSite) {
      setError("Sélectionnez un site avant de lancer l'analyse.");
      return;
    }
    const site = sites.find((s) => s.id === selectedSite);
    if (!site) {
      setError("Le site sélectionné n'est plus disponible dans la liste chargée.");
      return;
    }
    const requestedSiteId = selectedSite;
    const hasConfirmedResult = result !== null && resultSiteId === requestedSiteId;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 65000);
    try {
      const res = await fetch("/api/index-bloat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: requestedSiteId, site_url: site.url }),
        signal: controller.signal,
      });
      const data = await readApiJson(res, isBloatResponse, "Analyse de l'index impossible");
      setResult(data);
      setResultSiteId(requestedSiteId);
      setCopied(false);
    } catch (e) {
      const message = e instanceof Error && e.name === "AbortError"
        ? "Analyse interrompue : la limite de 65 secondes a été atteinte."
        : e instanceof Error
          ? e.message
          : "Erreur inconnue pendant l'analyse.";
      setError(hasConfirmedResult ? `${message} Le dernier résultat confirmé reste affiché.` : message);
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function copyNoindex() {
    if (!displayedResult) return;
    const urls = displayedResult.rows
      .filter((r) => r.recommendation === "noindex")
      .map((r) => r.url)
      .join("\n");
    if (!urls) return;
    setError(null);
    try {
      if (!navigator.clipboard) throw new Error("API presse-papiers indisponible");
      await navigator.clipboard.writeText(urls);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setError("Copie impossible. Autorisez l'accès au presse-papiers ou utilisez l'export CSV.");
    }
  }

  function exportCsv() {
    if (!displayedResult) return;
    const header = "URL,Raison,Impressions 90j,Recommandation\n";
    const body = displayedResult.rows
      .map((r) => [r.url, r.reason, r.impressions90d, r.recommendation].map(csvCell).join(","))
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "index-bloat.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const displayedResult = resultSiteId === selectedSite ? result : null;
  const noindexCount = displayedResult?.rows.filter((r) => r.recommendation === "noindex").length ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex min-h-11 items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
        </Link>
        <Filter className="w-5 h-5 text-orange-400" />
        <h1 className="text-xl font-semibold">Index Bloat</h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4 flex-wrap">
          <select
            aria-label="Site à analyser"
            value={selectedSite ?? ""}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            disabled={sitesLoading || loading}
            className="min-h-11 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64 disabled:opacity-50"
          >
            <option value="">{sitesLoading ? "Chargement des sites..." : "Sélectionner un site"}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={!selectedSite || loading || sitesLoading}
            className="min-h-11 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Filter className="w-4 h-4" aria-hidden="true" />}
            {loading ? "Analyse..." : "Analyser"}
          </button>
        </div>

        {sitesLoading && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Chargement des sites...
          </div>
        )}

        {sitesError && (
          <div role="alert" className="rounded-xl border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            {sitesError}
          </div>
        )}
        {!sitesLoading && !sitesError && sites.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-400">
            Aucun site actif n&apos;est disponible pour lancer cette analyse.
          </div>
        )}
        {loading && (
          <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 rounded-xl border border-gray-800 bg-gray-900 py-4 text-sm text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin text-orange-400" aria-hidden="true" />
            {displayedResult
              ? "Actualisation en cours; le dernier résultat confirmé reste affiché."
              : "Analyse de l'index en cours..."}
          </div>
        )}

        {displayedResult && (
          <>
            {/* Counts */}
            {displayedResult.total > 0 && <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-white">{displayedResult.total}</div>
                <div className="text-xs text-gray-400 mt-1">URLs du sitemap analysées</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-orange-400">{displayedResult.bloat_count}</div>
                <div className="text-xs text-gray-400 mt-1">Pages problématiques</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-2xl font-bold text-yellow-400">{noindexCount}</div>
                <div className="text-xs text-gray-400 mt-1">Candidats noindex</div>
              </div>
            </div>}

            {/* Info box */}
            {displayedResult.rows.length > 0 && (
              <div className="bg-blue-900/20 border border-blue-800/40 rounded-xl p-4 text-sm text-blue-300">
                <strong>Avant toute dé-indexation :</strong> vérifier la valeur, la canonique et le maillage de chaque URL. Pour une décision noindex confirmée, ajouter dans le{" "}
                <code className="bg-blue-900/40 px-1 rounded">&lt;head&gt;</code> :{" "}
                <code className="bg-blue-900/40 px-1 rounded text-xs">
                  &lt;meta name=&quot;robots&quot; content=&quot;noindex, follow&quot; /&gt;
                </code>
              </div>
            )}
            {(displayedResult.partial || displayedResult.total === 0) && (
              <div role="status" className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-3 text-sm text-yellow-200">
                {displayedResult.total === 0
                  ? "Analyse non concluante : le sitemap n'a fourni aucune URL analysable. Cela ne prouve pas l'absence de bloat; les éventuelles lignes ci-dessous restent partielles et doivent être vérifiées."
                  : "Analyse partielle: sitemap ou résultats bornés pour garder la page rapide."}
              </div>
            )}

            {/* Actions */}
            {displayedResult.rows.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => void copyNoindex()}
                  disabled={noindexCount === 0}
                  className="min-h-11 flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-4 py-2 rounded-lg"
                >
                  {copied ? <Check className="w-4 h-4 text-green-400" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                  {copied ? "Copié !" : `Copier ${noindexCount} candidats noindex`}
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="min-h-11 flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg"
                >
                  <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
                </button>
              </div>
            )}

            {/* Table */}
            {displayedResult.rows.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800">
                  <h2 className="font-medium text-gray-200">Pages à vérifier</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-400 border-b border-gray-800">
                      <tr>
                        <th className="px-5 py-3 text-left">URL</th>
                        <th className="px-4 py-3 text-left">Raison</th>
                        <th className="px-4 py-3 text-right">Impressions 90j</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {displayedResult.rows.map((r) => (
                        <tr key={r.url} className="hover:bg-gray-800/50">
                          <td className="px-5 py-2.5 font-mono text-xs text-gray-300 truncate max-w-xs">{r.url}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-400">{r.reason}</td>
                          <td className="px-4 py-2.5 text-right text-gray-400">{r.impressions90d}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${REC_COLOR[r.recommendation]}`}>
                              {r.recommendation}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {displayedResult.rows.length === 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-sm text-gray-400">
                {displayedResult.total > 0
                  ? `Analyse terminée : aucune anomalie détectée parmi ${displayedResult.total.toLocaleString()} URL${displayedResult.total > 1 ? "s" : ""} de sitemap avec les règles actuelles.`
                  : "Aucune URL de sitemap n'a pu être analysée. Ce résultat ne permet pas de conclure à l'absence de bloat."}
              </div>
            )}
          </>
        )}
        {error && (
          <div role="alert" className="bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
