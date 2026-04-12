export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface CountryRow {
  country: string;
  clicks: string;
  impressions: string;
  queries: string;
}

interface CannibalRow {
  query: string;
  page: string;
  clicks: string;
  impressions: string;
  position: string;
}

interface ArticleRow {
  id: number;
  site_id: number;
  site_name: string | null;
  keyword: string;
  article_title: string;
  github_url: string | null;
  image_url: string | null;
  language: string;
  status: string;
  created_at: string;
}

/**
 * GET /api/countries
 *   ?site_id=1            → required
 *   ?country=FR           → optional filter
 *   ?days=30              → lookback window
 *
 * Returns:
 *   - countries: list of countries with traffic stats (for filter)
 *   - cannibalization: queries appearing on multiple URLs (per country)
 *   - articles: autopilot_runs filtered by language matching country
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteIdParam = searchParams.get("site_id");
  const country = searchParams.get("country");
  const days = parseInt(searchParams.get("days") ?? "30", 10);

  if (!siteIdParam) {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const siteId = parseInt(siteIdParam, 10);
  if (isNaN(siteId)) {
    return NextResponse.json({ success: false, error: "Invalid site_id" }, { status: 400 });
  }

  const sql = getSQL();

  try {
    // 1. Countries list (aggregated traffic per country)
    const countries = (await sql`
      SELECT country,
             SUM(clicks)      AS clicks,
             SUM(impressions) AS impressions,
             COUNT(DISTINCT query) AS queries
      FROM search_console_data
      WHERE site_id = ${siteId}
        AND country IS NOT NULL
        AND country != ''
        AND date >= NOW() - INTERVAL '1 day' * ${days}
      GROUP BY country
      ORDER BY SUM(clicks) DESC
      LIMIT 30
    `) as CountryRow[];

    // 2. Cannibalization: queries ranking on 2+ pages (per country if provided)
    const cannibalization = country
      ? ((await sql`
          SELECT query,
                 page,
                 SUM(clicks)      AS clicks,
                 SUM(impressions) AS impressions,
                 AVG(position)    AS position
          FROM search_console_data
          WHERE site_id = ${siteId}
            AND country = ${country}
            AND date >= NOW() - INTERVAL '1 day' * ${days}
            AND query IN (
              SELECT query
              FROM search_console_data
              WHERE site_id = ${siteId}
                AND country = ${country}
                AND date >= NOW() - INTERVAL '1 day' * ${days}
                AND page != ''
              GROUP BY query
              HAVING COUNT(DISTINCT page) >= 2
                AND SUM(impressions) >= 10
            )
          GROUP BY query, page
          ORDER BY query, SUM(impressions) DESC
          LIMIT 100
        `) as CannibalRow[])
      : ((await sql`
          SELECT query,
                 page,
                 SUM(clicks)      AS clicks,
                 SUM(impressions) AS impressions,
                 AVG(position)    AS position
          FROM search_console_data
          WHERE site_id = ${siteId}
            AND date >= NOW() - INTERVAL '1 day' * ${days}
            AND query IN (
              SELECT query
              FROM search_console_data
              WHERE site_id = ${siteId}
                AND date >= NOW() - INTERVAL '1 day' * ${days}
                AND page != ''
              GROUP BY query
              HAVING COUNT(DISTINCT page) >= 2
                AND SUM(impressions) >= 10
            )
          GROUP BY query, page
          ORDER BY query, SUM(impressions) DESC
          LIMIT 100
        `) as CannibalRow[]);

    // 3. Map country ISO → language code (best-effort)
    const COUNTRY_LANG: Record<string, string> = {
      FRA: "fr", BEL: "fr", CHE: "fr", LUX: "fr", MCO: "fr",
      GBR: "en", USA: "en", IRL: "en", AUS: "en", NZL: "en", CAN: "en",
      DEU: "de", AUT: "de",
      ESP: "es", MEX: "es", ARG: "es",
      ITA: "it",
      NLD: "nl",
      PRT: "pt", BRA: "pt",
    };
    const filterLang = country ? COUNTRY_LANG[country] : null;

    // 4. Articles published (autopilot_runs) — optionally filtered by lang
    const articles = filterLang
      ? ((await sql`
          SELECT ar.id, ar.site_id, s.name AS site_name, ar.keyword, ar.article_title,
                 ar.github_url, ar.image_url,
                 COALESCE(ar.language, 'fr') AS language,
                 ar.status, ar.created_at
          FROM autopilot_runs ar
          LEFT JOIN sites s ON s.id = ar.site_id
          WHERE ar.site_id = ${siteId}
            AND COALESCE(ar.language, 'fr') = ${filterLang}
          ORDER BY ar.created_at DESC
          LIMIT 50
        `) as ArticleRow[])
      : ((await sql`
          SELECT ar.id, ar.site_id, s.name AS site_name, ar.keyword, ar.article_title,
                 ar.github_url, ar.image_url,
                 COALESCE(ar.language, 'fr') AS language,
                 ar.status, ar.created_at
          FROM autopilot_runs ar
          LEFT JOIN sites s ON s.id = ar.site_id
          WHERE ar.site_id = ${siteId}
          ORDER BY ar.created_at DESC
          LIMIT 50
        `) as ArticleRow[]);

    // Group cannibalization by query
    const cannibalMap: Record<string, CannibalRow[]> = {};
    for (const c of cannibalization) {
      (cannibalMap[c.query] ??= []).push(c);
    }
    const cannibalGroups = Object.entries(cannibalMap)
      .filter(([, pages]) => pages.length >= 2)
      .map(([query, pages]) => ({
        query,
        pages: pages.map((p) => ({
          url: p.page,
          clicks: parseInt(p.clicks),
          impressions: parseInt(p.impressions),
          position: parseFloat(p.position),
        })),
      }));

    return NextResponse.json({
      success: true,
      countries: countries.map((c) => ({
        country: c.country,
        clicks: parseInt(c.clicks),
        impressions: parseInt(c.impressions),
        queries: parseInt(c.queries),
      })),
      cannibalization: cannibalGroups,
      articles,
      filter: { country, language: filterLang },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Countries fetch error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
