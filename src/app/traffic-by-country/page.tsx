"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, RefreshCw, Globe, AlertTriangle, Info, ExternalLink, Users,
} from "lucide-react";
import { getApiErrorMessage, isRecord } from "@/lib/api-response";

type Window = "7d" | "28d" | "90d";

interface CountryMetrics { country: string; users: number; sessions: number; pageviews: number; engagement_rate: number }

interface TopPage { page: string; users: number; sessions: number }
interface TopSource { channel: string; users: number; sessions: number }
interface SiteTraffic {
  site_id: number; site_name: string; site_url: string; ga_property_id: string | null;
  window: Window; window_days: number;
  primary_market: { iso3: string; ga4_name: string; metrics: CountryMetrics | null };
  usa: CountryMetrics | null;
  global: CountryMetrics;
  top_countries: CountryMetrics[]; top_pages: TopPage[]; top_sources: TopSource[];
  per_day: { users: number; sessions: number; pageviews: number };
  warnings: string[]; error: string | null; fetched_at: string;
}

interface Summary {
  sites_count: number; requested_sites: number; failed_sites: number;
  total_users: number; avg_users_per_day: number;
  top_3: { site: string; users: number; per_day: number }[];
  bottom_3: { site: string; users: number; per_day: number }[];
  window: Window; window_days: number;
}

interface ApiSuccess { success: true; partial: boolean; status: "complete" | "partial"; summary: Summary; sites: SiteTraffic[] }
interface ApiFailure {
  success: false; partial?: false; status?: "not_configured" | "unavailable";
  summary?: Summary; sites?: SiteTraffic[]; error: string;
}
type ApiResponse = ApiSuccess | ApiFailure;
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isWindow(value: unknown): value is Window { return value === "7d" || value === "28d" || value === "90d"; }
function isStringList(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function isMetrics(value: unknown): value is CountryMetrics {
  return isRecord(value) && typeof value.country === "string"
    && [value.users, value.sessions, value.pageviews, value.engagement_rate].every(isFiniteNumber);
}
function isTopPage(value: unknown): value is TopPage {
  return isRecord(value) && typeof value.page === "string" && [value.users, value.sessions].every(isFiniteNumber);
}
function isTopSource(value: unknown): value is TopSource {
  return isRecord(value) && typeof value.channel === "string" && [value.users, value.sessions].every(isFiniteNumber);
}
function isSiteTraffic(value: unknown): value is SiteTraffic {
  return isRecord(value) && isFiniteNumber(value.site_id)
    && [value.site_name, value.site_url].every((item) => typeof item === "string")
    && typeof value.fetched_at === "string" && !Number.isNaN(Date.parse(value.fetched_at))
    && (value.ga_property_id === null || typeof value.ga_property_id === "string")
    && isWindow(value.window) && isFiniteNumber(value.window_days)
    && isRecord(value.primary_market) && typeof value.primary_market.iso3 === "string"
    && typeof value.primary_market.ga4_name === "string"
    && (value.primary_market.metrics === null || isMetrics(value.primary_market.metrics))
    && (value.usa === null || isMetrics(value.usa)) && isMetrics(value.global)
    && Array.isArray(value.top_countries) && value.top_countries.every(isMetrics)
    && Array.isArray(value.top_pages) && value.top_pages.every(isTopPage)
    && Array.isArray(value.top_sources) && value.top_sources.every(isTopSource)
    && isRecord(value.per_day) && [value.per_day.users, value.per_day.sessions, value.per_day.pageviews].every(isFiniteNumber)
    && isStringList(value.warnings) && (value.error === null || (typeof value.error === "string" && value.error.trim().length > 0));
}
function isSummary(value: unknown): value is Summary {
  const isRanked = (item: unknown) => isRecord(item) && typeof item.site === "string" && [item.users, item.per_day].every(isFiniteNumber);
  return isRecord(value)
    && [value.sites_count, value.requested_sites, value.failed_sites, value.total_users, value.avg_users_per_day, value.window_days].every(isFiniteNumber)
    && isWindow(value.window) && Array.isArray(value.top_3) && value.top_3.every(isRanked)
    && Array.isArray(value.bottom_3) && value.bottom_3.every(isRanked);
}
function hasConsistentCounts(summary: Summary, sites: SiteTraffic[]): boolean {
  const measured = sites.filter((site) => site.error === null);
  const failed = sites.filter((site) => site.error !== null);
  const rankings = [...summary.top_3, ...summary.bottom_3];
  return summary.requested_sites === sites.length && summary.sites_count === measured.length
    && summary.failed_sites === failed.length
    && sites.every((site) => site.window === summary.window && site.window_days === summary.window_days)
    && summary.total_users === measured.reduce((total, site) => total + site.global.users, 0)
    && summary.avg_users_per_day === measured.reduce((total, site) => total + site.per_day.users, 0)
    && rankings.every((rank) => measured.some((site) => site.site_name === rank.site && site.global.users === rank.users && site.per_day.users === rank.per_day));
}
function isApiResponse(value: unknown): value is ApiResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") return false;
  const sitesValid = value.sites === undefined || (Array.isArray(value.sites) && value.sites.every(isSiteTraffic));
  const summaryValid = value.summary === undefined || isSummary(value.summary);
  if (!sitesValid || !summaryValid) return false;
  if (value.success) return ((value.partial === false && value.status === "complete") || (value.partial === true && value.status === "partial"))
    && isSummary(value.summary) && value.partial === (value.summary.failed_sites > 0)
    && Array.isArray(value.sites) && hasConsistentCounts(value.summary, value.sites);
  return typeof value.error === "string" && value.error.trim().length > 0
    && (value.partial === undefined || value.partial === false)
    && (value.status === undefined || value.status === "not_configured" || value.status === "unavailable")
    && ((value.summary === undefined && value.sites === undefined)
      || (isSummary(value.summary) && Array.isArray(value.sites) && hasConsistentCounts(value.summary, value.sites)));
}

