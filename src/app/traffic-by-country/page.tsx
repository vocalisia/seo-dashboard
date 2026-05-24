"use client";

/**
 * /traffic-by-country — REAL visitor metrics per site, broken down by country.
 *
 * Surfaces `totalUsers` (deduped humans) instead of `eventCount`. Prevents the
 * confusion that led the user to think vocalis.pro had 60/day USA when reality
 * is 7-8 humans.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, RefreshCw, Globe, AlertTriangle, Info, ExternalLink, Users,
} from "lucide-react";

type Window = "7d" | "28d" | "90d";

interface CountryMetrics {
  country: string;
  users: number;
  sessions: number;
  pageviews: number;
  engagement_rate: number;
}

interface TopPage { page: string; users: number; sessions: number }
interface TopSource { channel: string; users: number; sessions: number }

interface SiteTraffic {
  site_id: number;
  site_name: string;
  site_url: string;
  ga_property_id: string | null;
  window: Window;
  window_days: number;
  primary_market: { iso3: string; ga4_name: string; metrics: CountryMetrics | null };
  usa: CountryMetrics | null;
  global: CountryMetrics;
  top_countries: CountryMetrics[];
  top_pages: TopPage[];
  top_sources: TopSource[];
  per_day: { users: number; sessions: number; pageviews: number };
  warnings: string[];
  error: string | null;
  fetched_at: string;
}

interface Summary {
  sites_count: number;
  total_users: number;
  avg_users_per_day: number;
  top_3: { site: string; users: number; per_day: number }[];
  bottom_3: { site: string; users: number; per_day: number }[];
  window: Window;
  window_days: number;
}

interface ApiResponse {
  success: boolean;
  summary?: Summary;
  sites?: SiteTraffic[];
  error?: string;
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
  return (
    <div className={`rounded-xl border-2 ${usersPerDayBorder(perDay)} bg-zinc-950/50 p-4 shadow`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-zinc-100">
            {FLAGS[site.primary_market.iso3] ?? "🌍"} {site.site_name}
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
        <div className="rounded-lg border border-red-700 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          {site.error}
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

  async function fetchData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ga4-traffic?window=${windowKey}`, { cache: "no-store" });
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (err) {
      setData({ success: false, error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey]);

  const sites = useMemo(() => data?.sites ?? [], [data]);
  const summary = data?.summary;

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

        {loading && !data && (
          <div className="flex h-64 items-center justify-center text-zinc-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Querying GA4 for {sites.length || 21} properties…
          </div>
        )}

        {data && !data.success && (
          <div className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            {data.error ?? "Unknown error"}
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
                {fmtPerDay(summary.avg_users_per_day)} users/day across {summary.sites_count} sites
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

        <div className="mb-3 rounded-lg border border-blue-700/50 bg-blue-950/30 px-3 py-2 text-xs text-blue-200">
          <Globe className="mr-1 inline h-3 w-3" />
          Color code: <span className="text-red-400">red &lt; 1 user/day</span> ·{" "}
          <span className="text-yellow-400">yellow 1-5/day</span> ·{" "}
          <span className="text-emerald-400">green &gt; 5/day</span>. Bot warning = ≥5 USA users with engagement_rate &lt; 30%.
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sites.map((s) => (
            <SiteCard key={s.site_id} site={s} />
          ))}
        </div>
      </div>
    </main>
  );
}
