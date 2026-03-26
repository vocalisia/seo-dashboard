import { getSQL } from "@/lib/db";
import { getAnalyticsClient, getSearchConsoleClient } from "@/lib/google-auth";
import { NextResponse } from "next/server";

async function syncAnalytics(siteId: number, propertyId: string) {
  const sql = getSQL();
  const analytics = getAnalyticsClient();
  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const response = await analytics.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metrics: [
        { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
        { name: "screenPageViews" }, { name: "bounceRate" }, { name: "averageSessionDuration" },
      ],
    },
  });

  if (!response.data.rows) return 0;

  const dailyStats: Record<string, {
    sessions: number; users: number; new_users: number; pageviews: number;
    bounce_rate: number; avg_duration: number; organic: number;
    direct: number; referral: number; social: number; count: number;
  }> = {};

  for (const row of response.data.rows) {
    const dateRaw = row.dimensionValues?.[0]?.value || "";
    const channel = row.dimensionValues?.[1]?.value || "";
    const formattedDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    const sessions = parseInt(row.metricValues?.[0]?.value || "0");

    if (!dailyStats[formattedDate]) {
      dailyStats[formattedDate] = {
        sessions: 0, users: 0, new_users: 0, pageviews: 0,
        bounce_rate: 0, avg_duration: 0, organic: 0,
        direct: 0, referral: 0, social: 0, count: 0,
      };
    }

    const s = dailyStats[formattedDate];
    s.sessions += sessions;
    s.users += parseInt(row.metricValues?.[1]?.value || "0");
    s.new_users += parseInt(row.metricValues?.[2]?.value || "0");
    s.pageviews += parseInt(row.metricValues?.[3]?.value || "0");
    s.bounce_rate += parseFloat(row.metricValues?.[4]?.value || "0");
    s.avg_duration += parseFloat(row.metricValues?.[5]?.value || "0");
    s.count++;

    const ch = channel.toLowerCase();
    if (ch.includes("organic")) s.organic += sessions;
    else if (ch.includes("direct")) s.direct += sessions;
    else if (ch.includes("referral")) s.referral += sessions;
    else if (ch.includes("social")) s.social += sessions;
  }

  let inserted = 0;
  for (const [date, stats] of Object.entries(dailyStats)) {
    await sql`
      INSERT INTO analytics_daily
      (site_id, date, sessions, users, new_users, pageviews, bounce_rate,
       avg_session_duration, organic_sessions, direct_sessions, referral_sessions, social_sessions)
      VALUES (${siteId}, ${date}, ${stats.sessions}, ${stats.users}, ${stats.new_users},
              ${stats.pageviews}, ${stats.count > 0 ? stats.bounce_rate / stats.count : 0},
              ${stats.count > 0 ? stats.avg_duration / stats.count : 0},
              ${stats.organic}, ${stats.direct}, ${stats.referral}, ${stats.social})
      ON CONFLICT (site_id, date) DO UPDATE SET
        sessions = EXCLUDED.sessions, users = EXCLUDED.users,
        pageviews = EXCLUDED.pageviews, organic_sessions = EXCLUDED.organic_sessions
    `;
    inserted++;
  }
  return inserted;
}

async function syncSearchConsole(siteId: number, siteUrl: string) {
  const sql = getSQL();
  const searchConsole = getSearchConsoleClient();
  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const response = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate, endDate,
      dimensions: ["query", "page", "date"],
      rowLimit: 25000, startRow: 0,
    },
  });

  const rows = response.data.rows || [];
  let totalInserted = 0;

  for (const row of rows) {
    await sql`
      INSERT INTO search_console_data
      (site_id, date, query, page, clicks, impressions, ctr, position)
      VALUES (${siteId}, ${row.keys?.[2] || ""}, ${row.keys?.[0] || ""}, ${row.keys?.[1] || ""},
              ${row.clicks || 0}, ${row.impressions || 0}, ${row.ctr || 0}, ${row.position || 0})
      ON CONFLICT DO NOTHING
    `;
    totalInserted++;
  }
  return totalInserted;
}

export async function POST() {
  try {
    const sql = getSQL();
    const sites = await sql`SELECT * FROM sites WHERE is_active = true`;
    const results = [];

    for (const site of sites) {
      const result: { site: string; analytics?: number; gsc?: number; error?: string } = { site: site.name };
      try {
        if (site.ga_property_id) result.analytics = await syncAnalytics(site.id, site.ga_property_id);
        if (site.gsc_property) result.gsc = await syncSearchConsole(site.id, site.gsc_property);
      } catch (err: unknown) {
        result.error = err instanceof Error ? err.message : "Unknown error";
      }
      results.push(result);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
