"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2,
  CircleDashed, ExternalLink, Loader2, Play, RefreshCw, Search,
  Target, TrendingUp,
} from "lucide-react";

type DataStatus = "fresh" | "aging" | "stale" | "missing" | "not_configured" | "syncing" | "error";
type KeywordFilter = "all" | "top10" | "opportunities" | "gains" | "losses" | "unobserved";
type KeywordSort = "impressions" | "position" | "change" | "keyword";

interface PositionSite {
  id: number;
  name: string;
  url: string;
  gsc_configured: boolean;
  latest_data_date: string | null;
  keyword_count: number;
  tracked_keywords: number;
  tracked_with_gsc: number;
  avg_position: number | null;
  top_3: number;
  top_10: number;
  top_20: number;
  clicks: number;
  impressions: number;
  data_status: DataStatus;
  last_crawl_status: string | null;
  last_crawl_at: string | null;
  last_crawl_rows: number;
  last_crawl_error: string | null;
}

interface KeywordRow {
  keyword: string;
  current_position: number | null;
  previous_position: number | null;
  position_change: number | null;
  clicks: number;
  impressions: number;
  ctr: number | null;
  target_url: string | null;
  market: string | null;
  volume_market: number | null;
  volume_fr: number | null;
  volume_ch: number | null;
  volume_source: string | null;
  row_source: "gsc" | "tracked_only";
}

interface PositionResponse {
  success: boolean;
  error?: string;
  ranking_notice?: string;
  summary: {
    total_sites: number;
    positioned_sites: number;
    fresh_sites: number;
    total_keywords: number;
    tracked_keywords: number;
    tracked_with_gsc: number;
    top_10: number;
    clicks: number;
    impressions: number;
    avg_position: number | null;
  };
  sites: PositionSite[];
  keywords: null | { page: number; pages: number; total: number; rows: KeywordRow[] };
}

const STATUS: Record<DataStatus, { label: string; className: string }> = {
  fresh: { label: "À jour", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" },
  aging: { label: "À surveiller", className: "border-amber-500/30 bg-amber-500/10 text-amber-100" },
  stale: { label: "En retard", className: "border-orange-500/30 bg-orange-500/10 text-orange-100" },
  missing: { label: "Sans données", className: "border-slate-600 bg-slate-800 text-slate-300" },
  not_configured: { label: "GSC non configurée", className: "border-red-500/30 bg-red-500/10 text-red-200" },
  syncing: { label: "Crawl en cours", className: "border-blue-500/30 bg-blue-500/10 text-blue-200" },
  error: { label: "Erreur de crawl", className: "border-red-500/30 bg-red-500/10 text-red-200" },
};

const FILTERS: Array<{ value: KeywordFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "top10", label: "Top 10" },
  { value: "opportunities", label: "Positions 4–20" },
  { value: "gains", label: "Gains" },
  { value: "losses", label: "Pertes" },
  { value: "unobserved", label: "Suivis non observés" },
];

function formatNumber(value: number) {
  return value.toLocaleString("fr-FR");
}

function importedVolume(row: KeywordRow): number | null {
  if (!row.volume_source) return null;
  const values = [row.volume_market, row.volume_ch, row.volume_fr]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length > 0 ? Math.max(...values) : 0;
}