async function readTrafficResponse(response: Response): Promise<ApiResponse> {
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new Error(`Réponse GA4 invalide (JSON, HTTP ${response.status})`); }
  if (!isApiResponse(payload)) throw new Error(getApiErrorMessage(payload, "Réponse GA4 invalide"));
  if (!response.ok) {
    if (payload.success) throw new Error(`Réponse GA4 incohérente (HTTP ${response.status})`);
    return payload;
  }
  return payload;
}
const FLAGS: Record<string, string> = {
  FRA: "🇫🇷", CHE: "🇨🇭", BEL: "🇧🇪", CAN: "🇨🇦", USA: "🇺🇸",
};

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  if (n >= 1000) return n.toLocaleString("fr-FR");
  return Math.round(n).toString();
}

function fmtPerDay(n: number): string {
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function usersPerDayColor(perDay: number): string {
  if (perDay < 1) return "text-red-400";
  if (perDay < 5) return "text-yellow-400";
  return "text-emerald-400";
}

function usersPerDayBorder(perDay: number): string {
  if (perDay < 1) return "border-red-500/40";
  if (perDay < 5) return "border-yellow-500/40";
  return "border-emerald-500/40";
}

function MetricCell({
  label,
  users,
  sessions,
  perDayDivisor,
  hint,
  warn,
}: {
  label: string;
  users: number;
  sessions: number;
  perDayDivisor: number;
  hint?: string;
  warn?: boolean;
}) {
  const perDay = perDayDivisor > 0 ? users / perDayDivisor : 0;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-400">
        <span className="flex items-center gap-1">
          {label}
          {hint && (
            <span title={hint} className="cursor-help text-zinc-500">
              <Info className="h-3 w-3" />
            </span>
          )}
        </span>
        {warn && <AlertTriangle className="h-3 w-3 text-yellow-400" />}
      </div>
      <div className={`text-2xl font-bold ${usersPerDayColor(perDay)}`}>
        {fmtNum(users)} <span className="text-xs font-normal text-zinc-500">users</span>
      </div>
      <div className="text-xs text-zinc-500">
        {fmtPerDay(perDay)}/day · {fmtNum(sessions)} sessions
      </div>
    </div>
  );
}

