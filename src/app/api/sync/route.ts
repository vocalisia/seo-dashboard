import { ensureSchemaOnce, getSQL } from "@/lib/db";
import { getAnalyticsClient, getSearchConsoleClient } from "@/lib/google-auth";
import { NextRequest, NextResponse } from "next/server";
import { mapWithConcurrency, parseSyncDays } from "@/lib/data-sync";
import { ensureSyncStatusTable, saveSyncStatus, type SyncSource } from "@/lib/sync-status";
import { requireCronOrUser } from "@/lib/cron-auth";
import { aggregateGa4Daily } from "@/lib/ga4-daily-aggregation";

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

async function syncAnalytics(siteId: number, propertyId: string) {
  const sql = getSQL();
  const analytics = getAnalyticsClient();
  const endDate = isoDateDaysAgo(1);
  const startDate = isoDateDaysAgo(30);

  const [dailyResponse, channelResponse] = await Promise.all([
    analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
          { name: "screenPageViews" }, { name: "bounceRate" }, { name: "averageSessionDuration" },
        ],
      },
    }),
    analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
      },
    }),
  ]);

  const dailyStats = aggregateGa4Daily(dailyResponse.data.rows ?? [], channelResponse.data.rows ?? []);

  let inserted = 0;
  for (const [date, stats] of dailyStats) {
    await sql`
      INSERT INTO analytics_daily
      (site_id, date, sessions, users, new_users, pageviews, bounce_rate,
       avg_session_duration, organic_sessions, direct_sessions, referral_sessions, social_sessions)
      VALUES (${siteId}, ${date}, ${stats.sessions}, ${stats.users}, ${stats.newUsers},
              ${stats.pageviews}, ${stats.bounceRate},
              ${stats.averageSessionDuration},
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

async function syncSearchConsole(siteId: number, siteUrl: string, days = 45) {
  const sql = getSQL();
  const searchConsole = getSearchConsoleClient();
  const endDate = isoDateDaysAgo(2);
  // 45d covers W4 (29-35d) in Gains/semaine.
  const startDate = isoDateDaysAgo(Math.max(1, Math.min(365, days)));

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

  // Query 3 (Bug B fix): query-level, no page split.
  let queryLevelSynced = false;
  try {
    const queryRows = await fetchAllSearchAnalyticsRows(searchConsole, siteUrl, {
      startDate,
      endDate,
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
          clicks = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          ctr = EXCLUDED.ctr,
          position = EXCLUDED.position,
          synced_at = NOW()
      `;
      totalInserted++;
    }
    queryLevelSynced = true;
  } catch (err) {
    console.error(`Query-level sync failed for site ${siteId}:`, err instanceof Error ? err.message : err);
  }

  if (queryLevelSynced) {
    // Keep legacy fallbacks aligned with the same query-level GSC metric.
    await sql`
      WITH anchor AS (
        SELECT MAX(date) AS latest_date
        FROM search_console_query_data
        WHERE site_id = ${siteId} AND position BETWEEN 1 AND 200
      ),
      live AS (
        SELECT LOWER(BTRIM(q.query)) AS keyword_key,
          SUM(q.clicks)::int AS current_clicks,
          SUM(q.impressions)::int AS current_impressions,
          SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS current_position
        FROM search_console_query_data q
        CROSS JOIN anchor a
        WHERE q.site_id = ${siteId}
          AND q.date >= (a.latest_date - INTERVAL '29 days')::date
          AND q.date <= a.latest_date
          AND q.position BETWEEN 1 AND 200
        GROUP BY LOWER(BTRIM(q.query))
      )
      UPDATE tracked_keywords tk
      SET current_position = live.current_position,
          current_impressions = live.current_impressions,
          current_clicks = live.current_clicks,
          updated_at = NOW()
      FROM live
      WHERE tk.site_id = ${siteId}
        AND tk.is_active = TRUE
        AND LOWER(BTRIM(tk.keyword)) = live.keyword_key
    `;
  }

  return totalInserted;
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;
  await ensureSchemaOnce();

  try {
    // Google data sync always uses the server-side service account. OAuth tokens
    // are never copied into browser-visible sessions.
    console.log("[sync] Using server-side service account");

    const sql = getSQL();
    await ensureSyncStatusTable();
    const siteIdParam = request.nextUrl.searchParams.get("siteId");
    const siteId = siteIdParam ? Number(siteIdParam) : null;
    if (siteIdParam && (!Number.isFinite(siteId) || Number(siteId) <= 0)) {
      return NextResponse.json({ error: "Invalid siteId" }, { status: 400 });
    }
    const sites = siteId
      ? await sql`SELECT * FROM sites WHERE is_active = true AND id = ${siteId}`
      : await sql`SELECT * FROM sites WHERE is_active = true`;
    const days = parseSyncDays(request.nextUrl.searchParams.get("days"));
    const syncSource = async (
      site: Record<string, unknown>,
      source: SyncSource,
      configured: boolean,
      run: () => Promise<number>,
      latestTable: "analytics_daily" | "search_console_query_data"
    ) => {
      const startedAt = new Date();
      const loadLatestDate = async () => {
        const latestRows = latestTable === "analytics_daily"
          ? await sql`SELECT MAX(date)::text AS latest_date FROM analytics_daily WHERE site_id = ${site.id}`
          : await sql`SELECT MAX(date)::text AS latest_date FROM search_console_query_data WHERE site_id = ${site.id}`;
        return (latestRows[0]?.latest_date as string | null) ?? null;
      };
      if (!configured) {
        await saveSyncStatus({ siteId: Number(site.id), source, status: "skipped", rowsSynced: 0, latestDataDate: null, error: "Not configured", startedAt });
        return { rows: 0, latest_date: null, status: "skipped" as const, error: null };
      }
      try {
        const rows = await run();
        const latestDate = await loadLatestDate();
        await saveSyncStatus({ siteId: Number(site.id), source, status: "success", rowsSynced: rows, latestDataDate: latestDate, startedAt });
        return { rows, latest_date: latestDate, status: "success" as const, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const latestDate = await loadLatestDate().catch(() => null);
        await saveSyncStatus({ siteId: Number(site.id), source, status: "error", rowsSynced: 0, latestDataDate: latestDate, error: message, startedAt });
        return { rows: 0, latest_date: latestDate, status: "error" as const, error: message };
      }
    };

    const results = await mapWithConcurrency(sites, 3, async (site) => {
      const [analytics, gsc] = await Promise.all([
        syncSource(site, "ga4", Boolean(site.ga_property_id), () => syncAnalytics(site.id, site.ga_property_id), "analytics_daily"),
        syncSource(site, "gsc", Boolean(site.gsc_property), () => syncSearchConsole(site.id, site.gsc_property, days), "search_console_query_data"),
      ]);
      return { site_id: site.id, site: site.name, analytics, gsc };
    });

    const errors = results.reduce((count, result) =>
      count + Number(result.analytics.status === "error") + Number(result.gsc.status === "error"), 0);
    return NextResponse.json({ success: errors === 0, results, errors, days, auth: "service_account" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  await ensureSyncStatusTable();
  const sql = getSQL();
  const [sites, statuses, gscDates, ga4Dates] = await Promise.all([
    sql`SELECT id, name, gsc_property, ga_property_id FROM sites WHERE is_active = true ORDER BY name`,
    sql`SELECT site_id, source, status, rows_synced, latest_data_date::text, error, started_at, finished_at FROM data_sync_status`,
    sql`SELECT site_id, MAX(date)::text AS latest_date FROM search_console_query_data GROUP BY site_id`,
    sql`SELECT site_id, MAX(date)::text AS latest_date FROM analytics_daily GROUP BY site_id`,
  ]);

  const statusByKey = new Map(statuses.map((row) => [`${row.site_id}:${row.source}`, row]));
  const gscBySite = new Map(gscDates.map((row) => [Number(row.site_id), row.latest_date as string | null]));
  const ga4BySite = new Map(ga4Dates.map((row) => [Number(row.site_id), row.latest_date as string | null]));
  const results = sites.map((site) => ({
    site_id: site.id,
    site: site.name,
    gsc: statusByKey.get(`${site.id}:gsc`) ?? { status: site.gsc_property ? "never_run" : "not_configured", latest_data_date: gscBySite.get(Number(site.id)) ?? null },
    ga4: statusByKey.get(`${site.id}:ga4`) ?? { status: site.ga_property_id ? "never_run" : "not_configured", latest_data_date: ga4BySite.get(Number(site.id)) ?? null },
  }));

  return NextResponse.json({ success: true, generated_at: new Date().toISOString(), sites: results });
}
