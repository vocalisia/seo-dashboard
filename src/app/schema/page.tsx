"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Code2, Loader2, X, CheckCircle2, XCircle } from "lucide-react";

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
  success?: boolean;
  results: SchemaResult[];
  score: number;
  total: number;
  withSchema: number;
  googleVerifiedCount?: number;
  verifiedWithGoogle?: boolean;
  partial?: boolean;
  duration_ms?: number;
  error?: string;
}

const STATUS_ICON: Record<SchemaResult["status"], string> = {
  ok: "✅",
  warn: "⚠️",
  error: "❌",
  "no-schema": "—",
};

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

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((d: unknown) => {
        if (Array.isArray(d)) { setSites(d as Site[]); if ((d as Site[]).length > 0) setSelectedSite((d as Site[])[0].id); }
      })
      .catch(() => undefined);
  }, []);

  async function runAudit() {
    if (!selectedSite) return;
    const site = sites.find((s) => s.id === selectedSite);
    if (!site) return;
    setLoading(true);
    setAudit(null);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), verifyWithGoogle ? 70000 : 45000);
      const res = await fetch("/api/schema-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: site.url, verifyWithGoogle, maxVerify: 6, maxUrls: 30 }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      const d = await res.json() as AuditResponse;
      if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
      setAudit(d);
    } catch (e) {
      setAudit(null);
      setError(e instanceof Error && e.name === "AbortError" ? "Audit trop long: limite atteinte" : e instanceof Error ? e.message : "Erreur inconnue");
    }
    setLoading(false);
  }

  function formatRawJson(raw: string | null): string {
    if (!raw) return "—";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  const scoreColor =
    audit && audit.score >= 70
      ? "text-emerald-400"
      : audit && audit.score >= 40
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
            value={selectedSite ?? ""}
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
            disabled={!selectedSite || loading}
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

        {audit && (
          <>
            {/* Score */}
            <div className={`grid ${audit.verifiedWithGoogle ? "grid-cols-4" : "grid-cols-3"} gap-4`}>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className={`text-3xl font-bold ${scoreColor}`}>{audit.score}%</div>
                <div className="text-xs text-gray-400 mt-1">Pages avec schema</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-3xl font-bold text-white">{audit.withSchema}</div>
                <div className="text-xs text-gray-400 mt-1">Pages schématisées</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-3xl font-bold text-gray-400">{audit.total - audit.withSchema}</div>
                <div className="text-xs text-gray-400 mt-1">Pages sans schema</div>
              </div>
              {audit.verifiedWithGoogle && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="text-3xl font-bold text-emerald-400">{audit.googleVerifiedCount ?? 0}</div>
                  <div className="text-xs text-gray-400 mt-1">Vérifié par Google</div>
                </div>
              )}
            </div>
            {audit.partial && (
              <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-3 text-sm text-yellow-200">
                Audit partiel: seules les premiÃ¨res URLs du sitemap ont Ã©tÃ© scannÃ©es pour garder la page rapide.
              </div>
            )}

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800">
                <h2 className="font-medium text-gray-200">Résultats par URL</h2>
              </div>
              <div className="overflow-x-auto">
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
                          {STATUS_ICON[r.status]}
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
                                ⚠ divergence
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
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
            {error}
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
