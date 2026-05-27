export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface Breakdown {
  gsc_score: number;
  pagespeed_score: number;
  content_score: number;
  position_score: number;
}

function computeGrade(score: number): string {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "F";
}

function generateRecommendations(breakdown: Breakdown): string[] {
  const recs: string[] = [];

  const sorted = Object.entries(breakdown).sort(
    ([, a], [, b]) => a - b
  ) as [keyof Breakdown, number][];

  for (const [key, value] of sorted) {
    if (recs.length >= 5) break;

    if (key === "content_score" && value < 80) {
      recs.push(
        value < 40
          ? "Publish more content — aim for at least 20 articles to maximize content score."
          : "Continue publishing regularly to strengthen content authority."
      );
    }

    if (key === "pagespeed_score" && value < 80) {
      recs.push(
        value < 40
          ? "Page speed is critically low — optimize images, enable caching, and reduce JS bundles."
          : "Improve page speed scores — focus on LCP and CLS for better Core Web Vitals."
      );
    }

    if (key === "gsc_score" && value < 80) {
      recs.push(
        value < 40
          ? "Traffic is very low — build backlinks, target long-tail keywords, and increase content volume."
          : "Boost organic traffic by optimizing meta titles/descriptions and improving CTR."
      );
    }

    if (key === "position_score" && value < 80) {
      recs.push(
        value < 40
          ? "Average ranking position is poor — target less competitive keywords and improve on-page SEO."
          : "Improve keyword positions by updating existing content and building topical authority."
      );
    }
  }

  if (recs.length === 0) {
    recs.push("SEO health is strong — maintain current strategy and monitor for changes.");
  }

  return recs;
}

export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("site_id");

  if (!siteId || isNaN(Number(siteId))) {
    return NextResponse.json(
      { success: false, error: "site_id query parameter required (number)" },
      { status: 400 }
    );
  }

  const sql = getSQL();
  const site_id = Number(siteId);

  try {
    // 1. GSC performance (30d) — clicks, impressions, avg position (impressions-weighted)
    const gscRows = (await sql`
      SELECT
        COALESCE(SUM(clicks), 0) AS total_clicks,
        COALESCE(SUM(impressions), 0) AS total_impressions,
        SUM(position * impressions)::float / NULLIF(SUM(impressions), 0) AS avg_position,
        COUNT(DISTINCT page) AS distinct_pages
      FROM search_console_data
      WHERE site_id = ${site_id}
        AND date >= (CURRENT_DATE - INTERVAL '30 days')::date
    `) as { total_clicks: number; total_impressions: number; avg_position: number | null; distinct_pages: number }[];

    const gscData = gscRows[0] ?? { total_clicks: 0, total_impressions: 0, avg_position: null, distinct_pages: 0 };
    const clicks = Number(gscData.total_clicks);
    const impressions = Number(gscData.total_impressions);
    const avgPosition = gscData.avg_position != null ? Number(gscData.avg_position) : null;
    const distinctPages = Number(gscData.distinct_pages);
    const hasGSCData = clicks > 0 || impressions > 0;

    // 2. PageSpeed scores (latest)
    const psRows = (await sql`
      SELECT mobile_score, desktop_score
      FROM pagespeed_scores
      WHERE site_id = ${site_id}
      ORDER BY checked_at DESC
      LIMIT 1
    `) as { mobile_score: number | null; desktop_score: number | null }[];

    const psData = psRows[0] ?? { mobile_score: null, desktop_score: null };
    const mobileScore = psData.mobile_score != null ? Number(psData.mobile_score) : null;
    const desktopScore = psData.desktop_score != null ? Number(psData.desktop_score) : null;
    const hasPagespeed = mobileScore != null || desktopScore != null;

    // 3. Content volume — count autopilot + count distinct pages indexed via GSC (fallback)
    let articleCount = 0;
    try {
      const contentRows = (await sql`
        SELECT COUNT(*) AS cnt FROM autopilot_runs
        WHERE site_id = ${site_id} AND status = 'published'
      `) as { cnt: number }[];
      articleCount = Number(contentRows[0]?.cnt ?? 0);
    } catch { /* table may not exist */ }
    // Use distinct_pages from GSC as fallback when autopilot has 0 (most user sites publish outside autopilot)
    const totalContentSignal = Math.max(articleCount, distinctPages);

    // --- Scoring ---
    // GSC: normalize by log scale (clicks 0-1000 -> 0-100, impressions 0-100000 -> 0-100)
    // Avoids the unbounded "site explodes to 100 instantly" bug.
    const gsc_score = hasGSCData
      ? Math.min(100, Math.round(
          (Math.log10(clicks + 1) / Math.log10(1001)) * 50 +
          (Math.log10(impressions + 1) / Math.log10(100001)) * 50
        ))
      : 0;

    // Pagespeed: actual average, null when no scan ever performed (excluded from overall)
    const pagespeed_score = hasPagespeed
      ? (mobileScore != null && desktopScore != null
          ? Math.round((mobileScore + desktopScore) / 2)
          : Math.round(mobileScore ?? desktopScore ?? 0))
      : null;

    // Content: includes GSC indexed pages, not just autopilot
    const content_score = Math.min(100, Math.round(totalContentSignal * 3));

    // Position: lower is better. null when no data → score = 0. avg pos 1 = 100, pos 30 = 40, pos 50+ = 0.
    const position_score = avgPosition != null
      ? Math.max(0, Math.round(100 - (avgPosition - 1) * 2.5))
      : 0;

    // Overall: weighted average, excluding components with null data (renormalize weights)
    const components: { score: number; weight: number }[] = [
      { score: gsc_score, weight: 0.35 },
      { score: content_score, weight: 0.20 },
      { score: position_score, weight: 0.25 },
    ];
    if (pagespeed_score != null) {
      components.push({ score: pagespeed_score, weight: 0.20 });
    }
    const totalWeight = components.reduce((a, c) => a + c.weight, 0);
    const overall_score = Math.round(
      components.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight
    );

    const breakdown: Breakdown = {
      gsc_score,
      pagespeed_score: pagespeed_score ?? -1, // -1 = no data (UI should display N/A)
      content_score,
      position_score,
    };

    const grade = computeGrade(overall_score);
    const recommendations = generateRecommendations(breakdown);

    return NextResponse.json({
      success: true,
      grade,
      overall_score: Math.round(overall_score * 100) / 100,
      breakdown,
      recommendations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
