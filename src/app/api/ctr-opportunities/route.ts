import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";

export const dynamic = "force-dynamic";

const EXPECTED_CTR: Record<number, number> = {
  1: 0.30, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05,
  6: 0.04, 7: 0.03, 8: 0.025, 9: 0.02, 10: 0.015,
};

function getExpectedCtr(position: number): number {
  const rounded = Math.round(position);
  return EXPECTED_CTR[Math.min(Math.max(rounded, 1), 10)] ?? 0.015;
}

export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const startedAt = Date.now();
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id");
    const days = parseInt(searchParams.get("days") ?? "30", 10);

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
        SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0) as position,
        SUM(d.clicks) as clicks,
        SUM(d.impressions) as impressions,
        CAST(SUM(d.clicks) AS FLOAT) / NULLIF(SUM(d.impressions), 0) as ctr
      FROM search_console_data d
      LEFT JOIN sites s ON s.id = d.site_id
      WHERE (${isAll} OR d.site_id = ${parsedSiteId})
        AND d.date >= NOW() - INTERVAL '1 day' * ${days}
        AND d.query IS NOT NULL
      GROUP BY d.query, d.site_id, s.name
      HAVING SUM(impressions) >= 50
        AND (SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0)) <= 10
      ORDER BY SUM(d.impressions) DESC
      LIMIT ${isAll ? 300 : 50}
    `;

    const results = rows
      .map((row: Record<string, unknown>) => {
        const position = Number(row.position);
        const impressions = Number(row.impressions);
        const clicks = Number(row.clicks);
        const actualCtr = Number(row.ctr) || 0;
        const expectedCtr = getExpectedCtr(position);
        const ctrGap = expectedCtr - actualCtr;
        const potentialClicks = Math.round(ctrGap * impressions);

        return {
          query: row.query as string,
          site_id: Number(row.site_id),
          site_name: row.site_name ? String(row.site_name) : null,
          position: Math.round(position * 10) / 10,
          clicks,
          impressions,
          actualCtr: Math.round(actualCtr * 10000) / 10000,
          expectedCtr,
          ctrGap: Math.round(ctrGap * 10000) / 10000,
          potentialClicks,
        };
      })
      .filter((r) => r.ctrGap > 0)
      .sort((a, b) => b.potentialClicks - a.potentialClicks);

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
