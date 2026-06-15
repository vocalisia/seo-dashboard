import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { isLocalDevDemoMode, LOCAL_DEMO_SITES } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

// In-memory cache (per-instance) — TTL 5 minutes. Saves ~200ms / heavy SQL on Neon.
type CacheEntry = { data: unknown; ts: number };
const SITE_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
function getCached(key: string): unknown | null {
  const e = SITE_CACHE.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    SITE_CACHE.delete(key);
    return null;
  }
  return e.data;
}
function setCached(key: string, data: unknown): void {
  SITE_CACHE.set(key, { data, ts: Date.now() });
  // Limit size to prevent memory growth
  if (SITE_CACHE.size > 50) {
    const oldest = [...SITE_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) SITE_CACHE.delete(oldest[0]);
  }
}

// Language → target countries (ISO-3)
const LANG_COUNTRIES: Record<string, string[]> = {
  fr: ["FRA","BEL","CHE","LUX","MCO","CAN"],
  en: ["GBR","USA","IRL","AUS","NZL","CAN"],
  de: ["DEU","AUT","CHE","LIE"],
  es: ["ESP","MEX","ARG","COL","CHL","PER"],
  it: ["ITA","CHE","SMR","VAT"],
  nl: ["NLD","BEL"],
  pt: ["PRT","BRA","AGO","MOZ"],
  ch: ["CHE"],
};

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const timingHeaders = (cache: "HIT" | "MISS" | "SKIP" = "MISS") => ({
    "X-Cache": cache,
    "X-Response-Time": `${Date.now() - startedAt}ms`,
    "Server-Timing": `app;dur=${Date.now() - startedAt}`,
  });

  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  if (isLocalDevDemoMode()) {
    return NextResponse.json(LOCAL_DEMO_SITES);
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error: "missing_env",
        message:
          "DATABASE_URL est absent ou vide. En local, lance `npm run dev` (mode démo auto) ou configure une base PostgreSQL et DATABASE_URL dans .env.local.",
      },
      { status: 503 }
    );
  }

  const language = request.nextUrl.searchParams.get("language");
  const countryFilter = language && LANG_COUNTRIES[language] ? LANG_COUNTRIES[language] : null;
  const daysParam = request.nextUrl.searchParams.get("days");
  const days = Math.max(1, Math.min(365, parseInt(daysParam ?? "30", 10) || 30));
  const noCache = request.nextUrl.searchParams.get("nocache") === "1";
  const wantsMetrics = Boolean(daysParam || language);

  // Check cache (unless ?nocache=1)
  const cacheKey = wantsMetrics ? `sites:${language || "all"}:${days}` : "sites:list";
  if (!noCache) {
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: timingHeaders("HIT") });
    }
  }

  try {
    const sql = getSQL();

    if (!wantsMetrics) {
      const rows = await sql`SELECT * FROM sites WHERE is_active = true ORDER BY name`;
      setCached(cacheKey, rows);
      return NextResponse.json(rows, { headers: timingHeaders("MISS") });
    }

    // Get all active sites first so we can compute per-site TLD country filter.
    const siteList = (await sql`
      SELECT id, url FROM sites WHERE is_active = true ORDER BY id
    `) as Array<{ id: number; url: string }>;

    // Build site_id → country list (primary country + NULL fallback)
    // If language is explicit, override with the language-mapped country list.
    const siteCountryMap: Record<number, string[]> = {};
    for (const s of siteList) {
      siteCountryMap[s.id] = countryFilter ?? [];
    }

    // Aggregate analytics_daily (no country dim)
    const analyticsAgg = (await sql`
      SELECT site_id,
        SUM(sessions) as total_sessions,
        SUM(users) as total_users,
        SUM(pageviews) as total_pageviews,
        SUM(organic_sessions) as total_organic
      FROM analytics_daily
      WHERE date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
      GROUP BY site_id
    `) as Array<Record<string, unknown>>;
    const aMap = new Map<number, Record<string, unknown>>();
    for (const r of analyticsAgg) aMap.set(Number(r.site_id), r);

    // Aggregate GSC per site using its TLD country (FRA/CHE/BEL/CAN…) — NULL fallback included
    // to avoid losing rows where GSC sync did not record a country.
    // C1: avg_position read from search_console_query_data (query-level, real Google position).
    // clicks/impressions stay on search_console_data (page-level totals identical).
    const gscMap = new Map<number, { total_clicks: number; total_impressions: number; avg_position: number }>();
    if (!countryFilter) {
      const gscRows = (await sql`
        WITH anchor AS (
          SELECT site_id, MAX(date) AS end_date
          FROM search_console_query_data
          WHERE position BETWEEN 1 AND 200
          GROUP BY site_id
        )
        SELECT qd.site_id,
          COALESCE(SUM(clicks), 0) as total_clicks,
          COALESCE(SUM(impressions), 0) as total_impressions,
          COALESCE(
            SUM(impressions * position)::float / NULLIF(SUM(impressions), 0),
            0
          ) as avg_position
        FROM search_console_query_data qd
        JOIN anchor a ON a.site_id = qd.site_id
        WHERE qd.date >= (a.end_date - INTERVAL '1 day' * (${days} - 1))::date
          AND qd.date <= a.end_date
          AND qd.position BETWEEN 1 AND 200
        GROUP BY qd.site_id
      `) as Array<Record<string, unknown>>;

      const rowsMap = new Map<number, Record<string, unknown>>();
      for (const row of gscRows) rowsMap.set(Number(row.site_id), row);
      for (const s of siteList) {
        const t = rowsMap.get(s.id) ?? {};
        gscMap.set(s.id, {
          total_clicks: Number(t.total_clicks ?? 0),
          total_impressions: Number(t.total_impressions ?? 0),
          avg_position: Number(t.avg_position ?? 0),
        });
      }
    } else {
      for (const s of siteList) {
        const wanted = siteCountryMap[s.id];
        const gscRow = (await sql`
          WITH anchor AS (
            SELECT MAX(date) AS end_date
            FROM search_console_query_data
            WHERE site_id = ${s.id}
              AND position BETWEEN 1 AND 200
              AND country = ANY(${wanted})
          )
          SELECT
            COALESCE(SUM(clicks), 0) as total_clicks,
            COALESCE(SUM(impressions), 0) as total_impressions,
            COALESCE(
              SUM(impressions * position)::float / NULLIF(SUM(impressions), 0),
              0
            ) as avg_position
          FROM search_console_query_data
          WHERE site_id = ${s.id}
            AND date >= ((SELECT end_date FROM anchor) - INTERVAL '1 day' * (${days} - 1))::date
            AND date <= (SELECT end_date FROM anchor)
            AND country = ANY(${wanted})
            AND position BETWEEN 1 AND 200
        `) as Array<Record<string, unknown>>;
        const t = gscRow[0] ?? {};
        gscMap.set(s.id, {
          total_clicks: Number(t.total_clicks ?? 0),
          total_impressions: Number(t.total_impressions ?? 0),
          avg_position: Number(t.avg_position ?? 0),
        });
      }
    }

    // Rebuild full site rows with joined data
    const fullSites = (await sql`
      SELECT * FROM sites WHERE is_active = true ORDER BY name
    `) as Array<Record<string, unknown>>;

    const rows = fullSites.map((s) => {
      const id = Number(s.id);
      const a = aMap.get(id) ?? {};
      const g = gscMap.get(id) ?? { total_clicks: 0, total_impressions: 0, avg_position: 0 };
      return {
        ...s,
        total_sessions_30d: Number(a.total_sessions ?? 0),
        total_users_30d: Number(a.total_users ?? 0),
        total_pageviews_30d: Number(a.total_pageviews ?? 0),
        organic_sessions_30d: Number(a.total_organic ?? 0),
        gsc_clicks_30d: g.total_clicks,
        gsc_impressions_30d: g.total_impressions,
        avg_position_30d: g.avg_position,
        country_filter: siteCountryMap[id] ?? [],
      };
    });

    setCached(cacheKey, rows);
    return NextResponse.json(rows, { headers: timingHeaders("MISS") });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  if (isLocalDevDemoMode()) {
    return NextResponse.json(
      {
        error: "demo_mode",
        message:
          "Ajout de site désactivé en mode démo (pas de base). Configure DATABASE_URL pour une vraie base, ou utilise l’app déployée.",
      },
      { status: 503 }
    );
  }
  try {
    const sql = getSQL();
    const { name, url, ga_property_id, gsc_property } = await request.json();
    const rows = await sql`
      INSERT INTO sites (name, url, ga_property_id, gsc_property)
      VALUES (${name}, ${url}, ${ga_property_id}, ${gsc_property})
      RETURNING *
    `;
    return NextResponse.json(rows[0]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
