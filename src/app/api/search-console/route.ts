import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { GSC_LAG_DAYS } from "@/lib/gsc-window";
import { siteCountryCode } from "@/lib/site-country";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// Language → target countries (ISO-3)
const LANG_COUNTRIES: Record<string, string[]> = {
  fr: ["FRA","BEL","CHE","LUX","MCO","CAN"],
  en: ["GBR","USA","IRL","AUS","NZL","CAN"],
  de: ["DEU","AUT","CHE","LIE"],
  es: ["ESP","MEX","ARG","COL","CHL","PER"],
  it: ["ITA","CHE","SMR","VAT"],
  nl: ["NLD","BEL"],
  pt: ["PRT","BRA","AGO","MOZ"],
  ch: ["CHE"],
};

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const type = request.nextUrl.searchParams.get("type") || "queries";
  const days = parseInt(request.nextUrl.searchParams.get("days") || "30", 10);
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "200", 10);
  const country = request.nextUrl.searchParams.get("country"); // ISO-3 or null
  const language = request.nextUrl.searchParams.get("language"); // fr/en/de/... or null

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });

  const id = parseInt(siteId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid siteId" }, { status: 400 });
  }
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return NextResponse.json({ error: "Invalid days (1..365)" }, { status: 400 });
  }
  if (!Number.isFinite(limit) || limit <= 0 || limit > 5000) {
    return NextResponse.json({ error: "Invalid limit (1..5000)" }, { status: 400 });
  }

  if (isLocalDevDemoMode()) {
    return NextResponse.json([]);
  }

  try {
    const sql = getSQL();

    // Resolve filter: explicit country > language mapping > null (all countries).
    // Default (no override) = ALL countries. TLD-based default was removed because
    // it cut international traffic for .pro/.com/.org sites (e.g. vocalis.pro showed
    // only FRA, missing RUS+BEL+MAR+CHE etc. = -40% of real clicks).
    let countryFilter: string[] | null;
    if (country) {
      countryFilter = [country];
    } else if (language && language !== "all" && LANG_COUNTRIES[language]) {
      countryFilter = LANG_COUNTRIES[language];
    } else {
      countryFilter = null; // "Tous pays" = no filter = show all countries
    }

    if (type === "queries") {
      // Bug B fix: use query-level position from search_console_query_data (no page split,
      // matches what GSC UI displays). search_console_data is page-level → SUM(imp×pos)/
      // SUM(imp) is impressions-weighted across pages and gets dragged down by deep pages.
      // Fall back to page-level aggregation if query-level row not yet synced.
      // ALWAYS include tracked_keywords even if 0 impressions in the period.
      // This prevents tracked keywords disappearing when switching to shorter periods.
      // Strategy: UNION of (GSC data for period) + (tracked_keywords with 0 data fallback)
      const rows = countryFilter
        ? await sql`
            WITH gsc AS (
              SELECT q.query,
                COALESCE(ql.clicks_q, q.total_clicks)                AS total_clicks,
                COALESCE(ql.impressions_q, q.total_impressions)      AS total_impressions,
                COALESCE(ql.ctr_q, q.avg_ctr)                        AS avg_ctr,
                COALESCE(ql.position_q, q.avg_position)              AS avg_position,
                q.avg_position                                       AS page_weighted_position,
                q.first_seen,
                tk.volume_market,
                tk.volume_fr,
                tk.volume_ch,
                tk.market,
                tk.volume_source
              FROM (
                SELECT query,
                  SUM(clicks) as total_clicks,
                  SUM(impressions) as total_impressions,
                  AVG(ctr) as avg_ctr,
                  AVG(position) as avg_position,
                  (SELECT MIN(date) FROM search_console_data WHERE site_id = ${id} AND query = d.query) AS first_seen
                FROM search_console_data d
                WHERE site_id = ${id}
                  AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                  AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                  AND query IS NOT NULL
                  AND position BETWEEN 1 AND 200
                  AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
                GROUP BY query
                ORDER BY total_clicks DESC
                LIMIT ${limit}
              ) q
              LEFT JOIN LATERAL (
                SELECT SUM(clicks)                                                     AS clicks_q,
                       SUM(impressions)                                                AS impressions_q,
                       SUM(impressions * ctr)::float / NULLIF(SUM(impressions), 0)     AS ctr_q,
                       SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS position_q
                FROM search_console_query_data
                WHERE site_id = ${id}
                  AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                  AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                  AND query = q.query
                  AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
              ) ql ON TRUE
              LEFT JOIN tracked_keywords tk
                ON tk.site_id = ${id}
               AND LOWER(tk.keyword) = LOWER(q.query)
               AND tk.is_active = TRUE
            ),
            -- Recent 30d GSC data: keywords active last 30d but not in current period
            -- This prevents keywords disappearing when switching to short periods (7j/3j)
            gsc_30d AS (
              SELECT query,
                SUM(clicks) as total_clicks,
                SUM(impressions) as total_impressions,
                AVG(ctr) as avg_ctr,
                AVG(position) as avg_position,
                AVG(position) AS page_weighted_position,
                NULL AS first_seen,
                NULL::int AS volume_market, NULL::int AS volume_fr, NULL::int AS volume_ch, NULL::varchar AS market, NULL::varchar AS volume_source
              FROM search_console_data d
              WHERE site_id = ${id}
                AND date >= (CURRENT_DATE - 30)::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
                AND NOT EXISTS (SELECT 1 FROM gsc WHERE LOWER(gsc.query) = LOWER(d.query))
              GROUP BY query
              HAVING SUM(impressions) >= 5
            ),
            tracked_only AS (
              -- Tracked keywords NOT in GSC for this period OR last 30d
              -- Use current_position from tracked_keywords if set, else NULL (not 0)
              SELECT tk.keyword AS query,
                0::bigint AS total_clicks, 0::bigint AS total_impressions,
                0::float8 AS avg_ctr,
                NULLIF(tk.current_position::float8, 0) AS avg_position,
                NULLIF(tk.current_position::float8, 0) AS page_weighted_position,
                NULL::date AS first_seen,
                tk.volume_market::int, tk.volume_fr::int, tk.volume_ch::int, tk.market::varchar, tk.volume_source::varchar
              FROM tracked_keywords tk
              WHERE tk.site_id = ${id} AND tk.is_active = TRUE
                AND NOT EXISTS (SELECT 1 FROM gsc WHERE LOWER(gsc.query) = LOWER(tk.keyword))
                AND NOT EXISTS (SELECT 1 FROM gsc_30d WHERE LOWER(gsc_30d.query) = LOWER(tk.keyword))
            )
            SELECT * FROM gsc
            UNION ALL
            SELECT * FROM gsc_30d
            UNION ALL
            SELECT * FROM tracked_only
            ORDER BY total_clicks DESC, total_impressions DESC
          `
        : await sql`
            SELECT q.query,
              COALESCE(ql.clicks_q, q.total_clicks)                AS total_clicks,
              COALESCE(ql.impressions_q, q.total_impressions)      AS total_impressions,
              COALESCE(ql.ctr_q, q.avg_ctr)                        AS avg_ctr,
              COALESCE(ql.position_q, q.avg_position)              AS avg_position,
              q.avg_position                                       AS page_weighted_position,
              q.first_seen,
              tk.volume_market,
              tk.volume_fr,
              tk.volume_ch,
              tk.market,
              tk.volume_source
            FROM (
              SELECT query,
                SUM(clicks) as total_clicks,
                SUM(impressions) as total_impressions,
                AVG(ctr) as avg_ctr,
                AVG(position) as avg_position,
                (SELECT MIN(date) FROM search_console_data WHERE site_id = ${id} AND query = d.query) AS first_seen
              FROM search_console_data d
              WHERE site_id = ${id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '')
              GROUP BY query
              ORDER BY total_clicks DESC
              LIMIT ${limit}
            ) q
            LEFT JOIN LATERAL (
              SELECT SUM(clicks)                                                     AS clicks_q,
                     SUM(impressions)                                                AS impressions_q,
                     SUM(impressions * ctr)::float / NULLIF(SUM(impressions), 0)     AS ctr_q,
                     SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS position_q
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND query = q.query
                AND (country IS NULL OR country = '')
            ) ql ON TRUE
            LEFT JOIN tracked_keywords tk
              ON tk.site_id = ${id}
             AND LOWER(tk.keyword) = LOWER(q.query)
             AND tk.is_active = TRUE
          `
          // Add 30d keywords + tracked keywords not in current period window
          .then(async (baseRows: Record<string, unknown>[]) => {
            const seen = new Set(baseRows.map(r => String(r.query ?? "").toLowerCase()));
            const gsc30 = (await sql`
              SELECT query, SUM(clicks) AS total_clicks, SUM(impressions) AS total_impressions,
                AVG(ctr) AS avg_ctr, AVG(position) AS avg_position, AVG(position) AS page_weighted_position,
                NULL AS first_seen, NULL::int AS volume_market, NULL::int AS volume_fr, NULL::int AS volume_ch, NULL::varchar AS market, NULL::varchar AS volume_source
              FROM search_console_data
              WHERE site_id=${id} AND date >= (CURRENT_DATE-30)::date
                AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
                AND query IS NOT NULL AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '')
              GROUP BY query HAVING SUM(impressions) >= 5
            `) as Record<string, unknown>[];
            const trackedOnly = (await sql`
              SELECT keyword AS query, 0 AS total_clicks, 0 AS total_impressions,
                0::float8 AS avg_ctr,
                NULLIF(current_position::float8, 0) AS avg_position,
                NULLIF(current_position::float8, 0) AS page_weighted_position,
                NULL::date AS first_seen, volume_market::int, volume_fr::int, volume_ch::int, market::varchar, volume_source::varchar
              FROM tracked_keywords WHERE site_id=${id} AND is_active=true
            `) as Record<string, unknown>[];
            const extra = [...gsc30, ...trackedOnly]
              .filter(r => !seen.has(String(r.query ?? "").toLowerCase()));
            const deduped: Record<string, unknown>[] = [...baseRows];
            const dedupSeen = new Set(seen);
            for (const r of extra) {
              const k = String(r.query ?? "").toLowerCase();
              if (!dedupSeen.has(k)) { deduped.push(r); dedupSeen.add(k); }
            }
            return deduped.sort((a, b) =>
              (Number(b.total_clicks) || 0) - (Number(a.total_clicks) || 0) ||
              (Number(b.total_impressions) || 0) - (Number(a.total_impressions) || 0)
            );
          });
      return NextResponse.json(rows);
    }

    if (type === "gains") {
      // 5 buckets hebdo : W0 (cette sem.) → W4 (il y a 4 sem.) + dates
      const rows = countryFilter
        ? await sql`
            WITH w0 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks, SUM(impressions) AS impressions
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
              GROUP BY query
            ),
            w1 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '14 days'
                AND date <  NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
              GROUP BY query
            ),
            w2 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '21 days'
                AND date <  NOW() - INTERVAL '14 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
              GROUP BY query
            ),
            w3 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '28 days'
                AND date <  NOW() - INTERVAL '21 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
              GROUP BY query
            ),
            w4 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '35 days'
                AND date <  NOW() - INTERVAL '28 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
              GROUP BY query
            )
            SELECT
              w0.query,
              ROUND(w0.pos::numeric, 1) AS position_now,
              ROUND(w1.pos::numeric, 1) AS position_prev,
              ROUND(w2.pos::numeric, 1) AS position_w2,
              ROUND(w3.pos::numeric, 1) AS position_w3,
              ROUND(w4.pos::numeric, 1) AS position_w4,
              ROUND((w1.pos - w0.pos)::numeric, 1) AS gain,
              ROUND((w2.pos - w1.pos)::numeric, 1) AS gain_w1_w2,
              ROUND((w3.pos - w2.pos)::numeric, 1) AS gain_w2_w3,
              ROUND((w4.pos - w3.pos)::numeric, 1) AS gain_w3_w4,
              w0.clicks AS clicks_now, w0.impressions AS impressions_now,
              w1.clicks AS clicks_prev,
              (w0.clicks - COALESCE(w1.clicks, 0)) AS clicks_gain,
              (SELECT MIN(date) FROM search_console_data WHERE site_id = ${id} AND query = w0.query) AS first_seen,
              tk.volume_market,
              tk.volume_fr,
              tk.volume_ch,
              tk.market,
              tk.volume_source
            FROM w0
            LEFT JOIN w1 ON w1.query = w0.query
            LEFT JOIN w2 ON w2.query = w0.query
            LEFT JOIN w3 ON w3.query = w0.query
            LEFT JOIN w4 ON w4.query = w0.query
            LEFT JOIN tracked_keywords tk ON tk.site_id = ${id}
              AND LOWER(tk.keyword) = LOWER(w0.query)
              AND tk.is_active = TRUE
            WHERE w1.pos IS NOT NULL
              AND ABS(w1.pos - w0.pos) > 0.5
            ORDER BY (w1.pos - w0.pos) DESC NULLS LAST
            LIMIT ${limit}
          `
        : await sql`
            WITH w0 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks, SUM(impressions) AS impressions
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '')
              GROUP BY query
            ),
            w1 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '14 days'
                AND date <  NOW() - INTERVAL '7 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '')
              GROUP BY query
            ),
            w2 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '21 days'
                AND date <  NOW() - INTERVAL '14 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '')
              GROUP BY query
            ),
            w3 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '28 days'
                AND date <  NOW() - INTERVAL '21 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '')
              GROUP BY query
            ),
            w4 AS (
              SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
              FROM search_console_data
              WHERE site_id = ${id}
                AND date >= NOW() - INTERVAL '35 days'
                AND date <  NOW() - INTERVAL '28 days'
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND (country IS NULL OR country = '')
              GROUP BY query
            )
            SELECT
              w0.query,
              ROUND(w0.pos::numeric, 1) AS position_now,
              ROUND(w1.pos::numeric, 1) AS position_prev,
              ROUND(w2.pos::numeric, 1) AS position_w2,
              ROUND(w3.pos::numeric, 1) AS position_w3,
              ROUND(w4.pos::numeric, 1) AS position_w4,
              ROUND((w1.pos - w0.pos)::numeric, 1) AS gain,
              ROUND((w2.pos - w1.pos)::numeric, 1) AS gain_w1_w2,
              ROUND((w3.pos - w2.pos)::numeric, 1) AS gain_w2_w3,
              ROUND((w4.pos - w3.pos)::numeric, 1) AS gain_w3_w4,
              w0.clicks AS clicks_now, w0.impressions AS impressions_now,
              w1.clicks AS clicks_prev,
              (w0.clicks - COALESCE(w1.clicks, 0)) AS clicks_gain,
              (SELECT MIN(date) FROM search_console_data WHERE site_id = ${id} AND query = w0.query) AS first_seen,
              tk.volume_market,
              tk.volume_fr,
              tk.volume_ch,
              tk.market,
              tk.volume_source
            FROM w0
            LEFT JOIN w1 ON w1.query = w0.query
            LEFT JOIN w2 ON w2.query = w0.query
            LEFT JOIN w3 ON w3.query = w0.query
            LEFT JOIN w4 ON w4.query = w0.query
            LEFT JOIN tracked_keywords tk ON tk.site_id = ${id}
              AND LOWER(tk.keyword) = LOWER(w0.query)
              AND tk.is_active = TRUE
            WHERE w1.pos IS NOT NULL
              AND ABS(w1.pos - w0.pos) > 0.5
            ORDER BY (w1.pos - w0.pos) DESC NULLS LAST
            LIMIT ${limit}
          `;

      // Date labels (TZ serveur — affichage frontend)
      const today = new Date();
      const fmt = (offset: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - offset);
        return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
      };
      const labels = {
        w0: `${fmt(7)}–${fmt(0)}`,
        w1: `${fmt(14)}–${fmt(8)}`,
        w2: `${fmt(21)}–${fmt(15)}`,
        w3: `${fmt(28)}–${fmt(22)}`,
        w4: `${fmt(35)}–${fmt(29)}`,
      };

      return NextResponse.json({ rows, labels });
    }

    if (type === "pages") {
      const rows = countryFilter
        ? await sql`
            SELECT page,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(ctr) as avg_ctr,
              AVG(position) as avg_position,
              COUNT(DISTINCT query) as keyword_count
            FROM search_console_data
            WHERE site_id = ${id}
              AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
              AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
              AND page IS NOT NULL
              AND position BETWEEN 1 AND 200
              AND (country IS NULL OR country = '' OR country = ANY(${countryFilter}))
            GROUP BY page
            ORDER BY total_clicks DESC
            LIMIT ${limit}
          `
        : await sql`
            SELECT page,
              SUM(clicks) as total_clicks,
              SUM(impressions) as total_impressions,
              AVG(ctr) as avg_ctr,
              AVG(position) as avg_position,
              COUNT(DISTINCT query) as keyword_count
            FROM search_console_data
            WHERE site_id = ${id}
              AND date >= (CURRENT_DATE - INTERVAL '1 day' * (${days} - 1 + ${GSC_LAG_DAYS}))::date
              AND date <= (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date
              AND page IS NOT NULL
              AND position BETWEEN 1 AND 200
              AND (country IS NULL OR country = '')
            GROUP BY page
            ORDER BY total_clicks DESC
            LIMIT ${limit}
          `;
      return NextResponse.json(rows);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
