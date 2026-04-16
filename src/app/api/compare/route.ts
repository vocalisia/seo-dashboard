import { getSQL } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface CompareSitePayload {
  name: string;
  clicks: number;
  impressions: number;
  avg_position: number;
  sessions: number;
  users: number;
  articles: number;
  top_keywords: string[];
}

interface SiteStats {
  site: Record<string, unknown>;
  gsc: {
    total_clicks: number;
    total_impressions: number;
    avg_position: number;
  };
  analytics: {
    total_sessions: number;
    total_users: number;
    total_pageviews: number;
  };
  article_count: number;
  top_keywords: Record<string, unknown>[];
}

interface Delta {
  clicks: number;
  impressions: number;
  avg_position: number;
  sessions: number;
  users: number;
  pageviews: number;
  articles: number;
}

async function getSiteStats(siteId: number): Promise<SiteStats | null> {
  const sql = getSQL();

  // Site info
  const siteRows = await sql`
    SELECT id, name, url FROM sites WHERE id = ${siteId}
  `;

  if (siteRows.length === 0) {
    return null;
  }

  // GSC stats (30d)
  const gscRows = await sql`
    SELECT
      COALESCE(SUM(clicks), 0) as total_clicks,
      COALESCE(SUM(impressions), 0) as total_impressions,
      COALESCE(AVG(NULLIF(position, 0)), 0) as avg_position
    FROM search_console_data
    WHERE site_id = ${siteId}
      AND date >= NOW() - INTERVAL '30 days'
  `;

  // Analytics stats (30d)
  const analyticsRows = await sql`
    SELECT
      COALESCE(SUM(sessions), 0) as total_sessions,
      COALESCE(SUM(users), 0) as total_users,
      COALESCE(SUM(pageviews), 0) as total_pageviews
    FROM analytics_daily
    WHERE site_id = ${siteId}
      AND date >= NOW() - INTERVAL '30 days'
  `;

  // Article count (published)
  const articleRows = await sql`
    SELECT COUNT(*) as article_count
    FROM autopilot_runs
    WHERE site_id = ${siteId}
      AND status = 'published'
  `;

  // Top 10 keywords
  const keywordRows = await sql`
    SELECT
      query,
      SUM(clicks) as clicks,
      SUM(impressions) as impressions,
      AVG(position) as avg_position
    FROM search_console_data
    WHERE site_id = ${siteId}
      AND date >= NOW() - INTERVAL '30 days'
      AND query IS NOT NULL
      AND query != ''
    GROUP BY query
    ORDER BY SUM(clicks) DESC
    LIMIT 10
  `;

  const gsc = gscRows[0];
  const analytics = analyticsRows[0];

  return {
    site: siteRows[0] as Record<string, unknown>,
    gsc: {
      total_clicks: Number(gsc?.total_clicks ?? 0),
      total_impressions: Number(gsc?.total_impressions ?? 0),
      avg_position: Math.round(Number(gsc?.avg_position ?? 0) * 100) / 100,
    },
    analytics: {
      total_sessions: Number(analytics?.total_sessions ?? 0),
      total_users: Number(analytics?.total_users ?? 0),
      total_pageviews: Number(analytics?.total_pageviews ?? 0),
    },
    article_count: Number(articleRows[0]?.article_count ?? 0),
    top_keywords: keywordRows as Record<string, unknown>[],
  };
}

export async function GET(request: NextRequest) {
  const siteA = request.nextUrl.searchParams.get("site_a");
  const siteB = request.nextUrl.searchParams.get("site_b");

  if (!siteA || !siteB) {
    return NextResponse.json(
      { error: "site_a and site_b required" },
      { status: 400 }
    );
  }

  const siteAId = parseInt(siteA, 10);
  const siteBId = parseInt(siteB, 10);

  if (isNaN(siteAId) || isNaN(siteBId)) {
    return NextResponse.json(
      { error: "site_a and site_b must be numbers" },
      { status: 400 }
    );
  }

  try {
    const [statsA, statsB] = await Promise.all([
      getSiteStats(siteAId),
      getSiteStats(siteBId),
    ]);

    if (!statsA) {
      return NextResponse.json(
        { error: `Site ${siteAId} not found` },
        { status: 404 }
      );
    }

    if (!statsB) {
      return NextResponse.json(
        { error: `Site ${siteBId} not found` },
        { status: 404 }
      );
    }

    const delta: Delta = {
      clicks: statsA.gsc.total_clicks - statsB.gsc.total_clicks,
      impressions: statsA.gsc.total_impressions - statsB.gsc.total_impressions,
      avg_position: Math.round((statsA.gsc.avg_position - statsB.gsc.avg_position) * 100) / 100,
      sessions: statsA.analytics.total_sessions - statsB.analytics.total_sessions,
      users: statsA.analytics.total_users - statsB.analytics.total_users,
      pageviews: statsA.analytics.total_pageviews - statsB.analytics.total_pageviews,
      articles: statsA.article_count - statsB.article_count,
    };

    const siteAUi: CompareSitePayload = {
      name: String(statsA.site.name ?? ""),
      clicks: statsA.gsc.total_clicks,
      impressions: statsA.gsc.total_impressions,
      avg_position: statsA.gsc.avg_position,
      sessions: statsA.analytics.total_sessions,
      users: statsA.analytics.total_users,
      articles: statsA.article_count,
      top_keywords: statsA.top_keywords.map((kw) => String(kw.query ?? "")),
    };

    const siteBUi: CompareSitePayload = {
      name: String(statsB.site.name ?? ""),
      clicks: statsB.gsc.total_clicks,
      impressions: statsB.gsc.total_impressions,
      avg_position: statsB.gsc.avg_position,
      sessions: statsB.analytics.total_sessions,
      users: statsB.analytics.total_users,
      articles: statsB.article_count,
      top_keywords: statsB.top_keywords.map((kw) => String(kw.query ?? "")),
    };

    return NextResponse.json({
      success: true,
      site_a: siteAUi,
      site_b: siteBUi,
      raw: {
        site_a: statsA,
        site_b: statsB,
      },
      delta,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
