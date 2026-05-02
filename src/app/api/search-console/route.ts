import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

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
  const siteId = request.nextUrl.searchParams.get("siteId");
  const type = request.nextUrl.searchParams.get("type") || "queries";
  const days = parseInt(request.nextUrl.searchParams.get("days") || "30");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "200");
  const country = request.nextUrl.searchParams.get("country"); // ISO-3 or null
  const language = request.nextUrl.searchParams.get("language"); // fr/en/de/... or null

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });

  if (isLocalDevDemoMode()) {
    return NextResponse.json([]);
  }

  // Resolve filter: explicit country > language mapping > none
  const countryFilter: string[] | null = country
    ? [country]
    : language && LANG_COUNTRIES[language]
      ? LANG_COUNTRIES[language]
      : null;

  try {
    const sql = getSQL();
    const id = parseInt(siteId);

    if (type === "queries") {
      const rows = countryFilter
        ? await sql`
            SELECT query,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(ctr) as avg_ctr,
              AVG(position) as avg_position
            FROM search_console_data
            WHERE site_id = ${id}
              AND date >= NOW() - INTERVAL '1 day' * ${days}
              AND query IS NOT NULL
              AND country = ANY(${countryFilter})
            GROUP BY query
            ORDER BY total_clicks DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT query,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(ctr) as avg_ctr,
              AVG(position) as avg_position
            FROM search_console_data
            WHERE site_id = ${id}
              AND date >= NOW() - INTERVAL '1 day' * ${days}
              AND query IS NOT NULL
            GROUP BY query
            ORDER BY total_clicks DESC
            LIMIT ${limit}
          `;
      return NextResponse.json(rows);
    }

    if (type === "gains") {
      // 5 buckets hebdo : W0 (cette sem.) → W4 (il y a 4 sem.) + dates
      const rows = countryFilter
        ? await sql`
            WITH w0 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks, SUM(impressions) AS impressions
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w1 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '14 days'
                AND date <  NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w2 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '21 days'
                AND date <  NOW() - INTERVAL '14 days'
                AND query IS NOT NULL
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w3 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '28 days'
                AND date <  NOW() - INTERVAL '21 days'
                AND query IS NOT NULL
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w4 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '35 days'
                AND date <  NOW() - INTERVAL '28 days'
                AND query IS NOT NULL
                AND country = ANY(${countryFilter})
              GROUP BY query
            )
            SELECT
              w0.query,
              ROUND(w0.pos::numeric, 1) AS position_now,
              ROUND(w1.pos::numeric, 1) AS position_prev,
              ROUND(w2.pos::numeric, 1) AS position_w2,
              ROUND(w3.pos::numeric, 1) AS position_w3,
              ROUND(w4.pos::numeric, 1) AS position_w4,
              ROUND((w1.pos - w0.pos)::numeric, 1) AS gain,
              ROUND((w2.pos - w1.pos)::numeric, 1) AS gain_w1_w2,
              ROUND((w3.pos - w2.pos)::numeric, 1) AS gain_w2_w3,
              ROUND((w4.pos - w3.pos)::numeric, 1) AS gain_w3_w4,
              w0.clicks AS clicks_now, w0.impressions AS impressions_now,
              w1.clicks AS clicks_prev,
              (w0.clicks - COALESCE(w1.clicks, 0)) AS clicks_gain
            FROM w0
            LEFT JOIN w1 ON w1.query = w0.query
            LEFT JOIN w2 ON w2.query = w0.query
            LEFT JOIN w3 ON w3.query = w0.query
            LEFT JOIN w4 ON w4.query = w0.query
            WHERE w1.pos IS NOT NULL
              AND ABS(w1.pos - w0.pos) > 0.5
            ORDER BY (w1.pos - w0.pos) DESC NULLS LAST
            LIMIT ${limit}
          `
        : await sql`
            WITH w0 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks, SUM(impressions) AS impressions
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
              GROUP BY query
            ),
            w1 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '14 days'
                AND date <  NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
              GROUP BY query
            ),
            w2 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '21 days'
                AND date <  NOW() - INTERVAL '14 days'
                AND query IS NOT NULL
              GROUP BY query
            ),
            w3 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '28 days'
                AND date <  NOW() - INTERVAL '21 days'
                AND query IS NOT NULL
              GROUP BY query
            ),
            w4 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '35 days'
                AND date <  NOW() - INTERVAL '28 days'
                AND query IS NOT NULL
              GROUP BY query
            )
            SELECT
              w0.query,
              ROUND(w0.pos::numeric, 1) AS position_now,
              ROUND(w1.pos::numeric, 1) AS position_prev,
              ROUND(w2.pos::numeric, 1) AS position_w2,
              ROUND(w3.pos::numeric, 1) AS position_w3,
              ROUND(w4.pos::numeric, 1) AS position_w4,
              ROUND((w1.pos - w0.pos)::numeric, 1) AS gain,
              ROUND((w2.pos - w1.pos)::numeric, 1) AS gain_w1_w2,
              ROUND((w3.pos - w2.pos)::numeric, 1) AS gain_w2_w3,
              ROUND((w4.pos - w3.pos)::numeric, 1) AS gain_w3_w4,
              w0.clicks AS clicks_now, w0.impressions AS impressions_now,
              w1.clicks AS clicks_prev,
              (w0.clicks - COALESCE(w1.clicks, 0)) AS clicks_gain
            FROM w0
            LEFT JOIN w1 ON w1.query = w0.query
            LEFT JOIN w2 ON w2.query = w0.query
            LEFT JOIN w3 ON w3.query = w0.query
            LEFT JOIN w4 ON w4.query = w0.query
            WHERE w1.pos IS NOT NULL
              AND ABS(w1.pos - w0.pos) > 0.5
            ORDER BY (w1.pos - w0.pos) DESC NULLS LAST
            LIMIT ${limit}
          `;

      // Date labels (TZ serveur — affichage frontend)
      const today = new Date();
      const fmt = (offset: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - offset);
        return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
      };
      const labels = {
        w0: `${fmt(7)}–${fmt(0)}`,
        w1: `${fmt(14)}–${fmt(8)}`,
        w2: `${fmt(21)}–${fmt(15)}`,
        w3: `${fmt(28)}–${fmt(22)}`,
        w4: `${fmt(35)}–${fmt(29)}`,
      };

      return NextResponse.json({ rows, labels });
    }

    if (type === "pages") {
      const rows = countryFilter
        ? await sql`
            SELECT page,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(ctr) as avg_ctr,
              AVG(position) as avg_position,
              COUNT(DISTINCT query) as keyword_count
            FROM search_console_data
            WHERE site_id = ${id}
              AND date >= NOW() - INTERVAL '1 day' * ${days}
              AND page IS NOT NULL
              AND country = ANY(${countryFilter})
            GROUP BY page
            ORDER BY total_clicks DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT page,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(ctr) as avg_ctr,
              AVG(position) as avg_position,
              COUNT(DISTINCT query) as keyword_count
            FROM search_console_data
            WHERE site_id = ${id}
              AND date >= NOW() - INTERVAL '1 day' * ${days}
              AND page IS NOT NULL
            GROUP BY page
            ORDER BY total_clicks DESC
            LIMIT ${limit}
          `;
      return NextResponse.json(rows);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
