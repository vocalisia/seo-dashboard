import { sql } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const type = request.nextUrl.searchParams.get("type") || "queries";
  const days = request.nextUrl.searchParams.get("days") || "30";
  const limit = request.nextUrl.searchParams.get("limit") || "50";

  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  try {
    if (type === "queries") {
      const { rows } = await sql`
        SELECT
          query,
          SUM(clicks) as total_clicks,
          SUM(impressions) as total_impressions,
          AVG(ctr) as avg_ctr,
          AVG(position) as avg_position
        FROM search_console_data
        WHERE site_id = ${parseInt(siteId)}
        AND date >= NOW() - INTERVAL '1 day' * ${parseInt(days)}
        AND query IS NOT NULL
        GROUP BY query
        ORDER BY total_clicks DESC
        LIMIT ${parseInt(limit)}
      `;
      return NextResponse.json(rows);
    }

    if (type === "pages") {
      const { rows } = await sql`
        SELECT
          page,
          SUM(clicks) as total_clicks,
          SUM(impressions) as total_impressions,
          AVG(ctr) as avg_ctr,
          AVG(position) as avg_position,
          COUNT(DISTINCT query) as keyword_count
        FROM search_console_data
        WHERE site_id = ${parseInt(siteId)}
        AND date >= NOW() - INTERVAL '1 day' * ${parseInt(days)}
        AND page IS NOT NULL
        GROUP BY page
        ORDER BY total_clicks DESC
        LIMIT ${parseInt(limit)}
      `;
      return NextResponse.json(rows);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
