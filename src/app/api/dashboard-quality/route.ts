import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { ensureSchemaOnce, getSQL } from "@/lib/db";
import { GSC_LAG_DAYS } from "@/lib/gsc-window";

export const dynamic = "force-dynamic";

export async function GET() {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  await ensureSchemaOnce();
  const sql = getSQL();

  const rows = await sql`
    WITH q AS (
      WITH anchor AS (
        SELECT site_id, MAX(date) AS latest_gsc_date
        FROM search_console_query_data
        WHERE position BETWEEN 1 AND 200
        GROUP BY site_id
      )
      SELECT
        a.site_id,
        a.latest_gsc_date,
        COUNT(DISTINCT qd.query) FILTER (
          WHERE qd.date >= (a.latest_gsc_date - INTERVAL '29 days')::date
            AND qd.position BETWEEN 1 AND 200
        ) AS positioned_keywords_30d,
        COUNT(DISTINCT qd.query) FILTER (
          WHERE qd.date >= (a.latest_gsc_date - INTERVAL '6 days')::date
            AND qd.position BETWEEN 1 AND 10
        ) AS top10_keywords_7d
      FROM anchor a
      LEFT JOIN search_console_query_data qd
        ON qd.site_id = a.site_id
       AND qd.date >= (a.latest_gsc_date - INTERVAL '29 days')::date
       AND qd.date <= a.latest_gsc_date
      GROUP BY a.site_id, a.latest_gsc_date
    ),
    tk AS (
      SELECT
        site_id,
        COUNT(*) FILTER (WHERE is_active = TRUE) AS tracked_keywords,
        COUNT(*) FILTER (
          WHERE is_active = TRUE
            AND COALESCE(volume_market, volume_ch, volume_fr, 0) > 1
            AND volume_source LIKE 'google_kp_real_%'
        ) AS kp_volumes_imported,
        COUNT(*) FILTER (
          WHERE is_active = TRUE
            AND COALESCE(volume_market, volume_ch, volume_fr, 0) <= 1
        ) AS kp_volumes_missing
      FROM tracked_keywords
      GROUP BY site_id
    ),
    gains AS (
      SELECT site_id, COUNT(*) AS gain_candidates
      FROM (
        SELECT
          qd.site_id,
          qd.query,
          SUM(impressions * position) FILTER (
            WHERE date >= (a.latest_gsc_date - INTERVAL '6 days')::date
              AND date <= a.latest_gsc_date
          )::float / NULLIF(SUM(impressions) FILTER (
            WHERE date >= (a.latest_gsc_date - INTERVAL '6 days')::date
              AND date <= a.latest_gsc_date
          ), 0) AS pos_now,
          SUM(impressions * position) FILTER (
            WHERE date >= (a.latest_gsc_date - INTERVAL '13 days')::date
              AND date <= (a.latest_gsc_date - INTERVAL '7 days')::date
          )::float / NULLIF(SUM(impressions) FILTER (
            WHERE date >= (a.latest_gsc_date - INTERVAL '13 days')::date
              AND date <= (a.latest_gsc_date - INTERVAL '7 days')::date
          ), 0) AS pos_prev
        FROM search_console_query_data qd
        JOIN (
          SELECT site_id, MAX(date) AS latest_gsc_date
          FROM search_console_query_data
          WHERE position BETWEEN 1 AND 200
          GROUP BY site_id
        ) a ON a.site_id = qd.site_id
        WHERE qd.date >= (a.latest_gsc_date - INTERVAL '13 days')::date
          AND qd.date <= a.latest_gsc_date
          AND qd.position BETWEEN 1 AND 200
        GROUP BY qd.site_id, qd.query
      ) x
      WHERE pos_now IS NOT NULL
        AND pos_prev IS NOT NULL
        AND ABS(pos_prev - pos_now) > 0.5
      GROUP BY site_id
    ),
    ga AS (
      SELECT
        site_id,
        MAX(date) AS latest_ga4_date,
        COUNT(DISTINCT date) FILTER (WHERE date >= (CURRENT_DATE - INTERVAL '29 days')::date)::int AS ga4_days_30d,
        SUM(users) FILTER (WHERE date >= (CURRENT_DATE - INTERVAL '30 days')::date) AS users_30d
      FROM analytics_daily
      GROUP BY site_id
    )
    SELECT
      s.id,
      s.name,
      s.url,
      s.gsc_property,
      s.ga_property_id,
      q.latest_gsc_date::text,
      COALESCE(q.positioned_keywords_30d, 0)::int AS positioned_keywords_30d,
      COALESCE(q.top10_keywords_7d, 0)::int AS top10_keywords_7d,
      COALESCE(tk.tracked_keywords, 0)::int AS tracked_keywords,
      COALESCE(tk.kp_volumes_imported, 0)::int AS kp_volumes_imported,
      COALESCE(tk.kp_volumes_missing, 0)::int AS kp_volumes_missing,
      COALESCE(gains.gain_candidates, 0)::int AS gain_candidates,
      ga.latest_ga4_date::text,
      COALESCE(ga.ga4_days_30d, 0)::int AS ga4_days_30d,
      COALESCE(ga.users_30d, 0)::int AS users_30d,
      CASE
        WHEN s.gsc_property IS NULL THEN 'gsc_not_configured'
        WHEN q.latest_gsc_date IS NULL THEN 'gsc_no_query_data'
        WHEN q.latest_gsc_date < (CURRENT_DATE - INTERVAL '1 day' * (${GSC_LAG_DAYS} + 2))::date THEN 'gsc_stale'
        WHEN s.ga_property_id IS NOT NULL AND ga.latest_ga4_date IS NULL THEN 'ga4_no_daily_data'
        WHEN s.ga_property_id IS NOT NULL AND ga.latest_ga4_date < (CURRENT_DATE - INTERVAL '3 days')::date THEN 'ga4_stale'
        WHEN s.ga_property_id IS NOT NULL AND COALESCE(ga.ga4_days_30d, 0) < 28 THEN 'ga4_incomplete'
        WHEN COALESCE(tk.kp_volumes_imported, 0) = 0 THEN 'kp_missing'
        ELSE 'ok'
      END AS status
    FROM sites s
    LEFT JOIN q ON q.site_id = s.id
    LEFT JOIN tk ON tk.site_id = s.id
    LEFT JOIN gains ON gains.site_id = s.id
    LEFT JOIN ga ON ga.site_id = s.id
    WHERE s.is_active = TRUE
    ORDER BY
      CASE
        WHEN q.latest_gsc_date IS NULL THEN 0
        WHEN q.latest_gsc_date < (CURRENT_DATE - INTERVAL '1 day' * (${GSC_LAG_DAYS} + 2))::date THEN 1
        WHEN s.ga_property_id IS NOT NULL AND ga.latest_ga4_date IS NULL THEN 2
        WHEN s.ga_property_id IS NOT NULL AND ga.latest_ga4_date < (CURRENT_DATE - INTERVAL '3 days')::date THEN 3
        WHEN s.ga_property_id IS NOT NULL AND COALESCE(ga.ga4_days_30d, 0) < 28 THEN 4
        WHEN COALESCE(tk.kp_volumes_imported, 0) = 0 THEN 5
        ELSE 6
      END,
      s.name ASC
  `;

  const sites: (Record<string, unknown> & { issues: string[] })[] = rows.map((row) => {
    const site = row as Record<string, unknown>;
    const issues: string[] = [];
    if (!site.gsc_property) issues.push("gsc_not_configured");
    else if (!site.latest_gsc_date) issues.push("gsc_no_query_data");
    else if (new Date(String(site.latest_gsc_date)) < new Date(Date.now() - (GSC_LAG_DAYS + 2) * 86_400_000)) issues.push("gsc_stale");
    if (site.ga_property_id && !site.latest_ga4_date) issues.push("ga4_no_daily_data");
    else if (site.ga_property_id && new Date(String(site.latest_ga4_date)) < new Date(Date.now() - 3 * 86_400_000)) issues.push("ga4_stale");
    else if (site.ga_property_id && Number(site.ga4_days_30d) < 28) issues.push("ga4_incomplete");
    if (Number(site.kp_volumes_imported) === 0) issues.push("kp_missing");
    return { ...site, issues };
  });

  const summary = sites.reduce(
    (acc, row) => {
      const status = String(row.status);
      acc.total += 1;
      acc.statuses[status] = (acc.statuses[status] ?? 0) + 1;
      return acc;
    },
    { total: 0, statuses: {} as Record<string, number> }
  );

  return NextResponse.json(
    {
      success: true,
    generated_at: new Date().toISOString(),
    rules: {
      positions: "Positions from search_console_query_data or reconciled tracked_keywords current_position.",
      volumes: "Volumes only from verified Keyword Planner imports; GSC impressions remain a visibility signal, never a search-volume fallback.",
      no_fake_positions: true,
      no_silent_empty_modules: true,
    },
    summary,
    sites,
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
