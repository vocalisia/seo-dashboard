// 30-day rank history for a (site_id, keyword) pair from rank_tracking table.
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { logError } from "@/lib/logger";

interface HistoryRow {
  checked_at: string;
  our_position: number | null;
  search_engine: string;
  top_10_results: unknown;
}

export async function GET(req: NextRequest) {
  const siteIdRaw = req.nextUrl.searchParams.get("site_id");
  const keyword = req.nextUrl.searchParams.get("keyword");
  const engine = (req.nextUrl.searchParams.get("engine") || "brave").toLowerCase();

  if (!siteIdRaw || isNaN(Number(siteIdRaw))) {
    return NextResponse.json(
      { success: false, error: "site_id query parameter required (number)" },
      { status: 400 }
    );
  }
  if (!keyword || !keyword.trim()) {
    return NextResponse.json(
      { success: false, error: "keyword query parameter required" },
      { status: 400 }
    );
  }

  const siteId = Number(siteIdRaw);
  const sql = getSQL();

  try {
    const rows = (await sql`
      SELECT checked_at, our_position, search_engine, top_10_results
      FROM rank_tracking
      WHERE site_id = ${siteId}
        AND LOWER(keyword) = LOWER(${keyword})
        AND search_engine = ${engine}
        AND checked_at >= (NOW() - INTERVAL '30 days')
      ORDER BY checked_at ASC
    `) as HistoryRow[];

    const series = rows.map((r) => ({
      date: r.checked_at,
      position: r.our_position,
      engine: r.search_engine,
    }));
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;

    return NextResponse.json({
      success: true,
      site_id: siteId,
      keyword,
      engine,
      points: series.length,
      series,
      latest_top10: latest?.top_10_results ?? [],
    });
  } catch (err) {
    logError("rank-tracker.history", err, { siteId, keyword });
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
