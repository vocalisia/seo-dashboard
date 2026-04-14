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
      // Position cette semaine vs semaine dernière
      const rows = countryFilter
        ? await sql`
            WITH current_week AS (
              SELECT query, AVG(position) as pos_now, SUM(clicks) as clicks_now
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            prev_week AS (
              SELECT query, AVG(position) as pos_prev, SUM(clicks) as clicks_prev
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '14 days'
                AND date < NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND country = ANY(${countryFilter})
              GROUP BY query
            )
            SELECT
              c.query,
              ROUND(c.pos_now::numeric, 1) as position_now,
              ROUND(p.pos_prev::numeric, 1) as position_prev,
              ROUND((p.pos_prev - c.pos_now)::numeric, 1) as gain,
              c.clicks_now,
              p.clicks_prev,
              (c.clicks_now - COALESCE(p.clicks_prev, 0)) as clicks_gain
            FROM current_week c
            LEFT JOIN prev_week p ON p.query = c.query
            WHERE p.pos_prev IS NOT NULL
              AND ABS(p.pos_prev - c.pos_now) > 0.5
            ORDER BY gain DESC
            LIMIT ${limit}
          `
        : await sql`
            WITH current_week AS (
              SELECT query, AVG(position) as pos_now, SUM(clicks) as clicks_now
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
              GROUP BY query
            ),
            prev_week AS (
              SELECT query, AVG(position) as pos_prev, SUM(clicks) as clicks_prev
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '14 days'
                AND date < NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
              GROUP BY query
            )
            SELECT
              c.query,
              ROUND(c.pos_now::numeric, 1) as position_now,
              ROUND(p.pos_prev::numeric, 1) as position_prev,
              ROUND((p.pos_prev - c.pos_now)::numeric, 1) as gain,
              c.clicks_now,
              p.clicks_prev,
              (c.clicks_now - COALESCE(p.clicks_prev, 0)) as clicks_gain
            FROM current_week c
            LEFT JOIN prev_week p ON p.query = c.query
            WHERE p.pos_prev IS NOT NULL
              AND ABS(p.pos_prev - c.pos_now) > 0.5
            ORDER BY gain DESC
            LIMIT ${limit}
          `;
      return NextResponse.json(rows);
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
