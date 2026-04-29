"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, X, Save, BarChart3 } from "lucide-react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface ScanResult {
  query: string;
  llm: string;
  mentioned: boolean;
  indirect: boolean;
  position: number | null;
  competitors: { name: string; rank: number }[];
}

interface HistoryPoint {
  score: number;
  created_at: string;
}

const LLM_ORDER = ["Perplexity", "Claude", "Gemini", "Mistral"];

type ActiveTab = "scan" | "history";

export default function AIVisibilityPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | null>(null);
  const [brand, setBrand] = useState("");
  const [queries, setQueries] = useState<string[]>(["Quel est le meilleur outil pour ..."]);
  const [newQuery, setNewQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("scan");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/sites");
        const data = await res.json() as Site[] | { sites?: Site[] };
        const list = Array.isArray(data) ? data : (data.sites ?? []);
        setSites(list);
        if (list.length > 0) {
          setSelectedSite(list[0].id);
          setBrand(list[0].name);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  async function loadHistory() {
    if (!selectedSite) return;
    try {
      const res = await fetch(`/api/ai-visibility/history?siteId=${selectedSite}`);
      const data = await res.json() as { success: boolean; history?: HistoryPoint[] };
      if (data.success && data.history) setHistory(data.history.reverse());
    } catch { /* ignore */ }
  }

  async function runScan() {
    if (!selectedSite || !brand || queries.length === 0) return;
    setLoading(true);
    setResults([]);
    setScore(null);
    try {
      const res = await fetch("/api/ai-visibility/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSite, brand, queries }),
      });
      const data = await res.json() as { success: boolean; results?: ScanResult[]; score?: number; error?: string };
      if (data.success && data.results) {
        setResults(data.results);
        setScore(data.score ?? 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function saveSnapshot() {
    if (!selectedSite || results.length === 0 || score === null) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ai-visibility/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSite, score, results }),
      });
      const data = await res.json() as { success: boolean };
      setSaveMsg(data.success ? "Snapshot sauvegardé" : "Erreur sauvegarde");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch { /* ignore */ }
    setSaving(false);
  }

  function addQuery() {
    const q = newQuery.trim();
    if (!q || queries.length >= 10) return;
    setQueries((prev) => [...prev, q]);
    setNewQuery("");
  }

  function removeQuery(i: number) {
    setQueries((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Build matrix: query × LLM
  const queryList = [...new Set(results.map((r) => r.query))];

  function getCell(query: string, llm: string): ScanResult | undefined {
    return results.find((r) => r.query === query && r.llm === llm);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <span className="text-xl">AI Visibility</span>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-2">
          {(["scan", "history"] as ActiveTab[]).map((t) => (
            <button key={t} onClick={() => { setActiveTab(t); if (t === "history") void loadHistory(); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === t ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              {t === "scan" ? "Scan LLMs" : "Historique"}
            </button>
          ))}
        </div>

        {activeTab === "scan" && (
          <>
            {/* Config */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 uppercase block mb-1">Site</label>
                  <select value={selectedSite ?? ""} onChange={(e) => {
                    const id = parseInt(e.target.value, 10);
                    setSelectedSite(id);
                    const site = sites.find((s) => s.id === id);
                    if (site) setBrand(site.name);
                  }} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 uppercase block mb-1">Marque / Brand</label>
                  <input value={brand} onChange={(e) => setBrand(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="vocalis.pro" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400 uppercase block mb-2">Requêtes ({queries.length}/10)</label>
                <div className="space-y-2">
                  {queries.map((q, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={q} onChange={(e) => setQueries((prev) => prev.map((x, idx) => idx === i ? e.target.value : x))}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <button onClick={() => removeQuery(i)} className="text-gray-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
                {queries.length < 10 && (
                  <div className="flex gap-2 mt-2">
                    <input value={newQuery} onChange={(e) => setNewQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addQuery(); }}
                      placeholder="Ajouter une requête..."
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <button onClick={addQuery} className="flex items-center gap-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
                      <Plus className="w-4 h-4" /> Ajouter
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-3 items-center">
                <button onClick={runScan} disabled={loading || !selectedSite || !brand}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
                  {loading ? "Scan en cours... (30s max/LLM)" : "Lancer scan"}
                </button>
                {results.length > 0 && (
                  <button onClick={saveSnapshot} disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg text-sm transition-colors">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Sauvegarder snapshot
                  </button>
                )}
                {saveMsg && <span className="text-sm text-green-400">{saveMsg}</span>}
              </div>
            </div>

            {/* Score */}
            {score !== null && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-6">
                <div>
                  <div className="text-xs text-gray-400 mb-1">Score visibilité IA global</div>
                  <div className={`text-4xl font-bold ${score >= 60 ? "text-green-400" : score >= 30 ? "text-yellow-400" : "text-red-400"}`}>
                    {score}%
                  </div>
                </div>
                <div className="flex-1 bg-gray-800 rounded-full h-3">
                  <div className={`h-3 rounded-full transition-all ${score >= 60 ? "bg-green-500" : score >= 30 ? "bg-yellow-500" : "bg-red-500"}`}
                    style={{ width: `${score}%` }} />
                </div>
                <div className="text-xs text-gray-500">
                  {results.filter((r) => r.mentioned).length}/{results.length} mentions directes
                </div>
              </div>
            )}

            {/* Results matrix */}
            {queryList.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800 text-sm font-medium text-gray-300">
                  Résultats par LLM
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                        <th className="px-5 py-3 text-left">Requête</th>
                        {LLM_ORDER.map((llm) => (
                          <th key={llm} className="px-4 py-3 text-center">{llm}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queryList.map((query) => (
                        <tr key={query} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                          <td className="px-5 py-3 text-gray-200 max-w-xs truncate">{query}</td>
                          {LLM_ORDER.map((llm) => {
                            const cell = getCell(query, llm);
                            if (!cell) return <td key={llm} className="px-4 py-3 text-center text-gray-600">—</td>;
                            return (
                              <td key={llm} className="px-4 py-3 text-center">
                                {cell.mentioned ? (
                                  <div className="inline-flex flex-col items-center gap-0.5">
                                    <span className="text-green-400 text-base">✅</span>
                                    {cell.position && <span className="text-xs text-green-400">#{cell.position}</span>}
                                  </div>
                                ) : cell.indirect ? (
                                  <span className="text-yellow-400 text-base" title="Mention indirecte">🟡</span>
                                ) : (
                                  <div className="inline-flex flex-col items-center gap-0.5">
                                    <span className="text-red-400 text-base">❌</span>
                                    {cell.competitors[0] && (
                                      <span className="text-xs text-gray-500 truncate max-w-20">{cell.competitors[0].name}</span>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!loading && results.length === 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center text-gray-500 text-sm">
                Configure tes requêtes et clique &quot;Lancer scan&quot;
              </div>
            )}
          </>
        )}

        {activeTab === "history" && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h2 className="text-sm font-medium text-gray-300 mb-4">Evolution score visibilité IA (30 derniers snapshots)</h2>
            {history.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-sm">Aucun snapshot enregistré. Lance un scan et sauvegarde.</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={history.map((h) => ({ date: h.created_at.slice(0, 10), score: Math.round(h.score) }))}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                    formatter={(v: unknown) => [`${v}%`, "Score"]} />
                  <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: "#3b82f6" }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
