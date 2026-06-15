import { ensureSchemaOnce, getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { GSC_LAG_DAYS } from "@/lib/gsc-window";
import { siteCountryCode } from "@/lib/site-country";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// Language -> target countries (ISO-3)
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

function isPollutedSearchQuery(value: unknown): boolean {
  const query = String(value ?? "").trim();
  if (!query) return true;
  const lower = query.toLowerCase();
  const commaCount = (query.match(/,/g) ?? []).length;

  if (/[\r\n]/.test(query)) return true;
  if (/(^|\s)(site|inurl|intitle|intext|cache|related|allinurl|allintitle|allintext|filetype):/i.test(query)) {
    return true;
  }
  if (/https?:\/\//i.test(query) || /\bwww\.[a-z0-9.-]+\.[a-z]{2,}\b/i.test(lower)) {
    return true;
  }

  // Bad CSV imports can leak whole rows into the query field:
  // "agence lead gen,92,0.01301,organic,https://...,8,..."
  if (commaCount >= 4) return true;
  if (commaCount >= 2 && /\b(organic|paid|cpc|ctr|position|impression|click)\b/i.test(query)) {
    return true;
  }
  if (commaCount >= 2 && /\d+\.\d{3,}/.test(query)) return true;
  if (query.length > 160 && commaCount >= 1) return true;

  return false;
}

function filterPollutedRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.filter((row) => !isPollutedSearchQuery(row.query));
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const type = request.nextUrl.searchParams.get("type") || "queries";
  const days = parseInt(request.nextUrl.searchParams.get("days") || "30", 10);
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "200", 10);
  const country = request.nextUrl.searchParams.get("country"); // ISO-3 or null
  const language = request.nextUrl.searchParams.get("language"); // fr/en/de/... or null
  const strictPositioned = request.nextUrl.searchParams.get("strict") === "1";

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
    await ensureSchemaOnce();
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
      // Query-level GSC is the truth for positions. Anchor the requested window on
      // the latest GSC date imported for this site, not on today's calendar date:
      // stale-but-real properties (Vocalis/Tesla/etc.) must show their last known
      // GSC rows instead of "0 keywords".
      const rows = countryFilter
        ? await sql`
            WITH anchor AS (
              SELECT MAX(date) AS end_date
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND country = ANY(${countryFilter})
            ),
            gsc AS (
              SELECT qd.query,
                SUM(qd.clicks) AS total_clicks,
                SUM(qd.impressions) AS total_impressions,
                SUM(qd.impressions * qd.ctr)::float / NULLIF(SUM(qd.impressions), 0) AS avg_ctr,
                SUM(qd.impressions * qd.position)::float / NULLIF(SUM(qd.impressions), 0) AS avg_position,
                NULL::float8 AS page_weighted_position,
                MIN(qd.date) AS first_seen,
                tk.volume_market,
                tk.volume_fr,
                tk.volume_ch,
                tk.market,
                tk.volume_source,
                'current'::varchar AS row_source
              FROM search_console_query_data qd
              LEFT JOIN tracked_keywords tk
                ON tk.site_id = ${id}
               AND LOWER(tk.keyword) = LOWER(qd.query)
               AND tk.is_active = TRUE
              WHERE qd.site_id = ${id}
                AND qd.date >= ((SELECT end_date FROM anchor) - INTERVAL '1 day' * (${days} - 1))::date
                AND qd.date <= (SELECT end_date FROM anchor)
                AND qd.query IS NOT NULL
                AND qd.position BETWEEN 1 AND 200
                AND qd.country = ANY(${countryFilter})
              GROUP BY qd.query, tk.volume_market, tk.volume_fr, tk.volume_ch, tk.market, tk.volume_source
              ORDER BY total_clicks DESC, total_impressions DESC
              LIMIT ${limit}
            ),
            gsc_30d AS (
              SELECT qd.query,
                SUM(qd.clicks) as total_clicks,
                SUM(qd.impressions) as total_impressions,
                SUM(qd.impressions * qd.ctr)::float / NULLIF(SUM(qd.impressions), 0) as avg_ctr,
                SUM(qd.impressions * qd.position)::float / NULLIF(SUM(qd.impressions), 0) as avg_position,
                NULL::float8 AS page_weighted_position,
                MIN(qd.date) AS first_seen,
                tk.volume_market,
                tk.volume_fr,
                tk.volume_ch,
                tk.market,
                tk.volume_source,
                'recent_30d'::varchar AS row_source
              FROM search_console_query_data qd
              LEFT JOIN tracked_keywords tk
                ON tk.site_id = ${id}
               AND LOWER(tk.keyword) = LOWER(qd.query)
               AND tk.is_active = TRUE
              WHERE qd.site_id = ${id}
                AND qd.date >= ((SELECT end_date FROM anchor) - INTERVAL '29 days')::date
                AND qd.date <= (SELECT end_date FROM anchor)
                AND qd.query IS NOT NULL
                AND qd.position BETWEEN 1 AND 200
                AND qd.country = ANY(${countryFilter})
                AND NOT EXISTS (SELECT 1 FROM gsc WHERE LOWER(gsc.query) = LOWER(qd.query))
              GROUP BY qd.query, tk.volume_market, tk.volume_fr, tk.volume_ch, tk.market, tk.volume_source
              HAVING SUM(qd.impressions) >= 5
            ),
            tracked_only AS (
              -- Tracked keywords NOT in GSC for this period OR last 30d
              -- No current GSC row means no current position. Keep volumes, hide stale positions.
              SELECT tk.keyword AS query,
                0::bigint AS total_clicks, 0::bigint AS total_impressions,
                0::float8 AS avg_ctr,
                NULL::float8 AS avg_position,
                NULL::float8 AS page_weighted_position,
                NULL::date AS first_seen,
                tk.volume_market::int, tk.volume_fr::int, tk.volume_ch::int, tk.market::varchar, tk.volume_source::varchar,
                'tracked'::varchar AS row_source
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
            WITH anchor AS (
              SELECT MAX(date) AS end_date
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
            ),
            gsc AS (
              SELECT qd.query,
                SUM(qd.clicks) AS total_clicks,
                SUM(qd.impressions) AS total_impressions,
                SUM(qd.impressions * qd.ctr)::float / NULLIF(SUM(qd.impressions), 0) AS avg_ctr,
                SUM(qd.impressions * qd.position)::float / NULLIF(SUM(qd.impressions), 0) AS avg_position,
                NULL::float8 AS page_weighted_position,
                MIN(qd.date) AS first_seen,
                tk.volume_market,
                tk.volume_fr,
                tk.volume_ch,
                tk.market,
                tk.volume_source,
                'current'::varchar AS row_source
              FROM search_console_query_data qd
              LEFT JOIN tracked_keywords tk
                ON tk.site_id = ${id}
               AND LOWER(tk.keyword) = LOWER(qd.query)
               AND tk.is_active = TRUE
              WHERE qd.site_id = ${id}
                AND qd.date >= ((SELECT end_date FROM anchor) - INTERVAL '1 day' * (${days} - 1))::date
                AND qd.date <= (SELECT end_date FROM anchor)
                AND qd.query IS NOT NULL
                AND qd.position BETWEEN 1 AND 200
              GROUP BY qd.query, tk.volume_market, tk.volume_fr, tk.volume_ch, tk.market, tk.volume_source
              ORDER BY total_clicks DESC, total_impressions DESC
              LIMIT ${limit}
            ),
            gsc_30d AS (
              SELECT qd.query,
                SUM(qd.clicks) AS total_clicks,
                SUM(qd.impressions) AS total_impressions,
                SUM(qd.impressions * qd.ctr)::float / NULLIF(SUM(qd.impressions), 0) AS avg_ctr,
                SUM(qd.impressions * qd.position)::float / NULLIF(SUM(qd.impressions), 0) AS avg_position,
                NULL::float8 AS page_weighted_position,
                MIN(qd.date) AS first_seen,
                tk.volume_market,
                tk.volume_fr,
                tk.volume_ch,
                tk.market,
                tk.volume_source,
                'recent_30d'::varchar AS row_source
              FROM search_console_query_data qd
              LEFT JOIN tracked_keywords tk
                ON tk.site_id = ${id}
               AND LOWER(tk.keyword) = LOWER(qd.query)
               AND tk.is_active = TRUE
              WHERE qd.site_id = ${id}
                AND qd.date >= ((SELECT end_date FROM anchor) - INTERVAL '29 days')::date
                AND qd.date <= (SELECT end_date FROM anchor)
                AND qd.query IS NOT NULL
                AND qd.position BETWEEN 1 AND 200
                AND NOT EXISTS (SELECT 1 FROM gsc WHERE LOWER(gsc.query) = LOWER(qd.query))
              GROUP BY qd.query, tk.volume_market, tk.volume_fr, tk.volume_ch, tk.market, tk.volume_source
              HAVING SUM(qd.impressions) >= 5
            ),
            tracked_only AS (
              SELECT keyword AS query, 0::bigint AS total_clicks, 0::bigint AS total_impressions,
                0::float8 AS avg_ctr,
                NULL::float8 AS avg_position,
                NULL::float8 AS page_weighted_position,
                NULL::date AS first_seen, volume_market::int, volume_fr::int, volume_ch::int, market::varchar, volume_source::varchar,
                'tracked'::varchar AS row_source
              FROM tracked_keywords WHERE site_id=${id} AND is_active=true
                AND NOT EXISTS (SELECT 1 FROM gsc WHERE LOWER(gsc.query) = LOWER(tracked_keywords.keyword))
                AND NOT EXISTS (SELECT 1 FROM gsc_30d WHERE LOWER(gsc_30d.query) = LOWER(tracked_keywords.keyword))
            )
            SELECT * FROM gsc
            UNION ALL
            SELECT * FROM gsc_30d
            UNION ALL
            SELECT * FROM tracked_only
            ORDER BY total_clicks DESC, total_impressions DESC
          `;
      const allRows = rows as Record<string, unknown>[];
      const currentRows = allRows.filter((row) => row.row_source === "current");
      const visibleRows = strictPositioned ? currentRows : rows;
      return NextResponse.json(filterPollutedRows(visibleRows as Record<string, unknown>[]));
    }

    if (type === "gains") {
      // 5 complete weekly buckets, excluding the GSC lag window.
      const rows = countryFilter
        ? await sql`
            WITH anchor AS (
              SELECT COALESCE(MAX(date), (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date) AS end_date
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND country = ANY(${countryFilter})
            ),
            w0 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks,
                SUM(impressions) AS impressions
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '6 days')::date
                AND date <= (SELECT end_date FROM anchor)
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w1 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '13 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '7 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w2 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '20 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '14 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w3 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '27 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '21 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND country = ANY(${countryFilter})
              GROUP BY query
            ),
            w4 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '34 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '28 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
                AND country = ANY(${countryFilter})
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
              (SELECT MIN(date) FROM search_console_query_data WHERE site_id = ${id} AND query = w0.query) AS first_seen,
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
            WITH anchor AS (
              SELECT COALESCE(MAX(date), (CURRENT_DATE - INTERVAL '1 day' * ${GSC_LAG_DAYS})::date) AS end_date
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
            ),
            w0 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks,
                SUM(impressions) AS impressions
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '6 days')::date
                AND date <= (SELECT end_date FROM anchor)
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
              GROUP BY query
            ),
            w1 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '13 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '7 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
              GROUP BY query
            ),
            w2 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '20 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '14 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
              GROUP BY query
            ),
            w3 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '27 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '21 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
              GROUP BY query
            ),
            w4 AS (
              SELECT query,
                SUM(impressions * position)::float / NULLIF(SUM(impressions), 0) AS pos,
                SUM(clicks) AS clicks
              FROM search_console_query_data
              WHERE site_id = ${id}
                AND date >= ((SELECT end_date FROM anchor) - INTERVAL '34 days')::date
                AND date <= ((SELECT end_date FROM anchor) - INTERVAL '28 days')::date
                AND query IS NOT NULL
                AND position BETWEEN 1 AND 200
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
              (SELECT MIN(date) FROM search_console_query_data WHERE site_id = ${id} AND query = w0.query) AS first_seen,
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

      // Date labels for the same complete GSC windows used above.
      const today = new Date();
      const fmt = (offset: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - offset);
        return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
      };
      const lag = GSC_LAG_DAYS;
      const labels = {
        w0: `${fmt(lag + 6)}-${fmt(lag)}`,
        w1: `${fmt(lag + 13)}-${fmt(lag + 7)}`,
        w2: `${fmt(lag + 20)}-${fmt(lag + 14)}`,
        w3: `${fmt(lag + 27)}-${fmt(lag + 21)}`,
        w4: `${fmt(lag + 34)}-${fmt(lag + 28)}`,
      };

      return NextResponse.json({ rows: filterPollutedRows(rows as Record<string, unknown>[]), labels });
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
              AND country = ANY(${countryFilter})
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
