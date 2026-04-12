import { getSQL } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const days = parseInt(request.nextUrl.searchParams.get("days") || "30");
  const type = request.nextUrl.searchParams.get("type") || "gsc"; // gsc | ga4

  try {
    const sql = getSQL();

    if (type === "gsc") {
      const rows = await sql`
        SELECT
          s.id as site_id, s.name, s.url,
          date::text,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          AVG(position) as position
        FROM search_console_data d
        JOIN sites s ON s.id = d.site_id
        WHERE d.date >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY s.id, s.name, s.url, d.date
        ORDER BY d.date ASC
      `;
      return NextResponse.json(rows);
    }

    if (type === "ga4") {
      const rows = await sql`
        SELECT
          s.id as site_id, s.name, s.url,
          date::text,
          sessions, users, pageviews, organic_sessions,
          direct_sessions, bounce_rate, avg_session_duration
        FROM analytics_daily d
        JOIN sites s ON s.id = d.site_id
        WHERE d.date >= NOW() - INTERVAL '1 day' * ${days}
        ORDER BY d.date ASC
      `;
      return NextResponse.json(rows);
    }

    // type=summary - totals per site per period (all active sites, even with 0 data)
    if (type === "summary") {
      const rows = await sql`
        SELECT
          s.id as site_id, s.name, s.url,
          COALESCE(SUM(d.clicks), 0) as clicks,
          COALESCE(SUM(d.impressions), 0) as impressions,
          COALESCE(AVG(NULLIF(d.position, 0)), 0) as position,
          COALESCE(COUNT(DISTINCT d.date), 0) as days_with_data,
          COALESCE(SUM(a.sessions), 0) as sessions,
          COALESCE(SUM(a.users), 0) as users,
          COALESCE(SUM(a.pageviews), 0) as pageviews,
          COALESCE(SUM(a.organic_sessions), 0) as organic_sessions,
          COALESCE(AVG(a.avg_session_duration), 0) as avg_duration,
          COALESCE(AVG(a.bounce_rate), 0) as bounce_rate
        FROM sites s
        LEFT JOIN search_console_data d ON d.site_id = s.id
          AND d.date >= NOW() - INTERVAL '1 day' * ${days}
        LEFT JOIN analytics_daily a ON a.site_id = s.id
          AND a.date >= NOW() - INTERVAL '1 day' * ${days}
        WHERE s.is_active = true
        GROUP BY s.id, s.name, s.url
        ORDER BY COALESCE(SUM(d.clicks), 0) DESC
      `;
      return NextResponse.json(rows);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
