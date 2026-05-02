"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Zap, Clock, CheckCircle, XCircle, ExternalLink, Globe, Image as ImageIcon, PlayCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface AutopilotRun {
  id: number;
  site_id: number;
  site_name: string;
  keyword: string;
  article_title: string;
  github_url: string | null;
  /** URL publique sur le site (blog) */
  published_url: string | null;
  image_url: string | null;
  status: string;
  language?: string;
  created_at: string;
}

interface LinkStats {
  total: number;
  valid: number;
  fuzzy: number;
  roundRobin: number;
  skipped: number;
}

interface AutopilotResult {
  success: boolean;
  keyword?: string;
  language?: string;
  article_title?: string;
  article_preview?: string;
  github_url?: string | null;
  published_url?: string | null;
  image_url?: string | null;
  dry_run?: boolean;
  status?: string;
  error?: string;
  repo_matched?: string | null;
  link_candidates_count?: number;
  link_stats?: LinkStats;
}

const LANGUAGES = [
  { code: "fr", label: "🇫🇷 Français" },
  { code: "en", label: "🇬🇧 English" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "it", label: "🇮🇹 Italiano" },
  { code: "nl", label: "🇳🇱 Nederlands" },
  { code: "pt", label: "🇵🇹 Português" },
];

const LANG_FLAG: Record<string, string> = {
  fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹",
};

interface SiteLangRow {
  id: number;
  name: string;
  target_languages: string[];
}

