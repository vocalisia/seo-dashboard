export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

/**
 * GET /api/position-history?site_id=X&days=90
 *
 * Returns daily aggregated position + clicks + impressions for:
 * 1. Site-level averages over time
 * 2. Top 10 keywords with their daily position history
 */
export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("site_id");
  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10);

  if (!siteId) {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();
  const id = parseInt(siteId, 10);

  try {
    // 1. Site-level daily averages
    const siteHistory = await sql`
      SELECT date,
             AVG(NULLIF(position, 0)) AS avg_position,
             SUM(clicks) AS total_clicks,
             SUM(impressions) AS total_impressions
      FROM search_console_data
      WHERE site_id = ${id}
        AND date >= NOW() - INTERVAL '1 day' * ${days}
        AND country IS NULL
      GROUP BY date
      ORDER BY date ASC
    `;

    // 2. Top 10 keywords by impressions (last 30d)
    const topKeywords = await sql`
      SELECT query
      FROM search_console_data
      WHERE site_id = ${id}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
        AND country IS NULL
      GROUP BY query
      ORDER BY SUM(impressions) DESC
      LIMIT 10
    `;

    const keywordNames = topKeywords.map((r) => r.query as string);

    // 3. Daily position for each top keyword
    const keywordHistory = keywordNames.length > 0
      ? await sql`
          SELECT query, date, AVG(position) AS position, SUM(clicks) AS clicks
          FROM search_console_data
          WHERE site_id = ${id}
            AND date >= NOW() - INTERVAL '1 day' * ${days}
            AND query = ANY(${keywordNames})
            AND country IS NULL
          GROUP BY query, date
          ORDER BY query, date ASC
        `
      : [];

    // Group keyword history by keyword
    const kwMap: Record<string, { date: string; position: number; clicks: number }[]> = {};
    for (const row of keywordHistory) {
      const q = row.query as string;
      (kwMap[q] ??= []).push({
        date: (row.date as string).slice(0, 10),
        position: parseFloat(row.position as string),
        clicks: parseInt(row.clicks as string),
      });
    }

    return NextResponse.json({
      success: true,
      site_history: siteHistory.map((r) => ({
        date: (r.date as string).slice(0, 10),
        position: r.avg_position ? parseFloat(r.avg_position as string) : null,
        clicks: parseInt(r.total_clicks as string),
        impressions: parseInt(r.total_impressions as string),
      })),
      keywords: keywordNames.map((q) => ({
        keyword: q,
        history: kwMap[q] ?? [],
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
