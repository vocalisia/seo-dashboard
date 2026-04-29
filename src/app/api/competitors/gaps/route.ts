export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface GapRow {
  keyword: string;
  our_position: number | null;
  competitor_positions: { domain: string; pos: number }[];
  volume: number;
}

export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId) {
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
        WHERE cr.site_id = ${parseInt(siteId, 10)}
          AND cr.competitor_position <= 10
        ORDER BY cr.estimated_volume DESC
        LIMIT 100
      ` as { keyword: string; competitor_domain: string; competitor_position: number; estimated_volume: number }[];

      if (competitorRows.length > 0) {
        // Get our positions for these keywords
        const keywords = competitorRows.map((r) => r.keyword);
        const ourPositions = await sql`
          SELECT query, AVG(position)::float AS pos
          FROM search_console_data
          WHERE site_id = ${parseInt(siteId, 10)}
            AND query = ANY(${keywords})
            AND date >= NOW() - INTERVAL '30 days'
          GROUP BY query
        ` as { query: string; pos: number }[];

        const ourPosMap: Record<string, number> = {};
        for (const row of ourPositions) {
          ourPosMap[row.query] = Number(row.pos);
        }

        // Group by keyword
        const keywordMap: Record<string, GapRow> = {};
        for (const row of competitorRows) {
          const ourPos = ourPosMap[row.keyword] ?? null;
          // Only include if we're not in top 50
          if (ourPos !== null && ourPos <= 50) continue;

          if (!keywordMap[row.keyword]) {
            keywordMap[row.keyword] = {
              keyword: row.keyword,
              our_position: ourPos,
              competitor_positions: [],
              volume: row.estimated_volume,
            };
          }
          keywordMap[row.keyword].competitor_positions.push({
            domain: row.competitor_domain,
            pos: Number(row.competitor_position),
          });
        }

        const gaps = Object.values(keywordMap).sort((a, b) => b.volume - a.volume);
        return NextResponse.json({ success: true, gaps });
      }
    }

    // Fallback: positions > 30 from our own data = potential gaps
    const fallbackRows = await sql`
      SELECT
        query AS keyword,
        AVG(position)::float AS our_position,
        SUM(impressions)::int AS impressions
      FROM search_console_data
      WHERE site_id = ${parseInt(siteId, 10)}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
      GROUP BY query
      HAVING AVG(position) > 30
      ORDER BY SUM(impressions) DESC
      LIMIT 100
    ` as { keyword: string; our_position: number; impressions: number }[];

    const gaps: GapRow[] = fallbackRows.map((r) => {
      const pos = Number(r.our_position);
      const imp = Number(r.impressions);
      const share = pos <= 50 ? 0.02 : 0.01;
      const volume = Math.round(imp / share);
      return {
        keyword: r.keyword,
        our_position: pos,
        competitor_positions: [],
        volume,
      };
    });

    return NextResponse.json({ success: true, gaps, fallback: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
