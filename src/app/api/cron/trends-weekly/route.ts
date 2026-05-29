/**
 * POST /api/cron/trends-weekly
 *
 * Refreshes the Google Trends cache for the top 30 tracked_keywords by
 * volume_market across all active sites. Runs once a week.
 *
 * Why 30: the unauthenticated Trends endpoint rate-limits to ~1 req/sec;
 * 30 keywords × ~1.5 s = 45 s, safely within the 60 s function budget.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { getSQL, ensureSchema } from "@/lib/db";
import { fetchKeywordTrend } from "@/lib/google-trends";

interface KeywordRow {
  id: number;
  site_id: number;
  keyword: string;
  market: string | null;
  volume_market: number;
  site_url: string;
}

interface RunResult {
  keyword: string;
  geo: string;
  status: "ok" | "failed" | "cached";
  error?: string;
}

function geoFromUrl(url: string): string {
  const m = url.match(/\.([a-z]{2,3})(?:\/|$)/i);
  if (!m) return "";
  const tld = m[1].toUpperCase();
  const map: Record<string, string> = {
    CH: "CH",
    FR: "FR",
    BE: "BE",
    CA: "CA",
    DE: "DE",
    IT: "IT",
    UK: "GB",
    PRO: "FR",
    COM: "",
    ORG: "",
    NET: "",
  };
  return map[tld] ?? "";
}

export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  await ensureSchema();
  const sql = getSQL();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Top 30 by volume across all active sites
  const rows = (await sql`
    SELECT k.id, k.site_id, k.keyword, k.market,
           COALESCE(k.volume_market, 0) AS volume_market,
           s.url AS site_url
    FROM tracked_keywords k
    JOIN sites s ON s.id = k.site_id
    WHERE k.is_active = TRUE
      AND s.is_active = TRUE
      AND COALESCE(k.volume_market, 0) > 0
    ORDER BY k.volume_market DESC NULLS LAST
    LIMIT 30
  `) as KeywordRow[];

  const results: RunResult[] = [];

  for (const row of rows) {
    const geo = (row.market || geoFromUrl(row.site_url) || "").toUpperCase();

    // Skip if cached < 7 days
    const cached = (await sql`
      SELECT id FROM keyword_trends
      WHERE COALESCE(site_id, 0) = ${row.site_id}
        AND LOWER(keyword) = LOWER(${row.keyword})
        AND geo = ${geo}
        AND fetched_at >= ${sevenDaysAgo}
      LIMIT 1
    `) as Array<{ id: number }>;
    if (cached.length > 0) {
      results.push({ keyword: row.keyword, geo, status: "cached" });
      continue;
    }

    try {
      const trend = await fetchKeywordTrend(row.keyword, geo);
      await sql`
        INSERT INTO keyword_trends (site_id, keyword, geo, trend_data, fetched_at)
        VALUES (
          ${row.site_id}, ${row.keyword}, ${geo},
          ${JSON.stringify({ points: trend.points })}::jsonb, NOW()
        )
        ON CONFLICT (COALESCE(site_id, 0), (LOWER(keyword)), geo) DO UPDATE SET
          trend_data = EXCLUDED.trend_data,
          fetched_at = NOW()
      `;
      results.push({ keyword: row.keyword, geo, status: "ok" });
    } catch (err) {
      results.push({
        keyword: row.keyword,
        geo,
        status: "failed",
        error: err instanceof Error ? err.message : "unknown",
      });
    }

    // Rate limit: ~1 req/sec
    await new Promise((r) => setTimeout(r, 1200));
  }

  return NextResponse.json({
    success: true,
    total: rows.length,
    ok: results.filter((r) => r.status === "ok").length,
    cached: results.filter((r) => r.status === "cached").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
