"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, Loader2, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { CopyKeywordsButton } from "@/components/CopyKeywordsButton";

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

export default function KeywordPlannerImportPage(): React.ReactElement {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [market, setMarket] = useState<string>("FR");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/sites")
      .then((r) => r.json() as Promise<SiteRow[]>)
      .then((d) => Array.isArray(d) && setSites(d))
      .catch(() => {
        /* ignore */
      });
  }, []);

  async function submit(): Promise<void> {
    if (!siteId || !file) {
      setError("Sélectionne un site et un fichier CSV");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("site_id", siteId);
      form.append("market", market);
      form.append("file", file);
      const res = await fetch("/api/keyword-planner/import", { method: "POST", body: form });
      const json = (await res.json()) as ImportSummary | { error: string };
      if (!res.ok) {
        setError("error" in json ? json.error : `HTTP ${res.status}`);
      } else if ("error" in json) {
        setError(json.error);
      } else {
        setResult(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/dashboard"
          className="text-sm text-gray-400 hover:text-white flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
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
          (CSV), puis upload ici. Colonnes attendues: Keyword, Avg. monthly searches,
          Competition, Top of page bid (low / high range).
        </p>

        <div className="bg-gray-900 rounded-lg p-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Site</label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full"
            >
              <option value="">— Choisis un site —</option>
              {sites.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Marché du CSV</label>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm w-full"
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
            <label className="block text-sm text-gray-300 mb-1">Fichier CSV</label>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-700 file:text-white hover:file:bg-blue-600"
            />
            {file && (
              <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                <FileText className="w-3 h-3" /> {file.name} ({Math.round(file.size / 1024)} KB)
              </div>
            )}
          </div>

          <button
            onClick={() => void submit()}
            disabled={uploading || !siteId || !file}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium flex items-center gap-2"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Import en cours…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" /> Importer
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
          </div>
        )}

        {result && (
          <div className="mt-6 bg-gray-900 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <h2 className="font-semibold">Résultat</h2>
            </div>
            <div className="grid grid-cols-4 gap-3 text-sm mb-4">
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-400">Total lignes</div>
                <div className="text-xl font-bold">{result.total_rows}</div>
              </div>
              <div className="bg-green-900/30 rounded p-3">
                <div className="text-xs text-green-300">Nouveaux</div>
                <div className="text-xl font-bold text-green-300">{result.imported}</div>
              </div>
              <div className="bg-blue-900/30 rounded p-3">
                <div className="text-xs text-blue-300">MAJ</div>
                <div className="text-xl font-bold text-blue-300">{result.updated}</div>
              </div>
              <div className="bg-gray-800 rounded p-3">
                <div className="text-xs text-gray-400">Skippés</div>
                <div className="text-xl font-bold text-gray-400">{result.skipped}</div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="bg-red-900/20 border border-red-800 rounded p-3 mb-4 text-xs text-red-300">
                {result.errors.map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            )}

            {result.preview.length > 0 && (
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
                            <CopyKeywordsButton keywords={result.preview.map((r) => r.keyword)} className="h-6 w-6" />
                          </span>
                        </th>
                        <th className="px-2 py-2 text-center">Marché</th>
                        <th className="px-2 py-2 text-right">Vol FR</th>
                        <th className="px-2 py-2 text-right">Vol CH</th>
                        <th className="px-2 py-2 text-right">Vol marché</th>
                        <th className="px-2 py-2 text-center">Competition</th>
                        <th className="px-2 py-2 text-right">CPC low</th>
                        <th className="px-2 py-2 text-right">CPC high</th>
                        <th className="px-2 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {result.preview.map((r, i) => (
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
          </div>
        )}
      </div>
    </div>
  );
}
