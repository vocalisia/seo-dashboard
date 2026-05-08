"use client";

import { useEffect, useState } from "react";
import { BarChart3, FileText, RefreshCw, Loader2, ChevronDown, ChevronRight, ArrowLeft, TrendingUp, ChevronsDownUp, ChevronsUpDown, Copy } from "lucide-react";
import Link from "next/link";

interface Report {
  id: number;
  site_id: number;
  site_name: string;
  site_url: string;
  week_start: string;
  summary: string;
  recommendations: string;
  top_opportunities: { query: string; impressions: number; position: number }[];
  created_at: string;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function fmtWeek(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return iso; }
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-2 text-sm text-gray-300">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) return <h3 key={i} className="text-white font-bold text-base mt-4 mb-1">{line.slice(3)}</h3>;
        if (line.startsWith('# ')) return <h2 key={i} className="text-white font-bold text-lg mt-4 mb-1">{line.slice(2)}</h2>;
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="text-white font-semibold">{line.slice(2, -2)}</p>;
        if (line.startsWith('- ') || line.startsWith('* ')) return (
          <div key={i} className="flex gap-2">
            <span className="text-blue-400 mt-0.5">•</span>
            <span>{line.slice(2).replace(/\*\*(.*?)\*\*/g, '$1')}</span>
          </div>
        );
        if (line.match(/^\d+\./)) return (
          <div key={i} className="flex gap-2">
            <span className="text-blue-400 font-bold min-w-[20px]">{line.match(/^\d+/)?.[0]}.</span>
            <span>{line.replace(/^\d+\.\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1')}</span>
          </div>
        );
        if (line.trim() === '') return <div key={i} className="h-1" />;
        return <p key={i}>{line.replace(/\*\*(.*?)\*\*/g, '$1')}</p>;
      })}
    </div>
  );
}

function buildFullText(reports: Report[]): string {
  return reports.map(r => {
    const ops = r.top_opportunities?.map(o => `  - ${o.query} (pos ${o.position}, ${o.impressions} imp.)`).join('\n') || "  Aucune";
    return `=== ${r.site_name} (${r.site_url}) ===\nAnalysé le : ${fmtDate(r.created_at)}\nSemaine du : ${fmtWeek(r.week_start)}\n\n${r.summary}\n\nOpportunités :\n${ops}\n\nAnalyse IA :\n${r.recommendations}`;
  }).join('\n\n' + '─'.repeat(60) + '\n\n');
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reports");
      const data = await res.json();
      if (Array.isArray(data)) setReports(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { setTimeout(() => { void fetchReports(); }, 0); }, []);

  const allExpanded = reports.length > 0 && expandedIds.size === reports.length;

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allExpanded) {
      setExpandedIds(new Set());
    } else {
      setExpandedIds(new Set(reports.map(r => r.id)));
    }
  }

  async function copyAll() {
    const text = buildFullText(reports);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function generateNow() {
    setGenerating(true);
    try {
      await fetch("/api/init", { method: "POST" });
      const res = await fetch("/api/reports/generate", { method: "POST" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        alert(`Génération échouée (${res.status}) : ${txt.slice(0, 200)}`);
      } else {
        setLastGenerated(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      }
      await fetchReports();
    } catch (e) {
      alert(`Erreur génération : ${e instanceof Error ? e.message : "réseau"}`);
    }
    setGenerating(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <FileText className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold">Rapports SEO hebdomadaires</h1>
          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">Lundi 8h auto</span>
        </div>
        <div className="flex items-center gap-3">
          {lastGenerated && (
            <span className="text-xs bg-green-500/20 text-green-400 px-3 py-1 rounded-full">Régénéré à {lastGenerated}</span>
          )}
          <button type="button" onClick={generateNow} disabled={generating}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {generating ? "Génération en cours..." : "Générer maintenant"}
          </button>
        </div>
      </header>

      <div className="px-6 py-6">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
        ) : reports.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 mb-2">Aucun rapport généré</p>
            <p className="text-gray-600 text-sm mb-6">Les rapports sont générés automatiquement chaque lundi à 8h.<br />Clique sur &quot;Générer maintenant&quot; pour créer le premier rapport.</p>
            <button type="button" onClick={generateNow} disabled={generating}
              className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-xl text-sm font-medium flex items-center gap-2 mx-auto disabled:opacity-50">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
              {generating ? "Génération..." : "Générer le premier rapport"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {reports.length} sites — dernière analyse le {fmtDate(reports[0]?.created_at)}
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={copyAll}
                  className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
                  <Copy className="w-3 h-3" />
                  {copied ? "Copié !" : "Copier tout"}
                </button>
                <button type="button" onClick={toggleAll}
                  className="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
                  {allExpanded ? <ChevronsDownUp className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3" />}
                  {allExpanded ? "Tout fermer" : "Tout ouvrir"}
                </button>
              </div>
            </div>
            {reports.map(report => (
              <div key={report.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div onClick={() => toggleExpand(report.id)}
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-800/50 transition">
                  <div className="flex items-center gap-3">
                    {expandedIds.has(report.id) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div>
                      <span className="font-semibold">{report.site_name}</span>
                      <span className="text-xs text-gray-500 ml-2">{report.site_url}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {report.top_opportunities && report.top_opportunities.length > 0 && (
                      <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        {report.top_opportunities.length} opportunités
                      </span>
                    )}
                    <span className="text-xs text-gray-600">Analysé le {fmtDate(report.created_at)}</span>
                  </div>
                </div>

                {expandedIds.has(report.id) && (
                  <div className="border-t border-gray-800 px-6 py-5 space-y-5">
                    <div className="bg-gray-800/50 rounded-lg px-4 py-3 text-sm text-gray-400">
                      {report.summary}
                    </div>

                    {report.top_opportunities && report.top_opportunities.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-2">Mots clés à attaquer (pos 11-20)</h3>
                        <div className="flex flex-wrap gap-2">
                          {report.top_opportunities.map((op, i) => (
                            <div key={i} className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-1.5 text-xs">
                              <span className="text-white font-medium">{op.query}</span>
                              <span className="text-gray-400 ml-1">pos {op.position} · {op.impressions} imp.</span>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
