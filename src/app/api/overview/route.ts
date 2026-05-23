import { getSQL } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { GSC_LAG_DAYS } from "@/lib/gsc-window";
import { siteCountryCode } from "@/lib/site-country";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  const days = parseInt(request.nextUrl.searchParams.get("days") || "30");
  const type = request.nextUrl.searchParams.get("type") || "gsc"; // gsc | ga4

  try {
    const sql = getSQL();

    if (type === "gsc") {
      // Per-site TLD country filter (FRA / CHE / BEL / CAN) + NULL fallback.
      // Build site → country map first, then aggregate per site/date.
      const siteRows = (await sql`SELECT id, url FROM sites WHERE is_active = true`) as Array<{ id: number; url: string }>;
      const rows: Array<Record<string, unknown>> = [];
      for (const s of siteRows) {
        const cc = siteCountryCode(s.url);
        const r = (await sql`
          SELECT
            s.id as site_id, s.name, s.url,
            d.date::text,
            SUM(d.clicks) as clicks,
            SUM(d.impressions) as impressions,
            AVG(d.position) as position
          FROM search_console_data d
          JOIN sites s ON s.id = d.site_id
          WHERE d.site_id = ${s.id}
            AND d.date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
            AND d.date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
            AND (d.country IS NULL OR d.country = '' OR d.country = ${cc})
          GROUP BY s.id, s.name, s.url, d.date
          ORDER BY d.date ASC
        `) as Array<Record<string, unknown>>;
        rows.push(...r);
      }
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
        WHERE d.date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
        ORDER BY d.date ASC
      `;
      return NextResponse.json(rows);
    }

    // type=summary - totals per site per period (all active sites, even with 0 data)
    if (type === "summary") {
      const siteRows = (await sql`SELECT id, name, url FROM sites WHERE is_active = true`) as Array<{ id: number; name: string; url: string }>;
      const out: Array<Record<string, unknown>> = [];
      for (const s of siteRows) {
        const cc = siteCountryCode(s.url);
        const r = (await sql`
          SELECT
            ${s.id}::int as site_id, ${s.name}::text as name, ${s.url}::text as url,
            COALESCE((SELECT SUM(clicks) FROM search_console_data
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND (country IS NULL OR country = '' OR country = ${cc})
            ), 0) as clicks,
            COALESCE((SELECT SUM(impressions) FROM search_console_data
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND (country IS NULL OR country = '' OR country = ${cc})
            ), 0) as impressions,
            -- C1: position from search_console_query_data (real Google query-level position).
            -- Page-level fallback if query-level not yet synced for this site.
            COALESCE((
              SELECT COALESCE(
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0),
                (SELECT AVG(NULLIF(position, 0)) FROM search_console_data
                  WHERE site_id = ${s.id}
                    AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                    AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                    AND (country IS NULL OR country = '' OR country = ${cc}))
              )
              FROM search_console_query_data
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND (country IS NULL OR country = '' OR country = ${cc})
            ), 0) as position,
            COALESCE((SELECT COUNT(DISTINCT date) FROM search_console_data
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND (country IS NULL OR country = '' OR country = ${cc})
            ), 0) as days_with_data,
            COALESCE((SELECT SUM(sessions) FROM analytics_daily
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
            ), 0) as sessions,
            COALESCE((SELECT SUM(users) FROM analytics_daily
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
            ), 0) as users,
            COALESCE((SELECT SUM(pageviews) FROM analytics_daily
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
            ), 0) as pageviews,
            COALESCE((SELECT SUM(organic_sessions) FROM analytics_daily
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
            ), 0) as organic_sessions,
            COALESCE((SELECT AVG(avg_session_duration) FROM analytics_daily
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
            ), 0) as avg_duration,
            COALESCE((SELECT AVG(bounce_rate) FROM analytics_daily
              WHERE site_id = ${s.id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * ${days})::date
            ), 0) as bounce_rate
        `) as Array<Record<string, unknown>>;
        if (r[0]) out.push(r[0]);
      }
      out.sort((a, b) => Number(b.clicks ?? 0) - Number(a.clicks ?? 0));
      return NextResponse.json(out);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
