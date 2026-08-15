"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Code2, Loader2, X, XCircle } from "lucide-react";
import { isRecord, readApiJson } from "@/lib/api-response";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface SchemaResult {
  url: string;
  types: string[];
  errors: string[];
  warnings: string[];
  rawJson: string | null;
  status: "ok" | "warn" | "error" | "no-schema";
  google_verified?: boolean;
  google_types?: string[];
  google_errors?: string[];
  google_warnings?: string[];
  google_verdict?: string;
  google_discrepancies?: string[];
}

interface AuditResponse {
  success: true;
  results: SchemaResult[];
  score: number;
  total: number;
  withSchema: number;
  googleVerifiedCount: number;
  verifiedWithGoogle: boolean;
  partial: boolean;
  duration_ms: number;
}
type SitesState = "loading" | "ready" | "empty" | "error";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalStringList(value: unknown): value is string[] | undefined {
  return value === undefined || isStringList(value);
}

function isSiteList(payload: unknown): payload is Site[] {
  return Array.isArray(payload) && payload.every((site) => isRecord(site)
    && isFiniteNumber(site.id) && typeof site.name === "string" && typeof site.url === "string");
}

function isSchemaResult(value: unknown): value is SchemaResult {
  return isRecord(value)
    && typeof value.url === "string"
    && isStringList(value.types) && isStringList(value.errors) && isStringList(value.warnings)
    && (value.rawJson === null || typeof value.rawJson === "string")
    && (value.status === "ok" || value.status === "warn" || value.status === "error" || value.status === "no-schema")
    && (value.google_verified === undefined || typeof value.google_verified === "boolean")
    && isOptionalStringList(value.google_types) && isOptionalStringList(value.google_errors)
    && isOptionalStringList(value.google_warnings) && isOptionalStringList(value.google_discrepancies)
    && (value.google_verdict === undefined || typeof value.google_verdict === "string");
}

function isAuditResponse(payload: unknown): payload is AuditResponse {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.results)
    || !payload.results.every(isSchemaResult)
    || !isFiniteNumber(payload.score) || !isFiniteNumber(payload.total) || !isFiniteNumber(payload.withSchema)
    || !isFiniteNumber(payload.googleVerifiedCount) || !isFiniteNumber(payload.duration_ms)
    || typeof payload.verifiedWithGoogle !== "boolean" || typeof payload.partial !== "boolean") return false;
  const withSchema = payload.results.filter((result) => result.types.length > 0).length;
  const googleVerified = payload.results.filter((result) => result.google_verified === true).length;
  return payload.total === payload.results.length && payload.withSchema === withSchema
    && payload.googleVerifiedCount === googleVerified
    && payload.score === (payload.total > 0 ? Math.round((withSchema / payload.total) * 100) : 0)
    && payload.duration_ms >= 0;
}

const STATUS_ICON = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
};

const STATUS_LABEL: Record<Exclude<SchemaResult["status"], "no-schema">, string> = {
  ok: "Valide",
  warn: "Avertissement",
  error: "Erreur",
};

function SchemaStatusIcon({ status }: { status: SchemaResult["status"] }) {
  if (status === "no-schema") return "—";
  const Icon = STATUS_ICON[status];
  return (
    <>
      <Icon className="inline h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </>
  );
}

const STATUS_COLOR: Record<SchemaResult["status"], string> = {
  ok: "text-emerald-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  "no-schema": "text-gray-500",
};

