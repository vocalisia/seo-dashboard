export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { ensureSchemaOnce, getSQL } from "@/lib/db";
import { logError } from "@/lib/logger";
import {
  ensurePositionCrawlSchema,
  PositionCrawlInProgressError,
  positionFreshness,
  runPositionCrawl,
} from "@/lib/position-crawl";

const FILTERS = new Set(["all", "top10", "opportunities", "gains", "losses", "unobserved"]);
const SORTS = new Set(["impressions", "position", "change", "keyword"]);

interface PortfolioRow {
  id: number;
  name: string;
  url: string;
  gsc_configured: boolean;
  latest_data_date: string | null;
  keyword_count: number;
  tracked_keywords: number;
  tracked_with_gsc: number;
  avg_position: number | null;
  top_3: number;
  top_10: number;
  top_20: number;
  clicks: number;
  impressions: number;
  last_crawl_status: string | null;
  last_crawl_at: string | null;
  last_crawl_rows: number;
  last_crawl_error: string | null;
}

function numberParam(value: string | null, fallback: number, min: number, max: number): number | null {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readLatestRun() {
  const sql = getSQL();
  const runs = await sql`
    SELECT id, status, requested_days, total_sites, completed_sites,
      successful_sites, failed_sites, skipped_sites, total_rows, total_keywords,
      started_at::text, finished_at::text, error
    FROM position_crawl_runs
    ORDER BY started_at DESC
    LIMIT 1
  `;
  const run = runs[0] ?? null;
  if (!run) return null;
  const sites = await sql`
    SELECT ps.site_id, s.name AS site_name, ps.status, ps.rows_synced,
      ps.keywords_discovered, ps.latest_data_date::text, ps.error,
      ps.started_at::text, ps.finished_at::text
    FROM position_crawl_site_runs ps
    JOIN sites s ON s.id = ps.site_id
    WHERE ps.run_id = ${run.id}
    ORDER BY s.name
  `;
  const startedAt = new Date(String(run.started_at)).getTime();
  const staleRunning = run.status === "running"
    && Number.isFinite(startedAt)
    && Date.now() - startedAt > 20 * 60_000;
  return {
    ...run,
    id: Number(run.id),
    total_sites: asNumber(run.total_sites),
    completed_sites: asNumber(run.completed_sites),
    successful_sites: asNumber(run.successful_sites),
    failed_sites: asNumber(run.failed_sites),
    skipped_sites: asNumber(run.skipped_sites),
    total_rows: asNumber(run.total_rows),
    total_keywords: asNumber(run.total_keywords),
    status: staleRunning ? "failed" : String(run.status),
    error: staleRunning ? "Le processus précédent a été interrompu." : run.error,
    sites: sites.map((site) => ({
      ...site,
      site_id: Number(site.site_id),
      rows_synced: asNumber(site.rows_synced),
      keywords_discovered: asNumber(site.keywords_discovered),
    })),
  };
}

async function readPortfolio(days: number): Promise<PortfolioRow[]> {
  const sql = getSQL();
  const rows = await sql`
    WITH anchors AS (
      SELECT site_id, MAX(date) AS latest_data_date
      FROM search_console_query_data
      WHERE position BETWEEN 1 AND 200 AND BTRIM(query) <> ''
      GROUP BY site_id
    ),
    live_keywords AS (
      SELECT q.site_id, LOWER(BTRIM(q.query)) AS keyword_key,
        SUM(q.clicks)::int AS clicks,
        SUM(q.impressions)::int AS impressions,
        SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS avg_position
      FROM search_console_query_data q
      JOIN anchors a ON a.site_id = q.site_id
      WHERE q.date >= (a.latest_data_date - INTERVAL '1 day' * (${days} - 1))::date
        AND q.date <= a.latest_data_date
        AND q.position BETWEEN 1 AND 200
        AND BTRIM(q.query) <> ''
      GROUP BY q.site_id, LOWER(BTRIM(q.query))
    ),
    live AS (
      SELECT site_id, COUNT(*)::int AS keyword_count,
        SUM(clicks)::int AS clicks,
        SUM(impressions)::int AS impressions,
        SUM(impressions * avg_position)::float / NULLIF(SUM(impressions), 0) AS avg_position,
        COUNT(*) FILTER (WHERE avg_position <= 3)::int AS top_3,
        COUNT(*) FILTER (WHERE avg_position <= 10)::int AS top_10,
        COUNT(*) FILTER (WHERE avg_position <= 20)::int AS top_20
      FROM live_keywords
      GROUP BY site_id
    ),
    tracked AS (
      SELECT site_id, COUNT(*) FILTER (WHERE is_active = TRUE)::int AS tracked_keywords
      FROM tracked_keywords
      GROUP BY site_id
    ),
    matched AS (
      SELECT tk.site_id, COUNT(*)::int AS tracked_with_gsc
      FROM tracked_keywords tk
      JOIN live_keywords lk
        ON lk.site_id = tk.site_id AND lk.keyword_key = LOWER(BTRIM(tk.keyword))
      WHERE tk.is_active = TRUE
      GROUP BY tk.site_id
    ),
    last_crawl AS (
      SELECT DISTINCT ON (ps.site_id)
        ps.site_id, ps.status, ps.rows_synced, ps.error,
        COALESCE(ps.finished_at, ps.started_at) AS crawl_at
      FROM position_crawl_site_runs ps
      ORDER BY ps.site_id, ps.run_id DESC
    )
    SELECT s.id, s.name, s.url,
      (s.gsc_property IS NOT NULL)::boolean AS gsc_configured,
      a.latest_data_date::text,
      COALESCE(l.keyword_count, 0)::int AS keyword_count,
      COALESCE(t.tracked_keywords, 0)::int AS tracked_keywords,
      COALESCE(m.tracked_with_gsc, 0)::int AS tracked_with_gsc,
      l.avg_position,
      COALESCE(l.top_3, 0)::int AS top_3,
      COALESCE(l.top_10, 0)::int AS top_10,
      COALESCE(l.top_20, 0)::int AS top_20,
      COALESCE(l.clicks, 0)::int AS clicks,
      COALESCE(l.impressions, 0)::int AS impressions,
      lc.status AS last_crawl_status,
      lc.crawl_at::text AS last_crawl_at,
      COALESCE(lc.rows_synced, 0)::int AS last_crawl_rows,
      lc.error AS last_crawl_error
    FROM sites s
    LEFT JOIN anchors a ON a.site_id = s.id
    LEFT JOIN live l ON l.site_id = s.id
    LEFT JOIN tracked t ON t.site_id = s.id
    LEFT JOIN matched m ON m.site_id = s.id
    LEFT JOIN last_crawl lc ON lc.site_id = s.id
    WHERE s.is_active = TRUE
    ORDER BY s.name
  `;

  return rows.map((row) => ({
    id: asNumber(row.id),
    name: String(row.name),
    url: String(row.url),
    gsc_configured: Boolean(row.gsc_configured),
    latest_data_date: row.latest_data_date ? String(row.latest_data_date).slice(0, 10) : null,
    keyword_count: asNumber(row.keyword_count),
    tracked_keywords: asNumber(row.tracked_keywords),
    tracked_with_gsc: asNumber(row.tracked_with_gsc),
    avg_position: asNullableNumber(row.avg_position),
    top_3: asNumber(row.top_3),
    top_10: asNumber(row.top_10),
    top_20: asNumber(row.top_20),
    clicks: asNumber(row.clicks),
    impressions: asNumber(row.impressions),
    last_crawl_status: row.last_crawl_status ? String(row.last_crawl_status) : null,
    last_crawl_at: row.last_crawl_at ? String(row.last_crawl_at) : null,
    last_crawl_rows: asNumber(row.last_crawl_rows),
    last_crawl_error: row.last_crawl_error ? String(row.last_crawl_error) : null,
  }));
}

async function readKeywords(input: {
  siteId: number;
  days: number;
  page: number;
  limit: number;
  search: string;
  filter: string;
  sort: string;
  direction: "asc" | "desc";
}) {
  const sql = getSQL();
  const offset = (input.page - 1) * input.limit;
  const searchPattern = `%${input.search}%`;
  const rows = await sql`
    WITH anchor AS (
      SELECT MAX(date) AS end_date
      FROM search_console_query_data
      WHERE site_id = ${input.siteId}
        AND position BETWEEN 1 AND 200
        AND BTRIM(query) <> ''
    ),
    current_period AS (
      SELECT LOWER(BTRIM(q.query)) AS keyword_key, MIN(q.query) AS keyword,
        SUM(q.clicks)::int AS clicks,
        SUM(q.impressions)::int AS impressions,
        SUM(q.clicks)::float / NULLIF(SUM(q.impressions), 0) AS ctr,
        SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS current_position,
        COUNT(DISTINCT q.country)::int AS country_count,
        MIN(q.date)::text AS first_seen,
        MAX(q.date)::text AS last_seen
      FROM search_console_query_data q
      CROSS JOIN anchor a
      WHERE q.site_id = ${input.siteId}
        AND q.date >= (a.end_date - INTERVAL '1 day' * (${input.days} - 1))::date
        AND q.date <= a.end_date
        AND q.position BETWEEN 1 AND 200
        AND BTRIM(q.query) <> ''
      GROUP BY LOWER(BTRIM(q.query))
    ),
    previous_period AS (
      SELECT LOWER(BTRIM(q.query)) AS keyword_key,
        SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS previous_position
      FROM search_console_query_data q
      CROSS JOIN anchor a
      WHERE q.site_id = ${input.siteId}
        AND q.date >= (a.end_date - INTERVAL '1 day' * (${input.days} * 2 - 1))::date
        AND q.date <= (a.end_date - INTERVAL '1 day' * ${input.days})::date
        AND q.position BETWEEN 1 AND 200
        AND BTRIM(q.query) <> ''
      GROUP BY LOWER(BTRIM(q.query))
    ),
    keyword_rows AS (
      SELECT c.keyword, c.current_position, p.previous_position,
        CASE WHEN p.previous_position IS NULL THEN NULL
             ELSE p.previous_position - c.current_position END AS position_change,
        c.clicks, c.impressions, c.ctr, c.country_count, c.first_seen, c.last_seen,
        tk.target_url, tk.market, tk.volume_market, tk.volume_fr, tk.volume_ch, tk.volume_source,
        'gsc'::text AS row_source
      FROM current_period c
      LEFT JOIN previous_period p ON p.keyword_key = c.keyword_key
      LEFT JOIN tracked_keywords tk
        ON tk.site_id = ${input.siteId}
       AND tk.is_active = TRUE
       AND LOWER(BTRIM(tk.keyword)) = c.keyword_key

      UNION ALL

      SELECT tk.keyword, NULL::float8, NULL::float8, NULL::float8,
        0::int, 0::int, NULL::float8, 0::int, NULL::text, NULL::text,
        tk.target_url, tk.market, tk.volume_market, tk.volume_fr, tk.volume_ch, tk.volume_source,
        'tracked_only'::text
      FROM tracked_keywords tk
      WHERE tk.site_id = ${input.siteId}
        AND tk.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM current_period c
          WHERE c.keyword_key = LOWER(BTRIM(tk.keyword))
        )
    ),
    filtered AS (
      SELECT * FROM keyword_rows
      WHERE (${input.search} = '' OR keyword ILIKE ${searchPattern})
        AND (
          ${input.filter} = 'all'
          OR (${input.filter} = 'top10' AND current_position <= 10)
          OR (${input.filter} = 'opportunities' AND current_position > 3 AND current_position <= 20)
          OR (${input.filter} = 'gains' AND position_change >= 1)
          OR (${input.filter} = 'losses' AND position_change <= -1)
          OR (${input.filter} = 'unobserved' AND row_source = 'tracked_only')
        )
    )
    SELECT *, COUNT(*) OVER()::int AS total_rows
    FROM filtered
    ORDER BY
      CASE WHEN ${input.sort} = 'impressions' AND ${input.direction} = 'desc' THEN impressions END DESC NULLS LAST,
      CASE WHEN ${input.sort} = 'impressions' AND ${input.direction} = 'asc' THEN impressions END ASC NULLS LAST,
      CASE WHEN ${input.sort} = 'position' AND ${input.direction} = 'asc' THEN current_position END ASC NULLS LAST,
      CASE WHEN ${input.sort} = 'position' AND ${input.direction} = 'desc' THEN current_position END DESC NULLS LAST,
      CASE WHEN ${input.sort} = 'change' AND ${input.direction} = 'desc' THEN position_change END DESC NULLS LAST,
      CASE WHEN ${input.sort} = 'change' AND ${input.direction} = 'asc' THEN position_change END ASC NULLS LAST,
      CASE WHEN ${input.sort} = 'keyword' AND ${input.direction} = 'asc' THEN keyword END ASC,
      CASE WHEN ${input.sort} = 'keyword' AND ${input.direction} = 'desc' THEN keyword END DESC,
      impressions DESC, current_position ASC NULLS LAST, keyword ASC
    LIMIT ${input.limit} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? asNumber(rows[0].total_rows) : 0;
  return {
    page: input.page,
    limit: input.limit,
    total,
    pages: total === 0 ? 0 : Math.ceil(total / input.limit),
    rows: rows.map((row) => ({
      keyword: String(row.keyword),
      current_position: asNullableNumber(row.current_position),
      previous_position: asNullableNumber(row.previous_position),
      position_change: asNullableNumber(row.position_change),
      clicks: asNumber(row.clicks),
      impressions: asNumber(row.impressions),
      ctr: asNullableNumber(row.ctr),
      country_count: asNumber(row.country_count),
      first_seen: row.first_seen ? String(row.first_seen).slice(0, 10) : null,
      last_seen: row.last_seen ? String(row.last_seen).slice(0, 10) : null,
      target_url: row.target_url ? String(row.target_url) : null,
      market: row.market ? String(row.market) : null,
      volume_market: asNullableNumber(row.volume_market),
      volume_fr: asNullableNumber(row.volume_fr),
      volume_ch: asNullableNumber(row.volume_ch),
      volume_source: row.volume_source ? String(row.volume_source) : null,
      row_source: String(row.row_source),
    })),
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const days = numberParam(request.nextUrl.searchParams.get("days"), 30, 7, 90);
  const page = numberParam(request.nextUrl.searchParams.get("page"), 1, 1, 10_000);
  const limit = numberParam(request.nextUrl.searchParams.get("limit"), 100, 20, 200);
  const siteIdRaw = request.nextUrl.searchParams.get("site_id");
  const siteId = siteIdRaw && siteIdRaw !== "all" ? Number(siteIdRaw) : null;
  const search = (request.nextUrl.searchParams.get("search") ?? "").trim().slice(0, 120);
  const filterRaw = request.nextUrl.searchParams.get("filter") ?? "all";
  const sortRaw = request.nextUrl.searchParams.get("sort") ?? "impressions";
  const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc";

  if (days == null || page == null || limit == null) {
    return NextResponse.json({ success: false, error: "Paramètres de pagination invalides" }, { status: 400 });
  }
  if (siteId !== null && (!Number.isInteger(siteId) || siteId <= 0)) {
    return NextResponse.json({ success: false, error: "site_id invalide" }, { status: 400 });
  }
  if (!FILTERS.has(filterRaw) || !SORTS.has(sortRaw)) {
    return NextResponse.json({ success: false, error: "Filtre ou tri invalide" }, { status: 400 });
  }

  try {
    await Promise.all([ensureSchemaOnce(), ensurePositionCrawlSchema()]);
    const [sites, latestRun] = await Promise.all([readPortfolio(days), readLatestRun()]);
    const selectedSite = siteId == null ? null : sites.find((site) => site.id === siteId) ?? null;
    if (siteId != null && !selectedSite) {
      return NextResponse.json({ success: false, error: "Site introuvable" }, { status: 404 });
    }
    const keywords = siteId == null ? null : await readKeywords({
      siteId,
      days,
      page,
      limit,
      search,
      filter: filterRaw,
      sort: sortRaw,
      direction,
    });

    const totalImpressions = sites.reduce((sum, site) => sum + site.impressions, 0);
    const weightedPosition = totalImpressions > 0
      ? sites.reduce((sum, site) => sum + (site.avg_position ?? 0) * site.impressions, 0) / totalImpressions
      : null;
    const normalizedSites = sites.map((site) => ({
      ...site,
      data_status: !site.gsc_configured
        ? "not_configured"
        : site.last_crawl_status === "running" || site.last_crawl_status === "queued"
          ? "syncing"
          : site.last_crawl_status === "error" && site.latest_data_date == null
            ? "error"
            : positionFreshness(site.latest_data_date),
    }));

    return NextResponse.json({
      success: true,
      source: "google_search_console_query_level",
      ranking_notice: "GSC — position moyenne pondérée par impressions, arrêtée à la dernière date importée de chaque domaine. Ce n’est pas un relevé SERP instantané.",
      generated_at: new Date().toISOString(),
      days,
      summary: {
        total_sites: sites.length,
        gsc_configured_sites: sites.filter((site) => site.gsc_configured).length,
        positioned_sites: sites.filter((site) => site.keyword_count > 0).length,
        fresh_sites: normalizedSites.filter((site) => site.data_status === "fresh").length,
        total_keywords: sites.reduce((sum, site) => sum + site.keyword_count, 0),
        tracked_keywords: sites.reduce((sum, site) => sum + site.tracked_keywords, 0),
        tracked_with_gsc: sites.reduce((sum, site) => sum + site.tracked_with_gsc, 0),
        top_10: sites.reduce((sum, site) => sum + site.top_10, 0),
        clicks: sites.reduce((sum, site) => sum + site.clicks, 0),
        impressions: totalImpressions,
        avg_position: weightedPosition,
      },
      latest_run: latestRun,
      sites: normalizedSites,
      selected_site: selectedSite,
      keywords,
    });
  } catch (error) {
    logError("position-crawl.get", error, { siteId, days });
    return NextResponse.json({ success: false, error: "Impossible de lire les positions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const days = numberParam(request.nextUrl.searchParams.get("days"), 45, 7, 90);
  const concurrency = numberParam(request.nextUrl.searchParams.get("concurrency"), 2, 1, 3);
  const siteIdRaw = request.nextUrl.searchParams.get("site_id");
  const siteId = siteIdRaw && siteIdRaw !== "all" ? Number(siteIdRaw) : null;
  if (days == null || concurrency == null || (siteId != null && (!Number.isInteger(siteId) || siteId <= 0))) {
    return NextResponse.json({ success: false, error: "Paramètres de crawl invalides" }, { status: 400 });
  }

  try {
    await ensureSchemaOnce();
    const result = await runPositionCrawl({ days, concurrency, siteId });
    return NextResponse.json({
      success: result.status !== "failed",
      source: "google_search_console_query_level",
      ...result,
    }, { status: result.status === "failed" ? 502 : 200 });
  } catch (error) {
    if (error instanceof PositionCrawlInProgressError) {
      return NextResponse.json({
        success: false,
        already_running: true,
        run_id: error.runId,
        error: "Un crawl de positions est déjà en cours.",
      }, { status: 409 });
    }
    logError("position-crawl.post", error, { siteId, days });
    return NextResponse.json({ success: false, error: "Le crawl de positions a échoué" }, { status: 500 });
  }
}
