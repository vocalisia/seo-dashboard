"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, Shield, BarChart3, ExternalLink, GraduationCap } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; url: string; }

interface AcademicMention {
  id: number;
  site_id: number;
  source_url: string | null;
  title: string;
  authors: string[] | null;
  year: number | null;
  doi: string | null;
  cited_by_count: number;
  source_type: string | null;
  source_domain: string | null;
  scanned_at: string;
}

interface AcademicStats { total: number; edu_gov: number; total_citations: number; }

interface AuthorityData {
  success: true;
  score_kind?: "heuristic";
  methodology?: string;
  scores_ui: { coverage: number; authority: number; content: number; overall: number };
  stats_ui: { queries: number; avg_position: number; clicks: number; articles: number; clusters: number };
}

interface AcademicScanSummary {
  site_id: number;
  site: string;
  works_found: number;
  inserted: number;
  edu_gov_count: number;
}

interface ScanNotice {
  tone: "success" | "info" | "warning";
  message: string;
}

type UnknownRecord = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getApiError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  for (const key of ["error", "message", "detail"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

async function fetchJson(
  input: string,
  label: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${label}: réponse JSON illisible (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(`${label}: ${getApiError(payload, `échec HTTP ${response.status}`)}.`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${label}: délai dépassé après ${Math.round(timeoutMs / 1000)} secondes.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function requireSuccessfulPayload(payload: unknown, label: string): UnknownRecord {
  if (!isRecord(payload)) throw new Error(`${label}: format de réponse invalide.`);
  if (payload.success !== true) {
    throw new Error(`${label}: ${getApiError(payload, "succès API non confirmé")}.`);
  }
  return payload;
}

function parseSites(payload: unknown): Site[] {
  if (!Array.isArray(payload)) throw new Error("Chargement des sites: liste absente.");
  return payload.map((item, index) => {
    if (
      !isRecord(item)
      || !isFiniteNumber(item.id)
      || typeof item.name !== "string"
      || typeof item.url !== "string"
    ) {
      throw new Error(`Chargement des sites: entrée ${index + 1} invalide.`);
    }
    return { id: item.id, name: item.name, url: item.url };
  });
}

function readNumber(source: UnknownRecord, keys: string[], label: string): number {
  for (const key of keys) {
    if (isFiniteNumber(source[key])) return source[key];
  }
  throw new Error(`${label}: valeur numérique absente.`);
}

function parseAuthorityData(payload: unknown): AuthorityData {
  const root = requireSuccessfulPayload(payload, "Chargement de l’autorité topique");
  const scores = isRecord(root.scores_ui) ? root.scores_ui : isRecord(root.scores) ? root.scores : null;
  const stats = isRecord(root.stats_ui) ? root.stats_ui : isRecord(root.stats) ? root.stats : null;
  if (!scores || !stats) throw new Error("Chargement de l’autorité topique: scores ou statistiques absents.");

  const normalizedScores = {
    coverage: readNumber(scores, ["coverage", "coverage_score"], "Score couverture"),
    authority: readNumber(scores, ["authority", "authority_score"], "Score visibilité"),
    content: readNumber(scores, ["content", "content_score"], "Score contenu"),
    overall: readNumber(scores, ["overall", "overall_score"], "Score global"),
  };
  if (Object.values(normalizedScores).some((value) => value < 0 || value > 100)) {
    throw new Error("Chargement de l’autorité topique: score hors plage 0–100.");
  }

  const normalizedStats = {
    queries: readNumber(stats, ["queries", "unique_queries"], "Requêtes"),
    avg_position: readNumber(stats, ["avg_position"], "Position GSC"),
    clicks: readNumber(stats, ["clicks", "total_clicks"], "Clics"),
    articles: readNumber(stats, ["articles", "article_count"], "Contenus"),
    clusters: readNumber(stats, ["clusters", "cluster_count"], "Clusters"),
  };
  if (Object.values(normalizedStats).some((value) => value < 0)) {
    throw new Error("Chargement de l’autorité topique: statistique négative invalide.");
  }

  return {
    success: true,
    score_kind: root.score_kind === "heuristic" ? "heuristic" : undefined,
    methodology: typeof root.methodology === "string" ? root.methodology : undefined,
    scores_ui: normalizedScores,
    stats_ui: normalizedStats,
  };
}

function parseAcademicMentions(payload: unknown): { mentions: AcademicMention[]; stats: AcademicStats } {
  const root = requireSuccessfulPayload(payload, "Chargement des mentions académiques");
  if (!Array.isArray(root.mentions) || !isRecord(root.stats)) {
    throw new Error("Chargement des mentions académiques: contrat incomplet.");
  }

  const mentions = root.mentions.map((item, index) => {
    if (
      !isRecord(item)
      || !isFiniteNumber(item.id)
      || !isFiniteNumber(item.site_id)
      || (item.source_url !== null && typeof item.source_url !== "string")
      || typeof item.title !== "string"
      || (item.authors !== null && (!Array.isArray(item.authors) || item.authors.some((author) => typeof author !== "string")))
      || (item.year !== null && !isFiniteNumber(item.year))
      || (item.doi !== null && typeof item.doi !== "string")
      || !isFiniteNumber(item.cited_by_count)
      || (item.source_type !== null && typeof item.source_type !== "string")
      || (item.source_domain !== null && typeof item.source_domain !== "string")
      || typeof item.scanned_at !== "string"
    ) {
      throw new Error(`Mention académique ${index + 1}: contrat invalide.`);
    }
    return {
      id: item.id,
      site_id: item.site_id,
      source_url: item.source_url,
      title: item.title,
      authors: item.authors,
      year: item.year,
      doi: item.doi,
      cited_by_count: item.cited_by_count,
      source_type: item.source_type,
      source_domain: item.source_domain,
      scanned_at: item.scanned_at,
    };
  });

  const total = root.stats.total;
  const eduGov = root.stats.edu_gov;
  const totalCitations = root.stats.total_citations;
  if (!isFiniteNumber(total) || !isFiniteNumber(eduGov) || !isFiniteNumber(totalCitations)) {
    throw new Error("Chargement des mentions académiques: statistiques invalides.");
  }
  return { mentions, stats: { total, edu_gov: eduGov, total_citations: totalCitations } };
}

function parseAcademicScan(payload: unknown, siteId: number): AcademicScanSummary {
  const root = requireSuccessfulPayload(payload, "Scan OpenAlex");
  if (!Array.isArray(root.summary)) throw new Error("Scan OpenAlex: résumé absent.");
  const raw = root.summary.find((item) => isRecord(item) && item.site_id === siteId);
  if (
    !isRecord(raw)
    || !isFiniteNumber(raw.site_id)
    || typeof raw.site !== "string"
    || !isFiniteNumber(raw.works_found)
    || !isFiniteNumber(raw.inserted)
    || !isFiniteNumber(raw.edu_gov_count)
  ) {
    throw new Error("Scan OpenAlex: résultat du site absent ou invalide.");
  }
  return {
    site_id: raw.site_id,
    site: raw.site,
    works_found: raw.works_found,
    inserted: raw.inserted,
    edu_gov_count: raw.edu_gov_count,
  };
}

function actionableError(error: unknown, action: string): string {
  const message = error instanceof Error ? error.message : "Erreur inconnue.";
  return `${message} ${action} Les dernières données confirmées sont conservées.`;
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 rounded-xl border border-amber-800/50 bg-amber-950/30 px-5 py-3 text-sm text-amber-100">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="shrink-0 rounded border border-amber-700 px-3 py-1 text-xs hover:bg-amber-900/50">
        Réessayer
      </button>
    </div>
  );
}

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-[100px] h-[100px]">
        <svg width="100" height="100" className="transform -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#1f2937" strokeWidth="8" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-1000" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white">{Math.round(score)}</div>
      </div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}

export default function AuthorityPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState<number | "all" | null>(null);
  const [data, setData] = useState<AuthorityData | null>(null);
  const [dataSiteId, setDataSiteId] = useState<number | null>(null);
  const [loadingSites, setLoadingSites] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [allScores, setAllScores] = useState<{ site: string; overall: number; id: number }[]>([]);
  const [academicMentions, setAcademicMentions] = useState<AcademicMention[]>([]);
  const [academicStats, setAcademicStats] = useState<AcademicStats | null>(null);
  const [academicSiteId, setAcademicSiteId] = useState<number | null>(null);
  const [academicLoading, setAcademicLoading] = useState(false);
  const [academicScanning, setAcademicScanning] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const [allScoresError, setAllScoresError] = useState<string | null>(null);
  const [academicError, setAcademicError] = useState<string | null>(null);
  const [academicScanError, setAcademicScanError] = useState<string | null>(null);
  const [academicScanNotice, setAcademicScanNotice] = useState<ScanNotice | null>(null);
  const sitesRequest = useRef(0);
  const authorityRequest = useRef(0);
  const allScoresRequest = useRef(0);
  const academicRequest = useRef(0);
  const academicScanRequest = useRef(0);

  async function fetchAcademic(siteId: number): Promise<boolean> {
    const requestId = ++academicRequest.current;
    setAcademicLoading(true);
    setAcademicError(null);
    try {
      const payload = await fetchJson(
        `/api/eeat/academic-mentions?site_id=${siteId}&limit=20`,
        "Chargement des mentions académiques",
      );
      const result = parseAcademicMentions(payload);
      if (requestId !== academicRequest.current) return false;
      setAcademicMentions(result.mentions);
      setAcademicStats(result.stats);
      setAcademicSiteId(siteId);
      return true;
    } catch (error) {
      if (requestId !== academicRequest.current) return false;
      setAcademicError(actionableError(error, "Relance le chargement des mentions."));
      return false;
    } finally {
      if (requestId === academicRequest.current) setAcademicLoading(false);
    }
  }

  async function scanAcademic() {
    if (typeof selectedSite !== "number") return;
    const siteId = selectedSite;
    const requestId = ++academicScanRequest.current;
    setAcademicScanning(true);
    setAcademicScanError(null);
    setAcademicScanNotice(null);
    try {
      const payload = await fetchJson(
        `/api/eeat/academic-scan?site_id=${siteId}`,
        "Scan OpenAlex",
        { method: "POST" },
        300_000,
      );
      const summary = parseAcademicScan(payload, siteId);
      if (requestId !== academicScanRequest.current) return;
      const refreshed = await fetchAcademic(siteId);
      if (requestId !== academicScanRequest.current) return;
      if (!refreshed) {
        setAcademicScanNotice({
          tone: "warning",
          message: "Le scan est confirmé par l’API, mais le rechargement a échoué; les données précédentes restent affichées.",
        });
      } else if (summary.works_found > 0) {
        setAcademicScanNotice({
          tone: "success",
          message: `${summary.works_found} mention${summary.works_found > 1 ? "s" : ""} confirmée${summary.works_found > 1 ? "s" : ""} par la réponse OpenAlex; ${summary.inserted} nouvel enregistrement.`,
        });
      } else {
        setAcademicScanNotice({
          tone: "info",
          message: "Scan terminé selon l’API, mais aucune mention académique n’a été confirmée.",
        });
      }
    } catch (error) {
      if (requestId !== academicScanRequest.current) return;
      setAcademicScanError(actionableError(error, "Relance le scan OpenAlex."));
    } finally {
      if (requestId === academicScanRequest.current) setAcademicScanning(false);
    }
  }

  async function fetchAllScores(list: Site[]) {
    const requestId = ++allScoresRequest.current;
    setLoadingAll(true);
    setAllScoresError(null);
    try {
      if (list.length === 0) {
        if (requestId === allScoresRequest.current) setAllScores([]);
        return;
      }
      const results: { site: string; overall: number; id: number }[] = [];
      const failures: string[] = [];
      for (let i = 0; i < list.length; i += 4) {
        const chunk = list.slice(i, i + 4);
        const settled = await Promise.allSettled(
          chunk.map(async (site) => {
            const payload = await fetchJson(
              `/api/topical-authority?site_id=${site.id}`,
              `Classement de ${site.name}`,
            );
            const authority = parseAuthorityData(payload);
            return { site: site.name, overall: authority.scores_ui.overall, id: site.id };
          }),
        );
        settled.forEach((result, index) => {
          if (result.status === "fulfilled") results.push(result.value);
          else failures.push(chunk[index].name);
        });
        if (requestId !== allScoresRequest.current) return;
      }
      if (failures.length > 0) {
        throw new Error(`Classement incomplet: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? ` et ${failures.length - 3} autre${failures.length - 3 > 1 ? "s" : ""}` : ""}.`);
      }
      if (requestId === allScoresRequest.current) {
        setAllScores(results.sort((a, b) => b.overall - a.overall));
      }
    } catch (error) {
      if (requestId !== allScoresRequest.current) return;
      setAllScoresError(actionableError(error, "Relance le classement complet."));
    } finally {
      if (requestId === allScoresRequest.current) setLoadingAll(false);
    }
  }

  async function fetchSites() {
    const requestId = ++sitesRequest.current;
    setLoadingSites(true);
    setSitesError(null);
    try {
      const payload = await fetchJson("/api/sites", "Chargement des sites");
      const list = parseSites(payload);
      if (requestId !== sitesRequest.current) return;
      setSites(list);
      setSelectedSite((current) => {
        if (current === "all") return current;
        if (typeof current === "number" && list.some((site) => site.id === current)) return current;
        return list[0]?.id ?? "all";
      });
      void fetchAllScores(list);
    } catch (error) {
      if (requestId !== sitesRequest.current) return;
      setSitesError(actionableError(error, "Réessaie; si nécessaire, reconnecte-toi au dashboard."));
    } finally {
      if (requestId === sitesRequest.current) setLoadingSites(false);
    }
  }

  async function fetchAuthority(siteId: number) {
    const requestId = ++authorityRequest.current;
    setLoading(true);
    setAuthorityError(null);
    try {
      const payload = await fetchJson(
        `/api/topical-authority?site_id=${siteId}`,
        "Chargement de l’autorité topique",
      );
      const authority = parseAuthorityData(payload);
      if (requestId !== authorityRequest.current) return;
      setData(authority);
      setDataSiteId(siteId);
    } catch (error) {
      if (requestId !== authorityRequest.current) return;
      setAuthorityError(actionableError(error, "Relance le calcul de l’indice."));
    } finally {
      if (requestId === authorityRequest.current) setLoading(false);
    }
  }

  function handleSiteChange(value: string) {
    const nextSite = value === "all" ? "all" : value ? parseInt(value, 10) : null;
    academicScanRequest.current += 1;
    setSelectedSite(nextSite);
    setAcademicScanning(false);
    setAcademicScanError(null);
    setAcademicScanNotice(null);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchSites(); }, []);
  useEffect(() => {
    if (typeof selectedSite === "number") void fetchAuthority(selectedSite);
    else authorityRequest.current += 1;
  }, [selectedSite]);
  useEffect(() => {
    if (typeof selectedSite === "number") void fetchAcademic(selectedSite);
    else academicRequest.current += 1;
  }, [selectedSite]);

  const scoreColor = (s: number) => s >= 70 ? "#22c55e" : s >= 40 ? "#eab308" : "#ef4444";
  const selectedSiteName = sites.find((site) => site.id === selectedSite)?.name ?? "le site sélectionné";
  const dataSourceName = sites.find((site) => site.id === dataSiteId)?.name;
  const academicSourceName = sites.find((site) => site.id === academicSiteId)?.name;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Shield className="w-5 h-5 text-emerald-400" />
        <h1 className="text-xl font-semibold">Autorité Topique</h1>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <select
            aria-label="Site à analyser"
            value={selectedSite ?? ""}
            onChange={(e) => handleSiteChange(e.target.value)}
            disabled={loadingSites || sites.length === 0}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-64"
          >
            <option value="all">Tous les sites</option>
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          {(() => {
            const current = sites.find((s) => s.id === selectedSite);
            return current?.url ? (
              <a href={current.url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${current.url} dans un nouvel onglet`}
                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm">
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : null;
          })()}
          {loadingAll && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement classement...
            </div>
          )}
        </div>

        {sitesError && <ErrorNotice message={sitesError} onRetry={() => void fetchSites()} />}
        {allScoresError && <ErrorNotice message={allScoresError} onRetry={() => void fetchAllScores(sites)} />}

        {typeof selectedSite === "number" && (
          <>
            {authorityError && (
              <ErrorNotice
                message={`${authorityError}${dataSiteId !== null && dataSiteId !== selectedSite ? ` Données affichées: ${dataSourceName ?? `site ${dataSiteId}`}, pas ${selectedSiteName}.` : ""}`}
                onRetry={() => void fetchAuthority(selectedSite)}
              />
            )}
            {!authorityError && data && dataSiteId !== selectedSite && (
              <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 px-5 py-3 text-xs text-amber-100">
                Calcul de {selectedSiteName} en cours; les dernières données confirmées de {dataSourceName ?? `site ${dataSiteId}`} restent affichées.
              </div>
            )}
            {loading && !data ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
              </div>
            ) : data ? (
              <>
            {/* Score rings */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
              <div className="flex flex-wrap justify-center gap-8 lg:gap-12">
                <ScoreRing score={data.scores_ui.overall} label="Indice interne" color={scoreColor(data.scores_ui.overall)} />
                <ScoreRing score={data.scores_ui.coverage} label="Couverture" color={scoreColor(data.scores_ui.coverage)} />
                <ScoreRing score={data.scores_ui.authority} label="Visibilité GSC" color={scoreColor(data.scores_ui.authority)} />
                <ScoreRing score={data.scores_ui.content} label="Contenu" color={scoreColor(data.scores_ui.content)} />
              </div>
              <p className="mx-auto mt-6 max-w-4xl rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-center text-xs text-amber-100">
                {data.methodology ?? "Indice interne heuristique; il ne représente ni une métrique Google ni une autorité de domaine externe."}
                {" "}Les états publié, live vérifié et indexé restent distincts; cet indice ne confirme ni le live actuel ni l’indexation.
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">{data.stats_ui.queries}</div>
                <div className="text-xs text-gray-400">Requêtes uniques</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">{data.stats_ui.avg_position.toFixed(1)}</div>
                <div className="text-xs text-gray-400">Position GSC pondérée</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{data.stats_ui.clicks}</div>
                <div className="text-xs text-gray-400">Clics 30j</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-green-400">{data.stats_ui.articles}</div>
                <div className="text-xs text-gray-400">Contenus pris en compte</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-violet-400">{data.stats_ui.clusters}</div>
                <div className="text-xs text-gray-400">Clusters</div>
              </div>
            </div>

            {/* Mentions académiques (OpenAlex) */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
                  <GraduationCap className="w-4 h-4 text-violet-400" />
                  <h2 className="font-medium text-gray-200">Mentions académiques</h2>
                  {academicStats && (
                    <span className="text-xs text-gray-500">
                      {academicStats.total} mentions · {academicStats.edu_gov} .edu/.gov · {academicStats.total_citations} citations
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={scanAcademic}
                    disabled={academicScanning}
                    className="ml-auto px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg text-xs font-medium flex items-center gap-2"
                  >
                    {academicScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <GraduationCap className="w-3 h-3" />}
                    {academicScanning ? "Scan…" : "Scanner OpenAlex"}
                  </button>
                </div>
                {academicScanError && (
                  <div className="p-4 pb-0">
                    <ErrorNotice message={academicScanError} onRetry={() => void scanAcademic()} />
                  </div>
                )}
                {academicError && (
                  <div className="p-4 pb-0">
                    <ErrorNotice
                      message={`${academicError}${academicSiteId !== null && academicSiteId !== selectedSite ? ` Données affichées: ${academicSourceName ?? `site ${academicSiteId}`}, pas ${selectedSiteName}.` : ""}`}
                      onRetry={() => void fetchAcademic(selectedSite)}
                    />
                  </div>
                )}
                {academicScanNotice && (
                  <div
                    role="status"
                    className={`mx-4 mt-4 rounded-lg border px-4 py-3 text-xs ${
                      academicScanNotice.tone === "success"
                        ? "border-emerald-800/50 bg-emerald-950/30 text-emerald-100"
                        : academicScanNotice.tone === "warning"
                          ? "border-amber-800/50 bg-amber-950/30 text-amber-100"
                          : "border-blue-800/50 bg-blue-950/30 text-blue-100"
                    }`}
                  >
                    {academicScanNotice.message}
                  </div>
                )}
                {!academicError && academicMentions.length > 0 && academicSiteId !== selectedSite && (
                  <div className="mx-4 mt-4 rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-100">
                    Chargement de {selectedSiteName}; les dernières mentions confirmées de {academicSourceName ?? `site ${academicSiteId}`} restent affichées.
                  </div>
                )}
                <div className="p-4">
                  {academicLoading && academicMentions.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                    </div>
                  ) : academicMentions.length === 0 ? (
                    <div className="text-sm text-gray-500 text-center py-6">
                      {academicSiteId === selectedSite && !academicError
                        ? "Aucune mention académique confirmée pour ce site."
                        : "Aucune donnée académique confirmée n’a encore été chargée."}
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-800">
                      {academicMentions.map((m) => {
                        const isEduGov = /\.(edu|gov)(\.|$)/i.test(m.source_domain ?? "");
                        return (
                          <a
                            key={m.id}
                            href={m.source_url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block py-2.5 hover:bg-gray-800/40 -mx-4 px-4 transition-colors"
                          >
                            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                              {isEduGov && (
                                <span className="bg-emerald-900/40 text-emerald-300 px-1.5 py-0.5 rounded font-medium">
                                  {m.source_domain?.match(/\.(edu|gov)/i)?.[0] ?? ".edu"}
                                </span>
                              )}
                              {m.year && <span>{m.year}</span>}
                              <span className="text-violet-400">
                                {m.cited_by_count} citation{m.cited_by_count !== 1 ? "s" : ""}
                              </span>
                              {m.source_type && (
                                <span className="text-gray-500">{m.source_type}</span>
                              )}
                            </div>
                            <div className="text-sm text-white line-clamp-2">{m.title}</div>
                            {m.authors && m.authors.length > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                {m.authors.slice(0, 3).join(", ")}
                                {m.authors.length > 3 ? ` +${m.authors.length - 3}` : ""}
                              </div>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              </>
            ) : (
              !authorityError && (
                <div className="rounded-xl border border-gray-800 bg-gray-900 py-12 text-center text-sm text-gray-500">
                  Aucune donnée d’autorité confirmée n’a encore été chargée.
                </div>
              )
            )}
          </>
        )}

        {/* Ranking all sites */}
        {allScores.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-medium text-gray-200 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                Classement autorité topique ({allScores.length} sites vérifiés)
              </h2>
            </div>
            <div className="divide-y divide-gray-800">
              {allScores.map((s, i) => (
                <div
                  key={s.id}
                  className={`px-5 py-3 flex items-center gap-3 ${s.id === selectedSite ? "bg-emerald-900/10" : ""}`}
                >
                  <span className={`w-6 text-center font-bold ${i < 3 ? "text-yellow-400" : "text-gray-500"}`}>
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm text-white">{s.site}</span>
                  <div className="w-32 bg-gray-800 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${s.overall}%`, backgroundColor: scoreColor(s.overall) }}
                    />
                  </div>
                  <span className="text-sm font-semibold w-10 text-right" style={{ color: scoreColor(s.overall) }}>
                    {Math.round(s.overall)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loadingAll && !allScoresError && sites.length > 0 && allScores.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 py-8 text-center text-sm text-gray-500">
            Aucun classement confirmé n’est disponible.
          </div>
        )}
      </div>
    </div>
  );
}