export default function SchemaPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [modal, setModal] = useState<SchemaResult | null>(null);
  const [verifyWithGoogle, setVerifyWithGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sitesState, setSitesState] = useState<SitesState>("loading");

  const loadSites = useCallback(async () => {
    setSitesState("loading");
    setError(null);
    try {
      const response = await fetch("/api/sites");
      const data = await readApiJson(response, isSiteList, "Impossible de charger les sites");
      setSites(data);
      if (data.length === 0) {
        setSelectedSite(null);
        setSitesState("empty");
        return;
      }
      setSelectedSite(data[0].id);
      setSitesState("ready");
    } catch (caught) {
      setSites([]);
      setSelectedSite(null);
      setError(caught instanceof Error ? caught.message : "Impossible de charger les sites");
      setSitesState("error");
    }
  }, []);

  useEffect(() => { void loadSites(); }, [loadSites]);

  async function runAudit() {
    if (!selectedSite) return;
    const site = sites.find((s) => s.id === selectedSite);
    if (!site) return;
    setLoading(true);
    setAudit(null);
    setError(null);
    let timeout: number | undefined;
    try {
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), verifyWithGoogle ? 70000 : 45000);
      const res = await fetch("/api/schema-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: site.url, verifyWithGoogle, maxVerify: 6, maxUrls: 30 }),
        signal: controller.signal,
      });
      const d = await readApiJson(res, isAuditResponse, "Impossible de charger l’audit schema");
      setAudit(d);
    } catch (e) {
      setAudit(null);
      setError(e instanceof Error && e.name === "AbortError" ? "Audit trop long: limite atteinte" : e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  function formatRawJson(raw: string | null): string {
    if (!raw) return "—";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  const failedUrlCount = audit?.results.filter((result) => result.errors.includes("Fetch failed")).length ?? 0;
  const measuredResults = audit?.results.filter((result) => !result.errors.includes("Fetch failed")) ?? [];
  const measuredWithSchema = measuredResults.filter((result) => result.types.length > 0).length;
  const measuredScore = measuredResults.length > 0 ? Math.round((measuredWithSchema / measuredResults.length) * 100) : 0;
  const scoreColor =
    measuredScore >= 70
      ? "text-emerald-400"
      : measuredScore >= 40
      ? "text-yellow-400"
      : "text-red-400";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Code2 className="w-5 h-5 text-indigo-400" />
        <h1 className="text-xl font-semibold">Schema Audit</h1>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            aria-label="Site à analyser"
            value={selectedSite ?? ""}
            disabled={sitesState !== "ready"}
            onChange={(e) => setSelectedSite(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            <option value="">Sélectionner un site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={runAudit}
            disabled={!selectedSite || loading || sitesState !== "ready"}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code2 className="w-4 h-4" />}
            {loading ? "Analyse en cours..." : "Lancer l'audit"}
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={verifyWithGoogle}
              onChange={(e) => setVerifyWithGoogle(e.target.checked)}
              className="accent-indigo-500"
            />
            Vérifier avec Google Rich Results API (10 premières pages)
          </label>
        </div>

        {sitesState === "loading" && (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
        )}
        {sitesState === "empty" && (
          <div className="py-12 text-center text-sm text-gray-500">Aucun site actif disponible pour lancer l’audit schema.</div>
        )}

        {audit && (
          <>
            {measuredResults.length > 0 && <div className={`grid ${audit.verifiedWithGoogle ? "grid-cols-4" : "grid-cols-3"} gap-4`}>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className={`text-3xl font-bold ${scoreColor}`}>{measuredScore}%</div>
                <div className="text-xs text-gray-400 mt-1">Pages avec schema</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-3xl font-bold text-white">{measuredWithSchema}</div>
                <div className="text-xs text-gray-400 mt-1">Pages schématisées</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-3xl font-bold text-gray-400">{measuredResults.length - measuredWithSchema}</div>
                <div className="text-xs text-gray-400 mt-1">Pages sans schema</div>
              </div>
              {audit.verifiedWithGoogle && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="text-3xl font-bold text-emerald-400">{audit.googleVerifiedCount}</div>
                  <div className="text-xs text-gray-400 mt-1">Vérifié par Google</div>
                </div>
              )}
            </div>}
            {audit.partial && (
              <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-3 text-sm text-yellow-200">
                Audit partiel: seules les premières URLs du sitemap ont été scannées pour garder la page rapide.
              </div>
            )}
            {failedUrlCount > 0 && (
              <div role="status" className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-3 text-sm text-yellow-200">
                Résultat partiel : {failedUrlCount} URL{failedUrlCount > 1 ? "s" : ""} n’ont pas pu être analysées et ne doivent pas être interprétées comme sans schema.
              </div>
            )}

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-medium text-gray-200">Résultats par URL</h2>
              </div>
              {audit.results.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">Aucune URL disponible dans cet audit.</div>
              ) : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400 border-b border-gray-800">
                    <tr>
                      <th className="px-5 py-3 text-left">URL</th>
                      <th className="px-4 py-3 text-left">Types détectés</th>
                      <th className="px-4 py-3 text-left">Erreurs</th>
                      <th className="px-4 py-3 text-left">Warnings</th>
                      <th className="px-4 py-3 text-center">Statut</th>
                      {audit.verifiedWithGoogle && (
                        <th className="px-4 py-3 text-center" title="Google Rich Results API verdict">Google</th>
                      )}
                      <th className="px-4 py-3 text-center">JSON-LD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {audit.results.map((r) => (
                      <tr key={r.url} className="hover:bg-gray-800/50">
                        <td className="px-5 py-2.5 text-gray-300 font-mono text-xs truncate max-w-xs">{r.url}</td>
                        <td className="px-4 py-2.5 text-indigo-300 text-xs">{r.types.join(", ") || "—"}</td>
                        <td className="px-4 py-2.5 text-red-400 text-xs">{r.errors.join("; ") || "—"}</td>
                        <td className="px-4 py-2.5 text-yellow-400 text-xs">{r.warnings.join("; ") || "—"}</td>
                        <td className={`px-4 py-2.5 text-center text-sm ${STATUS_COLOR[r.status]}`}>
                          <SchemaStatusIcon status={r.status} />
                        </td>
                        {audit.verifiedWithGoogle && (
                          <td className="px-4 py-2.5 text-center" title={r.google_verdict ?? "Non vérifié"}>
                            {r.google_verdict === undefined ? (
                              <span className="text-gray-600 text-xs">—</span>
                            ) : r.google_verified ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" aria-label="Google verified" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-400 inline" aria-label="Google rejected" />
                            )}
                            {r.google_discrepancies && r.google_discrepancies.length > 0 && (
                              <div className="text-[10px] text-amber-400 mt-0.5 truncate max-w-[120px]" title={r.google_discrepancies.join("; ")}>
                                <AlertTriangle className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                                divergence
                              </div>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-2.5 text-center">
                          {r.rawJson ? (
                            <button
                              onClick={() => setModal(r)}
                              className="text-xs text-indigo-400 hover:text-indigo-300 underline"
                            >
                              Voir
                            </button>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
            </div>
          </>
        )}
        {error && (
          <div role="alert" className="bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            Erreur de chargement : {error}
          </div>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <span className="text-sm text-gray-300 font-mono truncate">{modal.url}</span>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="p-5 overflow-auto text-xs text-green-300 font-mono flex-1">
              {formatRawJson(modal.rawJson)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
