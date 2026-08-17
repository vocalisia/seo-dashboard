// Daily rank snapshots via Brave when configured, otherwise the transparent
// no-key public web engine. Stores the observed top 10 and rotates keywords.

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
import { runOutcome } from "@/lib/run-outcome";
import { publicWebRankSearch } from "@/lib/public-rank-search";
import { mapWithConcurrency } from "@/lib/data-sync";

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

  const url = new URL(request.url);
  const siteIdRaw = url.searchParams.get("siteId");
  const limitRaw = url.searchParams.get("limit");
  const siteId = siteIdRaw ? Number(siteIdRaw) : null;
  const limitPerSite = limitRaw ? Number(limitRaw) : 2;
  const engine = isBraveConfigured() ? "brave" : "public_web";

  if (siteIdRaw && (!Number.isInteger(siteId) || (siteId ?? 0) <= 0)) {
    return NextResponse.json({ success: false, error: "siteId must be a positive integer" }, { status: 400 });
  }
  if (!Number.isInteger(limitPerSite) || limitPerSite < 1 || limitPerSite > 5) {
    return NextResponse.json({ success: false, error: "limit must be an integer between 1 and 5" }, { status: 400 });
  }

  const requestedSiteId = siteId ?? null;
  const sql = getSQL();
  await ensureRankTable(sql);

  const sites = (await sql`
    SELECT id, name, url, gsc_property,
      (SELECT market FROM tracked_keywords WHERE site_id = sites.id AND market IS NOT NULL LIMIT 1) AS market
    FROM sites
    WHERE is_active = true
      AND (${requestedSiteId} IS NULL OR id = ${requestedSiteId})
    ORDER BY id ASC
  `) as SiteRow[];

  type SiteSummary = {
    site_id: number;
    site_name: string;
    checked: number;
    ranked: number;
    errors: number;
  };

  const processSite = async (site: SiteRow): Promise<SiteSummary> => {
    const targetDomain = siteRootDomain(site.gsc_property || site.url);
    if (!targetDomain) {
      return {
        site_id: site.id,
        site_name: site.name,
        checked: 0,
        ranked: 0,
        errors: 1,
      };
    }

    const kws = (await sql`
      SELECT tk.id, tk.keyword
      FROM tracked_keywords tk
      LEFT JOIN LATERAL (
        SELECT MAX(rt.checked_at) AS checked_at
        FROM rank_tracking rt
        WHERE rt.site_id = tk.site_id
          AND LOWER(rt.keyword) = LOWER(tk.keyword)
          AND rt.search_engine = ${engine}
      ) latest ON TRUE
      WHERE tk.site_id = ${site.id} AND tk.is_active = true
      ORDER BY
        CASE WHEN tk.volume_source LIKE 'google_kp_real_%' THEN 0 ELSE 1 END,
        latest.checked_at ASC NULLS FIRST,
        COALESCE(tk.volume_market, tk.volume_ch, tk.volume_fr, 0) DESC,
        tk.id ASC
      LIMIT ${limitPerSite}
    `) as KwRow[];

    let ranked = 0;
    let errors = 0;
    let checked = 0;
    const country = pickCountry(site.market, site.gsc_property);

    for (const kw of kws) {
      try {
        const results = engine === "brave"
          ? await braveSearch(kw.keyword, country, 10)
          : await publicWebRankSearch(kw.keyword, country);
        const ourPos = findDomainPosition(results, targetDomain);
        const top10 = results.slice(0, 10).map((r) => ({
          position: r.position,
          url: r.url,
          title: r.title,
          domain: r.domain,
        }));
        await sql`
          INSERT INTO rank_tracking (site_id, keyword, our_position, top_10_results, search_engine)
          VALUES (${site.id}, ${kw.keyword}, ${ourPos}, ${JSON.stringify(top10)}::jsonb, ${engine})
          ON CONFLICT (site_id, LOWER(keyword), search_engine, (checked_at::date))
          DO UPDATE SET our_position = EXCLUDED.our_position, top_10_results = EXCLUDED.top_10_results
        `;
        if (ourPos != null) ranked += 1;
        checked += 1;
        // Brave is rate-limited. The no-key public search already performs two
        // bounded provider requests and only needs a short courtesy gap.
        await new Promise((r) => setTimeout(r, engine === "brave" ? 1100 : 250));
      } catch (err) {
        errors += 1;
        logError("rank-tracker.check.keyword", err, { site_id: site.id, keyword: kw.keyword });
      }
    }

    return {
      site_id: site.id,
      site_name: site.name,
      checked,
      ranked,
      errors,
    };
  };

  // Brave free-tier calls stay strictly sequential. The no-key engine runs a
  // small, bounded number of sites in parallel so the daily portfolio sweep
  // stays below the serverless execution window without hammering providers.
  const summary = await mapWithConcurrency(
    sites,
    engine === "brave" ? 1 : 3,
    processSite,
  );
  const totalChecks = summary.reduce((total, site) => total + site.checked, 0);
  const totalErrors = summary.reduce((total, site) => total + site.errors, 0);

  logger.info(
    { ctx: "rank-tracker.check", totalChecks, totalErrors, sites: sites.length },
    "rank tracker run finished"
  );

  const requestedChecks = summary.reduce((total, site) => total + site.checked + site.errors, 0);
  const outcome = runOutcome(totalChecks, totalErrors, requestedChecks);

  return NextResponse.json({
    success: outcome.success,
    partial: outcome.partial,
    skipped: outcome.skipped,
    engine,
    source_notice: engine === "brave"
      ? "Brave Search snapshot; not a Google rank."
      : "No-key Bing RSS + DuckDuckGo snapshot; not a Google rank.",
    limit_per_site: limitPerSite,
    sites: sites.length,
    total_checks: totalChecks,
    total_errors: totalErrors,
    summary,
  }, { status: outcome.statusCode });
}

// Vercel cron sends GET — alias to POST so /api/cron/rank-tracker-daily can fire it.
export const GET = POST;
