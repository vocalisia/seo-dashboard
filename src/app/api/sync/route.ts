import { getSQL } from "@/lib/db";
import { getAnalyticsClient, getSearchConsoleClient } from "@/lib/google-auth";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

const GSC_PAGE_SIZE = 25000;

async function fetchAllSearchAnalyticsRows(
  searchConsole: ReturnType<typeof getSearchConsoleClient>,
  siteUrl: string,
  requestBody: Record<string, unknown>
) {
  const rows: Array<{
    keys?: string[] | null;
    clicks?: number | null;
    impressions?: number | null;
    ctr?: number | null;
    position?: number | null;
  }> = [];
  for (let startRow = 0; ; startRow += GSC_PAGE_SIZE) {
    const response = await searchConsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        ...requestBody,
        rowLimit: GSC_PAGE_SIZE,
        startRow,
      },
    });
    const pageRows = response.data.rows || [];
    rows.push(...pageRows);
    if (pageRows.length < GSC_PAGE_SIZE) break;
  }
  return rows;
}

function isoDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

async function syncAnalytics(siteId: number, propertyId: string, accessToken?: string) {
  const sql = getSQL();
  const analytics = getAnalyticsClient(accessToken);
  const endDate = isoDateDaysAgo(1);
  const startDate = isoDateDaysAgo(30);

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
  return inserted;
}

async function syncSearchConsole(siteId: number, siteUrl: string, accessToken?: string, days = 45) {
  const sql = getSQL();
  const searchConsole = getSearchConsoleClient(accessToken);
  const endDate = isoDateDaysAgo(2);
  // 45d covers W4 (29-35d) in Gains/semaine.
  const startDate = isoDateDaysAgo(Math.max(45, Math.min(365, days)));

  // Query 1: query + page + date (no country, no device) — country='' device='' rows
  // Natural key: (site_id, date, COALESCE(query,''), COALESCE(page,''), COALESCE(country,''), COALESCE(device,''))
  // UNIQUE INDEX uq_scd_natural_key enforces dedup at write time.
  const rows = await fetchAllSearchAnalyticsRows(searchConsole, siteUrl, {
      startDate, endDate,
      dimensions: ["query", "page", "date"],
      dataState: "final", // exclude fresh/lag dates
  });
  let totalInserted = 0;

  for (const row of rows) {
    if ((row.position || 0) > 200) continue;
    await sql`
      INSERT INTO search_console_data
      (site_id, date, query, page, clicks, impressions, ctr, position, country, device)
      VALUES (${siteId}, ${row.keys?.[2] || ""}, ${row.keys?.[0] || ""}, ${row.keys?.[1] || ""},
              ${row.clicks || 0}, ${row.impressions || 0}, ${row.ctr || 0}, ${row.position || 0},
              '', '')
      ON CONFLICT (site_id, date, (COALESCE(query,'')), (COALESCE(page,'')), (COALESCE(country,'')), (COALESCE(device,'')))
      DO UPDATE SET
        clicks      = EXCLUDED.clicks,
        impressions = EXCLUDED.impressions,
        ctr         = EXCLUDED.ctr,
        position    = EXCLUDED.position
    `;
    totalInserted++;
  }

  // Query 2: by country WITH date dimension so each row has its real date
  // (previously collapsed all dates to endDate → 45× row inflation per query/page/country)
  try {
    const countryRows = await fetchAllSearchAnalyticsRows(searchConsole, siteUrl, {
        startDate, endDate,
        dimensions: ["query", "page", "country", "date"],
        dataState: "final",
    });
    for (const row of countryRows) {
      if ((row.position || 0) > 200) continue;
      const country = (row.keys?.[2] || "").toUpperCase();
      const realDate = row.keys?.[3] || endDate;
      await sql`
        INSERT INTO search_console_data
        (site_id, date, query, page, clicks, impressions, ctr, position, country, device)
        VALUES (${siteId}, ${realDate}, ${row.keys?.[0] || ""}, ${row.keys?.[1] || ""},
                ${row.clicks || 0}, ${row.impressions || 0}, ${row.ctr || 0}, ${row.position || 0},
                ${country}, '')
        ON CONFLICT (site_id, date, (COALESCE(query,'')), (COALESCE(page,'')), (COALESCE(country,'')), (COALESCE(device,'')))
        DO UPDATE SET
          clicks      = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          ctr         = EXCLUDED.ctr,
          position    = EXCLUDED.position
      `;
      totalInserted++;
    }
  } catch (err) {
    // GSC sometimes refuses 4 dims — fail soft, query 1 already covers date totals
    console.error(`Country sync failed for site ${siteId}:`, err instanceof Error ? err.message : err);
  }

  // Query 3 (Bug B fix): QUERY-LEVEL — no page split. Returns the position Google
  // actually displays in the GSC UI (query+country aggregate). Stored in a separate
  // table so page-level analyses still work but the keyword position is the real one.
  try {
    const queryRows = await fetchAllSearchAnalyticsRows(searchConsole, siteUrl, {
        startDate, endDate,
        dimensions: ["query", "country", "date"],
        dataState: "final",
    });
    for (const row of queryRows) {
      if ((row.position || 0) > 200) continue;
      const country = (row.keys?.[1] || "").toUpperCase();
      const realDate = row.keys?.[2] || endDate;
      await sql`
        INSERT INTO search_console_query_data
        (site_id, date, query, country, device, clicks, impressions, ctr, position)
        VALUES (${siteId}, ${realDate}, ${row.keys?.[0] || ""}, ${country}, '',
                ${row.clicks || 0}, ${row.impressions || 0}, ${row.ctr || 0}, ${row.position || 0})
        ON CONFLICT (site_id, date, query, country, device)
        DO UPDATE SET
          clicks      = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          ctr         = EXCLUDED.ctr,
          position    = EXCLUDED.position,
          synced_at   = NOW()
      `;
      totalInserted++;
    }
  } catch (err) {
    console.error(`Query-level sync failed for site ${siteId}:`, err instanceof Error ? err.message : err);
  }

  return totalInserted;
}

