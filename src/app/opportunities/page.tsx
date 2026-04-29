"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp, AlertTriangle, FileText, X } from "lucide-react";
import Link from "next/link";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface CtrRow {
  query: string;
  position: number;
  clicks: number;
  impressions: number;
  actualCtr: number;
  expectedCtr: number;
  ctrGap: number;
  potentialClicks: number;
}

interface CannibRow {
  query: string;
  pageCount: number;
  pages: string[];
  avgPosition: number;
  clicks: number;
}

type Tab = "ctr" | "cannib" | "briefs";

function ctrGapColor(gap: number): string {
  if (gap > 0.1) return "text-red-400";
  if (gap > 0.05) return "text-yellow-400";
  return "text-green-400";
}

function pct(v: number) {
  return (v * 100).toFixed(1) + "%";
}

function BriefModal({ query, position, impressions, siteUrl, onClose }: {
  query: string; position: number; impressions: number; siteUrl: string; onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    generateBrief();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateBrief() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/content-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, position, impressions, site_url: siteUrl }),
      });
      const data = await res.json() as { brief?: string; error?: string };
      if (data.error) { setErr(data.error); return; }
      setBrief(data.brief ?? "");
    } catch {
      setErr("Erreur lors de la génération");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h2 className="font-semibold">Brief IA — {query}</h2>
            <p className="text-xs text-gray-500">Position {position} · {impressions.toLocaleString()} impressions</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center gap-3 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" /> Génération en cours...
            </div>
          )}
          {err && <div className="text-red-400">{err}</div>}
          {brief && (
            <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">{brief}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefsTab({ sites, selectedSite }: { sites: Site[]; selectedSite: Site | null }) {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    if (!keyword.trim()) return;
    setLoading(true);
    setErr(null);
    setBrief("");
    try {
      const res = await fetch("/api/content-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: keyword,
          position: 0,
          impressions: 0,
          site_url: selectedSite?.url ?? "",
        }),
      });
      const data = await res.json() as { brief?: string; error?: string };
      if (data.error) { setErr(data.error); return; }
      setBrief(data.brief ?? "");
    } catch {
      setErr("Erreur lors de la génération");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="font-medium mb-4">Générer un brief SEO</h3>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Entrez un mot clé..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
            className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={generate}
            disabled={loading || !keyword.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Générer
          </button>
        </div>
        {err && <div className="mt-3 text-red-400 text-sm">{err}</div>}
      </div>
      {brief && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">{brief}</pre>
        </div>
      )}
    </div>
  );
}

