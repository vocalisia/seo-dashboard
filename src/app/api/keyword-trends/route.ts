/**
 * GET /api/keyword-trends?keyword=...&geo=FR[&site_id=12][&force=1]
 *
 * Returns the 12-month weekly Google Trends series for a single keyword.
 * Cached in the `keyword_trends` table for 7 days (per keyword+geo, scoped by
 * site_id when provided). Pass `force=1` to bypass cache.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSQL, ensureSchema } from "@/lib/db";
import { fetchKeywordTrend, TrendPoint } from "@/lib/google-trends";
import { requireApiSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface CachedRow {
  id: number;
  trend_data: { points: TrendPoint[] };
  fetched_at: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;
  const { searchParams } = new URL(req.url);
  const keyword = (searchParams.get("keyword") ?? "").trim();
  const geo = (searchParams.get("geo") ?? "").trim().toUpperCase();
  const siteIdRaw = searchParams.get("site_id");
  const siteId = siteIdRaw ? Number(siteIdRaw) : null;
  const force = searchParams.get("force") === "1";

  if (!keyword) {
    return NextResponse.json({ error: "keyword required" }, { status: 400 });
  }

  await ensureSchema();
  const sql = getSQL();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  if (!force) {
    const cached = (await sql`
      SELECT id, trend_data, fetched_at
      FROM keyword_trends
      WHERE COALESCE(site_id, 0) = ${siteId ?? 0}
        AND LOWER(keyword) = LOWER(${keyword})
        AND geo = ${geo}
        AND fetched_at >= ${sevenDaysAgo}
      ORDER BY fetched_at DESC
      LIMIT 1
    `) as CachedRow[];
    if (cached.length > 0) {
      return NextResponse.json({
        keyword,
        geo,
        cached: true,
        fetched_at: cached[0].fetched_at,
        points: cached[0].trend_data?.points ?? [],
      });
    }
  }

  try {
    const trend = await fetchKeywordTrend(keyword, geo);
    const trendData = { points: trend.points };

    await sql`
      INSERT INTO keyword_trends (site_id, keyword, geo, trend_data, fetched_at)
      VALUES (${siteId}, ${keyword}, ${geo}, ${JSON.stringify(trendData)}::jsonb, NOW())
      ON CONFLICT (COALESCE(site_id, 0), (LOWER(keyword)), geo) DO UPDATE SET
        trend_data = EXCLUDED.trend_data,
        fetched_at = NOW()
    `;

    return NextResponse.json({
      keyword,
      geo,
      cached: false,
      fetched_at: trend.fetched_at,
      points: trend.points,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (/Google Trends HTTP 429/.test(msg)) {
      let stale: CachedRow[] = [];
      try {
        stale = (await sql`
          SELECT id, trend_data, fetched_at
          FROM keyword_trends
          WHERE COALESCE(site_id, 0) = ${siteId ?? 0}
            AND LOWER(keyword) = LOWER(${keyword})
            AND geo = ${geo}
          ORDER BY fetched_at DESC
          LIMIT 1
        `) as CachedRow[];
      } catch {
        // Preserve the upstream quota status even if the cache lookup fails.
      }

      if (stale.length > 0) {
        return NextResponse.json({
          keyword,
          geo,
          cached: true,
          stale: true,
          warning: "Google Trends limite temporairement les requêtes. Dernier relevé affiché.",
          fetched_at: stale[0].fetched_at,
          points: stale[0].trend_data?.points ?? [],
        });
      }

      return NextResponse.json(
        {
          error: "Google Trends limite temporairement les requêtes. Réessaie dans quelques minutes.",
          keyword,
          geo,
          points: [],
        },
        { status: 429, headers: { "Retry-After": "300" } }
      );
    }

    return NextResponse.json(
      { error: msg, keyword, geo, points: [] },
      { status: 502 }
    );
  }
}
