// Daily GA4 analytics sync — pulls last 7 days for all active sites
// Runs at 08:15 UTC every day (after GSC daily cron at 07:00)
// ON CONFLICT DO UPDATE → idempotent re-runs

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { getSQL } from "@/lib/db";
import { getAnalyticsClient } from "@/lib/google-auth";
import { ensureSyncStatusTable, saveSyncStatus } from "@/lib/sync-status";
import { mapWithConcurrency } from "@/lib/data-sync";
import { aggregateGa4Daily } from "@/lib/ga4-daily-aggregation";

interface SiteRow {
  id: number;
  name: string;
  ga_property_id: string;
}

function dateRange(days: number) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

async function syncSite(
  site: SiteRow,
  analytics: ReturnType<typeof getAnalyticsClient>,
  sql: ReturnType<typeof getSQL>,
  days: number
): Promise<{ inserted: number; latestDate: string | null; error: string | null }> {
  const startedAt = new Date();
  const propId = site.ga_property_id.replace(/^properties\//, "");
  if (!propId || /^G-/.test(propId)) {
    const error = "Measurement ID stored instead of Property ID";
    await saveSyncStatus({ siteId: site.id, source: "ga4", status: "error", rowsSynced: 0, latestDataDate: null, error, startedAt });
    return { inserted: 0, latestDate: null, error };
  }

  const { startDate, endDate } = dateRange(days);

  try {
    const [dailyResponse, channelResponse] = await Promise.all([
      analytics.properties.runReport({
        property: `properties/${propId}`,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: "date" }],
          metrics: [
            { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
            { name: "screenPageViews" }, { name: "bounceRate" }, { name: "averageSessionDuration" },
          ],
          limit: "100000",
        },
      }),
      analytics.properties.runReport({
        property: `properties/${propId}`,
        requestBody: {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
          metrics: [{ name: "sessions" }],
          limit: "100000",
        },
      }),
    ]);

    const byDate = aggregateGa4Daily(dailyResponse.data.rows ?? [], channelResponse.data.rows ?? []);

    let inserted = 0;
    for (const [date, d] of byDate) {
      await sql`
        INSERT INTO analytics_daily
          (site_id, date, sessions, users, new_users, pageviews, bounce_rate, avg_session_duration,
           organic_sessions, direct_sessions, referral_sessions, social_sessions)
        VALUES (
          ${site.id}, ${date}, ${d.sessions}, ${d.users}, ${d.newUsers}, ${d.pageviews},
          ${d.bounceRate},
          ${d.averageSessionDuration},
          ${d.organic}, ${d.direct}, ${d.referral}, ${d.social}
        )
        ON CONFLICT (site_id, date) DO UPDATE SET
          sessions = EXCLUDED.sessions,
          users = EXCLUDED.users,
          new_users = EXCLUDED.new_users,
          pageviews = EXCLUDED.pageviews,
          bounce_rate = EXCLUDED.bounce_rate,
          avg_session_duration = EXCLUDED.avg_session_duration,
          organic_sessions = EXCLUDED.organic_sessions,
          direct_sessions = EXCLUDED.direct_sessions,
          referral_sessions = EXCLUDED.referral_sessions,
          social_sessions = EXCLUDED.social_sessions
      `;
      inserted++;
    }
    const latestDate = Object.keys(byDate).sort().at(-1) ?? null;
    await saveSyncStatus({ siteId: site.id, source: "ga4", status: "success", rowsSynced: inserted, latestDataDate: latestDate, startedAt });
    return { inserted, latestDate, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown";
    await saveSyncStatus({ siteId: site.id, source: "ga4", status: "error", rowsSynced: 0, latestDataDate: null, error, startedAt });
    return { inserted: 0, latestDate: null, error };
  }
}

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") ?? "7", 10)));

  try {
    const sql = getSQL();
    await ensureSyncStatusTable();
    const analytics = getAnalyticsClient();

    const siteRows = (await sql`
      SELECT id, name, ga_property_id
      FROM sites
      WHERE is_active = true AND ga_property_id IS NOT NULL
      ORDER BY name
    `) as SiteRow[];

    const results = await mapWithConcurrency(siteRows, 3, async (site) => {
      const result = await syncSite(site, analytics, sql, days);
      return { site_id: site.id, site: site.name, inserted: result.inserted, latest_date: result.latestDate, error: result.error };
    });
    const totalInserted = results.reduce((total, result) => total + result.inserted, 0);
    const errors = results.filter((result) => result.error).length;

    return NextResponse.json({
      success: errors === 0,
      sites: siteRows.length,
      total_inserted: totalInserted,
      errors,
      days,
      results,
      ran_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}

export const POST = GET;
