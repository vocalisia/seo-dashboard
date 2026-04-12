import { NextRequest, NextResponse } from "next/server";
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
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id");
    const days = parseInt(searchParams.get("days") ?? "30", 10);

    if (!siteId) return NextResponse.json({ error: "site_id required" }, { status: 400 });

    const sql = getSQL();
    const rows = await sql`
      SELECT
        query,
        AVG(position) as position,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        CAST(SUM(clicks) AS FLOAT) / NULLIF(SUM(impressions), 0) as ctr
      FROM search_console_data
      WHERE site_id = ${parseInt(siteId, 10)}
        AND date >= NOW() - INTERVAL '1 day' * ${days}
        AND impressions >= 50
      GROUP BY query
      HAVING AVG(position) <= 10
      ORDER BY SUM(impressions) DESC
      LIMIT 50
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

    return NextResponse.json(results);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
