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
};

export async function GET(request: NextRequest) {
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

  // Check cache (unless ?nocache=1)
  const cacheKey = `sites:${language || "all"}:${days}`;
  if (!noCache) {
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { "X-Cache": "HIT" } });
    }
  }

  try {
    const sql = getSQL();

    const rows = countryFilter
      ? await sql`
          SELECT
            s.*,
            COALESCE(a.total_sessions, 0) as total_sessions_30d,
            COALESCE(a.total_users, 0) as total_users_30d,
            COALESCE(a.total_pageviews, 0) as total_pageviews_30d,
            COALESCE(a.total_organic, 0) as organic_sessions_30d,
            COALESCE(gsc.total_clicks, 0) as gsc_clicks_30d,
            COALESCE(gsc.total_impressions, 0) as gsc_impressions_30d,
            COALESCE(gsc.avg_position, 0) as avg_position_30d
          FROM sites s
          LEFT JOIN (
            SELECT site_id,
              SUM(sessions) as total_sessions,
              SUM(users) as total_users,
              SUM(pageviews) as total_pageviews,
              SUM(organic_sessions) as total_organic
            FROM analytics_daily
            WHERE date >= CURRENT_DATE - ${days}::int
            GROUP BY site_id
          ) a ON a.site_id = s.id
          LEFT JOIN (
            SELECT site_id,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(NULLIF(position, 0)) as avg_position
            FROM search_console_data
            WHERE date >= CURRENT_DATE - ${days}::int
              AND country = ANY(${countryFilter})
            GROUP BY site_id
          ) gsc ON gsc.site_id = s.id
          WHERE s.is_active = true
          ORDER BY s.name
        `
      : await sql`
          SELECT
            s.*,
            COALESCE(a.total_sessions, 0) as total_sessions_30d,
            COALESCE(a.total_users, 0) as total_users_30d,
            COALESCE(a.total_pageviews, 0) as total_pageviews_30d,
            COALESCE(a.total_organic, 0) as organic_sessions_30d,
            COALESCE(gsc.total_clicks, 0) as gsc_clicks_30d,
            COALESCE(gsc.total_impressions, 0) as gsc_impressions_30d,
            COALESCE(gsc.avg_position, 0) as avg_position_30d
          FROM sites s
          LEFT JOIN (
            SELECT site_id,
              SUM(sessions) as total_sessions,
              SUM(users) as total_users,
              SUM(pageviews) as total_pageviews,
              SUM(organic_sessions) as total_organic
            FROM analytics_daily
            WHERE date >= CURRENT_DATE - ${days}::int
            GROUP BY site_id
          ) a ON a.site_id = s.id
          LEFT JOIN (
            SELECT site_id,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(NULLIF(position, 0)) as avg_position
            FROM search_console_data
            WHERE date >= CURRENT_DATE - ${days}::int
            GROUP BY site_id
          ) gsc ON gsc.site_id = s.id
          WHERE s.is_active = true
          ORDER BY s.name
        `;

    setCached(cacheKey, rows);
    return NextResponse.json(rows, { headers: { "X-Cache": "MISS" } });
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
