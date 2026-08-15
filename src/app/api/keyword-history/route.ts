import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteId = request.nextUrl.searchParams.get("siteId");
  const query = request.nextUrl.searchParams.get("query");
  const days = parseInt(request.nextUrl.searchParams.get("days") || "90", 10);

  if (!siteId || !query) return NextResponse.json({ error: "siteId + query required" }, { status: 400 });

  if (isLocalDevDemoMode()) {
    return NextResponse.json([]);
  }

  try {
    const sql = getSQL();
    const id = parseInt(siteId, 10);
    if (Number.isNaN(id) || Number.isNaN(days)) {
      return NextResponse.json({ error: "invalid siteId or days" }, { status: 400 });
    }

    const rows = await sql`
      WITH anchor AS (
        SELECT MAX(date) AS end_date
        FROM search_console_query_data
        WHERE site_id = ${id}
          AND LOWER(query) = LOWER(${query})
          AND position BETWEEN 1 AND 200
      )
      SELECT
        date::text as date,
        SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) as position,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions
      FROM search_console_query_data
      WHERE site_id = ${id}
        AND LOWER(query) = LOWER(${query})
        AND date >= ((SELECT end_date FROM anchor) - INTERVAL '1 day' * (${days} - 1))::date
        AND date <= (SELECT end_date FROM anchor)
        AND position BETWEEN 1 AND 200
      GROUP BY date
      ORDER BY date ASC
    `;

    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
