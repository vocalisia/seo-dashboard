/**
 * /api/ga4-traffic — REAL visitor metrics per site, broken down by country.
 *
 * Goal: surface `totalUsers` (real humans, deduplicated) instead of `eventCount`
 * (every gtag event, inflates 5-10× over actual visitors). The user previously
 * mistook eventCount=55-83/day for "visitors" on vocalis.pro when real
 * USA users = 7-8/day.
 *
 * GET /api/ga4-traffic?siteId=<id>&window=28d  → single site
 * GET /api/ga4-traffic                          → all 21 active sites
 *
 * window: 7d | 28d | 90d (default 28d)
 *
 * Cached 15 minutes in-process to respect GA4 quotas.
 */
import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { getAnalyticsClient } from "@/lib/google-auth";
import { requireApiSession } from "@/lib/api-auth";
import { siteCountryCode } from "@/lib/site-country";
import { buildTrafficSummary, type TrafficWindow } from "@/lib/ga4-traffic-summary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Window = TrafficWindow;

const WINDOW_DAYS: Record<Window, number> = { "7d": 7, "28d": 28, "90d": 90 };

// ISO-3 (TLD-mapped) → GA4 `country` dimension (English country name)
// GA4 returns full country names (e.g. "France"), not ISO codes.
const ISO3_TO_GA4_NAME: Record<string, string> = {
  FRA: "France",
  CHE: "Switzerland",
  BEL: "Belgium",
  CAN: "Canada",
  USA: "United States",
};

interface CountryMetrics {
  country: string;
  users: number;
  sessions: number;
  pageviews: number;
  engagement_rate: number; // 0..1
}

interface TopPage {
  page: string;
  users: number;
  sessions: number;
}

interface TopSource {
  channel: string;
  users: number;
  sessions: number;
}

export interface SiteTraffic {
  site_id: number;
  site_name: string;
  site_url: string;
  ga_property_id: string | null;
  window: Window;
  window_days: number;
  primary_market: {
    iso3: string;
    ga4_name: string;
    metrics: CountryMetrics | null;
  };
  usa: CountryMetrics | null;
  global: CountryMetrics;
  top_countries: CountryMetrics[];
  top_pages: TopPage[];
  top_sources: TopSource[];
  per_day: {
    users: number;
    sessions: number;
    pageviews: number;
  };
  warnings: string[];
  error: string | null;
  fetched_at: string;
}

interface Cached {
  data: SiteTraffic;
  ts: number;
}
const CACHE = new Map<string, Cached>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const GA4_SITE_CONCURRENCY = 3;

interface SiteRow {
  id: number;
  name: string;
  url: string;
  ga_property_id: string | null;
}

function normalizePropertyId(raw: string | null): string | null {
  if (!raw) return null;
  // Accept "properties/123" or "123"
  const numeric = raw.startsWith("properties/") ? raw.slice("properties/".length) : raw;
  return /^\d+$/.test(numeric) ? numeric : null;
}

function dateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const endDate = end.toISOString().split("T")[0];
  const startDate = start.toISOString().split("T")[0];
  return { startDate, endDate };
}

