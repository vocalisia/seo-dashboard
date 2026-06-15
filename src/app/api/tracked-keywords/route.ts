/**
 * /api/tracked-keywords — fetch tracked keywords with volumes + sites join.
 * Used by /tracked-keywords UI page.
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureSchemaOnce, getSQL } from "@/lib/db";

export const dynamic = "force-dynamic";

interface KeywordRow {
  id: number;
  keyword: string;
  market: string | null;
  volume_fr: number | null;
  volume_ch: number | null;
  volume_market: number | null;
  current_position: number | null;
  current_impressions: number | null;
  current_clicks: number | null;
  site_id: number;
  site_name: string;
  site_url: string;
}

export async function GET(req: NextRequest) {
  await ensureSchemaOnce();
  const sql = getSQL();
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId");
  const minVol = parseInt(searchParams.get("minVol") || "0", 10);
  const posMin = parseFloat(searchParams.get("posMin") || "1");
  const posMax = parseFloat(searchParams.get("posMax") || "100");
  const onlyQuickWins = searchParams.get("quickWins") === "1";

  const minPos = onlyQuickWins ? 4 : posMin;
  const maxPos = onlyQuickWins ? 15 : posMax;
  const minVolFilter = onlyQuickWins ? Math.max(100, minVol) : minVol;

  let rows: KeywordRow[];
  if (siteId && siteId !== "all") {
    rows = (await sql`
      WITH live AS (
        SELECT site_id, LOWER(query) AS keyword_key,
          SUM(clicks) AS current_clicks,
          SUM(impressions) AS current_impressions,
          SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS current_position
        FROM search_console_query_data
        WHERE date >= (CURRENT_DATE - INTERVAL '30 days')::date
          AND date <= (CURRENT_DATE - INTERVAL '2 days')::date
          AND position BETWEEN 1 AND 200
        GROUP BY site_id, LOWER(query)
      )
      SELECT k.id, k.keyword, k.market, k.volume_fr, k.volume_ch, k.volume_market,
             live.current_position, live.current_impressions, live.current_clicks,
             k.site_id, s.name AS site_name, s.url AS site_url
      FROM tracked_keywords k
      JOIN sites s ON s.id = k.site_id
      LEFT JOIN live ON live.site_id = k.site_id AND live.keyword_key = LOWER(k.keyword)
      WHERE k.is_active = TRUE
        AND k.site_id = ${parseInt(siteId, 10)}
        AND COALESCE(k.volume_market, k.volume_ch, k.volume_fr, 0) >= ${minVolFilter}
        AND COALESCE(live.current_position, 100) BETWEEN ${minPos} AND ${maxPos}
      ORDER BY COALESCE(k.volume_market, k.volume_ch, k.volume_fr, 0) DESC, live.current_position ASC NULLS LAST
      LIMIT 500
    `) as KeywordRow[];
  } else {
    rows = (await sql`
      WITH live AS (
        SELECT site_id, LOWER(query) AS keyword_key,
          SUM(clicks) AS current_clicks,
          SUM(impressions) AS current_impressions,
          SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS current_position
        FROM search_console_query_data
        WHERE date >= (CURRENT_DATE - INTERVAL '30 days')::date
          AND date <= (CURRENT_DATE - INTERVAL '2 days')::date
          AND position BETWEEN 1 AND 200
        GROUP BY site_id, LOWER(query)
      )
      SELECT k.id, k.keyword, k.market, k.volume_fr, k.volume_ch, k.volume_market,
             live.current_position, live.current_impressions, live.current_clicks,
             k.site_id, s.name AS site_name, s.url AS site_url
      FROM tracked_keywords k
      JOIN sites s ON s.id = k.site_id
      LEFT JOIN live ON live.site_id = k.site_id AND live.keyword_key = LOWER(k.keyword)
      WHERE k.is_active = TRUE
        AND COALESCE(k.volume_market, k.volume_ch, k.volume_fr, 0) >= ${minVolFilter}
        AND COALESCE(live.current_position, 100) BETWEEN ${minPos} AND ${maxPos}
      ORDER BY COALESCE(k.volume_market, k.volume_ch, k.volume_fr, 0) DESC, live.current_position ASC NULLS LAST
      LIMIT 500
    `) as KeywordRow[];
  }

  // Sites list for the filter dropdown
  const sites = (await sql`
    SELECT id, name, url
    FROM sites
    WHERE is_active = TRUE
      AND EXISTS (SELECT 1 FROM tracked_keywords k WHERE k.site_id = sites.id)
    ORDER BY name
  `) as Array<{ id: number; name: string; url: string }>;

  return NextResponse.json({ sites, keywords: rows });
}
