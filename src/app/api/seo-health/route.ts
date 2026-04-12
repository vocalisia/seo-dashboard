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
    // 1. GSC performance (30d) — clicks, impressions, avg position
    const gscRows = (await sql`
      SELECT
        COALESCE(SUM(clicks), 0) AS total_clicks,
        COALESCE(SUM(impressions), 0) AS total_impressions,
        COALESCE(AVG(position), 50) AS avg_position
      FROM search_console_data
      WHERE site_id = ${site_id}
        AND date >= NOW() - INTERVAL '30 days'
    `) as { total_clicks: number; total_impressions: number; avg_position: number }[];

    const gscData = gscRows[0] ?? { total_clicks: 0, total_impressions: 0, avg_position: 50 };
    const clicks = Number(gscData.total_clicks);
    const impressions = Number(gscData.total_impressions);
    const avgPosition = Number(gscData.avg_position);

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

    // 3. Content volume (published articles)
    let articleCount = 0;
    try {
      const contentRows = (await sql`
        SELECT COUNT(*) AS cnt
        FROM autopilot_runs
        WHERE site_id = ${site_id}
          AND status = 'published'
      `) as { cnt: number }[];
      articleCount = Number(contentRows[0]?.cnt ?? 0);
    } catch {
      // table may not exist
    }

    // --- Scoring ---
    const gsc_score = Math.min(100, clicks * 0.5 + impressions / 100);
    const pagespeed_score =
      mobileScore != null && desktopScore != null
        ? (mobileScore + desktopScore) / 2
        : mobileScore ?? desktopScore ?? 0;
    const content_score = Math.min(100, articleCount * 5);
    const position_score = Math.max(0, 100 - avgPosition * 2);

    const overall_score =
      gsc_score * 0.3 +
      pagespeed_score * 0.25 +
      content_score * 0.2 +
      position_score * 0.25;

    const breakdown: Breakdown = {
      gsc_score: Math.round(gsc_score * 100) / 100,
      pagespeed_score: Math.round(pagespeed_score * 100) / 100,
      content_score: Math.round(content_score * 100) / 100,
      position_score: Math.round(position_score * 100) / 100,
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
    console.error("SEO health error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
