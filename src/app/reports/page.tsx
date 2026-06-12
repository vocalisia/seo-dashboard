"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

interface Opportunity {
  query: string;
  clicks?: number;
  impressions: number;
  position: number;
  ctr?: number;
  source_volume?: number;
  volume_source?: string | null;
  volume_status?: "imported" | "missing";
  priority_score?: number;
  reason?: string;
  data_source?: string;
}

interface Report {
  id: number;
  site_id: number;
  site_name: string;
  site_url: string;
  week_start: string;
  summary: string;
  recommendations: string;
  top_opportunities: Opportunity[];
  created_at: string;
}

interface Site {
  id: number;
  name: string;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtWeek(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtNumber(value: number | undefined | null) {
  return Number(value ?? 0).toLocaleString("fr-FR");
}

function fmtPosition(value: number | undefined | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(1) : "-";
}

function fmtCtr(value: number | undefined | null) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)} %` : "-";
}

function volumeLabel(op: Opportunity) {
  const volume = Number(op.source_volume ?? 0);
  return volume > 0 ? `volume importe ${fmtNumber(volume)}` : "volume non importe";
}

function reportStats(report: Report) {
  const ops = report.top_opportunities ?? [];
  return {
    opportunities: ops.length,
    importedVolumes: ops.filter((op) => Number(op.source_volume ?? 0) > 0).length,
    clicks: ops.reduce((sum, op) => sum + Number(op.clicks ?? 0), 0),
    impressions: ops.reduce((sum, op) => sum + Number(op.impressions ?? 0), 0),
  };
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-2 text-sm text-gray-300">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) return <h3 key={i} className="text-white font-bold text-base mt-4 mb-1">{line.slice(3)}</h3>;
        if (line.startsWith("# ")) return <h2 key={i} className="text-white font-bold text-lg mt-4 mb-1">{line.slice(2)}</h2>;
        if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="text-white font-semibold">{line.slice(2, -2)}</p>;
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-blue-400 mt-0.5">•</span>
              <span>{line.slice(2).replace(/\*\*(.*?)\*\*/g, "$1")}</span>
            </div>
          );
        }
        if (line.match(/^\d+\./)) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-blue-400 font-bold min-w-[20px]">{line.match(/^\d+/)?.[0]}.</span>
              <span>{line.replace(/^\d+\.\s*/, "").replace(/\*\*(.*?)\*\*/g, "$1")}</span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i}>{line.replace(/\*\*(.*?)\*\*/g, "$1")}</p>;
      })}
    </div>
  );
}

function buildFullText(reports: Report[]): string {
  return reports.map((report) => {
    const ops = report.top_opportunities?.map((op) => {
      const ctr = typeof op.ctr === "number" ? `, CTR ${fmtCtr(op.ctr)}` : "";
      return `  - ${op.query} (pos ${fmtPosition(op.position)}, ${fmtNumber(op.clicks)} clics, ${fmtNumber(op.impressions)} imp.${ctr}, ${volumeLabel(op)})`;
    }).join("\n") || "  Aucune";

    return [
      `=== ${report.site_name} (${report.site_url}) ===`,
      `Analyse le : ${fmtDate(report.created_at)}`,
      `Semaine du : ${fmtWeek(report.week_start)}`,
      "",
      report.summary,
      "",
      "Priorites mots cles :",
      ops,
      "",
      "Analyse IA :",
      report.recommendations,
    ].join("\n");
  }).join(`\n\n${"-".repeat(60)}\n\n`);
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{ done: number; total: number; failed: number } | null>(null);

  function showNotification(type: "success" | "error", text: string) {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 4000);
  }

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reports");
      const data = await res.json();
      if (Array.isArray(data)) setReports(data);
    } catch {
      showNotification("error", "Impossible de charger les rapports");
    }
    setLoading(false);
  };

  useEffect(() => {
    setTimeout(() => {
      void fetchReports();
    }, 0);
  }, []);

  const allExpanded = reports.length > 0 && expandedIds.size === reports.length;

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allExpanded) setExpandedIds(new Set());
    else setExpandedIds(new Set(reports.map((report) => report.id)));
  }

  async function copyAll() {
    const text = buildFullText(reports);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function fetchSitesForGeneration(): Promise<Site[]> {
    const res = await fetch("/api/sites");
    const data = await res.json() as Site[] | { sites?: Site[] };
    const list = Array.isArray(data) ? data : data.sites ?? [];
    return list.filter((site) => Number.isFinite(site.id));
  }

  async function generateNowBySite() {
    setGenerating(true);
    setGenerationProgress(null);
    setGenerationStatus("Initialisation des tables...");
    try {
      await fetch("/api/init", { method: "POST" });
      const sites = await fetchSitesForGeneration();
      if (sites.length === 0) throw new Error("Aucun site actif");

      let failed = 0;
      setGenerationProgress({ done: 0, total: sites.length, failed: 0 });

      for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        setGenerationStatus(`Generation rapport ${i + 1}/${sites.length}: ${site.name}`);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 45000);
        try {
          const res = await fetch("/api/reports/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ site_id: site.id }),
            signal: controller.signal,
          });
          if (!res.ok) failed++;
        } catch {
          failed++;
        } finally {
          window.clearTimeout(timeout);
          setGenerationProgress({ done: i + 1, total: sites.length, failed });
        }
      }

      if (failed === 0) {
        setLastGenerated(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
        showNotification("success", "Rapports generes avec succes");
      } else {
        showNotification("error", `${failed} rapport(s) non genere(s). Les autres ont continue.`);
      }
      await fetchReports();
    } catch (e) {
      showNotification("error", `Erreur generation : ${e instanceof Error ? e.message : "reseau"}`);
    }
    setGenerationStatus(null);
    setGenerationProgress(null);
    setGenerating(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg max-w-md text-sm ${
          notification.type === "success"
            ? "bg-green-900/80 border border-green-700 text-green-100"
            : "bg-red-900/80 border border-red-700 text-red-100"
        }`}>
          {notification.text}
        </div>
      )}

      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white transition" aria-label="Retour dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <FileText className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold">Rapports SEO hebdomadaires</h1>
          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">Vendredi 8h auto</span>
        </div>
        <div className="flex items-center gap-3">
          {lastGenerated && (
            <span className="text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded-full">Regenere a {lastGenerated}</span>
          )}
          <button
            type="button"
            onClick={generateNowBySite}
            disabled={generating}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {generating ? "Generation en cours..." : "Generer maintenant"}
          </button>
        </div>
      </header>

      <div className="px-6 py-6">
        {generationStatus && (
          <div className="mb-4 rounded-lg border border-blue-800 bg-blue-950/30 px-4 py-3 text-sm text-blue-200 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {generationStatus}
            {generationProgress && (
              <span className="ml-auto text-xs text-blue-300">
                {generationProgress.done}/{generationProgress.total}
                {generationProgress.failed > 0 ? ` · ${generationProgress.failed} echec(s)` : ""}
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
        ) : reports.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 mb-2">Aucun rapport genere</p>
            <p className="text-gray-600 text-sm mb-6">
              Les rapports sont generes automatiquement chaque vendredi a 8h.<br />
              Clique sur &quot;Generer maintenant&quot; pour creer le premier rapport.
            </p>
            <button
              type="button"
              onClick={generateNowBySite}
              disabled={generating}
              className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-xl text-sm font-medium flex items-center gap-2 mx-auto disabled:opacity-50 cursor-pointer"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              {generating ? "Generation..." : "Generer le premier rapport"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">
                {reports.length} sites - derniere analyse le {fmtDate(reports[0]?.created_at)}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyAll}
                  className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  {copied ? "Copie !" : "Copier tout"}
                </button>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer"
                >
                  {allExpanded ? <ChevronsDownUp className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3" />}
                  {allExpanded ? "Tout fermer" : "Tout ouvrir"}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-blue-900/60 bg-blue-950/20 px-4 py-3 text-sm text-blue-100 flex items-start gap-3">
              <Database className="w-4 h-4 mt-0.5 text-blue-300" />
              <div>
                <p className="font-medium text-blue-50">Reporting source reelle</p>
                <p className="text-blue-200/80">
                  Positions, clics et impressions viennent de Google Search Console query-level. Le volume affiche est seulement le volume importe; sinon il reste marque comme non importe.
                </p>
              </div>
            </div>

            {reports.map((report) => {
              const stats = reportStats(report);
              return (
                <div key={report.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                  <div
                    onClick={() => toggleExpand(report.id)}
                    className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/50 transition"
                  >
                    <div className="flex items-center gap-3">
                      {expandedIds.has(report.id)
                        ? <ChevronDown className="w-4 h-4 text-gray-400" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      <div>
                        <span className="font-semibold">{report.site_name}</span>
                        <span className="text-xs text-gray-400 ml-2">{report.site_url}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {report.top_opportunities && report.top_opportunities.length > 0 && (
                        <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {report.top_opportunities.length} priorites
                        </span>
                      )}
                      <span className="text-xs text-gray-600">Analyse le {fmtDate(report.created_at)}</span>
                    </div>
                  </div>

                  {expandedIds.has(report.id) && (
                    <div className="border-t border-gray-800 px-6 py-5 space-y-5">
                      <div className="bg-gray-800/50 rounded-lg px-4 py-3 text-sm text-gray-400">
                        {report.summary}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2">
                          <div className="text-gray-500">Priorites</div>
                          <div className="text-white font-semibold">{stats.opportunities}</div>
                        </div>
                        <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2">
                          <div className="text-gray-500">Volumes importes</div>
                          <div className="text-white font-semibold">{stats.importedVolumes}/{stats.opportunities}</div>
                        </div>
                        <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2">
                          <div className="text-gray-500">Clics priorites</div>
                          <div className="text-white font-semibold">{fmtNumber(stats.clicks)}</div>
                        </div>
                        <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2">
                          <div className="text-gray-500">Impressions priorites</div>
                          <div className="text-white font-semibold">{fmtNumber(stats.impressions)}</div>
                        </div>
                      </div>

                      {report.top_opportunities && report.top_opportunities.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2">Priorites mots cles GSC</h3>
                          <div className="flex flex-wrap gap-2">
                            {report.top_opportunities.map((op, i) => (
                              <div key={`${op.query}-${i}`} className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs max-w-full">
                                <div className="text-white font-medium break-words">{op.query}</div>
                                <div className="text-gray-400 mt-1">
                                  pos {fmtPosition(op.position)} · {fmtNumber(op.clicks)} clics · {fmtNumber(op.impressions)} imp. · CTR {fmtCtr(op.ctr)}
                                </div>
                                <div className={Number(op.source_volume ?? 0) > 0 ? "text-green-300 mt-1" : "text-orange-300 mt-1"}>
                                  {volumeLabel(op)}
                                </div>
                                {op.reason && <div className="text-gray-500 mt-1">{op.reason}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">Analyse & recommandations IA</h3>
                        <MarkdownText text={report.recommendations} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
