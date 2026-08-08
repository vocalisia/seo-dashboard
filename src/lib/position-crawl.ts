import { getSQL } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/data-sync";
import { getSearchConsoleClient } from "@/lib/google-auth";
import { ensureSyncStatusTable, saveSyncStatus } from "@/lib/sync-status";

const GSC_PAGE_SIZE = 25_000;
const UPSERT_BATCH_SIZE = 1_000;
const DEFAULT_CONCURRENCY = 2;

export interface RawGscPositionRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

export interface NormalizedGscPositionRow {
  date: string;
  query: string;
  country: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface CrawlSite {
  id: number;
  name: string;
  gsc_property: string | null;
}

export interface PositionCrawlSiteResult {
  site_id: number;
  site_name: string;
  status: "success" | "error" | "skipped";
  rows_synced: number;
  keywords_discovered: number;
  latest_data_date: string | null;
  error: string | null;
}

export interface PositionCrawlResult {
  run_id: number;
  status: "completed" | "partial" | "failed";
  requested_days: number;
  total_sites: number;
  completed_sites: number;
  successful_sites: number;
  failed_sites: number;
  skipped_sites: number;
  total_rows: number;
  total_keywords: number;
  sites: PositionCrawlSiteResult[];
}

export class PositionCrawlInProgressError extends Error {
  constructor(public readonly runId: number) {
    super("A position crawl is already running");
    this.name = "PositionCrawlInProgressError";
  }
}

let positionCrawlSchemaReady: Promise<void> | null = null;

export function chunkItems<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }
  return chunks;
}

export function normalizeGscPositionRows(rows: RawGscPositionRow[]): NormalizedGscPositionRow[] {
  return rows.flatMap((row) => {
    const query = String(row.keys?.[0] ?? "").trim();
    const country = String(row.keys?.[1] ?? "").trim().toUpperCase();
    const date = String(row.keys?.[2] ?? "").slice(0, 10);
    const position = Number(row.position ?? 0);
    if (!query || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(position) || position <= 0 || position > 200) {
      return [];
    }
    return [{
      date,
      query,
      country,
      clicks: Math.max(0, Math.round(Number(row.clicks ?? 0))),
      impressions: Math.max(0, Math.round(Number(row.impressions ?? 0))),
      ctr: Math.max(0, Number(row.ctr ?? 0)),
      position,
    }];
  });
}

