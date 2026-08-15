import { getSQL } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteId = request.nextUrl.searchParams.get("siteId");
  const requestedLimit = parseInt(request.nextUrl.searchParams.get("limit") || "4", 10);
  const limit = Math.min(12, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 4));

  try {
    const sql = getSQL();

    if (siteId) {
      const parsedSiteId = Number(siteId);
      if (!Number.isInteger(parsedSiteId) || parsedSiteId <= 0) {
        return NextResponse.json(
          { success: false, error: "siteId must be a positive integer" },
          { status: 400 },
        );
      }

      const rows = await sql`
        SELECT
          wr.id,
          wr.site_id,
          wr.week_start,
          COALESCE(wr.summary, '') AS summary,
          COALESCE(wr.recommendations, '') AS recommendations,
          COALESCE(wr.top_opportunities, '[]'::jsonb) AS top_opportunities,
          wr.created_at,
          s.name AS site_name,
          s.url AS site_url
        FROM weekly_reports wr
        JOIN sites s ON s.id = wr.site_id
        WHERE wr.site_id = ${parsedSiteId}
        ORDER BY wr.week_start DESC
        LIMIT ${limit}
      `;
      return NextResponse.json(rows);
    }

    // Latest report per site
    const rows = await sql`
      SELECT DISTINCT ON (wr.site_id)
        wr.id,
        wr.site_id,
        wr.week_start,
        COALESCE(wr.summary, '') AS summary,
        COALESCE(wr.recommendations, '') AS recommendations,
        COALESCE(wr.top_opportunities, '[]'::jsonb) AS top_opportunities,
        wr.created_at,
        s.name AS site_name,
        s.url AS site_url
      FROM weekly_reports wr
      JOIN sites s ON s.id = wr.site_id
      ORDER BY wr.site_id, wr.week_start DESC
    `;
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
