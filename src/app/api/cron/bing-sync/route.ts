// Daily Bing Webmaster Tools sync — 05:00 UTC.
// Loops is_active sites that have a `bing_wmt_property` set and stores per-query
// daily stats into bing_search_data (schema mirrors search_console_data).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";
import { getBingStats, isBingWmtConfigured } from "@/lib/bing-wmt";
import { logError, logger } from "@/lib/logger";
import { runOutcome } from "@/lib/run-outcome";

interface SiteRow {
  id: number;
  name: string;
  bing_wmt_property: string | null;
}

async function ensureBingSchema(sql: ReturnType<typeof getSQL>): Promise<void> {
  // Add bing_wmt_property column to sites (idempotent)
  await sql`ALTER TABLE sites ADD COLUMN IF NOT EXISTS bing_wmt_property VARCHAR(500)`;

  await sql`
    CREATE TABLE IF NOT EXISTS bing_search_data (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      date DATE NOT NULL,
      query VARCHAR(500),
      clicks INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      ctr DECIMAL(5,4),
      position DECIMAL(6,2),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_bing_site_date ON bing_search_data(site_id, date)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bing_dedupe
      ON bing_search_data(site_id, date, LOWER(COALESCE(query, '')))
  `;
}

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const sql = getSQL();
  await ensureBingSchema(sql);

  if (!isBingWmtConfigured()) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "BING_WMT_API_KEY missing — set it in Vercel env, then re-run.",
    });
  }

  const sites = (await sql`
    SELECT id, name, bing_wmt_property
    FROM sites
    WHERE is_active = true AND bing_wmt_property IS NOT NULL AND bing_wmt_property <> ''
    ORDER BY id ASC
  `) as SiteRow[];

  const summary: Array<{ site_id: number; site_name: string; rows: number; error?: string }> = [];
  let totalRows = 0;

  for (const site of sites) {
    try {
      const stats = await getBingStats(site.bing_wmt_property!, undefined, 30);
      for (const s of stats) {
        await sql`
          INSERT INTO bing_search_data (site_id, date, query, clicks, impressions, ctr, position)
          VALUES (${site.id}, ${s.date}::date, ${s.query}, ${s.clicks}, ${s.impressions}, ${s.ctr}, ${s.position})
          ON CONFLICT (site_id, date, LOWER(COALESCE(query, '')))
          DO UPDATE SET
            clicks = EXCLUDED.clicks,
            impressions = EXCLUDED.impressions,
            ctr = EXCLUDED.ctr,
            position = EXCLUDED.position
        `;
        totalRows += 1;
      }
      summary.push({ site_id: site.id, site_name: site.name, rows: stats.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      logError("cron.bing-sync.site", err, { site_id: site.id });
      summary.push({ site_id: site.id, site_name: site.name, rows: 0, error: msg });
    }
  }

  logger.info(
    { ctx: "cron.bing-sync", sites: sites.length, totalRows },
    "bing sync finished"
  );

  const failed = summary.filter((result) => Boolean(result.error)).length;
  const outcome = runOutcome(sites.length - failed, failed, sites.length);
  return NextResponse.json({
    success: outcome.success,
    partial: outcome.partial,
    skipped: outcome.skipped,
    engine: "bing",
    sites: sites.length,
    total_rows: totalRows,
    failed,
    summary,
  }, { status: outcome.statusCode });
}

export const POST = GET;
