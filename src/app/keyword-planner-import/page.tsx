"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Loader2, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";
import { isRecord, readApiJson } from "@/lib/api-response";

interface SiteRow {
  id: number;
  name: string;
}

interface PreviewRow {
  keyword: string;
  market: string;
  volume_market: number | null;
  volume_fr: number | null;
  volume_ch: number | null;
  competition: string | null;
  cpc_low: number | null;
  cpc_high: number | null;
  action: "insert" | "update";
}

interface ImportSummary {
  success: boolean;
  site_id: number;
  total_rows: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  preview: PreviewRow[];
}

interface ImportContext {
  siteId: string;
  market: string;
  fileName: string;
  fileSize: number;
  fileModified: number;
}

const REQUEST_TIMEOUT_MS = 60_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isSiteRow(value: unknown): value is SiteRow {
  return isRecord(value)
    && Number.isInteger(value.id)
    && typeof value.name === "string"
    && value.name.trim().length > 0;
}

function isSiteList(value: unknown): value is SiteRow[] {
  return Array.isArray(value) && value.every(isSiteRow);
}

function isPreviewRow(value: unknown): value is PreviewRow {
  return isRecord(value)
    && typeof value.keyword === "string"
    && value.keyword.trim().length > 0
    && typeof value.market === "string"
    && isNullableFiniteNumber(value.volume_market)
    && isNullableFiniteNumber(value.volume_fr)
    && isNullableFiniteNumber(value.volume_ch)
    && (value.competition === null || typeof value.competition === "string")
    && isNullableFiniteNumber(value.cpc_low)
    && isNullableFiniteNumber(value.cpc_high)
    && (value.action === "insert" || value.action === "update");
}

function isImportSummary(value: unknown): value is ImportSummary {
  return isRecord(value)
    && value.success === true
    && Number.isInteger(value.site_id)
    && [value.total_rows, value.imported, value.updated, value.skipped]
      .every((count) => Number.isInteger(count) && Number(count) >= 0)
    && Array.isArray(value.errors)
    && value.errors.every((message) => typeof message === "string")
    && Array.isArray(value.preview)
    && value.preview.every(isPreviewRow);
}

function visibleRequestError(error: unknown, action: string): string {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return `${action} a dépassé le délai autorisé. Réessaie.`;
  }
  return error instanceof Error
    ? `${action} : ${error.message}`
    : `${action} a échoué. Réessaie.`;
}

function sameImportContext(left: ImportContext | null, right: ImportContext): boolean {
  return left !== null
    && left.siteId === right.siteId
    && left.market === right.market
    && left.fileName === right.fileName
    && left.fileSize === right.fileSize
    && left.fileModified === right.fileModified;
}