export async function POST(request: NextRequest) {
  try {
    // Try OAuth session first, fallback to service account (no login required)
    let accessToken: string | undefined;
    try {
      const session = await auth();
      accessToken = session?.accessToken ?? undefined;
    } catch {
      // no session — will use service account
    }

    // If no OAuth token, use service account (pass undefined → google-auth.ts handles it)
    const useServiceAccount = !accessToken;
    if (useServiceAccount) {
      console.log("[sync] No OAuth session → using service account");
    }

    const sql = getSQL();
    const siteIdParam = request.nextUrl.searchParams.get("siteId");
    const siteId = siteIdParam ? Number(siteIdParam) : null;
    if (siteIdParam && (!Number.isFinite(siteId) || Number(siteId) <= 0)) {
      return NextResponse.json({ error: "Invalid siteId" }, { status: 400 });
    }
    const sites = siteId
      ? await sql`SELECT * FROM sites WHERE is_active = true AND id = ${siteId}`
      : await sql`SELECT * FROM sites WHERE is_active = true`;
    const results = [];
    const days = Math.max(45, Math.min(365, parseInt(request.nextUrl.searchParams.get("days") || "45", 10) || 45));

    for (const site of sites) {
      const result: { site: string; analytics?: number; gsc?: number; error?: string } = { site: site.name };
      try {
        if (site.ga_property_id) result.analytics = await syncAnalytics(site.id, site.ga_property_id, accessToken);
        if (site.gsc_property) result.gsc = await syncSearchConsole(site.id, site.gsc_property, accessToken, days);
      } catch (err: unknown) {
        result.error = err instanceof Error ? err.message : "Unknown error";
      }
      results.push(result);
    }

    return NextResponse.json({ success: true, results, days, auth: useServiceAccount ? "service_account" : "oauth" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
