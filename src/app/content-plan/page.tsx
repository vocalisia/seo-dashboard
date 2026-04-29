"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, CheckCircle, Circle, Clock } from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface ContentItem {
  id: number;
  title: string;
  target_keyword: string;
  score: number;
  rationale: string;
  difficulty: string;
  volume: number;
  status: "todo" | "doing" | "done";
  site_name?: string;
}

const DIFF_COLORS: Record<string, string> = {
  easy: "text-green-400",
  medium: "text-yellow-400",
  hard: "text-red-400",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  todo: <Circle className="w-4 h-4 text-gray-500" />,
  doing: <Clock className="w-4 h-4 text-yellow-400" />,
  done: <CheckCircle className="w-4 h-4 text-green-400" />,
};

type StatusFilter = "all" | "todo" | "doing" | "done";

export default function ContentPlanPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [allProgress, setAllProgress] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/sites");
        const data = await res.json() as Site[] | { sites?: Site[] };
        const list = Array.isArray(data) ? data : (data.sites ?? []);
        setSites(list);
        if (list.length > 0) setSelectedSite("all");
      } catch { /* ignore */ }
    })();
  }, []);

  async function generate() {
    if (!selectedSite) return;
    if (selectedSite === "all") {
      await generateAll();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content-plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: selectedSite }),
      });
      const data = await res.json() as { success: boolean; items?: ContentItem[]; error?: string };
      if (data.success && data.items) {
        setItems(data.items as ContentItem[]);
      } else {
        setError(data.error ?? "Erreur inconnue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    }
    setLoading(false);
  }

  async function generateAll() {
    if (sites.length === 0) return;
    setLoading(true);
    setError(null);
    const allItems: ContentItem[] = [];
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      setAllProgress(`Site ${i + 1}/${sites.length} — ${site.name}`);
      try {
        const res = await fetch("/api/content-plan/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ siteId: site.id }),
        });
        const data = await res.json() as { success: boolean; items?: ContentItem[]; error?: string };
        if (data.success && data.items) allItems.push(...data.items);
      } catch { /* skip site on error */ }
    }
    setItems(allItems);
    setAllProgress(null);
    setLoading(false);
  }

  async function updateStatus(id: number, status: "todo" | "doing" | "done") {
    setUpdatingId(id);
    try {
      await fetch(`/api/content-plan/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setItems((prev) => prev.map((item) => item.id === id ? { ...item, status } : item));
    } catch { /* ignore */ }
    setUpdatingId(null);
  }

  const filtered = items.filter((item) => statusFilter === "all" || item.status === statusFilter);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <span className="text-xl">Content Plan</span>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs text-gray-400 uppercase block mb-1">Site</label>
            <select value={selectedSite ?? ""} onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-56">
              <option value="all">🌐 Tous les sites</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button onClick={generate} disabled={loading || !selectedSite}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? (allProgress ?? "Génération IA...") : "Régénérer plan"}
          </button>
          <div className="text-xs text-gray-500">
            Scoring: volume × difficulté inverse × type d&apos;opportunité
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">{error}</div>
        )}

        {items.length > 0 && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {(["todo", "doing", "done"] as const).map((s) => (
                <div key={s} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-white">{items.filter((i) => i.status === s).length}</div>
                  <div className="text-xs text-gray-500 mt-1 capitalize">{s === "todo" ? "À faire" : s === "doing" ? "En cours" : "Terminé"}</div>
                </div>
              ))}
            </div>

            {/* Filter */}
            <div className="flex gap-2">
              {(["all", "todo", "doing", "done"] as StatusFilter[]).map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusFilter === s ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
                  {s === "all" ? "Tous" : s === "todo" ? "À faire" : s === "doing" ? "En cours" : "Terminés"}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800 bg-gray-800/40">
                    <th className="px-4 py-3 text-center">#</th>
                    <th className="px-4 py-3 text-left">Titre</th>
                    {selectedSite === "all" && <th className="px-4 py-3 text-left">Site</th>}
                    <th className="px-4 py-3 text-left">Mot-clé cible</th>
                    <th className="px-4 py-3 text-right">Vol.</th>
                    <th className="px-4 py-3 text-center">Difficulté</th>
                    <th className="px-4 py-3 text-right">Score</th>
                    <th className="px-4 py-3 text-left">Justification</th>
                    <th className="px-4 py-3 text-center">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => (
                    <tr key={item.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="px-4 py-3 text-center text-gray-500 text-xs">{i + 1}</td>
                      <td className="px-4 py-3 text-gray-100 font-medium max-w-xs">{item.title}</td>
                      {selectedSite === "all" && <td className="px-4 py-3 text-xs text-gray-400">{item.site_name ?? "—"}</td>}
                      <td className="px-4 py-3 text-blue-400 text-xs">{item.target_keyword}</td>
                      <td className="px-4 py-3 text-right text-purple-400">{Number(item.volume).toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium ${DIFF_COLORS[item.difficulty] ?? "text-gray-400"}`}>{item.difficulty}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300 font-semibold">{Number(item.score).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{item.rationale}</td>
                      <td className="px-4 py-3 text-center">
                        {updatingId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto" />
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => updateStatus(item.id, item.status === "done" ? "todo" : item.status === "todo" ? "doing" : "done")}
                              title="Changer le statut"
                              className="hover:scale-110 transition-transform">
                              {STATUS_ICONS[item.status]}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && items.length === 0 && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl py-16 text-center text-gray-500 text-sm">
            Sélectionne un site et génère ton plan de 20 articles prioritaires
          </div>
        )}
      </div>
    </div>
  );
}
