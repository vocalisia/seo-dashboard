import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("site_id");
    const days = parseInt(searchParams.get("days") ?? "30", 10);

    if (!siteId) return NextResponse.json({ error: "site_id required" }, { status: 400 });

    if (isLocalDevDemoMode()) {
      return NextResponse.json({ overview: [], topQueriesByDevice: {} });
    }

    const sql = getSQL();
    const siteIdNum = parseInt(siteId, 10);

    const overview = await sql`
      SELECT
        device,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        AVG(position) as position,
        CAST(SUM(clicks) AS FLOAT) / NULLIF(SUM(impressions), 0) as ctr
      FROM search_console_data
      WHERE site_id = ${siteIdNum}
        AND date >= NOW() - INTERVAL '1 day' * ${days}
        AND device IS NOT NULL
        AND device != ''
      GROUP BY device
      ORDER BY SUM(clicks) DESC
    `;

    const topByDevice = await sql`
      SELECT
        device,
        query,
        SUM(clicks) as clicks,
        SUM(impressions) as impressions,
        AVG(position) as position
      FROM search_console_data
      WHERE site_id = ${siteIdNum}
        AND date >= NOW() - INTERVAL '1 day' * ${days}
        AND device IS NOT NULL
        AND device != ''
      GROUP BY device, query
      ORDER BY device, SUM(clicks) DESC
    `;

    const topQueriesByDevice: Record<string, unknown[]> = {};
    for (const row of topByDevice as Record<string, unknown>[]) {
      const dev = row.device as string;
      if (!topQueriesByDevice[dev]) topQueriesByDevice[dev] = [];
      if (topQueriesByDevice[dev].length < 10) {
        topQueriesByDevice[dev].push({
          query: row.query,
          clicks: Number(row.clicks),
          impressions: Number(row.impressions),
          position: Math.round(Number(row.position) * 10) / 10,
        });
      }
    }

    const formattedOverview = (overview as Record<string, unknown>[]).map((row) => ({
      device: row.device as string,
      clicks: Number(row.clicks),
      impressions: Number(row.impressions),
      position: Math.round(Number(row.position) * 10) / 10,
      ctr: Math.round(Number(row.ctr) * 10000) / 10000,
    }));

    return NextResponse.json({ overview: formattedOverview, topQueriesByDevice });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
