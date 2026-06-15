import { getSQL } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { GSC_LAG_DAYS } from "@/lib/gsc-window";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CacheEntry = { data: unknown; ts: number };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 1000;

function getCached(key: string): unknown | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.data;
}

function setCached(key: string, data: unknown) {
  CACHE.set(key, { data, ts: Date.now() });
  if (CACHE.size > 30) {
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) CACHE.delete(oldest[0]);
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const days = Math.max(1, Math.min(180, parseInt(request.nextUrl.searchParams.get("days") || "30", 10) || 30));
  const offset = Math.max(0, Math.min(365, parseInt(request.nextUrl.searchParams.get("offset") || "0", 10) || 0));
  const gscStartDaysAgo = days - 1 + GSC_LAG_DAYS + offset;
  const gscEndDaysAgo = GSC_LAG_DAYS + offset;
  const ga4StartDaysAgo = days - 1 + offset;
  const ga4EndDaysAgo = offset;
  const type = request.nextUrl.searchParams.get("type") || "gsc";
  const noCache = request.nextUrl.searchParams.get("nocache") === "1";
  const cacheKey = `overview:${type}:${days}:${offset}`;

  const headers = (cache: "HIT" | "MISS") => ({
    "X-Cache": cache,
    "X-Response-Time": `${Date.now() - startedAt}ms`,
    "Server-Timing": `app;dur=${Date.now() - startedAt}`,
  });

  if (!noCache) {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json(cached, { headers: headers("HIT") });
  }

  try {
    const sql = getSQL();

    if (type === "gsc") {
      const rows = await sql`
        SELECT
          s.id AS site_id,
          s.name,
          s.url,
          d.date::text,
          COALESCE(SUM(d.clicks), 0) AS clicks,
          COALESCE(SUM(d.impressions), 0) AS impressions,
          COALESCE(SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0), 0) AS position
        FROM search_console_data d
        JOIN sites s ON s.id = d.site_id
        WHERE s.is_active = true
          AND d.date >= (CURRENT_DATE - INTERVAL '1 day' * ${gscStartDaysAgo})::date
          AND d.date <= (CURRENT_DATE - INTERVAL '1 day' * ${gscEndDaysAgo})::date
          AND (d.country IS NULL OR d.country = '')
        GROUP BY s.id, s.name, s.url, d.date
        ORDER BY d.date ASC
      `;
      setCached(cacheKey, rows);
      return NextResponse.json(rows, { headers: headers("MISS") });
    }

    if (type === "ga4") {
      const rows = await sql`
        SELECT
          s.id AS site_id,
          s.name,
          s.url,
          d.date::text,
          COALESCE(d.sessions, 0) AS sessions,
          COALESCE(d.users, 0) AS users,
          COALESCE(d.pageviews, 0) AS pageviews,
          COALESCE(d.organic_sessions, 0) AS organic_sessions,
          COALESCE(d.direct_sessions, 0) AS direct_sessions,
          COALESCE(d.bounce_rate, 0) AS bounce_rate,
          COALESCE(d.avg_session_duration, 0) AS avg_session_duration
        FROM analytics_daily d
        JOIN sites s ON s.id = d.site_id
        WHERE s.is_active = true
          AND d.date >= (CURRENT_DATE - INTERVAL '1 day' * ${ga4StartDaysAgo})::date
          AND d.date <= (CURRENT_DATE - INTERVAL '1 day' * ${ga4EndDaysAgo})::date
        ORDER BY d.date ASC
      `;
      setCached(cacheKey, rows);
      return NextResponse.json(rows, { headers: headers("MISS") });
    }

    if (type === "summary") {
      const rows = await sql`
        WITH gsc AS (
          SELECT
            site_id,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(impressions), 0) AS impressions,
            COUNT(DISTINCT date) AS days_with_data
          FROM search_console_data
          WHERE date >= (CURRENT_DATE - INTERVAL '1 day' * ${gscStartDaysAgo})::date
            AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${gscEndDaysAgo})::date
            AND (country IS NULL OR country = '')
          GROUP BY site_id
        ),
        pos AS (
          SELECT
            site_id,
            COALESCE(SUM(impressions * position)::float / NULLIF(SUM(impressions), 0), 0) AS position
          FROM search_console_query_data
          WHERE date >= (CURRENT_DATE - INTERVAL '1 day' * ${gscStartDaysAgo})::date
            AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${gscEndDaysAgo})::date
          GROUP BY site_id
        ),
        pos_fallback AS (
          SELECT
            site_id,
            COALESCE(AVG(NULLIF(position, 0)), 0) AS position
          FROM search_console_data
          WHERE date >= (CURRENT_DATE - INTERVAL '1 day' * ${gscStartDaysAgo})::date
            AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${gscEndDaysAgo})::date
            AND (country IS NULL OR country = '')
          GROUP BY site_id
        ),
        ga4 AS (
          SELECT
            site_id,
            COALESCE(SUM(sessions), 0) AS sessions,
            COALESCE(SUM(users), 0) AS users,
            COALESCE(SUM(pageviews), 0) AS pageviews,
            COALESCE(SUM(organic_sessions), 0) AS organic_sessions,
            COALESCE(AVG(avg_session_duration), 0) AS avg_duration,
            COALESCE(AVG(bounce_rate), 0) AS bounce_rate
          FROM analytics_daily
          WHERE date >= (CURRENT_DATE - INTERVAL '1 day' * ${ga4StartDaysAgo})::date
            AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${ga4EndDaysAgo})::date
          GROUP BY site_id
        )
        SELECT
          s.id AS site_id,
          s.name,
          s.url,
          COALESCE(g.clicks, 0) AS clicks,
          COALESCE(g.impressions, 0) AS impressions,
          COALESCE(NULLIF(p.position, 0), pf.position, 0) AS position,
          COALESCE(g.days_with_data, 0) AS days_with_data,
          COALESCE(a.sessions, 0) AS sessions,
          COALESCE(a.users, 0) AS users,
          COALESCE(a.pageviews, 0) AS pageviews,
          COALESCE(a.organic_sessions, 0) AS organic_sessions,
          COALESCE(a.avg_duration, 0) AS avg_duration,
          COALESCE(a.bounce_rate, 0) AS bounce_rate
        FROM sites s
        LEFT JOIN gsc g ON g.site_id = s.id
        LEFT JOIN pos p ON p.site_id = s.id
        LEFT JOIN pos_fallback pf ON pf.site_id = s.id
        LEFT JOIN ga4 a ON a.site_id = s.id
        WHERE s.is_active = true
        ORDER BY COALESCE(g.clicks, 0) DESC, s.name ASC
      `;
      setCached(cacheKey, rows);
      return NextResponse.json(rows, { headers: headers("MISS") });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
