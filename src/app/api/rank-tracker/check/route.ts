// Daily rank tracking via Brave Search API.
// Loops top 30 tracked_keywords per active site, calls Brave, stores our position
// plus full top-10 SERP snapshot. Idempotent on (site_id, keyword, search_engine, checked_at::date).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";
import {
  braveSearch,
  findDomainPosition,
  siteRootDomain,
  isBraveConfigured,
} from "@/lib/brave-search";
import { logError, logger } from "@/lib/logger";

interface SiteRow {
  id: number;
  name: string;
  url: string;
  gsc_property: string | null;
  market: string | null;
}

interface KwRow {
  id: number;
  keyword: string;
}

async function ensureRankTable(sql: ReturnType<typeof getSQL>): Promise<void> {
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
  await sql`CREATE INDEX IF NOT EXISTS idx_rank_tracking_site_kw ON rank_tracking(site_id, keyword, checked_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rank_tracking_engine ON rank_tracking(search_engine, checked_at DESC)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_tracking_dedupe
      ON rank_tracking(site_id, LOWER(keyword), search_engine, (checked_at::date))
  `;
}

function pickCountry(market: string | null, gscProperty: string | null): string {
  const m = (market || "").trim().toUpperCase();
  if (m && m.length === 2) return m;
  // Heuristic from GSC property TLD
  const dom = (gscProperty || "").toLowerCase();
  if (dom.endsWith(".ch")) return "CH";
  if (dom.endsWith(".be")) return "BE";
  if (dom.endsWith(".ca")) return "CA";
  if (dom.endsWith(".uk")) return "GB";
  if (dom.endsWith(".de")) return "DE";
  if (dom.endsWith(".es")) return "ES";
  if (dom.endsWith(".it")) return "IT";
  return "FR";
}

export async function POST(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  if (!isBraveConfigured()) {
    return NextResponse.json(
      {
        success: false,
        skipped: true,
        reason: "BRAVE_SEARCH_API_KEY missing — set it in Vercel env, then re-run.",
      },
      { status: 200 }
    );
  }

  const sql = getSQL();
  await ensureRankTable(sql);

  const sites = (await sql`
    SELECT id, name, url, gsc_property,
      (SELECT market FROM tracked_keywords WHERE site_id = sites.id AND market IS NOT NULL LIMIT 1) AS market
    FROM sites
    WHERE is_active = true
    ORDER BY id ASC
  `) as SiteRow[];

  const summary: Array<{
    site_id: number;
    site_name: string;
    checked: number;
    ranked: number;
    errors: number;
  }> = [];

  let totalChecks = 0;
  let totalErrors = 0;

  for (const site of sites) {
    const targetDomain = siteRootDomain(site.gsc_property || site.url);
    if (!targetDomain) continue;

    const kws = (await sql`
      SELECT id, keyword FROM tracked_keywords
      WHERE site_id = ${site.id} AND is_active = true
      ORDER BY COALESCE(volume_market, volume_fr, 0) DESC, id ASC
      LIMIT 30
    `) as KwRow[];

    let ranked = 0;
    let errors = 0;
    const country = pickCountry(site.market, site.gsc_property);

    for (const kw of kws) {
      try {
        const results = await braveSearch(kw.keyword, country, 10);
        const ourPos = findDomainPosition(results, targetDomain);
        const top10 = results.slice(0, 10).map((r) => ({
          position: r.position,
          url: r.url,
          title: r.title,
          domain: r.domain,
        }));
        await sql`
          INSERT INTO rank_tracking (site_id, keyword, our_position, top_10_results, search_engine)
          VALUES (${site.id}, ${kw.keyword}, ${ourPos}, ${JSON.stringify(top10)}::jsonb, 'brave')
          ON CONFLICT (site_id, LOWER(keyword), search_engine, (checked_at::date))
          DO UPDATE SET our_position = EXCLUDED.our_position, top_10_results = EXCLUDED.top_10_results
        `;
        if (ourPos != null) ranked += 1;
        totalChecks += 1;
        // Brave free tier ~1 req/sec; small sleep to stay safe
        await new Promise((r) => setTimeout(r, 1100));
      } catch (err) {
        errors += 1;
        totalErrors += 1;
        logError("rank-tracker.check.keyword", err, { site_id: site.id, keyword: kw.keyword });
      }
    }

    summary.push({
      site_id: site.id,
      site_name: site.name,
      checked: kws.length,
      ranked,
      errors,
    });
  }

  logger.info(
    { ctx: "rank-tracker.check", totalChecks, totalErrors, sites: sites.length },
    "rank tracker run finished"
  );

  return NextResponse.json({
    success: true,
    engine: "brave",
    sites: sites.length,
    total_checks: totalChecks,
    total_errors: totalErrors,
    summary,
  });
}

// Vercel cron sends GET — alias to POST so /api/cron/rank-tracker-daily can fire it.
export const GET = POST;
