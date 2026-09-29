import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteId = request.nextUrl.searchParams.get("siteId");
  const daysParam = request.nextUrl.searchParams.get("days") || "30";

  if (!siteId) {
    return NextResponse.json({ error: "siteId required" }, { status: 400 });
  }

  const siteIdNum = parseInt(siteId, 10);
  const daysNum = parseInt(daysParam, 10);
  if (!Number.isFinite(siteIdNum) || siteIdNum <= 0) {
    return NextResponse.json({ error: "Invalid siteId" }, { status: 400 });
  }
  if (!Number.isFinite(daysNum) || daysNum <= 0 || daysNum > 365) {
    return NextResponse.json({ error: "Invalid days (1..365)" }, { status: 400 });
  }

  if (isLocalDevDemoMode()) {
    return NextResponse.json([]);
  }

  try {
    const sql = getSQL();
    // The daily GA4 sync ends yesterday. Select N complete days, ending yesterday,
    // so a one-day request never reads an unsynced current-day row.
    const rows = await sql`
      SELECT * FROM analytics_daily
      WHERE site_id = ${siteIdNum}
      AND date >= (CURRENT_DATE - INTERVAL '1 day' * ${daysNum})::date
      AND date < CURRENT_DATE
      ORDER BY date ASC
    `;
    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
