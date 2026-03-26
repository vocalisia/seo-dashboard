import { getSQL } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const days = request.nextUrl.searchParams.get("days") || "30";

  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  try {
    const sql = getSQL();
    const rows = await sql`
      SELECT * FROM analytics_daily
      WHERE site_id = ${parseInt(siteId)}
      AND date >= NOW() - INTERVAL '1 day' * ${parseInt(days)}
      ORDER BY date ASC
    `;
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
