export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";

/**
 * GET /api/position-history?site_id=X&days=90
 *
 * Query-level Search Console is the canonical position source. Every window is
 * anchored on the latest imported GSC date for the selected domain so normal
 * reporting lag never turns a valid history into an empty chart.
 */
export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteIdParam = req.nextUrl.searchParams.get("site_id");
  const days = Number.parseInt(req.nextUrl.searchParams.get("days") ?? "90", 10);
  if (!siteIdParam) {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const isAll = siteIdParam === "all";
  const siteId = isAll ? null : Number.parseInt(siteIdParam, 10);
  if (!isAll && (!Number.isInteger(siteId) || Number(siteId) <= 0)) {
    return NextResponse.json({ success: false, error: "Invalid site_id" }, { status: 400 });
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return NextResponse.json({ success: false, error: "Invalid days (1..365)" }, { status: 400 });
  }

  const sql = getSQL();
  try {
    const siteHistory = await sql`
      WITH anchors AS (
        SELECT site_id, MAX(date) AS end_date
        FROM search_console_query_data
        WHERE position BETWEEN 1 AND 200 AND BTRIM(query) <> ''
          AND (${siteId}::int IS NULL OR site_id = ${siteId})
        GROUP BY site_id
      )
      SELECT q.date,
        SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS avg_position,
        SUM(q.clicks)::int AS total_clicks,
        SUM(q.impressions)::int AS total_impressions
      FROM search_console_query_data q
      JOIN anchors a ON a.site_id = q.site_id
      WHERE q.date >= (a.end_date - INTERVAL '1 day' * (${days} - 1))::date
        AND q.date <= a.end_date
        AND q.position BETWEEN 1 AND 200
      GROUP BY q.date
      ORDER BY q.date ASC
    `;

    const topKeywords = await sql`
      WITH anchors AS (
        SELECT site_id, MAX(date) AS end_date
        FROM search_console_query_data
        WHERE position BETWEEN 1 AND 200 AND BTRIM(query) <> ''
          AND (${siteId}::int IS NULL OR site_id = ${siteId})
        GROUP BY site_id
      )
      SELECT q.query
      FROM search_console_query_data q
      JOIN anchors a ON a.site_id = q.site_id
      WHERE q.date >= (a.end_date - INTERVAL '29 days')::date
        AND q.date <= a.end_date
        AND q.position BETWEEN 1 AND 200
        AND BTRIM(q.query) <> ''
      GROUP BY q.query
      ORDER BY SUM(q.impressions) DESC, SUM(q.clicks) DESC
      LIMIT 10
    `;
    const keywordNames = topKeywords.map((row) => String(row.query));

    const keywordHistory = keywordNames.length === 0 ? [] : await sql`
      WITH anchors AS (
        SELECT site_id, MAX(date) AS end_date
        FROM search_console_query_data
        WHERE position BETWEEN 1 AND 200 AND BTRIM(query) <> ''
          AND (${siteId}::int IS NULL OR site_id = ${siteId})
        GROUP BY site_id
      )
      SELECT q.query, q.date,
        SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS position,
        SUM(q.clicks)::int AS clicks
      FROM search_console_query_data q
      JOIN anchors a ON a.site_id = q.site_id
      WHERE q.date >= (a.end_date - INTERVAL '1 day' * (${days} - 1))::date
        AND q.date <= a.end_date
        AND q.position BETWEEN 1 AND 200
        AND q.query = ANY(${keywordNames})
      GROUP BY q.query, q.date
      ORDER BY q.query, q.date ASC
    `;

    const toIsoDate = (value: unknown): string =>
      value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
    const histories: Record<string, Array<{ date: string; position: number; clicks: number }>> = {};
    for (const row of keywordHistory) {
      const keyword = String(row.query);
      (histories[keyword] ??= []).push({
        date: toIsoDate(row.date),
        position: Number(row.position),
        clicks: Number(row.clicks),
      });
    }

    return NextResponse.json({
      success: true,
      source: "google_search_console_query_level",
      ranking_notice: "Position moyenne GSC pondérée par impressions, pas un relevé SERP instantané.",
      site_history: siteHistory.map((row) => ({
        date: toIsoDate(row.date),
        position: row.avg_position == null ? null : Number(row.avg_position),
        clicks: Number(row.total_clicks),
        impressions: Number(row.total_impressions),
      })),
      keywords: keywordNames.map((keyword) => ({
        keyword,
        history: histories[keyword] ?? [],
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({
      success: false,
      error: message,
      source: "google_search_console_query_level",
      site_history: [],
      keywords: [],
    }, { status: 500 });
  }
}