export default function KeywordPlannerImportPage(): React.ReactElement {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [market, setMarket] = useState<string>("FR");
  const [file, setFile] = useState<File | null>(null);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [resultContext, setResultContext] = useState<ImportContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSites(): Promise<void> {
      setSitesLoading(true);
      setSitesError(null);
      try {
        const response = await fetch("/api/sites", {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const payload = await readApiJson(
          response,
          isSiteList,
          "Le chargement des sites a échoué",
        );
        if (!active) return;
        setSites(payload);
        setSiteId((current) => payload.some((site) => String(site.id) === current) ? current : "");
      } catch (caught) {
        if (!active) return;
        setSites([]);
        setSiteId("");
        setSitesError(visibleRequestError(caught, "Le chargement des sites"));
      } finally {
        if (active) setSitesLoading(false);
      }
    }

    void loadSites();
    return () => { active = false; };
  }, []);

  async function submit(): Promise<void> {
    if (!siteId || !file) {
      setError("Sélectionne un site et un fichier CSV.");
      return;
    }
    const requestContext: ImportContext = {
      siteId,
      market,
      fileName: file.name,
      fileSize: file.size,
      fileModified: file.lastModified,
    };
    const hasConfirmedResult = result !== null && sameImportContext(resultContext, requestContext);
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("site_id", siteId);
      form.append("market", market);
      form.append("file", file);
      const response = await fetch("/api/keyword-planner/import", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await readApiJson(
        response,
        isImportSummary,
        "L’import Keyword Planner a échoué",
      );
      if (payload.site_id !== Number(siteId)) {
        throw new Error("la réponse ne correspond pas au site sélectionné");
      }
      setResult(payload);
      setResultContext(requestContext);
    } catch (caught) {
      const message = visibleRequestError(caught, "L’import Keyword Planner");
      setError(hasConfirmedResult ? `${message} Le dernier import confirmé reste affiché.` : message);
    } finally {
      setUploading(false);
    }
  }

  const currentContext = file ? {
    siteId,
    market,
    fileName: file.name,
    fileSize: file.size,
    fileModified: file.lastModified,
  } : null;
  const displayedResult = currentContext && sameImportContext(resultContext, currentContext) ? result : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/dashboard"
          className="text-sm text-gray-400 hover:text-white flex min-h-11 items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Dashboard
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-2">
          <Upload className="w-6 h-6" /> Google Keyword Planner — Import CSV
        </h1>
        <p className="text-sm text-gray-400 mb-6">
          Exporte un plan depuis{" "}
          <a
            href="https://ads.google.com/aw/keywordplanner"
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline"
          >
            Google Keyword Planner
          </a>{" "}
          (CSV), puis téléverse-le ici. Colonnes attendues : Keyword, Avg. monthly searches,
          Competition, Top of page bid (low / high range).
        </p>

        <div className="bg-gray-900 rounded-lg p-5 space-y-4">
          <div>
            <label htmlFor="keyword-planner-site" className="block text-sm text-gray-300 mb-1">Site</label>
            <select
              id="keyword-planner-site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              disabled={sitesLoading || uploading || sites.length === 0}
              aria-busy={sitesLoading}
              className="min-h-11 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full disabled:opacity-50"
            >
              <option value="">
                {sitesLoading ? "Chargement des sites…" : "— Choisis un site —"}
              </option>
              {sites.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
            {sitesError && (
              <p className="text-xs text-red-300 mt-2" role="alert">{sitesError}</p>
            )}
            {!sitesLoading && !sitesError && sites.length === 0 && (
              <p className="text-xs text-amber-300 mt-2" role="status">
                Aucun site actif n’est disponible pour cet import.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="keyword-planner-market" className="block text-sm text-gray-300 mb-1">Marché du CSV</label>
            <select
              id="keyword-planner-market"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              disabled={uploading}
              className="min-h-11 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full disabled:opacity-50"
            >
              <option value="FR">FR France</option>
              <option value="CH">CH Suisse</option>
              <option value="BE">BE Belgique</option>
              <option value="CA">CA Canada</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Pour un domaine .ch, importe un CSV Suisse en CH puis un CSV France en FR si tu veux les deux volumes.
            </p>
          </div>

          <div>
            <label htmlFor="keyword-planner-file" className="block text-sm text-gray-300 mb-1">Fichier CSV</label>
            <input
              id="keyword-planner-file"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
              className="block min-h-11 w-full text-sm text-gray-300 file:mr-4 file:min-h-11 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-700 file:text-white hover:file:bg-blue-600 disabled:opacity-50"
            />
            {file && (
              <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <FileText className="w-3 h-3" aria-hidden="true" /> {file.name} ({Math.round(file.size / 1024)} KB)
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={uploading || sitesLoading || !siteId || !file}
            aria-busy={uploading}
            className="min-h-11 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium flex items-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Import en cours…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" aria-hidden="true" /> Importer
              </>
            )}
          </button>
        </div>

        {uploading && displayedResult && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-400" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Nouvel import en cours; le dernier résultat confirmé reste affiché.
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300 flex items-start gap-2" role="alert">
            <AlertCircle className="w-4 h-4 mt-0.5" aria-hidden="true" /> {error}
          </div>
        )}

        {displayedResult && (
          <div className="mt-6 bg-gray-900 rounded-lg p-5" aria-live="polite">
            <div className="flex items-center gap-2 mb-4">
              {displayedResult.errors.length > 0 || displayedResult.skipped > 0 || displayedResult.imported + displayedResult.updated === 0 ? (
                <AlertCircle className="w-5 h-5 text-amber-400" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-green-400" aria-hidden="true" />
              )}
              <h2 className="font-semibold">
                {displayedResult.imported + displayedResult.updated === 0
                  ? "Import terminé sans ligne exploitable"
                  : displayedResult.errors.length > 0 || displayedResult.skipped > 0
                    ? "Import terminé avec avertissements"
                    : "Import réussi"}
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-400">Total lignes</div>
                <div className="text-xl font-bold">{displayedResult.total_rows}</div>
              </div>
              <div className="bg-green-900/30 rounded p-3">
                <div className="text-xs text-green-300">Nouveaux</div>
                <div className="text-xl font-bold text-green-300">{displayedResult.imported}</div>
              </div>
              <div className="bg-blue-900/30 rounded p-3">
                <div className="text-xs text-blue-300">Mises à jour</div>
                <div className="text-xl font-bold text-blue-300">{displayedResult.updated}</div>
              </div>
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-400">Ignorées</div>
                <div className="text-xl font-bold text-gray-400">{displayedResult.skipped}</div>
              </div>
            </div>

            {displayedResult.errors.length > 0 && (
              <div className="bg-red-900/20 border border-red-800 rounded p-3 mb-4 text-xs text-red-300">
                <ul className="list-disc pl-4 space-y-1">
                  {displayedResult.errors.map((message, index) => (
                    <li key={`${index}-${message}`}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {displayedResult.total_rows === 0 && (
              <div className="bg-amber-900/20 border border-amber-800 rounded p-3 mb-4 text-xs text-amber-200" role="status">
                Le CSV ne contient aucune ligne de données à importer.
              </div>
            )}

            {displayedResult.preview.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-gray-300 mb-2">
                  Aperçu (20 premières lignes)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-800 text-gray-400">
                      <tr>
                        <th className="px-2 py-2 text-left">
                          <span className="inline-flex items-center gap-2">
                            Keyword
                            <CopyKeywordsButton keywords={displayedResult.preview.map((r) => r.keyword)} className="h-11 w-11" />
                          </span>
                        </th>
                        <th className="px-2 py-2 text-center">Marché</th>
                        <th className="px-2 py-2 text-right">Vol FR</th>
                        <th className="px-2 py-2 text-right">Vol CH</th>
                        <th className="px-2 py-2 text-right">Vol. marché</th>
                        <th className="px-2 py-2 text-center">Concurrence</th>
                        <th className="px-2 py-2 text-right">CPC low</th>
                        <th className="px-2 py-2 text-right">CPC high</th>
                        <th className="px-2 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {displayedResult.preview.map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5 text-gray-100">{r.keyword}</td>
                          <td className="px-2 py-1.5 text-center text-gray-300">{r.market}</td>
                          <td className="px-2 py-1.5 text-right text-blue-300">
                            {r.volume_fr?.toLocaleString() ?? "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-red-300">
                            {r.volume_ch?.toLocaleString() ?? "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-yellow-300">
                            {r.volume_market?.toLocaleString() ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-center text-gray-300">
                            {r.competition ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-400">
                            {r.cpc_low ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-400">
                            {r.cpc_high ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span
                              className={`text-[10px] uppercase ${
                                r.action === "insert" ? "text-green-400" : "text-blue-400"
                              }`}
                            >
                              {r.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {displayedResult.preview.length === 0 && displayedResult.total_rows > 0 && (
              <div className="rounded border border-gray-800 bg-gray-950/40 p-3 text-sm text-gray-400" role="status">
                Aucun aperçu n’est disponible : aucune ligne n’a été importée ou mise à jour.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
