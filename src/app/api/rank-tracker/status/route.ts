export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";
import { logError } from "@/lib/logger";

const DEFAULT_ENGINE = "brave";
const DEFAULT_CYCLE_DAYS = 4;
const TRACKED_PER_SITE_LIMIT = 30;

interface StatusRow {
  site_id: number;
  site_name: string;
  total_keywords: number;
  checked_in_cycle: number;
  ranked_in_cycle: number;
  gsc_positioned: number;
  stale_keywords: number;
  latest_checked_at: string | null;
  latest_gsc_position_at: string | null;
  oldest_checked_at: string | null;
}

async function ensureRankStatusSchema(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS rank_tracking (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      keyword VARCHAR(500) NOT NULL,
      our_position INTEGER,
      top_10_results JSONB NOT NULL DEFAULT '[]'::jsonb,
      search_engine VARCHAR(10) NOT NULL DEFAULT 'brave',
      checked_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_rank_tracking_status_latest
      ON rank_tracking(search_engine, site_id, LOWER(keyword), checked_at DESC)
      INCLUDE (our_position)
  `;
}

function levelFromCoverage(coverage: number, ageHours: number | null, cycleDays: number): "fresh" | "partial" | "late" | "empty" {
  if (coverage <= 0) return "empty";
  if (ageHours != null && ageHours > cycleDays * 24 + 12) return "late";
  if (coverage >= 0.9) return "fresh";
  if (coverage >= 0.35) return "partial";
  return "late";
}

export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteIdRaw = req.nextUrl.searchParams.get("site_id");
  const engine = (req.nextUrl.searchParams.get("engine") || DEFAULT_ENGINE).toLowerCase();
  const cycleDaysRaw = req.nextUrl.searchParams.get("cycle_days");
  const cycleDays = cycleDaysRaw == null ? DEFAULT_CYCLE_DAYS : Number(cycleDaysRaw);
  const siteId = siteIdRaw && siteIdRaw !== "all" ? Number(siteIdRaw) : null;

  if (!Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > 14) {
    return NextResponse.json({ success: false, error: "cycle_days invalid (1..14)" }, { status: 400 });
  }
  if (!/^(brave|duckduckgo|google|bing)$/i.test(engine)) {
    return NextResponse.json({ success: false, error: "engine invalid" }, { status: 400 });
  }
  if (siteIdRaw && siteIdRaw !== "all" && (!Number.isInteger(siteId) || Number(siteId) <= 0)) {
    return NextResponse.json({ success: false, error: "site_id invalid" }, { status: 400 });
  }

  const sql = getSQL();

  try {
    await ensureRankStatusSchema(sql);
    const rows = (await sql`
      WITH ranked_keywords AS (
        SELECT
          tk.site_id,
          s.name AS site_name,
          tk.keyword,
          tk.current_position,
          tk.updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY tk.site_id
            ORDER BY COALESCE(tk.volume_market, tk.volume_fr, 0) DESC, tk.id ASC
          ) AS rn
        FROM tracked_keywords tk
        JOIN sites s ON s.id = tk.site_id
        WHERE tk.is_active = TRUE
          AND s.is_active = TRUE
          AND (${siteId}::int IS NULL OR tk.site_id = ${siteId})
      ),
      tracked_scope AS (
        SELECT site_id, site_name, keyword, current_position, updated_at
        FROM ranked_keywords
        WHERE rn <= ${TRACKED_PER_SITE_LIMIT}
      )
      SELECT
        ts.site_id,
        MAX(ts.site_name) AS site_name,
        COUNT(*)::int AS total_keywords,
        COUNT(latest.checked_at) FILTER (
          WHERE latest.checked_at >= NOW() - (${cycleDays} || ' days')::interval
        )::int AS checked_in_cycle,
        COUNT(latest.checked_at) FILTER (
          WHERE latest.checked_at >= NOW() - (${cycleDays} || ' days')::interval
            AND latest.our_position IS NOT NULL
        )::int AS ranked_in_cycle,
        COUNT(*) FILTER (
          WHERE ts.current_position IS NOT NULL
            AND ts.current_position > 0
        )::int AS gsc_positioned,
        COUNT(*) FILTER (
          WHERE latest.checked_at IS NULL
             OR latest.checked_at < NOW() - (${cycleDays} || ' days')::interval
        )::int AS stale_keywords,
        MAX(latest.checked_at)::text AS latest_checked_at,
        MAX(ts.updated_at)::text AS latest_gsc_position_at,
        MIN(latest.checked_at)::text AS oldest_checked_at
      FROM tracked_scope ts
      LEFT JOIN LATERAL (
        SELECT rt.our_position, rt.checked_at
        FROM rank_tracking rt
        WHERE rt.site_id = ts.site_id
          AND LOWER(rt.keyword) = LOWER(ts.keyword)
          AND rt.search_engine = ${engine}
        ORDER BY rt.checked_at DESC
        LIMIT 1
      ) latest ON TRUE
      GROUP BY ts.site_id
      ORDER BY MAX(ts.site_name) ASC
    `) as StatusRow[];

    const sites = rows.map((row) => {
      const total = Number(row.total_keywords) || 0;
      const checked = Number(row.checked_in_cycle) || 0;
      const gscPositioned = Number(row.gsc_positioned) || 0;
      const coverage = total > 0 ? checked / total : 0;
      const gscFallbackCoverage = total > 0 ? gscPositioned / total : 0;
      const latestValue = row.latest_checked_at;
      const latest = latestValue ? new Date(latestValue) : null;
      const ageHours = latest ? Math.round((Date.now() - latest.getTime()) / 36_000) / 100 : null;
      return {
        ...row,
        engine,
        source: checked > 0 ? "rank_tracking" : "no_rank_tracking_run",
        latest_checked_at: latestValue,
        gsc_fallback_coverage_pct: Math.round(gscFallbackCoverage * 100),
        latest_gsc_fallback_at: row.latest_gsc_position_at,
        cycle_days: cycleDays,
        coverage_pct: Math.round(coverage * 100),
        age_hours: ageHours,
        level: levelFromCoverage(coverage, ageHours, cycleDays),
      };
    });

    const totalKeywords = sites.reduce((sum, site) => sum + site.total_keywords, 0);
    const checkedInCycle = sites.reduce((sum, site) => sum + site.checked_in_cycle, 0);
    const gscFallbackPositioned = sites.reduce((sum, site) => sum + site.gsc_positioned, 0);
    const coverage = totalKeywords > 0 ? checkedInCycle / totalKeywords : 0;
    const latestTimes = sites
      .map((site) => (site.latest_checked_at ? new Date(site.latest_checked_at).getTime() : 0))
      .filter((time) => time > 0);
    const latestCheckedAt = latestTimes.length > 0 ? new Date(Math.max(...latestTimes)).toISOString() : null;
    const summaryAgeHours = latestCheckedAt ? Math.round((Date.now() - new Date(latestCheckedAt).getTime()) / 36_000) / 100 : null;

    return NextResponse.json({
      success: true,
      engine,
      cycle_days: cycleDays,
      limit_per_site: TRACKED_PER_SITE_LIMIT,
      summary: {
        total_sites: sites.length,
        total_keywords: totalKeywords,
        checked_in_cycle: checkedInCycle,
        coverage_pct: Math.round(coverage * 100),
        gsc_fallback_positioned: gscFallbackPositioned,
        gsc_fallback_coverage_pct: totalKeywords > 0 ? Math.round((gscFallbackPositioned / totalKeywords) * 100) : 0,
        latest_checked_at: latestCheckedAt,
        age_hours: summaryAgeHours,
        level: levelFromCoverage(coverage, summaryAgeHours, cycleDays),
      },
      sites,
    });
  } catch (err) {
    logError("rank-tracker.status", err, { siteId, engine, cycleDays });
    return NextResponse.json(
      { success: false, error: "Unable to read rank tracker status" },
      { status: 500 }
    );
  }
}