export function crawlDateWindow(days: number, now = new Date()): { startDate: string; endDate: string } {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeDays + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function positionFreshness(latestDate: string | null, now = new Date()): "fresh" | "stale" | "empty" {
  if (!latestDate) return "empty";
  const timestamp = new Date(`${latestDate.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(timestamp)) return "empty";
  const ageDays = Math.floor((now.getTime() - timestamp) / 86_400_000);
  return ageDays <= 5 ? "fresh" : "stale";
}

export function ensurePositionCrawlSchema(): Promise<void> {
  positionCrawlSchemaReady ??= (async () => {
    const sql = getSQL();
    await sql`
      CREATE TABLE IF NOT EXISTS position_crawl_runs (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(16) NOT NULL DEFAULT 'running',
        requested_days INTEGER NOT NULL,
        total_sites INTEGER NOT NULL DEFAULT 0,
        completed_sites INTEGER NOT NULL DEFAULT 0,
        successful_sites INTEGER NOT NULL DEFAULT 0,
        failed_sites INTEGER NOT NULL DEFAULT 0,
        skipped_sites INTEGER NOT NULL DEFAULT 0,
        total_rows INTEGER NOT NULL DEFAULT 0,
        total_keywords INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        error TEXT
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS position_crawl_site_runs (
        run_id BIGINT NOT NULL REFERENCES position_crawl_runs(id) ON DELETE CASCADE,
        site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL DEFAULT 'queued',
        rows_synced INTEGER NOT NULL DEFAULT 0,
        keywords_discovered INTEGER NOT NULL DEFAULT 0,
        latest_data_date DATE,
        error TEXT,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        PRIMARY KEY (run_id, site_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_position_crawl_runs_started ON position_crawl_runs(started_at DESC)`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_position_crawl_single_running
      ON position_crawl_runs ((status))
      WHERE status = 'running'
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_position_crawl_site_latest ON position_crawl_site_runs(site_id, finished_at DESC)`;
  })().catch((error) => {
    positionCrawlSchemaReady = null;
    throw error;
  });
  return positionCrawlSchemaReady;
}

async function fetchAllPositionRows(
  searchConsole: ReturnType<typeof getSearchConsoleClient>,
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<NormalizedGscPositionRow[]> {
  const collected: NormalizedGscPositionRow[] = [];
  for (let startRow = 0; startRow < 2_000_000; startRow += GSC_PAGE_SIZE) {
    const response = await searchConsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["query", "country", "date"],
        dataState: "final",
        rowLimit: GSC_PAGE_SIZE,
        startRow,
      },
    });
    const rawRows = (response.data.rows ?? []) as RawGscPositionRow[];
    collected.push(...normalizeGscPositionRows(rawRows));
    if (rawRows.length < GSC_PAGE_SIZE) break;
  }
  return collected;
}

async function upsertPositionRows(siteId: number, rows: NormalizedGscPositionRow[]): Promise<void> {
  const sql = getSQL();
  for (const batch of chunkItems(rows, UPSERT_BATCH_SIZE)) {
    const payload = JSON.stringify(batch);
    await sql`
      INSERT INTO search_console_query_data
        (site_id, date, query, country, device, clicks, impressions, ctr, position)
      SELECT
        ${siteId}, x.date::date, x.query, x.country, '', x.clicks,
        x.impressions, x.ctr, x.position
      FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        date text,
        query text,
        country text,
        clicks integer,
        impressions integer,
        ctr real,
        position real
      )
      ON CONFLICT (site_id, date, query, country, device)
      DO UPDATE SET
        clicks = EXCLUDED.clicks,
        impressions = EXCLUDED.impressions,
        ctr = EXCLUDED.ctr,
        position = EXCLUDED.position,
        synced_at = NOW()
    `;
  }
}

async function reconcileTrackedKeywords(siteId: number): Promise<void> {
  const sql = getSQL();
  await sql`
    WITH anchor AS (
      SELECT MAX(date) AS latest_date
      FROM search_console_query_data
      WHERE site_id = ${siteId}
        AND position BETWEEN 1 AND 200
        AND BTRIM(query) <> ''
    ),
    live AS (
      SELECT
        LOWER(BTRIM(q.query)) AS keyword_key,
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

async function crawlSite(
  site: CrawlSite,
  days: number,
  searchConsole: ReturnType<typeof getSearchConsoleClient>,
): Promise<PositionCrawlSiteResult> {
  if (!site.gsc_property) {
    return {
      site_id: site.id,
      site_name: site.name,
      status: "skipped",
      rows_synced: 0,
      keywords_discovered: 0,
      latest_data_date: null,
      error: "Propriété GSC non configurée",
    };
  }

  const { startDate, endDate } = crawlDateWindow(days);
  const rows = await fetchAllPositionRows(searchConsole, site.gsc_property, startDate, endDate);
  await upsertPositionRows(site.id, rows);
  await reconcileTrackedKeywords(site.id);

  const latestDataDate = rows.reduce<string | null>((latest, row) => {
    return latest == null || row.date > latest ? row.date : latest;
  }, null);
  const keywordsDiscovered = new Set(rows.map((row) => row.query.trim().toLowerCase())).size;
  return {
    site_id: site.id,
    site_name: site.name,
    status: "success",
    rows_synced: rows.length,
    keywords_discovered: keywordsDiscovered,
    latest_data_date: latestDataDate,
    error: null,
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Erreur inconnue";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

export async function runPositionCrawl(input: {
  days: number;
  siteId?: number | null;
  concurrency?: number;
}): Promise<PositionCrawlResult> {
  await ensurePositionCrawlSchema();
  await ensureSyncStatusTable();
  const sql = getSQL();
  const days = Math.max(1, Math.min(90, Math.floor(input.days)));
  const siteId = input.siteId ?? null;
  const concurrency = Math.max(1, Math.min(3, Math.floor(input.concurrency ?? DEFAULT_CONCURRENCY)));

  await sql`
    UPDATE position_crawl_runs
    SET status = 'failed', finished_at = NOW(), error = 'Interrompu avant la fin'
    WHERE status = 'running' AND started_at < NOW() - INTERVAL '20 minutes'
  `;
  const active = (await sql`
    SELECT id FROM position_crawl_runs
    WHERE status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `) as Array<{ id: number }>;
  if (active[0]) throw new PositionCrawlInProgressError(Number(active[0].id));

  const sites = (await sql`
    SELECT id, name, gsc_property
    FROM sites
    WHERE is_active = TRUE
      AND (${siteId}::int IS NULL OR id = ${siteId})
    ORDER BY name
  `) as CrawlSite[];

  let runId: number;
  try {
    const insertedRuns = (await sql`
      INSERT INTO position_crawl_runs (status, requested_days, total_sites)
      VALUES ('running', ${days}, ${sites.length})
      RETURNING id
    `) as Array<{ id: number }>;
    runId = Number(insertedRuns[0].id);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      const concurrent = (await sql`
        SELECT id FROM position_crawl_runs
        WHERE status = 'running'
        ORDER BY started_at DESC
        LIMIT 1
      `) as Array<{ id: number }>;
      throw new PositionCrawlInProgressError(Number(concurrent[0]?.id ?? 0));
    }
    throw error;
  }

  for (const site of sites) {
    await sql`
      INSERT INTO position_crawl_site_runs (run_id, site_id, status)
      VALUES (${runId}, ${site.id}, 'queued')
    `;
  }

  let results: PositionCrawlSiteResult[];
  try {
    const searchConsole = getSearchConsoleClient();
    results = await mapWithConcurrency(sites, concurrency, async (site) => {
    const startedAt = new Date();
    await sql`
      UPDATE position_crawl_site_runs
      SET status = 'running', started_at = NOW(), error = NULL
      WHERE run_id = ${runId} AND site_id = ${site.id}
    `;
    let result: PositionCrawlSiteResult;
    try {
      result = await crawlSite(site, days, searchConsole);
      await saveSyncStatus({
        siteId: site.id,
        source: "gsc",
        status: result.status === "skipped" ? "skipped" : "success",
        rowsSynced: result.rows_synced,
        latestDataDate: result.latest_data_date,
        error: result.error,
        startedAt,
      });
    } catch (error) {
      const message = safeError(error);
      result = {
        site_id: site.id,
        site_name: site.name,
        status: "error",
        rows_synced: 0,
        keywords_discovered: 0,
        latest_data_date: null,
        error: message,
      };
      await saveSyncStatus({
        siteId: site.id,
        source: "gsc",
        status: "error",
        rowsSynced: 0,
        latestDataDate: null,
        error: message,
        startedAt,
      }).catch(() => undefined);
    }

    await sql`
      UPDATE position_crawl_site_runs
      SET status = ${result.status},
          rows_synced = ${result.rows_synced},
          keywords_discovered = ${result.keywords_discovered},
          latest_data_date = ${result.latest_data_date},
          error = ${result.error},
          finished_at = NOW()
      WHERE run_id = ${runId} AND site_id = ${site.id}
    `;
    await sql`
      UPDATE position_crawl_runs
      SET completed_sites = completed_sites + 1,
          successful_sites = successful_sites + ${result.status === "success" ? 1 : 0},
          failed_sites = failed_sites + ${result.status === "error" ? 1 : 0},
          skipped_sites = skipped_sites + ${result.status === "skipped" ? 1 : 0},
          total_rows = total_rows + ${result.rows_synced},
          total_keywords = total_keywords + ${result.keywords_discovered}
      WHERE id = ${runId}
    `;
    return result;
    });
  } catch (error) {
    await sql`
      UPDATE position_crawl_runs
      SET status = 'failed', finished_at = NOW(), error = ${safeError(error)}
      WHERE id = ${runId} AND status = 'running'
    `.catch(() => undefined);
    throw error;
  }

  const successfulSites = results.filter((result) => result.status === "success").length;
  const failedSites = results.filter((result) => result.status === "error").length;
  const skippedSites = results.filter((result) => result.status === "skipped").length;
  const status = failedSites === 0 ? "completed" : successfulSites > 0 ? "partial" : "failed";
  await sql`
    UPDATE position_crawl_runs
    SET status = ${status}, finished_at = NOW()
    WHERE id = ${runId}
  `;

  return {
    run_id: runId,
    status,
    requested_days: days,
    total_sites: sites.length,
    completed_sites: results.length,
    successful_sites: successfulSites,
    failed_sites: failedSites,
    skipped_sites: skippedSites,
    total_rows: results.reduce((sum, result) => sum + result.rows_synced, 0),
    total_keywords: results.reduce((sum, result) => sum + result.keywords_discovered, 0),
    sites: results,
  };
}
