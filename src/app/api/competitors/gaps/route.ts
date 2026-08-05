export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { sortGapsByKnownVolume, toGscOpportunities, type CompetitorGap } from "@/lib/competitor-gaps";
import { requireApiSession } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteId = req.nextUrl.searchParams.get("siteId");
  const parsedSiteId = Number(siteId);
  if (!Number.isInteger(parsedSiteId) || parsedSiteId <= 0) {
    return NextResponse.json(
      { success: false, error: "siteId required" },
      { status: 400 }
    );
  }

  const sql = getSQL();

  try {
    // Check if competitor_research table exists with data
    const hasData = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM information_schema.tables
      WHERE table_name = 'competitor_research'
    `;

    const tableExists = (hasData[0] as { cnt: number }).cnt > 0;

    if (tableExists) {
      const competitorRows = await sql`
        SELECT cr.keyword, cr.competitor_domain, cr.competitor_position::float, cr.estimated_volume
        FROM competitor_research cr
        WHERE cr.site_id = ${parsedSiteId}
          AND cr.competitor_position <= 10
        ORDER BY cr.estimated_volume DESC
        LIMIT 100
      ` as { keyword: string; competitor_domain: string; competitor_position: number; estimated_volume: number }[];

      if (competitorRows.length > 0) {
        // Get our positions for these keywords
        const keywords = competitorRows.map((r) => r.keyword);
        const ourPositions = await sql`
          SELECT query, SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos
          FROM search_console_query_data
          WHERE site_id = ${parsedSiteId}
            AND query = ANY(${keywords})
            AND date >= NOW() - INTERVAL '30 days'
          GROUP BY query
        ` as { query: string; pos: number }[];

        const ourPosMap: Record<string, number> = {};
        for (const row of ourPositions) {
          ourPosMap[row.query] = Number(row.pos);
        }

        // Group by keyword
        const keywordMap: Record<string, CompetitorGap> = {};
        for (const row of competitorRows) {
          const ourPos = ourPosMap[row.keyword] ?? null;
          // Only include if we're not in top 50
          if (ourPos !== null && ourPos <= 50) continue;

          if (!keywordMap[row.keyword]) {
            keywordMap[row.keyword] = {
              keyword: row.keyword,
              our_position: ourPos,
              competitor_positions: [],
              volume: Number(row.estimated_volume) > 0 ? Number(row.estimated_volume) : null,
              source: "competitor_cache",
            };
          }
          keywordMap[row.keyword].competitor_positions.push({
            domain: row.competitor_domain,
            pos: Number(row.competitor_position),
          });
        }

        const gaps = sortGapsByKnownVolume(Object.values(keywordMap));
        return NextResponse.json({ success: true, gaps, data_status: "competitor_cache" });
      }
    }

    // Without verified competitor research, expose only first-party GSC opportunities.
    // Impressions are deliberately kept separate from search volume.
    const fallbackRows = await sql`
      SELECT
        query AS keyword,
        SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS our_position,
        SUM(impressions)::int AS impressions
      FROM search_console_query_data
      WHERE site_id = ${parsedSiteId}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
      GROUP BY query
      HAVING AVG(position) > 30
      ORDER BY SUM(impressions) DESC
      LIMIT 100
    ` as { keyword: string; our_position: number; impressions: number }[];

    const gaps = toGscOpportunities(fallbackRows);

    return NextResponse.json({
      success: true,
      gaps,
      fallback: true,
      data_status: "own_gsc_opportunities",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