function SiteCard({ site }: { site: SiteTraffic }) {
  const days = site.window_days;
  const perDay = site.per_day.users;
  const primaryFlag = FLAGS[site.primary_market.iso3];
  const borderColor = site.error ? "border-zinc-700" : usersPerDayBorder(perDay);
  return (
    <div className={`rounded-xl border-2 ${borderColor} bg-zinc-950/50 p-4 shadow`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-zinc-100">
            {primaryFlag ? (
              <span aria-hidden="true">{primaryFlag} </span>
            ) : (
              <Globe className="mr-1 inline h-4 w-4 text-zinc-400" aria-hidden="true" />
            )}
            {site.site_name}
          </div>
          <a
            href={site.site_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            {site.site_url} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="text-right text-xs text-zinc-500">
          GA4: {site.ga_property_id ?? "—"}
          <div>{site.window} window</div>
        </div>
      </div>

      {site.error ? (
        <div role="status" className="rounded-lg border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          Données GA4 indisponibles : {site.error}. Ce site n’est pas compté comme un zéro mesuré.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <MetricCell
              label={`Primary (${site.primary_market.ga4_name})`}
              users={site.primary_market.metrics?.users ?? 0}
              sessions={site.primary_market.metrics?.sessions ?? 0}
              perDayDivisor={days}
              hint="totalUsers ≠ eventCount. totalUsers is deduplicated humans for the period, eventCount is every gtag event fired."
            />
            <MetricCell
              label="USA"
              users={site.usa?.users ?? 0}
              sessions={site.usa?.sessions ?? 0}
              perDayDivisor={days}
              hint="GA4 totalUsers from US. Low engagement_rate (<30%) flagged as likely bots."
              warn={!!site.usa && site.usa.users >= 5 && site.usa.engagement_rate < 0.3}
            />
            <MetricCell
              label="Global (all countries)"
              users={site.global.users}
              sessions={site.global.sessions}
              perDayDivisor={days}
              hint="Sum of all countries — single GA4 query, no dimension."
            />
          </div>

          {site.warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-yellow-700 bg-yellow-950/30 px-3 py-2 text-xs text-yellow-200">
              {site.warnings.map((w, i) => (
                <div key={i}>
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  {w}
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Top 5 landing pages
              </div>
              {site.top_pages.length === 0 ? (
                <div className="text-xs text-zinc-500">—</div>
              ) : (
                <ul className="space-y-1 text-xs">
                  {site.top_pages.map((p, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-zinc-300" title={p.page}>{p.page || "/"}</span>
                      <span className="shrink-0 text-zinc-400">{fmtNum(p.users)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Top 5 sources (channel groups)
              </div>
              {site.top_sources.length === 0 ? (
                <div className="text-xs text-zinc-500">—</div>
              ) : (
                <ul className="space-y-1 text-xs">
                  {site.top_sources.map((s, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-zinc-300">{s.channel || "(unknown)"}</span>
                      <span className="shrink-0 text-zinc-400">{fmtNum(s.users)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
              All countries ({site.top_countries.length})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="text-left">Country</th>
                    <th className="text-right">Users</th>
                    <th className="text-right">Sessions</th>
                    <th className="text-right">Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {site.top_countries.map((c, i) => (
                    <tr key={i} className="border-t border-zinc-800/60">
                      <td className="py-1 text-zinc-300">{c.country}</td>
                      <td className="py-1 text-right text-zinc-200">{fmtNum(c.users)}</td>
                      <td className="py-1 text-right text-zinc-400">{fmtNum(c.sessions)}</td>
                      <td className={`py-1 text-right ${c.engagement_rate < 0.3 ? "text-yellow-400" : "text-zinc-400"}`}>
                        {(c.engagement_rate * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

export default function TrafficByCountryPage() {
  const [windowKey, setWindowKey] = useState<Window>("28d");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setData(null);
    setLastLoadedAt(null);
    let timeout: number | undefined;
    try {
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 65000);
      const res = await fetch(`/api/ga4-traffic?window=${windowKey}`, { cache: "no-store", signal: controller.signal });
      const json = await readTrafficResponse(res);
      if (json.summary && json.summary.window !== windowKey) throw new Error("La fenêtre GA4 reçue ne correspond pas à la demande");
      setData(json);
      if (json.success) setLastLoadedAt(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    } catch (err) {
      setData({
        success: false,
        error: err instanceof Error && err.name === "AbortError"
          ? "Délai GA4 dépassé après 65 secondes. Essayez la fenêtre 7 jours ou rechargez."
          : err instanceof Error ? err.message : "Erreur réseau lors du chargement GA4",
      });
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [windowKey]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const sites = data?.sites ?? [];
  const summary = data?.success ? data.summary : undefined;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
            >
              <ArrowLeft className="h-3 w-3" /> Back to dashboard
            </Link>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold">
              <Users className="h-6 w-6 text-emerald-400" />
              Traffic by country — REAL visitors
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              <strong className="text-zinc-200">totalUsers</strong> (deduplicated humans) per site
              per country. <em>Not</em> eventCount (every gtag event = 5-10× inflation).{" "}
              <a
                href="https://support.google.com/analytics/answer/12959748"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 underline hover:text-emerald-300"
              >
                GA4 docs
              </a>
              .
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-800">
              {(["7d", "28d", "90d"] as Window[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setWindowKey(w)}
                  className={`px-3 py-1.5 text-xs font-medium transition ${
                    windowKey === w ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
            <button
              onClick={() => void fetchData()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </button>
          </div>
        </div>
        {lastLoadedAt && (
          <div className="mb-3 text-xs text-zinc-500">Dernière mise à jour locale: {lastLoadedAt}</div>
        )}

        {loading && (
          <div className="flex h-64 items-center justify-center text-zinc-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Interrogation des propriétés GA4…
          </div>
        )}

        {data && !data.success && (
          <div role="alert" className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            Données GA4 indisponibles : {data.error}. Aucune propriété indisponible n’est comptée comme un zéro mesuré.
          </div>
        )}

        {summary && summary.failed_sites > 0 && (
          <div role="status" className="mb-4 rounded-lg border border-yellow-700 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-200">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            Résultat partiel : {summary.failed_sites} site{summary.failed_sites > 1 ? "s" : ""} GA4 indisponible{summary.failed_sites > 1 ? "s" : ""}. Les totaux couvrent uniquement {summary.sites_count} site{summary.sites_count > 1 ? "s" : ""} mesuré{summary.sites_count > 1 ? "s" : ""} sur {summary.requested_sites} demandé{summary.requested_sites > 1 ? "s" : ""}.
          </div>
        )}

        {summary && (
          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-400">Portfolio total ({summary.window})</div>
              <div className="mt-1 text-3xl font-bold text-emerald-400">
                {fmtNum(summary.total_users)}
              </div>
              <div className="text-xs text-zinc-500">
                {fmtPerDay(summary.avg_users_per_day)} utilisateurs/jour sur {summary.sites_count} site{summary.sites_count > 1 ? "s" : ""} mesuré{summary.sites_count > 1 ? "s" : ""} parmi {summary.requested_sites}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-400">Top 3 sites by users</div>
              <ul className="mt-1 space-y-1 text-sm">
                {summary.top_3.map((t, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-zinc-200">{i + 1}. {t.site}</span>
                    <span className="shrink-0 text-emerald-400">{fmtNum(t.users)} ({fmtPerDay(t.per_day)}/d)</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-400">Problem zones (bottom 3)</div>
              <ul className="mt-1 space-y-1 text-sm">
                {summary.bottom_3.map((t, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-zinc-200">{t.site}</span>
                    <span className="shrink-0 text-red-400">{fmtNum(t.users)} ({fmtPerDay(t.per_day)}/d)</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {data?.success && sites.length > 0 && <div className="mb-3 rounded-lg border border-blue-700/50 bg-blue-950/30 px-3 py-2 text-xs text-blue-200">
          <Globe className="mr-1 inline h-3 w-3" />
          Color code: <span className="text-red-400">red &lt; 1 user/day</span> ·{" "}
          <span className="text-yellow-400">yellow 1-5/day</span> ·{" "}
          <span className="text-emerald-400">green &gt; 5/day</span>. Bot warning = ≥5 USA users with engagement_rate &lt; 30%.
        </div>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sites.map((s) => (
            <SiteCard key={s.site_id} site={s} />
          ))}
        </div>
        {data?.success && sites.length === 0 && !loading && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-400">
            Aucun site GA4 exploitable pour cette fenêtre.
          </div>
        )}
      </div>
    </main>
  );
}