export default function AutopilotPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("fr");
  const [siteLangs, setSiteLangs] = useState<SiteLangRow[]>([]);
  const [savingLangs, setSavingLangs] = useState(false);
  const [runs, setRuns] = useState<AutopilotRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [result, setResult] = useState<AutopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<{ published: number; failed: number; total: number } | null>(null);
  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean>(true);
  const [togglingAutopilot, setTogglingAutopilot] = useState(false);

  useEffect(() => {
    fetchSites();
    fetchHistory();
    fetchSiteLangs();
    fetchAutopilotToggle();
  }, []);

  async function fetchAutopilotToggle() {
    try {
      const res = await fetch("/api/autopilot/toggle");
      const data = await res.json();
      if (typeof data?.enabled === "boolean") setAutopilotEnabled(data.enabled);
    } catch { /* ignore */ }
  }

  async function toggleAutopilot() {
    setTogglingAutopilot(true);
    const next = !autopilotEnabled;
    try {
      const res = await fetch("/api/autopilot/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (data?.success) setAutopilotEnabled(data.enabled);
    } catch (e) {
      alert(`Erreur: ${e instanceof Error ? e.message : "réseau"}`);
    }
    setTogglingAutopilot(false);
  }

  async function fetchSiteLangs() {
    try {
      const res = await fetch("/api/sites/languages");
      const data = await res.json() as { success: boolean; sites?: SiteLangRow[] };
      if (data.success && data.sites) setSiteLangs(data.sites);
    } catch {
      // ignore
    }
  }

  async function toggleSiteLang(siteId: number, lang: string) {
    const row = siteLangs.find((r) => r.id === siteId);
    if (!row) return;
    const current = row.target_languages ?? ["fr"];
    const next = current.includes(lang)
      ? current.filter((l) => l !== lang)
      : [...current, lang];
    if (next.length === 0) return; // must keep at least 1

    setSavingLangs(true);
    try {
      const res = await fetch("/api/sites/languages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: siteId, languages: next }),
      });
      const data = await res.json() as { success: boolean; languages?: string[] };
      if (data.success && data.languages) {
        setSiteLangs((prev) =>
          prev.map((r) => (r.id === siteId ? { ...r, target_languages: data.languages! } : r))
        );
      }
    } finally {
      setSavingLangs(false);
    }
  }

  useEffect(() => {
    fetchHistory();
  }, [selectedSite]);

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites");
      const data = await res.json() as Site[] | { sites?: Site[] };
      const list = Array.isArray(data) ? data : data.sites ?? [];
      if (list.length > 0) {
        setSites(list);
        if (!selectedSite) {
          setSelectedSite("all");
        }
      }
    } catch {
      // silently ignore
    }
  }

  async function fetchHistory() {
    setLoadingRuns(true);
    try {
      const url = selectedSite && selectedSite !== "all"
        ? `/api/autopilot/history?site_id=${selectedSite}`
        : "/api/autopilot/history";
      const res = await fetch(url);
      const data = await res.json() as { runs?: AutopilotRun[] };
      setRuns(data.runs ?? []);
    } catch {
      // silently ignore
    } finally {
      setLoadingRuns(false);
    }
  }

  async function retryRun(run: AutopilotRun) {
    setRetryingId(run.id);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: run.site_id,
          dry_run: false,
          language: run.language ?? "fr",
          forced_keyword: run.keyword,
        }),
      });
      await res.json();
      await fetchHistory();
    } catch {
      // silently ignore
    } finally {
      setRetryingId(null);
    }
  }

  async function runAutopilot(dryRun: boolean) {
    if (!selectedSite || selectedSite === "all") {
      setError("Sélectionne un site d'abord");
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: selectedSite, dry_run: dryRun, language: selectedLanguage }),
      });

      const data = await res.json() as AutopilotResult;

      if (data.success) {
        setResult(data);
        if (!dryRun) fetchHistory();
      } else {
        setError(data.error ?? "Erreur inconnue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function runBatchToday() {
    setBatchRunning(true);
    setBatchResult(null);
    try {
      const res = await fetch("/api/autopilot/weekly", { method: "POST" });
      const d = await res.json() as { published?: number; failed?: number; total_runs?: number; results?: { status: string }[] };
      const results = d.results ?? [];
      setBatchResult({
        published: d.published ?? results.filter((r) => r.status === "published").length,
        failed: d.failed ?? results.filter((r) => r.status !== "published").length,
        total: d.total_runs ?? results.length,
      });
      void fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur batch");
    } finally {
      setBatchRunning(false);
    }
  }

  function nextMondayAt9() {
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntilMonday);
    next.setHours(9, 0, 0, 0);
    return next.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-gray-400 hover:text-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          <h1 className="text-xl font-semibold">SEO Autopilot</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Big ON/OFF kill switch */}
        <div className={`rounded-xl p-5 flex items-center justify-between gap-4 border-2 transition ${
          autopilotEnabled
            ? "bg-emerald-950/30 border-emerald-500/50"
            : "bg-red-950/30 border-red-500/50"
        }`}>
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${autopilotEnabled ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            <div>
              <div className="text-xs uppercase tracking-wider font-bold text-white">
                {autopilotEnabled ? "🟢 Autopilot ACTIVÉ" : "🔴 Autopilot DÉSACTIVÉ"}
              </div>
              <div className="text-sm text-gray-300 mt-1">
                {autopilotEnabled
                  ? "Le cron lundi 9h00 publiera des articles automatiquement."
                  : "Aucun article ne sera publié par le cron lundi 9h00."}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleAutopilot}
            disabled={togglingAutopilot}
            className={`px-6 py-3 rounded-lg font-bold text-sm transition disabled:opacity-50 ${
              autopilotEnabled
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            }`}
          >
            {togglingAutopilot ? "..." : autopilotEnabled ? "⏸️ Désactiver" : "▶️ Activer"}
          </button>
        </div>

        {/* Status card */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-4">
          <Clock className="w-8 h-8 text-blue-400 flex-shrink-0" />
          <div>
            <div className="text-sm text-gray-400">Prochain run automatique</div>
            <div className="font-medium text-white">{autopilotEnabled ? nextMondayAt9() : "— (désactivé)"}</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/countries"
              className="text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-900/20 border border-cyan-800 rounded px-3 py-1.5 flex items-center gap-1.5"
            >
              <Globe className="w-3 h-3" /> Dashboard par pays
            </Link>
            <Link
              href="/autopilot/roi"
              className="text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border border-emerald-800 rounded px-3 py-1.5 flex items-center gap-1.5"
            >
              📈 ROI &amp; Indexation
            </Link>
            <div className="text-xs text-gray-500 bg-gray-800 rounded px-2 py-1">
              Cron: lundi 9h00
            </div>
            <button
              onClick={runBatchToday}
              disabled={batchRunning}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
            >
              {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              {batchRunning ? "Génération en cours..." : "Générer tous les sites aujourd'hui"}
            </button>
          </div>
        </div>
        {batchResult && (
          <div className={`border rounded-xl px-5 py-4 flex items-center gap-4 ${batchResult.failed === 0 ? "bg-green-900/20 border-green-800" : "bg-yellow-900/20 border-yellow-800"}`}>
            <CheckCircle className={`w-5 h-5 flex-shrink-0 ${batchResult.failed === 0 ? "text-green-400" : "text-yellow-400"}`} />
            <div>
              <div className="text-sm font-medium text-white">Batch terminé</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {batchResult.published} publiés · {batchResult.failed} échecs · {batchResult.total} total
              </div>
            </div>
          </div>
        )}

        {/* Auto mode config: target languages per site */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h2 className="font-medium text-gray-200">Mode automatique · Langues ciblées par site</h2>
            {savingLangs && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
          </div>
          <p className="text-xs text-gray-500">
            Chaque lundi 9h, l&apos;autopilot génère <strong>1 article par langue cochée</strong> pour chaque site.
            Ex: cocher 🇫🇷 🇬🇧 🇩🇪 → 3 articles publiés par site chaque semaine.
          </p>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {siteLangs.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 p-3 bg-gray-800/40 rounded-lg border border-gray-800"
              >
                <div className="flex-1 text-sm text-gray-200 font-medium truncate">
                  {row.name}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {LANGUAGES.map((l) => {
                    const active = (row.target_languages ?? []).includes(l.code);
                    return (
                      <button
                        key={l.code}
                        onClick={() => toggleSiteLang(row.id, l.code)}
                        disabled={savingLangs}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          active
                            ? "bg-cyan-900/40 border-cyan-700 text-white"
                            : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                        }`}
                        title={l.label}
                      >
                        {l.label.split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <h2 className="font-medium text-gray-200">Lancer l&apos;autopilot</h2>

          <div className="flex flex-wrap gap-4">
            {/* Site selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-400">Site cible</label>
              <select
                value={selectedSite ?? ""}
                onChange={(e) => setSelectedSite(e.target.value === "all" ? "all" : e.target.value ? parseInt(e.target.value, 10) : null)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
              >
                <option value="all">🌐 Tous les sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Language selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-400 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5" /> Langue de l&apos;article
              </label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 w-52"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => runAutopilot(true)}
              disabled={loading || !selectedSite || selectedSite === "all"}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 text-yellow-400" />
              )}
              Tester maintenant (aperçu)
            </button>

            <button
              onClick={() => runAutopilot(false)}
              disabled={loading || !selectedSite || selectedSite === "all"}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              Publier maintenant
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Result preview */}
          {result && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                {result.status === "published" ? (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                ) : (
                  <Zap className="w-4 h-4 text-yellow-400" />
                )}
                <span className="font-medium text-sm">
                  {result.dry_run ? "Aperçu généré" : "Article publié"}
                </span>
                {result.language && (
                  <span className="text-xs bg-gray-700 rounded px-2 py-0.5">
                    {LANG_FLAG[result.language] ?? ""} {result.language.toUpperCase()}
                  </span>
                )}
                <span className="ml-auto flex flex-wrap items-center justify-end gap-3">
                  {result.published_url && (
                    <a
                      href={result.published_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={result.published_url}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      Article sur le site
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                  {result.github_url && (
                    <a
                      href={result.github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-blue-400 hover:text-blue-300"
                    >
                      GitHub
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                </span>
              </div>

              <div className="space-y-1 text-sm">
                <div>
                  <span className="text-gray-400">Mot-clé: </span>
                  <span className="text-white font-medium">{result.keyword}</span>
                </div>
                <div>
                  <span className="text-gray-400">Titre: </span>
                  <span className="text-white">{result.article_title}</span>
                </div>
                <div className="text-xs">
                  <span className="text-gray-400">Repo: </span>
                  <span className={result.repo_matched ? "text-green-400" : "text-red-400"}>
                    {result.repo_matched ?? "— aucun repo matché"}
                  </span>
                  <span className="text-gray-500 ml-2">
                    ({result.link_candidates_count ?? 0} slugs disponibles)
                  </span>
                </div>
                {result.link_stats && result.link_stats.total > 0 && (
                  <div className="text-xs flex gap-2 flex-wrap mt-1">
                    <span className="text-gray-400">Liens:</span>
                    <span className="bg-gray-900 px-2 py-0.5 rounded">
                      {result.link_stats.total} total
                    </span>
                    <span className="bg-green-900/40 text-green-300 px-2 py-0.5 rounded">
                      {result.link_stats.valid} valides
                    </span>
                    {result.link_stats.fuzzy > 0 && (
                      <span className="bg-yellow-900/40 text-yellow-300 px-2 py-0.5 rounded">
                        {result.link_stats.fuzzy} fuzzy
                      </span>
                    )}
                    {result.link_stats.roundRobin > 0 && (
                      <span className="bg-orange-900/40 text-orange-300 px-2 py-0.5 rounded">
                        {result.link_stats.roundRobin} remplacés
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Image preview */}
              {result.image_url ? (
                <div className="mt-2">
                  <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> Image générée (DALL-E 3)
                  </div>
                  <div className="relative w-full max-w-md h-40 rounded-lg overflow-hidden border border-gray-700">
                    <Image
                      src={result.image_url}
                      alt={result.keyword ?? "article image"}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <a
                    href={result.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-flex items-center gap-1"
                  >
                    Ouvrir l&apos;image <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                  <ImageIcon className="w-3 h-3" />
                  <span>Aucune image générée (quota DALL-E ou clé manquante)</span>
                </div>
              )}

              {result.article_preview && (
                <div className="mt-2">
                  <div className="text-xs text-gray-400 mb-1">
                    Article complet · ~{result.article_preview.split(/\s+/).length} mots · {result.article_preview.length} chars
                  </div>
                  <pre className="text-xs text-gray-300 bg-gray-900 rounded p-3 overflow-auto whitespace-pre-wrap font-mono max-h-[600px]">
                    {result.article_preview}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent runs table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-medium text-gray-200">Runs récents</h2>
            <button
              onClick={fetchHistory}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              Actualiser
            </button>
          </div>

          {loadingRuns ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              Aucun run pour le moment
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-800">
                    <th className="px-5 py-3 text-left font-medium">Site</th>
                    <th className="px-5 py-3 text-left font-medium">Mot-clé</th>
                    <th className="px-5 py-3 text-left font-medium">Langue</th>
                    <th className="px-5 py-3 text-left font-medium">Date</th>
                    <th className="px-5 py-3 text-left font-medium">Statut</th>
                    <th className="px-5 py-3 text-left font-medium">Image</th>
                    <th className="px-5 py-3 text-left font-medium">Article (site)</th>
                    <th className="px-5 py-3 text-left font-medium">GitHub</th>
                    <th className="px-5 py-3 text-left font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-5 py-3 text-gray-300">{run.site_name ?? `Site ${run.site_id}`}</td>
                      <td className="px-5 py-3">
                        <div className="text-white font-medium">{run.keyword}</div>
                        {run.article_title && run.article_title !== run.keyword && (
                          <div className="text-xs text-gray-400 truncate max-w-[200px]">{run.article_title}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-400">
                        {run.language ? (
                          <span className="text-base" title={run.language.toUpperCase()}>
                            {LANG_FLAG[run.language] ?? run.language.toUpperCase()}
                          </span>
                        ) : (
                          <span>🇫🇷</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                        {formatDate(run.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        {run.status === "published" ? (
                          <span className="flex items-center gap-1 text-green-400">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Publié
                          </span>
                        ) : run.status === "dry_run" ? (
                          <span className="flex items-center gap-1 text-yellow-400">
                            <Zap className="w-3.5 h-3.5" />
                            Test
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-400">
                            <XCircle className="w-3.5 h-3.5" />
                            Échec
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {run.image_url ? (
                          <a
                            href={run.image_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            Voir
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {run.published_url && run.status === "published" ? (
                          <a
                            href={run.published_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={run.published_url}
                            className="inline-flex items-center gap-1.5 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 px-1 py-0.5 text-xs"
                          >
                            <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="whitespace-nowrap">Voir l&apos;article</span>
                            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {run.github_url ? (
                          <a
                            href={run.github_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Fichier <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {run.status !== "published" && (
                          <button
                            type="button"
                            onClick={() => void retryRun(run)}
                            disabled={retryingId === run.id}
                            className="flex items-center gap-1 text-xs bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 px-2 py-1 rounded disabled:opacity-50"
                          >
                            {retryingId === run.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Relancer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// Sat May  2 09:31:48     2026
