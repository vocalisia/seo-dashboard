"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  ExternalLink, Loader2, Play, Radar, RefreshCw, Search, Target, TrendingUp, X,
} from "lucide-react";
import { ToolAlert, ToolEmptyState, ToolLoadingState, ToolPage, ToolPanel } from "@/components/dashboard/ToolPage";
import { useDialogFocus } from "@/hooks/useDialogFocus";

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
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<PositionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState<"all" | number | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [crawlConfirmOpen, setCrawlConfirmOpen] = useState(false);
  const requestId = useRef(0);
  const crawlDialogRef = useRef<HTMLDivElement>(null);
  const crawlConfirmRef = useRef<HTMLButtonElement>(null);
  const crawlTriggerRef = useRef<HTMLButtonElement>(null);

  useDialogFocus({
    open: crawlConfirmOpen,
    onClose: () => setCrawlConfirmOpen(false),
    containerRef: crawlDialogRef,
    initialFocusRef: crawlConfirmRef,
    returnFocusRef: crawlTriggerRef,
    lockScroll: true,
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setMessage((current) => current?.type === "error" ? null : current);
    const params = new URLSearchParams({
      days: String(days), page: String(page), limit: String(pageSize), filter, sort, direction,
    });
    if (selectedSiteId) params.set("site_id", String(selectedSiteId));
    if (keywordSearch.trim()) params.set("search", keywordSearch.trim());
    try {
      const response = await fetch(`/api/position-crawl?${params}`, { signal, cache: "no-store" });
      const payload = await response.json() as PositionResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error || `Lecture impossible (HTTP ${response.status})`);
      if (currentRequest !== requestId.current) return;
      setData(payload);
      if (selectedSiteId === null) {
        const initialSite = payload.sites.find((site) => site.keyword_count > 0) ?? payload.sites[0];
        if (initialSite) setSelectedSiteId(initialSite.id);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (currentRequest !== requestId.current) return;
      setMessage({ type: "error", text: reason instanceof Error ? reason.message : "Lecture des positions impossible" });
    } finally {
      if (currentRequest === requestId.current && !signal?.aborted) setLoading(false);
    }
  }, [days, direction, filter, keywordSearch, page, pageSize, selectedSiteId, sort]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 200);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  const runCrawl = async (siteId: number | null) => {
    setCrawling(siteId ?? "all");
    setMessage(siteId ? null : {
      type: "ok",
      text: `Crawl du portfolio en cours : ${formatNumber(data?.summary.total_sites ?? 0)} domaines au maximum, avec deux traitements simultanés. Le bilan apparaîtra à la fin.`,
    });
    const params = new URLSearchParams({ days: "45", concurrency: "2" });
    if (siteId) params.set("site_id", String(siteId));
    try {
      const response = await fetch(`/api/position-crawl?${params}`, { method: "POST" });
      const payload = await response.json() as { success?: boolean; error?: string; successful_sites?: number; total_keywords?: number };
      if (!response.ok || !payload.success) throw new Error(payload.error || `Le crawl a échoué (HTTP ${response.status})`);
      setMessage({
        type: "ok",
        text: siteId
          ? `Crawl terminé : ${formatNumber(payload.total_keywords ?? 0)} mots-clés consolidés.`
          : `Portfolio actualisé : ${formatNumber(payload.successful_sites ?? 0)} domaines traités et ${formatNumber(payload.total_keywords ?? 0)} mots-clés consolidés.`,
      });
      await load();
    } catch (reason) {
      setMessage({ type: "error", text: reason instanceof Error ? reason.message : "Le crawl a échoué" });
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
  const initialLoading = loading && data === null;
  const detailLoading = loading && selectedSiteId !== null;

  const selectSite = (id: number) => {
    setSelectedSiteId(id);
    setKeywordSearch("");
    setFilter("all");
    setPage(1);
  };

  const actions = (
    <>
      <select
        aria-label="Période GSC"
        value={days}
        onChange={(event) => { setDays(Number(event.target.value)); setPage(1); }}
        className="h-11 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value={7}>7 jours</option>
        <option value={30}>30 jours</option>
        <option value={45}>45 jours</option>
        <option value={90}>90 jours</option>
      </select>
      <button type="button" onClick={() => void load()} disabled={loading || crawling !== null} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-50" aria-label="Rafraîchir les données affichées">
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
      </button>
      <button ref={crawlTriggerRef} type="button" onClick={() => setCrawlConfirmOpen(true)} disabled={crawling !== null || loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 text-sm font-semibold text-blue-100 hover:bg-blue-500/20 disabled:cursor-wait disabled:opacity-60">
        {crawling === "all" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        Crawler le portfolio
      </button>
    </>
  );

  return (
    <ToolPage
      title="Positions et mots-clés par domaine"
      eyebrow="Mesure Google Search Console"
      description="Positions moyennes pondérées par impressions et arrêtées à la dernière date importée. Les mots-clés suivis non observés dans GSC restent séparés des requêtes réellement mesurées."
      icon={Radar}
      actions={actions}
    >
      {message && (
        <ToolAlert tone={message.type === "ok" ? "success" : "error"}>{message.text}</ToolAlert>
      )}

      {initialLoading ? (
        <ToolLoadingState title="Chargement du portfolio" description="Lecture des domaines, de la fraîcheur GSC et des derniers crawls." rows={5} />
      ) : (
        <>
          <section aria-label="Résumé des positions" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Domaines", data?.summary.total_sites],
              ["Requêtes GSC", data?.summary.total_keywords],
              ["Top 10", data?.summary.top_10],
              ["Impressions", data?.summary.impressions],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-white">{typeof value === "number" ? formatNumber(value) : "—"}</div>
              </div>
            ))}
          </section>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicateurs secondaires">
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{formatNumber(data?.summary.fresh_sites ?? 0)}</strong> domaines à jour</div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{formatNumber(data?.summary.tracked_keywords ?? 0)}</strong> mots-clés suivis</div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{formatNumber(data?.summary.tracked_with_gsc ?? 0)}</strong> suivis observés dans GSC</div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300"><strong className="tabular-nums text-white">{data?.summary.avg_position?.toFixed(1) ?? "—"}</strong> position pondérée</div>
          </div>

          <ToolPanel className="p-4 xl:hidden" labelledBy="mobile-domain-title">
            <label id="mobile-domain-title" htmlFor="mobile-position-domain" className="mb-2 block text-sm font-medium text-white">Domaine analysé</label>
            <select
              id="mobile-position-domain"
              value={selectedSiteId ?? ""}
              onChange={(event) => selectSite(Number(event.target.value))}
              className="h-12 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-white outline-none focus:ring-2 focus:ring-blue-400"
            >
              {(data?.sites ?? []).map((site) => <option key={site.id} value={site.id}>{site.name} · {STATUS[site.data_status].label}</option>)}
            </select>
          </ToolPanel>

          <div className="grid min-h-[36rem] gap-4 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.8fr)]">
            <ToolPanel className="hidden min-w-0 xl:block" labelledBy="domains-title">
              <div className="border-b border-slate-800 p-4">
                <h2 id="domains-title" className="font-semibold text-white">Domaines</h2>
                <label className="relative mt-3 block">
                  <span className="sr-only">Rechercher un domaine</span>
                  <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" />
                  <input value={domainSearch} onChange={(event) => setDomainSearch(event.target.value)} placeholder="Rechercher un domaine" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-400" />
                </label>
              </div>
              <div className="max-h-[70vh] space-y-2 overflow-y-auto p-3">
                {sites.map((site) => (
                  <button data-testid="position-domain" key={site.id} type="button" onClick={() => selectSite(site.id)} aria-pressed={selectedSiteId === site.id} className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${selectedSiteId === site.id ? "border-blue-500/50 bg-blue-500/10" : "border-slate-800 bg-slate-950/60 hover:border-slate-700"}`}>
                    <div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-100">{site.name}</span><StatusBadge status={site.data_status} /></div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><span className="block text-slate-500">GSC</span>{formatNumber(site.keyword_count)}</div><div><span className="block text-slate-500">Top 10</span>{formatNumber(site.top_10)}</div><div><span className="block text-slate-500">Position</span>{site.avg_position?.toFixed(1) ?? "—"}</div></div>
                    <div className="mt-2 text-[11px] text-slate-500">Dernières données : {site.latest_data_date ?? "jamais"}</div>
                  </button>
                ))}
                {sites.length === 0 && <div className="py-10 text-center text-sm text-slate-500">Aucun domaine trouvé.</div>}
              </div>
            </ToolPanel>

            <ToolPanel className="min-w-0" labelledBy="keywords-title">
              {!selectedSite ? (
                <ToolEmptyState icon={Target} title="Aucun domaine sélectionné" description="Choisis un domaine pour afficher séparément ses requêtes GSC et ses mots-clés suivis." />
              ) : (
                <>
                  <div className="flex flex-col gap-4 border-b border-slate-800 p-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <h2 id="keywords-title" className="truncate text-lg font-semibold text-white">{selectedSite.name}</h2>
                      <a href={selectedSite.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 truncate text-xs text-blue-300 hover:text-blue-200">{selectedSite.url}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-blue-100">{formatNumber(selectedSite.keyword_count)} requêtes GSC</span>
                        <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300">{formatNumber(selectedSite.tracked_keywords)} suivis</span>
                        <span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-300">{formatNumber(selectedSite.tracked_with_gsc)} suivis observés</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => void runCrawl(selectedSite.id)} disabled={crawling !== null} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-4 text-sm font-medium text-blue-100 hover:bg-blue-500/20 disabled:opacity-50">
                      {crawling === selectedSite.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Target className="h-4 w-4" aria-hidden="true" />}
                      Crawler ce domaine
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 border-b border-slate-800 p-4">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les mots-clés">
                      {FILTERS.map((item) => <button key={item.value} type="button" onClick={() => { setFilter(item.value); setPage(1); }} aria-pressed={filter === item.value} className={`min-h-10 rounded-lg border px-3 text-xs font-medium ${filter === item.value ? "border-blue-500 bg-blue-600 text-white" : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"}`}>{item.label}</button>)}
                    </div>
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_10rem_8rem]">
                      <label className="relative"><span className="sr-only">Rechercher un mot-clé</span><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" aria-hidden="true" /><input value={keywordSearch} onChange={(event) => { setKeywordSearch(event.target.value); setPage(1); }} placeholder="Rechercher un mot-clé" className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-400" /></label>
                      <select aria-label="Trier les mots-clés" value={sort} onChange={(event) => { setSort(event.target.value as KeywordSort); setPage(1); }} className="h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"><option value="impressions">Impressions</option><option value="position">Position</option><option value="change">Évolution</option><option value="keyword">Mot-clé</option></select>
                      <button type="button" onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm hover:bg-slate-800">{direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}{direction === "asc" ? "Croissant" : "Décroissant"}</button>
                    </div>
                  </div>

                  {detailLoading && !keywords ? (
                    <div className="p-4"><ToolLoadingState title="Chargement des positions" description={`Lecture des requêtes de ${selectedSite.name}.`} rows={5} /></div>
                  ) : (
                    <>
                      <div className="divide-y divide-slate-800 md:hidden" role="list" aria-label="Positions des mots-clés">
                        {keywords?.rows.map((row) => {
                          const volume = importedVolume(row);
                          return (
                            <article key={`mobile-${row.row_source}-${row.keyword}`} role="listitem" className="p-4">
                              <div className="min-w-0">
                                <h3 className="break-words text-sm font-semibold leading-5 text-slate-100">{row.keyword}</h3>
                                <p className="mt-1 text-[11px] text-slate-500">{row.row_source === "tracked_only" ? "Suivi, non observé dans GSC" : row.market || "GSC"}</p>
                              </div>
                              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-slate-800 bg-slate-950/55 p-3 text-xs">
                                <div><dt className="text-slate-500">Position</dt><dd className="mt-1 font-semibold tabular-nums text-cyan-200">{row.current_position?.toFixed(1) ?? "—"}</dd></div>
                                <div><dt className="text-slate-500">Évolution</dt><dd className="mt-1">{row.position_change == null ? "—" : <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${row.position_change > 0 ? "text-emerald-300" : row.position_change < 0 ? "text-red-300" : "text-slate-400"}`}>{row.position_change > 0 ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : row.position_change < 0 ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : null}{row.position_change > 0 ? "+" : ""}{row.position_change.toFixed(1)}</span>}</dd></div>
                                <div><dt className="text-slate-500">Clics</dt><dd className="mt-1 font-medium tabular-nums text-white">{formatNumber(row.clicks)}</dd></div>
                                <div><dt className="text-slate-500">Impressions</dt><dd className="mt-1 font-medium tabular-nums text-white">{formatNumber(row.impressions)}</dd></div>
                                <div><dt className="text-slate-500">CTR</dt><dd className="mt-1 font-medium tabular-nums text-white">{row.ctr == null ? "—" : `${(row.ctr * 100).toFixed(1)} %`}</dd></div>
                                <div><dt className="text-slate-500">Volume importé</dt><dd className="mt-1 font-medium tabular-nums text-white">{volume == null ? "—" : formatNumber(volume)}</dd><span className="mt-1 block break-words text-[10px] text-slate-600">{row.volume_source ?? "Non importé"}</span></div>
                              </dl>
                            </article>
                          );
                        })}
                      </div>
                      <div className="hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[760px] text-sm">
                          <thead className="bg-slate-950/70 text-left text-xs text-slate-500"><tr><th className="px-4 py-3 font-medium">Mot-clé</th><th className="px-3 py-3 font-medium">Position</th><th className="px-3 py-3 font-medium">Évolution</th><th className="px-3 py-3 font-medium">Clics</th><th className="px-3 py-3 font-medium">Impressions</th><th className="px-3 py-3 font-medium">CTR</th><th className="px-3 py-3 font-medium">Volume importé</th></tr></thead>
                          <tbody className="divide-y divide-slate-800">
                            {keywords?.rows.map((row) => {
                              const volume = importedVolume(row);
                              return <tr key={`${row.row_source}-${row.keyword}`} className="hover:bg-slate-800/40"><td className="px-4 py-3"><div className="max-w-[25rem] truncate font-medium text-slate-100" title={row.keyword}>{row.keyword}</div><div className="mt-1 text-[11px] text-slate-500">{row.row_source === "tracked_only" ? "Suivi, non observé dans GSC" : row.market || "GSC"}</div></td><td className="px-3 py-3 font-semibold tabular-nums text-cyan-200">{row.current_position?.toFixed(1) ?? "—"}</td><td className="px-3 py-3">{row.position_change == null ? "—" : <span className={`inline-flex items-center gap-1 tabular-nums ${row.position_change > 0 ? "text-emerald-300" : row.position_change < 0 ? "text-red-300" : "text-slate-400"}`}>{row.position_change > 0 ? <TrendingUp className="h-3 w-3" /> : row.position_change < 0 ? <ArrowDown className="h-3 w-3" /> : null}{row.position_change > 0 ? "+" : ""}{row.position_change.toFixed(1)}</span>}</td><td className="px-3 py-3 tabular-nums">{formatNumber(row.clicks)}</td><td className="px-3 py-3 tabular-nums">{formatNumber(row.impressions)}</td><td className="px-3 py-3 tabular-nums">{row.ctr == null ? "—" : `${(row.ctr * 100).toFixed(1)} %`}</td><td className="px-3 py-3"><div className="tabular-nums">{volume == null ? "—" : formatNumber(volume)}</div><div className="mt-1 max-w-32 truncate text-[10px] text-slate-500" title={row.volume_source ?? "Non importé"}>{row.volume_source ?? "Non importé"}</div></td></tr>;
                            })}
                          </tbody>
                        </table>
                      </div>
                      {!loading && keywords?.rows.length === 0 && <ToolEmptyState icon={Search} title="Aucun résultat pour ce filtre" description="Modifie le filtre, la recherche ou la période. Un mot-clé suivi non observé reste accessible via « Suivis non observés »." />}
                      <div className="flex flex-col gap-3 border-t border-slate-800 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-slate-500">{formatNumber(keywords?.total ?? 0)} résultat(s)</span>
                          <label className="flex items-center gap-2 text-xs text-slate-400">
                            Par page
                            <select
                              aria-label="Nombre de mots-clés par page"
                              value={pageSize}
                              onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
                              className="h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:ring-2 focus:ring-blue-400"
                            >
                              <option value={25}>25</option>
                              <option value={50}>50</option>
                              <option value={100}>100</option>
                            </select>
                          </label>
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:justify-end">
                          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 disabled:opacity-30" aria-label="Page précédente"><ArrowLeft className="h-4 w-4" /></button>
                          <span className="min-w-20 text-center tabular-nums">{page} / {Math.max(1, keywords?.pages ?? 1)}</span>
                          <button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= (keywords?.pages ?? 0) || loading} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-700 disabled:opacity-30" aria-label="Page suivante"><ArrowRight className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </ToolPanel>
          </div>
        </>
      )}

      {crawlConfirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setCrawlConfirmOpen(false); }}>
          <div ref={crawlDialogRef} role="dialog" aria-modal="true" aria-labelledby="crawl-confirm-title" aria-describedby="crawl-confirm-description" className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="crawl-confirm-title" className="text-lg font-semibold text-white">Actualiser tout le portfolio ?</h2>
                <p id="crawl-confirm-description" className="mt-2 text-sm leading-6 text-slate-400">Cette opération interroge Google Search Console puis consolide les positions et mots-clés de chaque domaine configuré. Elle peut durer plusieurs minutes.</p>
              </div>
              <button type="button" onClick={() => setCrawlConfirmOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800" aria-label="Annuler et fermer"><X className="h-4 w-4" /></button>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3"><dt className="text-xs text-slate-500">Domaines au maximum</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-white">{data?.summary.total_sites ?? 0}</dd></div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3"><dt className="text-xs text-slate-500">Déjà à jour</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-white">{data?.summary.fresh_sites ?? 0}</dd></div>
            </dl>
            <ToolAlert tone="info"><strong>Aucune publication n’est déclenchée.</strong> Seules les données de mesure du dashboard sont actualisées.</ToolAlert>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setCrawlConfirmOpen(false)} className="min-h-11 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-200 hover:bg-slate-800">Annuler</button>
              <button ref={crawlConfirmRef} type="button" onClick={() => { setCrawlConfirmOpen(false); void runCrawl(null); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500"><Play className="h-4 w-4" aria-hidden="true" />Démarrer le crawl</button>
            </div>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
