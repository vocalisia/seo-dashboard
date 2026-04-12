import { getSQL } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "4");

  try {
    const sql = getSQL();

    if (siteId) {
      const rows = await sql`
        SELECT wr.*, s.name as site_name, s.url as site_url
        FROM weekly_reports wr
        JOIN sites s ON s.id = wr.site_id
        WHERE wr.site_id = ${parseInt(siteId)}
        ORDER BY wr.week_start DESC
        LIMIT ${limit}
      `;
      return NextResponse.json(rows);
    }

    // Latest report per site
    const rows = await sql`
      SELECT DISTINCT ON (wr.site_id)
        wr.*, s.name as site_name, s.url as site_url
      FROM weekly_reports wr
      JOIN sites s ON s.id = wr.site_id
      ORDER BY wr.site_id, wr.week_start DESC
    `;
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
