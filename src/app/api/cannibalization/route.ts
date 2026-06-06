import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const startedAt = Date.now();
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id");

    if (!siteId) return NextResponse.json({ error: "site_id required" }, { status: 400 });

    const sql = getSQL();
    const isAll = siteId === "all";
    const parsedSiteId = Number.parseInt(siteId, 10);
    if (!isAll && (!Number.isFinite(parsedSiteId) || parsedSiteId <= 0)) {
      return NextResponse.json({ error: "Invalid site_id" }, { status: 400 });
    }

    const rows = await sql`
      SELECT
        d.query,
        d.site_id,
        s.name AS site_name,
        COUNT(DISTINCT d.page) as page_count,
        array_agg(DISTINCT d.page) as pages,
        SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0) as avg_position,
        SUM(d.clicks) as clicks
      FROM search_console_data d
      LEFT JOIN sites s ON s.id = d.site_id
      WHERE (${isAll} OR d.site_id = ${parsedSiteId})
        AND d.date >= NOW() - INTERVAL '30 days'
        AND d.page IS NOT NULL
        AND d.page != ''
        AND d.query IS NOT NULL
      GROUP BY d.query, d.site_id, s.name
      HAVING COUNT(DISTINCT page) >= 2
      ORDER BY SUM(d.clicks) DESC
      LIMIT ${isAll ? 200 : 30}
    `;

    const results = (rows as Record<string, unknown>[]).map((row) => ({
      query: row.query as string,
      site_id: Number(row.site_id),
      site_name: row.site_name ? String(row.site_name) : null,
      pageCount: Number(row.page_count),
      pages: row.pages as string[],
      avgPosition: Math.round(Number(row.avg_position) * 10) / 10,
      clicks: Number(row.clicks),
    }));

    return NextResponse.json(results, {
      headers: {
        "X-Response-Time": `${Date.now() - startedAt}ms`,
        "Server-Timing": `app;dur=${Date.now() - startedAt}`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
