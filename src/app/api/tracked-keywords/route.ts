/**
 * /api/tracked-keywords — fetch tracked keywords with volumes + sites join.
 * Used by /tracked-keywords UI page.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
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
  latest_data_date: string | null;
  position_source: "gsc_query_level" | "not_observed";
  site_id: number;
  site_name: string;
  site_url: string;
}

export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;
  await ensureSchemaOnce();
  const sql = getSQL();
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get("siteId");
  const minVol = Number(searchParams.get("minVol") || "0");
  const posMin = Number(searchParams.get("posMin") || "1");
  const posMax = Number(searchParams.get("posMax") || "100");
  const onlyQuickWins = searchParams.get("quickWins") === "1";
  const parsedSiteId = siteId && siteId !== "all" ? Number(siteId) : null;

  if (parsedSiteId !== null && (!Number.isInteger(parsedSiteId) || parsedSiteId <= 0)) {
    return NextResponse.json({ error: "siteId must be a positive integer" }, { status: 400 });
  }
  if (!Number.isFinite(minVol) || minVol < 0 || !Number.isFinite(posMin) || !Number.isFinite(posMax) || posMin < 1 || posMax > 200 || posMin > posMax) {
    return NextResponse.json({ error: "invalid keyword filters" }, { status: 400 });
  }

  const minPos = onlyQuickWins ? 4 : posMin;
  const maxPos = onlyQuickWins ? 15 : posMax;
  const minVolFilter = onlyQuickWins ? Math.max(100, minVol) : minVol;

  const rows = (await sql`
    WITH anchors AS (
      SELECT site_id, MAX(date) AS latest_data_date
      FROM search_console_query_data
      WHERE position BETWEEN 1 AND 200 AND BTRIM(query) <> ''
      GROUP BY site_id
    ),
    live AS (
      SELECT q.site_id, LOWER(BTRIM(q.query)) AS keyword_key,
        SUM(q.clicks) AS current_clicks,
        SUM(q.impressions) AS current_impressions,
        SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS current_position,
        MAX(a.latest_data_date)::text AS latest_data_date
      FROM search_console_query_data q
      JOIN anchors a ON a.site_id = q.site_id
      WHERE q.date >= (a.latest_data_date - INTERVAL '29 days')::date
        AND q.date <= a.latest_data_date
        AND q.position BETWEEN 1 AND 200
      GROUP BY q.site_id, LOWER(BTRIM(q.query))
    )
    SELECT k.id, k.keyword, k.market, k.volume_fr, k.volume_ch, k.volume_market,
           live.current_position, live.current_impressions, live.current_clicks,
           live.latest_data_date,
           CASE WHEN live.keyword_key IS NULL THEN 'not_observed' ELSE 'gsc_query_level' END AS position_source,
           k.site_id, s.name AS site_name, s.url AS site_url
    FROM tracked_keywords k
    JOIN sites s ON s.id = k.site_id
    LEFT JOIN live ON live.site_id = k.site_id AND live.keyword_key = LOWER(BTRIM(k.keyword))
    WHERE k.is_active = TRUE
      AND (${parsedSiteId}::int IS NULL OR k.site_id = ${parsedSiteId})
      AND COALESCE(k.volume_market, k.volume_ch, k.volume_fr, 0) >= ${minVolFilter}
      AND COALESCE(live.current_position, 100) BETWEEN ${minPos} AND ${maxPos}
    ORDER BY COALESCE(k.volume_market, k.volume_ch, k.volume_fr, 0) DESC, live.current_position ASC NULLS LAST
    LIMIT 500
  `) as KeywordRow[];

  // Sites list for the filter dropdown
  const sites = (await sql`
    SELECT id, name, url
    FROM sites
    WHERE is_active = TRUE
      AND EXISTS (SELECT 1 FROM tracked_keywords k WHERE k.site_id = sites.id)
    ORDER BY name
  `) as Array<{ id: number; name: string; url: string }>;

  return NextResponse.json({
    source: "google_search_console_query_level",
    ranking_notice: "Positions ancrées sur la dernière date GSC importée de chaque domaine.",
    generated_at: new Date().toISOString(),
    sites,
    keywords: rows,
  });
}
