import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Heuristique AIO sans scraping :
// AIO probable si position TOP 3 informationnelle ET CTR < 50% du benchmark attendu
// Queries informationnelles = contiennent : comment, pourquoi, qu'est-ce, what, how, why, what is, guide, exemple
const INFO_PATTERNS = /\b(comment|pourquoi|qu(?:'|´|`)?est[\s-]?ce|what|how|why|when|where|guide|exemple|example|tutorial|tutoriel|d[ée]finition|definition|signification|meaning)\b/i;

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
        AND position <= 10
      GROUP BY query, page
      HAVING SUM(impressions) >= 100
    `;

    const flagged = (rows as Record<string, unknown>[]).map(r => {
      const query = String(r.query);
      const pos = Math.round(Number(r.position));
      const impressions = Number(r.impressions);
      const clicks = Number(r.clicks);
      const ctrActual = clicks / Math.max(1, impressions);
      const ctrExpected = CTR_BENCHMARK[pos] ?? 0.01;
      const ratio = ctrActual / ctrExpected;
      const isInfo = INFO_PATTERNS.test(query);
      const aioSuspect = isInfo && ratio < 0.5 && pos <= 5;
      if (!aioSuspect) return null;

      const missedClicks = Math.round(impressions * ctrExpected - clicks);
      return {
        query,
        page: r.page,
        position: Number(Number(r.position).toFixed(1)),
        impressions,
        clicks,
        ctr_actual_pct: Number((ctrActual * 100).toFixed(2)),
        ctr_expected_pct: Number((ctrExpected * 100).toFixed(2)),
        ctr_ratio: Number(ratio.toFixed(2)),
        missed_clicks: Math.max(0, missedClicks),
        aio_likely: true,
        recommendation: ratio < 0.3
          ? "🚨 AIO probable — réécrire pour citation IA (data + structure FAQ + bullet points)"
          : "⚠️ AIO suspect — ajouter section 'Réponse rapide' en début d'article",
      };
    }).filter(Boolean);

    flagged.sort((a, b) => (b!.missed_clicks as number) - (a!.missed_clicks as number));
    return NextResponse.json(flagged.slice(0, limit));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
