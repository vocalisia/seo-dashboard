import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// CTR benchmarks par position (Advanced Web Ranking 2026, moyenne all-intent)
const CTR_BENCHMARK: Record<number, number> = {
  1: 0.286, 2: 0.157, 3: 0.094, 4: 0.064, 5: 0.049,
  6: 0.038, 7: 0.030, 8: 0.024, 9: 0.020, 10: 0.017,
};

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;
  const siteId = request.nextUrl.searchParams.get("siteId");
  const days = Number(request.nextUrl.searchParams.get("days") || "28");
  const limit = Number(request.nextUrl.searchParams.get("limit") || "100");

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  const parsedSiteId = siteId === "all" ? null : Number(siteId);
  if ((parsedSiteId !== null && (!Number.isInteger(parsedSiteId) || parsedSiteId <= 0)) || !Number.isInteger(days) || days < 1 || days > 365 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    return NextResponse.json({ error: "invalid query parameters" }, { status: 400 });
  }
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
            SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0) AS position,
            SUM(d.clicks)::float / NULLIF(SUM(d.impressions), 0) AS ctr
          FROM search_console_data d
          LEFT JOIN sites s ON s.id = d.site_id
          WHERE d.date >= NOW() - INTERVAL '1 day' * ${days}
            AND d.query IS NOT NULL
          GROUP BY d.query, d.page, d.site_id, s.name
          HAVING SUM(d.impressions) > 100 AND SUM(d.clicks) > 0
            AND (SUM(d.position * d.impressions)::float / NULLIF(SUM(d.impressions), 0)) BETWEEN 11 AND 20
          ORDER BY SUM(d.impressions) DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            query, page,
            ${parsedSiteId}::int AS site_id,
            NULL::text AS site_name,
            SUM(clicks) AS clicks,
            SUM(impressions) AS impressions,
            SUM(position * impressions)::float / NULLIF(SUM(impressions), 0) AS position,
            SUM(clicks)::float / NULLIF(SUM(impressions), 0) AS ctr
          FROM search_console_data
          WHERE site_id = ${parsedSiteId}
            AND date >= NOW() - INTERVAL '1 day' * ${days}
            AND query IS NOT NULL
          GROUP BY query, page
          HAVING SUM(impressions) > 100 AND SUM(clicks) > 0
            AND (SUM(position * impressions)::float / NULLIF(SUM(impressions), 0)) BETWEEN 11 AND 20
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
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
