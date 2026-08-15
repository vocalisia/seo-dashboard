"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, ArrowLeftRight, TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";

interface Site { id: number; name: string; }

interface SiteStats {
  name: string;
  clicks: number;
  impressions: number;
  avg_position: number;
  sessions: number;
  users: number;
  articles: number;
  top_keywords: string[];
}

interface CompareData {
  success: true;
  site_a: SiteStats;
  site_b: SiteStats;
  methodology?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getApiError(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const key of ["error", "message"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(`réponse JSON illisible (HTTP ${response.status})`);
  }
}

function parseSites(payload: unknown): Site[] {
  if (isRecord(payload) && "success" in payload && payload.success !== true) {
    throw new Error(getApiError(payload) ?? "le contrat success de l’API a échoué");
  }
  const candidate = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.sites)
      ? payload.sites
      : null;
  if (!candidate || !candidate.every((site) => (
    isRecord(site)
    && typeof site.id === "number"
    && typeof site.name === "string"
  ))) {
    throw new Error("contrat API invalide : liste de sites absente ou mal formée");
  }
  return candidate as Site[];
}

function isSiteStats(value: unknown): value is SiteStats {
  return isRecord(value)
    && typeof value.name === "string"
    && typeof value.clicks === "number"
    && typeof value.impressions === "number"
    && typeof value.avg_position === "number"
    && typeof value.sessions === "number"
    && typeof value.users === "number"
    && typeof value.articles === "number"
    && Array.isArray(value.top_keywords)
    && value.top_keywords.every((keyword) => typeof keyword === "string");
}

function parseComparison(payload: unknown): CompareData {
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error(getApiError(payload) ?? "le contrat success de l’API a échoué");
  }
  if (!isSiteStats(payload.site_a) || !isSiteStats(payload.site_b)) {
    throw new Error("contrat API invalide : statistiques de comparaison absentes ou mal formées");
  }
  return payload as unknown as CompareData;
}

function actionableError(action: string, reason: unknown, retained: boolean): string {
  const detail = reason instanceof Error && reason.message.trim()
    ? ` Détail : ${reason.message.trim()}.`
    : "";
  const preservation = retained
    ? " La comparaison précédemment chargée reste affichée."
    : "";
  return `${action} impossible. Réessaie ; si le problème persiste, vérifie ta session et l’API.${preservation}${detail}`;
}