export default function OpportunitiesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<Site | "all" | null>(null);
  const [tab, setTab] = useState<Tab>("ctr");
  const [ctrRows, setCtrRows] = useState<CtrRow[]>([]);
  const [cannibRows, setCannibRows] = useState<CannibRow[]>([]);
  const [loadingCtr, setLoadingCtr] = useState(false);
  const [loadingCannib, setLoadingCannib] = useState(false);
  const [modal, setModal] = useState<CtrRow | null>(null);

  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setSites(data as Site[]);
          if ((data as Site[]).length > 0) setSelectedSite("all");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedSite || selectedSite === "all") return;
    if (tab === "ctr") loadCtr(selectedSite.id);
    if (tab === "cannib") loadCannib(selectedSite.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, tab]);

  async function loadCtr(siteId: number) {
    setLoadingCtr(true);
    try {
      const res = await fetch(`/api/ctr-opportunities?site_id=${siteId}&days=30`);
      const data = await res.json() as CtrRow[];
      if (Array.isArray(data)) setCtrRows(data);
    } catch { /* ignore */ }
    setLoadingCtr(false);
  }

  async function loadCannib(siteId: number) {
    setLoadingCannib(true);
    try {
      const res = await fetch(`/api/cannibalization?site_id=${siteId}`);
      const data = await res.json() as CannibRow[];
      if (Array.isArray(data)) setCannibRows(data);
    } catch { /* ignore */ }
    setLoadingCannib(false);
  }

  function handleSiteChange(id: number) {
    const s = sites.find((site) => site.id === id);
    setSelectedSite(s ?? null);
    setCtrRows([]);
    setCannibRows([]);
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "ctr", label: "CTR Optimizer", icon: <TrendingUp className="w-4 h-4" /> },
    { key: "cannib", label: "Cannibalisation", icon: <AlertTriangle className="w-4 h-4" /> },
    { key: "briefs", label: "Briefs IA", icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-400 hover:text-white transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <TrendingUp className="w-6 h-6 text-green-400" />
        <h1 className="text-xl font-bold">Opportunités SEO</h1>
      </header>

      <div className="px-6 py-6 max-w-6xl mx-auto">
        {/* Site selector */}
        <div className="mb-6">
          <select
            value={selectedSite === "all" ? "all" : typeof selectedSite === "object" && selectedSite ? String(selectedSite.id) : ""}
            onChange={(e) => {
              if (e.target.value === "all") { setSelectedSite("all"); setCtrRows([]); setCannibRows([]); }
              else handleSiteChange(parseInt(e.target.value, 10));
            }}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="all">🌐 Tous les sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {s.url}</option>
            ))}
          </select>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 mb-6 w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                tab === t.key ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* CTR Optimizer */}
        {tab === "ctr" && (
          <div>
            {loadingCtr ? (
              <div className="flex items-center gap-3 text-gray-400 py-8">
                <Loader2 className="w-5 h-5 animate-spin" /> Chargement...
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800">
                  <h2 className="font-semibold">Mots clés sous-performants — CTR Optimizer</h2>
                  <p className="text-xs text-gray-500 mt-1">Triés par clics potentiels perdus</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                        <th className="py-3 px-4 text-left">Mot clé</th>
                        <th className="py-3 px-4 text-center">Position</th>
                        <th className="py-3 px-4 text-center">CTR actuel</th>
                        <th className="py-3 px-4 text-center">CTR attendu</th>
                        <th className="py-3 px-4 text-right">Impressions</th>
                        <th className="py-3 px-4 text-right">Clics perdus</th>
                        <th className="py-3 px-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ctrRows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition">
                          <td className="py-3 px-4 text-gray-200 max-w-xs truncate font-medium">{row.query}</td>
                          <td className="py-3 px-4 text-center text-gray-400">{row.position}</td>
                          <td className="py-3 px-4 text-center text-gray-400">{pct(row.actualCtr)}</td>
                          <td className="py-3 px-4 text-center text-gray-400">{pct(row.expectedCtr)}</td>
                          <td className="py-3 px-4 text-right text-gray-400">{row.impressions.toLocaleString()}</td>
                          <td className={`py-3 px-4 text-right font-medium ${ctrGapColor(row.ctrGap)}`}>
                            -{row.potentialClicks.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              onClick={() => setModal(row)}
                              className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-1 rounded text-xs transition"
                            >
                              Brief IA
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ctrRows.length === 0 && (
                    <div className="py-12 text-center text-gray-500">Aucune opportunité trouvée</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cannibalisation */}
        {tab === "cannib" && (
          <div>
            {loadingCannib ? (
              <div className="flex items-center gap-3 text-gray-400 py-8">
                <Loader2 className="w-5 h-5 animate-spin" /> Chargement...
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800">
                  <h2 className="font-semibold">Cannibalisation de mots clés</h2>
                  <p className="text-xs text-gray-500 mt-1">Requêtes où plusieurs pages se font concurrence</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                        <th className="py-3 px-4 text-left">Mot clé</th>
                        <th className="py-3 px-4 text-center">Nb pages</th>
                        <th className="py-3 px-4 text-left">URLs en compétition</th>
                        <th className="py-3 px-4 text-right">Clics</th>
                        <th className="py-3 px-4 text-right">Position moy.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cannibRows.map((row, i) => (
                        <tr key={i} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition">
                          <td className="py-3 px-4 text-gray-200 font-medium max-w-xs truncate">{row.query}</td>
                          <td className="py-3 px-4 text-center">
                            <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded text-xs">
                              {row.pageCount}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {row.pages.slice(0, 3).map((p, j) => (
                                <span key={j} className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-xs max-w-[200px] truncate" title={p}>
                                  {p.replace(/^https?:\/\/[^/]+/, "")}
                                </span>
                              ))}
                              {row.pages.length > 3 && (
                                <span className="text-gray-500 text-xs">+{row.pages.length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-gray-400">{row.clicks.toLocaleString()}</td>
                          <td className="py-3 px-4 text-right text-gray-400">{Number(row.avgPosition).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {cannibRows.length === 0 && (
                    <div className="py-12 text-center text-gray-500">Aucune cannibalisation détectée</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Briefs IA */}
        {tab === "briefs" && <BriefsTab sites={sites} selectedSite={typeof selectedSite === "object" ? selectedSite : null} />}
      </div>

      {/* Brief modal from CTR table */}
      {modal && selectedSite && selectedSite !== "all" && (
        <BriefModal
          query={modal.query}
          position={modal.position}
          impressions={modal.impressions}
          siteUrl={selectedSite.url}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
