import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id");

    if (!siteId) return NextResponse.json({ error: "site_id required" }, { status: 400 });

    const sql = getSQL();
    const rows = await sql`
      SELECT
        query,
        COUNT(DISTINCT page) as page_count,
        array_agg(DISTINCT page) as pages,
        AVG(position) as avg_position,
        SUM(clicks) as clicks
      FROM search_console_data
      WHERE site_id = ${parseInt(siteId, 10)}
        AND date >= NOW() - INTERVAL '30 days'
        AND page IS NOT NULL
        AND page != ''
      GROUP BY query
      HAVING COUNT(DISTINCT page) >= 2
      ORDER BY SUM(clicks) DESC
      LIMIT 30
    `;

    const results = (rows as Record<string, unknown>[]).map((row) => ({
      query: row.query as string,
      pageCount: Number(row.page_count),
      pages: row.pages as string[],
      avgPosition: Math.round(Number(row.avg_position) * 10) / 10,
      clicks: Number(row.clicks),
    }));

    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