function parseNum(v: string | null | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchSiteTraffic(site: SiteRow, win: Window): Promise<SiteTraffic> {
  const fetched_at = new Date().toISOString();
  const days = WINDOW_DAYS[win];
  const iso3 = siteCountryCode(site.url);
  const ga4PrimaryName = ISO3_TO_GA4_NAME[iso3] ?? "France";
  const warnings: string[] = [];

  const empty = (msg: string): SiteTraffic => ({
    site_id: site.id,
    site_name: site.name,
    site_url: site.url,
    ga_property_id: site.ga_property_id,
    window: win,
    window_days: days,
    primary_market: { iso3, ga4_name: ga4PrimaryName, metrics: null },
    usa: null,
    global: { country: "All", users: 0, sessions: 0, pageviews: 0, engagement_rate: 0 },
    top_countries: [],
    top_pages: [],
    top_sources: [],
    per_day: { users: 0, sessions: 0, pageviews: 0 },
    warnings,
    error: msg,
    fetched_at,
  });

  const propertyId = normalizePropertyId(site.ga_property_id);
  if (!propertyId) return empty("ga_property_id not configured");

  const analytics = getAnalyticsClient();
  const { startDate, endDate } = dateRange(days);

  try {
    // 1) Per-country totals (and global = sum of all rows)
    const countryReport = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "country" }],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
        ],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: "50",
      },
    });

    const countryRows: CountryMetrics[] = (countryReport.data.rows ?? []).map((r) => ({
      country: r.dimensionValues?.[0]?.value ?? "(unknown)",
      users: parseNum(r.metricValues?.[0]?.value),
      sessions: parseNum(r.metricValues?.[1]?.value),
      pageviews: parseNum(r.metricValues?.[2]?.value),
      engagement_rate: parseNum(r.metricValues?.[3]?.value),
    }));

    // 2) Global (no dimension) — single-row totals
    const globalReport = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
        ],
      },
    });
    const gRow = globalReport.data.rows?.[0];
    const global: CountryMetrics = {
      country: "All",
      users: parseNum(gRow?.metricValues?.[0]?.value),
      sessions: parseNum(gRow?.metricValues?.[1]?.value),
      pageviews: parseNum(gRow?.metricValues?.[2]?.value),
      engagement_rate: parseNum(gRow?.metricValues?.[3]?.value),
    };

    // 3) Top landing pages
    const pagesReport = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "landingPage" }],
        metrics: [{ name: "totalUsers" }, { name: "sessions" }],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: "5",
      },
    });
    const top_pages: TopPage[] = (pagesReport.data.rows ?? []).map((r) => ({
      page: r.dimensionValues?.[0]?.value ?? "(unknown)",
      users: parseNum(r.metricValues?.[0]?.value),
      sessions: parseNum(r.metricValues?.[1]?.value),
    }));

    // 4) Top sources (channels)
    const sourcesReport = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "totalUsers" }, { name: "sessions" }],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: "5",
      },
    });
    const top_sources: TopSource[] = (sourcesReport.data.rows ?? []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value ?? "(unknown)",
      users: parseNum(r.metricValues?.[0]?.value),
      sessions: parseNum(r.metricValues?.[1]?.value),
    }));

    const primary = countryRows.find((c) => c.country === ga4PrimaryName) ?? null;
    const usa = countryRows.find((c) => c.country === "United States") ?? null;

    // Bot-traffic heuristic on USA: low engagement_rate often signals automated traffic.
    if (usa && usa.users >= 5 && usa.engagement_rate < 0.3) {
      warnings.push(
        `USA traffic shows low engagement_rate (${(usa.engagement_rate * 100).toFixed(1)}%) — likely bots/crawlers.`
      );
    }
    if (global.users === 0) {
      warnings.push("No users in window — GA4 may be broken, no traffic, or measurement filtered.");
    }

    return {
      site_id: site.id,
      site_name: site.name,
      site_url: site.url,
      ga_property_id: site.ga_property_id,
      window: win,
      window_days: days,
      primary_market: { iso3, ga4_name: ga4PrimaryName, metrics: primary },
      usa,
      global,
      top_countries: countryRows.slice(0, 10),
      top_pages,
      top_sources,
      per_day: {
        users: days > 0 ? global.users / days : 0,
        sessions: days > 0 ? global.sessions / days : 0,
        pageviews: days > 0 ? global.pageviews / days : 0,
      },
      warnings,
      error: null,
      fetched_at,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown GA4 error";
    return empty(message);
  }
}

async function getSites(siteIdParam: string | null): Promise<SiteRow[]> {
  const sql = getSQL();
  if (siteIdParam) {
    const id = Number(siteIdParam);
    if (!Number.isFinite(id)) return [];
    const rows = await sql`
      SELECT id, name, url, ga_property_id
      FROM sites
      WHERE id = ${id} AND is_active = true
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      url: String(r.url),
      ga_property_id: r.ga_property_id ? String(r.ga_property_id) : null,
    }));
  }
  const rows = await sql`
    SELECT id, name, url, ga_property_id
    FROM sites
    WHERE is_active = true
    ORDER BY name
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    url: String(r.url),
    ga_property_id: r.ga_property_id ? String(r.ga_property_id) : null,
  }));
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(req: Request) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(req.url);
  const siteIdParam = searchParams.get("siteId");
  const windowParam = (searchParams.get("window") ?? "28d") as Window;
  const win: Window = windowParam in WINDOW_DAYS ? windowParam : "28d";

  try {
    const sites = await getSites(siteIdParam);
    if (sites.length === 0) {
      return NextResponse.json({ success: false, error: "No active sites" }, { status: 404 });
    }

    const now = Date.now();
    const results = await mapLimit(sites, siteIdParam ? 1 : GA4_SITE_CONCURRENCY, async (site) => {
      const cacheKey = `${site.id}:${win}`;
      const cached = CACHE.get(cacheKey);
      if (cached && now - cached.ts < CACHE_TTL_MS) {
        return cached.data;
      }
      const data = await fetchSiteTraffic(site, win);
      // A provider/configuration failure must not be served as fresh data for
      // fifteen minutes. Only cache successful GA4 measurements.
      if (data.error === null) CACHE.set(cacheKey, { data, ts: now });
      return data;
    });

    // Portfolio totals only include successful measurements. An unavailable
    // property is not equivalent to a measured zero.
    const { measuredResults, failedResults, summary } = buildTrafficSummary(results, win);

    if (measuredResults.length === 0) {
      const onlyMissingConfiguration = failedResults.every((result) => result.error === "ga_property_id not configured");
      return NextResponse.json(
        {
          success: false,
          partial: false,
          status: onlyMissingConfiguration ? "not_configured" : "unavailable",
          error: onlyMissingConfiguration
            ? "Aucune propriété GA4 valide n'est configurée pour la sélection."
            : "Aucune mesure GA4 n'a pu être récupérée.",
          summary,
          sites: results,
        },
        { status: onlyMissingConfiguration ? 422 : 502 },
      );
    }

    return NextResponse.json({
      success: true,
      partial: failedResults.length > 0,
      status: failedResults.length > 0 ? "partial" : "complete",
      summary,
      sites: results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