function StatusBadge({ status }: { status: DataStatus }) {
  const item = STATUS[status] ?? STATUS.missing;
  return <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-medium ${item.className}`}>{item.label}</span>;
}

export function PositionWorkspace() {
  const [days, setDays] = useState(30);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [domainSearch, setDomainSearch] = useState("");
  const [keywordSearch, setKeywordSearch] = useState("");
  const [filter, setFilter] = useState<KeywordFilter>("all");
  const [sort, setSort] = useState<KeywordSort>("impressions");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PositionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState<"all" | number | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const params = new URLSearchParams({
      days: String(days), page: String(page), limit: "100", filter, sort, direction,
    });
    if (selectedSiteId) params.set("site_id", String(selectedSiteId));
    if (keywordSearch.trim()) params.set("search", keywordSearch.trim());
    try {
      const response = await fetch(`/api/position-crawl?${params}`, { signal, cache: "no-store" });
      const payload = await response.json() as PositionResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || "Lecture impossible");
      setData(payload);
      if (selectedSiteId === null) {
        const initialSite = payload.sites.find((site) => site.keyword_count > 0) ?? payload.sites[0];
        if (initialSite) setSelectedSiteId(initialSite.id);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Lecture des positions impossible" });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [days, direction, filter, keywordSearch, page, selectedSiteId, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  const runCrawl = async (siteId: number | null) => {
    setCrawling(siteId ?? "all");
    setMessage(null);
    const params = new URLSearchParams({ days: "45", concurrency: "2" });
    if (siteId) params.set("site_id", String(siteId));
    try {
      const response = await fetch(`/api/position-crawl?${params}`, { method: "POST" });
      const payload = await response.json() as { success?: boolean; error?: string; successful_sites?: number; total_keywords?: number };
      if (!response.ok || !payload.success) throw new Error(payload.error || "Le crawl a échoué");
      setMessage({
        type: "ok",
        text: siteId
          ? `Crawl terminé : ${formatNumber(payload.total_keywords ?? 0)} mots-clés consolidés.`
          : `Portfolio actualisé : ${formatNumber(payload.successful_sites ?? 0)} domaines traités, ${formatNumber(payload.total_keywords ?? 0)} mots-clés consolidés.`,
      });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Le crawl a échoué" });
    } finally {
      setCrawling(null);
    }
  };

  const sites = useMemo(() => {
    const needle = domainSearch.trim().toLocaleLowerCase("fr");
    return (data?.sites ?? []).filter((site) => !needle || `${site.name} ${site.url}`.toLocaleLowerCase("fr").includes(needle));
  }, [data?.sites, domainSearch]);
  const selectedSite = data?.sites.find((site) => site.id === selectedSiteId) ?? null;
  const keywords = data?.keywords;

  const selectSite = (id: number) => {
    setSelectedSiteId(id);
    setKeywordSearch("");
    setFilter("all");
    setPage(1);
  };

  return (
    <div data-testid="position-workspace" className="min-h-dvh bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/90 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-300">Mesure vérifiée</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Positions et mots-clés par domaine</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">Moyennes Google Search Console pondérées par impressions, arrêtées à la dernière date importée. Ce ne sont pas des positions SERP instantanées.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Période GSC" value={days} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); }} className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-400">
              <option value={7}>7 jours</option><option value={30}>30 jours</option><option value={45}>45 jours</option><option value={90}>90 jours</option>
            </select>
            <button type="button" onClick={() => void load()} disabled={loading || crawling !== null} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-50" aria-label="Rafraîchir les données affichées">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => void runCrawl(null)} disabled={crawling !== null} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
              {crawling === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              Crawler tout le portfolio
            </button>
          </div>
        </div>
      </header>

      {message && <div role={message.type === "error" ? "alert" : "status"} className={`mx-4 mt-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm sm:mx-6 ${message.type === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-red-500/30 bg-red-500/10 text-red-100"}`}>
        {message.type === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}{message.text}
      </div>}

      <section aria-label="Résumé des positions" className="grid grid-cols-2 gap-3 px-4 py-4 sm:px-6 lg:grid-cols-4 2xl:grid-cols-8">
        {[
          ["Domaines", data?.summary.total_sites], ["À jour", data?.summary.fresh_sites],
          ["Positionnés", data?.summary.positioned_sites], ["Mots-clés GSC", data?.summary.total_keywords],
          ["Top 10", data?.summary.top_10], ["Mots-clés suivis", data?.summary.tracked_keywords],
          ["Impressions", data?.summary.impressions], ["Position pondérée", data?.summary.avg_position == null ? null : data.summary.avg_position.toFixed(1)],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold">{typeof value === "number" ? formatNumber(value) : value ?? "—"}</div></div>)}
      </section>

      <div className="grid min-h-[36rem] gap-4 px-4 pb-8 sm:px-6 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.8fr)]">
        <section aria-labelledby="domains-title" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="border-b border-slate-800 p-4"><h2 id="domains-title" className="font-semibold">Domaines</h2><label className="relative mt-3 block"><span className="sr-only">Rechercher un domaine</span><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" /><input value={domainSearch} onChange={(event) => setDomainSearch(event.target.value)} placeholder="Rechercher un domaine" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-400" /></label></div>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
            {loading && sites.length === 0 && <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Chargement des domaines…</div>}
            {sites.map((site) => <button data-testid="position-domain" key={site.id} type="button" onClick={() => selectSite(site.id)} aria-pressed={selectedSiteId === site.id} className={`w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${selectedSiteId === site.id ? "border-blue-500/50 bg-blue-500/10" : "border-slate-800 bg-slate-950/60 hover:border-slate-700"}`}>
              <div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-100">{site.name}</span><StatusBadge status={site.data_status} /></div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><span className="block text-slate-500">Mots-clés</span>{formatNumber(site.keyword_count)}</div><div><span className="block text-slate-500">Top 10</span>{formatNumber(site.top_10)}</div><div><span className="block text-slate-500">Position</span>{site.avg_position?.toFixed(1) ?? "—"}</div></div>
              <div className="mt-2 text-[11px] text-slate-500">Dernières données : {site.latest_data_date ?? "jamais"}</div>
            </button>)}
            {!loading && sites.length === 0 && <div className="py-10 text-center text-sm text-slate-500">Aucun domaine trouvé.</div>}
          </div>
        </section>

        <section aria-labelledby="keywords-title" className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60">
          {!selectedSite ? <div className="grid min-h-[28rem] place-items-center p-6 text-center"><div><CircleDashed className="mx-auto h-9 w-9 text-slate-600" /><h2 id="keywords-title" className="mt-3 font-semibold">Choisis un domaine</h2><p className="mt-1 text-sm text-slate-500">Ses mots-clés GSC et les mots-clés suivis apparaîtront ici.</p></div></div> : <>
            <div className="flex flex-col gap-3 border-b border-slate-800 p-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><h2 id="keywords-title" className="truncate text-lg font-semibold">{selectedSite.name}</h2><a href={selectedSite.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 truncate text-xs text-blue-300 hover:text-blue-200">{selectedSite.url}<ExternalLink className="h-3 w-3" /></a></div><button type="button" onClick={() => void runCrawl(selectedSite.id)} disabled={crawling !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 text-sm font-medium text-blue-100 hover:bg-blue-500/20 disabled:opacity-50">{crawling === selectedSite.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}Crawler ce domaine</button></div>
            <div className="flex flex-col gap-3 border-b border-slate-800 p-4"><div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les mots-clés">{FILTERS.map((item) => <button key={item.value} type="button" onClick={() => { setFilter(item.value); setPage(1); }} aria-pressed={filter === item.value} className={`min-h-10 rounded-lg border px-3 text-xs font-medium ${filter === item.value ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"}`}>{item.label}</button>)}</div><div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_8rem]"><label className="relative"><span className="sr-only">Rechercher un mot-clé</span><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" /><input value={keywordSearch} onChange={(event) => { setKeywordSearch(event.target.value); setPage(1); }} placeholder="Rechercher un mot-clé" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-400" /></label><select aria-label="Trier les mots-clés" value={sort} onChange={(event) => { setSort(event.target.value as KeywordSort); setPage(1); }} className="h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"><option value="impressions">Impressions</option><option value="position">Position</option><option value="change">Évolution</option><option value="keyword">Mot-clé</option></select><button type="button" onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm hover:bg-slate-800">{direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}{direction === "asc" ? "Croissant" : "Décroissant"}</button></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-950/70 text-left text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">Mot-clé</th><th className="px-3 py-3 font-medium">Position</th><th className="px-3 py-3 font-medium">Évolution</th><th className="px-3 py-3 font-medium">Clics</th><th className="px-3 py-3 font-medium">Impressions</th><th className="px-3 py-3 font-medium">CTR</th><th className="px-3 py-3 font-medium">Volume importé</th></tr></thead><tbody className="divide-y divide-slate-800">{keywords?.rows.map((row) => { const volume = importedVolume(row); return <tr key={row.keyword} className="hover:bg-slate-800/40"><td className="px-4 py-3"><div className="max-w-[25rem] truncate font-medium text-slate-100" title={row.keyword}>{row.keyword}</div><div className="mt-1 text-[11px] text-slate-500">{row.row_source === "tracked_only" ? "Suivi, non observé dans GSC" : row.market || "GSC"}</div></td><td className="px-3 py-3 font-semibold text-cyan-200">{row.current_position?.toFixed(1) ?? "—"}</td><td className="px-3 py-3">{row.position_change == null ? "—" : <span className={`inline-flex items-center gap-1 ${row.position_change > 0 ? "text-emerald-300" : row.position_change < 0 ? "text-red-300" : "text-slate-400"}`}>{row.position_change > 0 ? <TrendingUp className="h-3 w-3" /> : row.position_change < 0 ? <ArrowDown className="h-3 w-3" /> : null}{row.position_change > 0 ? "+" : ""}{row.position_change.toFixed(1)}</span>}</td><td className="px-3 py-3">{formatNumber(row.clicks)}</td><td className="px-3 py-3">{formatNumber(row.impressions)}</td><td className="px-3 py-3">{row.ctr == null ? "—" : `${(row.ctr * 100).toFixed(1)} %`}</td><td className="px-3 py-3"><div>{volume == null ? "—" : formatNumber(volume)}</div><div className="mt-1 max-w-32 truncate text-[10px] text-slate-500" title={row.volume_source ?? "Non importé"}>{row.volume_source ?? "Non importé"}</div></td></tr>; })}</tbody></table></div>
            {loading && <div role="status" className="flex min-h-24 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Chargement des positions…</div>}
            {!loading && keywords?.rows.length === 0 && <div className="min-h-24 p-8 text-center text-sm text-slate-500">Aucun mot-clé ne correspond à ce filtre.</div>}
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 p-4 text-sm"><span className="text-slate-500">{formatNumber(keywords?.total ?? 0)} résultat(s)</span><div className="flex items-center gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 disabled:opacity-30" aria-label="Page précédente"><ArrowLeft className="h-4 w-4" /></button><span className="min-w-20 text-center">{page} / {Math.max(1, keywords?.pages ?? 1)}</span><button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= (keywords?.pages ?? 0)} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 disabled:opacity-30" aria-label="Page suivante"><ArrowRight className="h-4 w-4" /></button></div></div>
          </>}
        </section>
      </div>
    </div>
  );
}
