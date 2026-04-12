export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface GscAgg {
  avg_position: string | null;
  total_clicks: string | null;
  total_impressions: string | null;
}

interface AutopilotRow {
  id: number;
  keyword: string;
  language: string;
  created_at: string;
}

interface ArticleROI {
  id: number;
  keyword: string;
  language: string;
  created_at: string;
  before: { position: number | null; clicks: number; impressions: number };
  after_7d: { position: number | null; clicks: number; impressions: number };
  after_30d: { position: number | null; clicks: number; impressions: number };
  improvement: number;
}

function parseGsc(rows: GscAgg[]): {
  position: number | null;
  clicks: number;
  impressions: number;
} {
  if (rows.length === 0 || rows[0].avg_position === null) {
    return { position: null, clicks: 0, impressions: 0 };
  }
  return {
    position: parseFloat(rows[0].avg_position),
    clicks: parseInt(rows[0].total_clicks ?? "0", 10),
    impressions: parseInt(rows[0].total_impressions ?? "0", 10),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteIdParam = searchParams.get("site_id");

  if (!siteIdParam) {
    return NextResponse.json(
      { success: false, error: "site_id required" },
      { status: 400 }
    );
  }

  const siteId = parseInt(siteIdParam, 10);
  if (isNaN(siteId)) {
    return NextResponse.json(
      { success: false, error: "Invalid site_id" },
      { status: 400 }
    );
  }

  const sql = getSQL();

  try {
    // Fetch all published articles for this site
    const runs = (await sql`
      SELECT id, keyword, COALESCE(language, 'fr') AS language, created_at
      FROM autopilot_runs
      WHERE site_id = ${siteId}
        AND status = 'published'
      ORDER BY created_at DESC
      LIMIT 100
    `) as AutopilotRow[];

    const articles: ArticleROI[] = [];

    for (const run of runs) {
      const createdAt = run.created_at;

      // BEFORE: 30 days before article creation
      const beforeRows = (await sql`
        SELECT AVG(position) AS avg_position,
               SUM(clicks) AS total_clicks,
               SUM(impressions) AS total_impressions
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND LOWER(query) = LOWER(${run.keyword})
          AND date >= (${createdAt}::date - INTERVAL '30 days')
          AND date < ${createdAt}::date
      `) as GscAgg[];

      // AFTER 7d: from article date to +7 days
      const after7dRows = (await sql`
        SELECT AVG(position) AS avg_position,
               SUM(clicks) AS total_clicks,
               SUM(impressions) AS total_impressions
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND LOWER(query) = LOWER(${run.keyword})
          AND date >= ${createdAt}::date
          AND date < (${createdAt}::date + INTERVAL '7 days')
      `) as GscAgg[];

      // AFTER 30d: from article date to +30 days
      const after30dRows = (await sql`
        SELECT AVG(position) AS avg_position,
               SUM(clicks) AS total_clicks,
               SUM(impressions) AS total_impressions
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND LOWER(query) = LOWER(${run.keyword})
          AND date >= ${createdAt}::date
          AND date < (${createdAt}::date + INTERVAL '30 days')
      `) as GscAgg[];

      const before = parseGsc(beforeRows);
      const after7d = parseGsc(after7dRows);
      const after30d = parseGsc(after30dRows);

      // Improvement = position drop (lower is better) → positive means improved
      const improvement =
        before.position !== null && after30d.position !== null
          ? parseFloat((before.position - after30d.position).toFixed(2))
          : 0;

      articles.push({
        id: run.id,
        keyword: run.keyword,
        language: run.language,
        created_at: run.created_at,
        before,
        after_7d: after7d,
        after_30d: after30d,
        improvement,
      });
    }

    return NextResponse.json({ success: true, articles });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("ROI tracking error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
