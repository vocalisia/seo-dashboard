import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// CTR benchmarks par position (Advanced Web Ranking 2026, all-intent)
const CTR_BENCHMARK: Record<number, number> = {
  1: 0.286, 2: 0.157, 3: 0.094, 4: 0.064, 5: 0.049,
  6: 0.038, 7: 0.030, 8: 0.024, 9: 0.020, 10: 0.017,
  11: 0.015, 12: 0.013, 13: 0.011, 14: 0.010, 15: 0.009,
  16: 0.008, 17: 0.007, 18: 0.006, 19: 0.005, 20: 0.005,
};

function expectedCtr(position: number): number {
  const p = Math.min(20, Math.max(1, Math.round(position)));
  return CTR_BENCHMARK[p] ?? 0.003;
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const days = parseInt(request.nextUrl.searchParams.get("days") || "28");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100");

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  if (isLocalDevDemoMode()) return NextResponse.json([]);

  try {
    const sql = getSQL();
    const id = parseInt(siteId);

    const rows = await sql`
      SELECT
        query,
        page,
        SUM(clicks) AS clicks,
        SUM(impressions) AS impressions,
        AVG(position) AS position,
        AVG(ctr) AS ctr
      FROM search_console_data
      WHERE site_id = ${id}
        AND date >= NOW() - INTERVAL '1 day' * ${days}
        AND query IS NOT NULL
        AND position <= 20
      GROUP BY query, page
      HAVING SUM(impressions) >= 200
      ORDER BY SUM(impressions) DESC
      LIMIT 500
    `;

    const enriched = (rows as Record<string, unknown>[]).map(r => {
      const position = Number(r.position);
      const impressions = Number(r.impressions);
      const clicks = Number(r.clicks);
      const ctrActual = clicks / Math.max(1, impressions);
      const ctrExpected = expectedCtr(position);
      const gap = ctrActual - ctrExpected;
      const gapPct = ctrExpected > 0 ? (gap / ctrExpected) * 100 : 0;
      const missedClicks = Math.max(0, Math.round(impressions * ctrExpected - clicks));

      let diagnosis = "";
      if (gapPct < -50) diagnosis = "🚨 Très anormalement bas — vérifier title/meta + AIO";
      else if (gapPct < -25) diagnosis = "⚠️ CTR sous-performant — réécrire title/meta";
      else if (gapPct > 50) diagnosis = "🌟 Sur-performe — extraire le pattern pour autres pages";
      else diagnosis = "✓ Normal";

      return {
        query: r.query,
        page: r.page,
        position: Number(position.toFixed(1)),
        impressions,
        clicks,
        ctr_actual: Number((ctrActual * 100).toFixed(2)),
        ctr_expected: Number((ctrExpected * 100).toFixed(2)),
        gap_pct: Number(gapPct.toFixed(0)),
        missed_clicks: missedClicks,
        diagnosis,
      };
    });

    // Garde uniquement anomalies négatives ≥ 25% sous benchmark
    const anomalies = enriched
      .filter(e => e.gap_pct <= -25)
      .sort((a, b) => b.missed_clicks - a.missed_clicks)
      .slice(0, limit);

    return NextResponse.json(anomalies);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
