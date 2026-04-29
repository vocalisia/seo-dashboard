import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// CTR benchmarks par position (Advanced Web Ranking 2026, moyenne all-intent)
const CTR_BENCHMARK: Record<number, number> = {
  1: 0.286, 2: 0.157, 3: 0.094, 4: 0.064, 5: 0.049,
  6: 0.038, 7: 0.030, 8: 0.024, 9: 0.020, 10: 0.017,
};

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const days = parseInt(request.nextUrl.searchParams.get("days") || "28");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100");

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  if (isLocalDevDemoMode()) return NextResponse.json([]);

  try {
    const sql = getSQL();
    const isAll = siteId === "all";

    const rows = isAll
      ? await sql`
          SELECT
            d.query, d.page, d.site_id, s.name AS site_name,
            SUM(d.clicks) AS clicks,
            SUM(d.impressions) AS impressions,
            AVG(d.position) AS position,
            AVG(d.ctr) AS ctr
          FROM search_console_data d
          LEFT JOIN sites s ON s.id = d.site_id
          WHERE d.date >= NOW() - INTERVAL '1 day' * ${days}
            AND d.query IS NOT NULL
            AND d.position BETWEEN 8 AND 20
          GROUP BY d.query, d.page, d.site_id, s.name
          HAVING SUM(d.impressions) > 100 AND SUM(d.clicks) > 0
          ORDER BY SUM(d.impressions) DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            query, page,
            ${parseInt(siteId)}::int AS site_id,
            NULL::text AS site_name,
            SUM(clicks) AS clicks,
            SUM(impressions) AS impressions,
            AVG(position) AS position,
            AVG(ctr) AS ctr
          FROM search_console_data
          WHERE site_id = ${parseInt(siteId)}
            AND date >= NOW() - INTERVAL '1 day' * ${days}
            AND query IS NOT NULL
            AND position BETWEEN 8 AND 20
          GROUP BY query, page
          HAVING SUM(impressions) > 100 AND SUM(clicks) > 0
          ORDER BY SUM(impressions) DESC
          LIMIT ${limit}
        `;

    const enriched = (rows as Record<string, unknown>[]).map(r => {
      const ctrTarget = CTR_BENCHMARK[5];
      const ctrActual = Number(r.ctr);
      const impressions = Number(r.impressions);
      const clicksNow = Number(r.clicks);
      const clicksAtPos5 = Math.round(impressions * ctrTarget);
      const uplift = Math.max(0, clicksAtPos5 - clicksNow);
      return {
        query: r.query,
        page: r.page,
        site_id: r.site_id !== undefined && r.site_id !== null ? Number(r.site_id) : null,
        site_name: r.site_name ? String(r.site_name) : null,
        clicks: clicksNow,
        impressions,
        position: Number(Number(r.position).toFixed(1)),
        ctr: Number((ctrActual * 100).toFixed(2)),
        uplift_estimate: uplift,
        priority: uplift > 100 ? "P0" : uplift > 30 ? "P1" : "P2",
      };
    });

    return NextResponse.json(enriched.sort((a, b) => b.uplift_estimate - a.uplift_estimate));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