function StatRow({ label, valA, valB, inverted = false, format = "number" }: {
  label: string; valA: number; valB: number; inverted?: boolean; format?: string;
}) {
  const fmtA = format === "decimal" ? valA.toFixed(1) : valA.toLocaleString();
  const fmtB = format === "decimal" ? valB.toFixed(1) : valB.toLocaleString();
  const betterA = inverted ? valA < valB : valA > valB;
  const betterB = inverted ? valB < valA : valB > valA;

  return (
    <div className="grid grid-cols-[1fr_100px_80px_100px_1fr] items-center py-3 border-b border-gray-800/50">
      <div className={`text-right text-sm font-semibold ${betterA ? "text-emerald-400" : "text-white"}`}>
        {fmtA}
      </div>
      <div className="text-center">
        {betterA ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mx-auto" /> :
         betterB ? <TrendingDown className="w-3.5 h-3.5 text-red-400 mx-auto" /> :
         <span className="text-gray-600">—</span>}
      </div>
      <div className="text-center text-xs text-gray-400 font-medium">{label}</div>
      <div className="text-center">
        {betterB ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mx-auto" /> :
         betterA ? <TrendingDown className="w-3.5 h-3.5 text-red-400 mx-auto" /> :
         <span className="text-gray-600">—</span>}
      </div>
      <div className={`text-left text-sm font-semibold ${betterB ? "text-emerald-400" : "text-white"}`}>
        {fmtB}
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteA, setSiteA] = useState<number | null>(null);
  const [siteB, setSiteB] = useState<number | null>(null);
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const compareRequestId = useRef(0);
  const sitesRef = useRef<Site[]>([]);

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/sites");
      const payload = await readJson(res);
      if (!res.ok) {
        throw new Error(getApiError(payload) ?? `HTTP ${res.status}`);
      }
      const list = parseSites(payload);
      sitesRef.current = list;
      setSites(list);
      setSitesLoaded(true);
      setSitesError(null);
      if (list.length >= 2) {
        setSiteA((current) => current ?? list[0].id);
        setSiteB((current) => current ?? list[1].id);
      }
    } catch (reason) {
      setSitesError(actionableError("Chargement des sites", reason, sitesRef.current.length > 0));
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { void fetchSites(); }, 0);
    return () => clearTimeout(id);
  }, [fetchSites]);

  async function compare() {
    if (!siteA || !siteB) return;
    const requestId = ++compareRequestId.current;
    const requestedSiteA = siteA;
    const requestedSiteB = siteB;
    setLoading(true);
    setCompareError(null);
    try {
      const res = await fetch(`/api/compare?site_a=${requestedSiteA}&site_b=${requestedSiteB}`);
      const payload = await readJson(res);
      if (!res.ok) {
        throw new Error(getApiError(payload) ?? `HTTP ${res.status}`);
      }
      const nextData = parseComparison(payload);
      if (requestId !== compareRequestId.current) return;
      setData(nextData);
    } catch (reason) {
      if (requestId === compareRequestId.current) {
        setCompareError(actionableError("Comparaison", reason, data !== null));
      }
    } finally {
      if (requestId === compareRequestId.current) setLoading(false);
    }
  }

  function selectSite(setter: (value: number) => void, value: string) {
    compareRequestId.current += 1;
    setLoading(false);
    setCompareError(null);
    setter(parseInt(value, 10));
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-gray-400 hover:text-gray-100">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <ArrowLeftRight className="w-5 h-5 text-pink-400" />
        <h1 className="text-xl font-semibold">Comparer 2 Sites</h1>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {sitesError && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-xl px-5 py-4 text-sm text-red-300">
            {sitesError}
          </div>
        )}
        {compareError && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-xl px-5 py-4 text-sm text-red-300">
            {compareError}
          </div>
        )}
        {sitesLoaded && sites.length < 2 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 text-sm text-gray-400">
            Tu dois avoir au moins 2 sites pour comparer. Ajoute-en via{" "}
            <Link href="/dashboard" className="text-blue-400 hover:text-blue-300 underline">Dashboard</Link>.
          </div>
        )}
        {/* Selectors */}
        <div className="flex items-center gap-4 justify-center">
          <select aria-label="Premier site à comparer" value={siteA ?? ""} onChange={(e) => selectSite(setSiteA, e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-52">
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <ArrowLeftRight className="w-5 h-5 text-gray-500" />
          <select aria-label="Second site à comparer" value={siteB ?? ""} onChange={(e) => selectSite(setSiteB, e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-52">
            {sites.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button onClick={compare} disabled={loading || !siteA || !siteB}
            className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 rounded-lg text-sm font-medium flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            Comparer
          </button>
        </div>

        {data && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <p className="mb-4 rounded-lg border border-blue-800/50 bg-blue-950/20 p-3 text-xs text-blue-100">{data.methodology ?? "Positions Google Search Console pondérées par impressions sur 30 jours."}</p>
            {/* Headers */}
            <div className="grid grid-cols-[1fr_100px_80px_100px_1fr] items-center pb-4 border-b border-gray-700 mb-2">
              <div className="text-right text-lg font-bold text-white">{data.site_a.name}</div>
              <div />
              <div className="text-center text-xs text-gray-500">VS</div>
              <div />
              <div className="text-left text-lg font-bold text-white">{data.site_b.name}</div>
            </div>

            <StatRow label="Clics" valA={data.site_a.clicks} valB={data.site_b.clicks} />
            <StatRow label="Impr." valA={data.site_a.impressions} valB={data.site_b.impressions} />
            <StatRow label="Position GSC pondérée" valA={data.site_a.avg_position} valB={data.site_b.avg_position} inverted format="decimal" />
            <StatRow label="Sessions" valA={data.site_a.sessions} valB={data.site_b.sessions} />
            <StatRow label="Users" valA={data.site_a.users} valB={data.site_b.users} />
            <StatRow label="Articles" valA={data.site_a.articles} valB={data.site_b.articles} />

            {/* Top keywords comparison */}
            <div className="grid grid-cols-2 gap-6 mt-6 pt-4 border-t border-gray-700">
              <div>
                <div className="text-xs text-gray-400 mb-2 font-medium">Top mots-clés — {data.site_a.name}</div>
                <div className="space-y-1">
                  {data.site_a.top_keywords.map((kw, i) => (
                    <div key={i} className="text-xs text-gray-300 bg-gray-800/50 rounded px-2 py-1">{kw}</div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-2 font-medium">Top mots-clés — {data.site_b.name}</div>
                <div className="space-y-1">
                  {data.site_b.top_keywords.map((kw, i) => (
                    <div key={i} className="text-xs text-gray-300 bg-gray-800/50 rounded px-2 py-1">{kw}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
