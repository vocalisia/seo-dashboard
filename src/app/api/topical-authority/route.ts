import { getSQL } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface TopicalAuthorityScores {
  coverage_score: number;
  authority_score: number;
  content_score: number;
  overall_score: number;
}

interface TopicalAuthorityStats {
  unique_queries: number;
  avg_position: number;
  total_clicks: number;
  total_impressions: number;
  article_count: number;
  cluster_count: number;
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("site_id");

  if (!siteId) {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }

  const siteIdNum = parseInt(siteId, 10);

  if (isNaN(siteIdNum)) {
    return NextResponse.json({ error: "site_id must be a number" }, { status: 400 });
  }

  try {
    const sql = getSQL();

    // 1. Get site
    const siteRows = await sql`
      SELECT id, name, url FROM sites WHERE id = ${siteIdNum}
    `;

    if (siteRows.length === 0) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const site = siteRows[0];

    // 2. Get keyword clusters count
    const clusterRows = await sql`
      SELECT COUNT(*) as cluster_count
      FROM keyword_clusters
      WHERE site_id = ${siteIdNum}
    `;

    const clusterCount = Number(clusterRows[0]?.cluster_count ?? 0);

    // 3. Get GSC stats (30d)
    const gscRows = await sql`
      SELECT
        COUNT(DISTINCT query) as unique_queries,
        COALESCE(AVG(NULLIF(position, 0)), 0) as avg_position,
        COALESCE(SUM(clicks), 0) as total_clicks,
        COALESCE(SUM(impressions), 0) as total_impressions
      FROM search_console_data
      WHERE site_id = ${siteIdNum}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
        AND query != ''
    `;

    const gsc = gscRows[0];
    const uniqueQueries = Number(gsc?.unique_queries ?? 0);
    const avgPosition = Number(gsc?.avg_position ?? 0);
    const totalClicks = Number(gsc?.total_clicks ?? 0);
    const totalImpressions = Number(gsc?.total_impressions ?? 0);

    // 4. Get article count from autopilot_runs
    const articleRows = await sql`
      SELECT COUNT(*) as article_count
      FROM autopilot_runs
      WHERE site_id = ${siteIdNum}
    `;

    const articleCount = Number(articleRows[0]?.article_count ?? 0);

    // 5. Calculate scores
    const coverageScore = Math.min(100, (uniqueQueries / 200) * 100);
    const authorityScore = Math.max(0, Math.min(100, 100 - avgPosition));
    const contentScore = Math.min(100, (articleCount / 50) * 100);
    const overallScore =
      coverageScore * 0.3 + authorityScore * 0.4 + contentScore * 0.3;

    const scores: TopicalAuthorityScores = {
      coverage_score: Math.round(coverageScore * 100) / 100,
      authority_score: Math.round(authorityScore * 100) / 100,
      content_score: Math.round(contentScore * 100) / 100,
      overall_score: Math.round(overallScore * 100) / 100,
    };

    const stats: TopicalAuthorityStats = {
      unique_queries: uniqueQueries,
      avg_position: Math.round(avgPosition * 100) / 100,
      total_clicks: totalClicks,
      total_impressions: totalImpressions,
      article_count: articleCount,
      cluster_count: clusterCount,
    };

    return NextResponse.json({ site, scores, stats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
