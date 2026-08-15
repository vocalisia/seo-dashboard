// POST /api/brand-mentions/scan?site_id=X — fetch + store Reddit/HN mentions
// for one site (or all active sites if no site_id provided).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { ensureSchema, getSQL, isDatabaseConfigured } from "@/lib/db";
import { unifiedSearch, BrandMention } from "@/lib/brand-mentions";
import { logError, logger } from "@/lib/logger";
import { runOutcome } from "@/lib/run-outcome";

interface SiteRow {
  id: number;
  name: string;
  url: string;
}

function brandFromName(name: string): string {
  return name.replace(/\.[a-z]{2,}$/i, "").trim();
}

async function loadSites(siteId?: number): Promise<SiteRow[]> {
  const sql = getSQL();
  if (siteId) {
    return (await sql`
      SELECT id, name, url FROM sites WHERE id = ${siteId} AND is_active = true
    `) as SiteRow[];
  }
  return (await sql`
    SELECT id, name, url FROM sites WHERE is_active = true ORDER BY id
  `) as SiteRow[];
}

async function storeMentions(
  siteId: number,
  mentions: BrandMention[]
): Promise<{ inserted: number; failed: number }> {
  if (mentions.length === 0) return { inserted: 0, failed: 0 };
  const sql = getSQL();
  let inserted = 0;
  let failed = 0;
  for (const m of mentions) {
    try {
      const rows = (await sql`
        INSERT INTO brand_mentions (
          site_id, source, title, url, score,
          created_at_external, body, sentiment, scanned_at
        )
        VALUES (
          ${siteId}, ${m.source}, ${m.title}, ${m.url}, ${m.score},
          ${m.created_at_external}, ${m.body}, ${m.sentiment}, NOW()
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `) as Array<{ id: number }>;
      if (rows.length > 0) inserted += 1;
    } catch (e) {
      failed += 1;
      logError("brand-mentions.store", e, { siteId, source: m.source });
    }
  }
  return { inserted, failed };
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try { await ensureSchema(); } catch (e) { logError("brand-mentions.scan.ensureSchema", e); }

  const siteIdRaw = request.nextUrl.searchParams.get("site_id");
  const siteId = siteIdRaw ? parseInt(siteIdRaw, 10) : undefined;
  if (siteIdRaw && (!siteId || Number.isNaN(siteId))) {
    return NextResponse.json({ error: "Invalid site_id" }, { status: 400 });
  }

  const sites = await loadSites(siteId);
  if (sites.length === 0) {
    return NextResponse.json({ error: "No sites found" }, { status: 404 });
  }

  const summary: Array<{ site_id: number; site: string; found: number; inserted: number; store_errors: number; error?: string }> = [];

  for (const s of sites) {
    const domain = s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const brand = brandFromName(s.name);
    try {
      const mentions = await unifiedSearch(domain, brand);
      const stored = await storeMentions(s.id, mentions);
      summary.push({ site_id: s.id, site: s.name, found: mentions.length, inserted: stored.inserted, store_errors: stored.failed });
      logger.info({ ctx: "brand-mentions.scan", site: s.name, found: mentions.length, inserted: stored.inserted, store_errors: stored.failed });
    } catch (e) {
      logError("brand-mentions.scan", e, { site: s.name });
      summary.push({ site_id: s.id, site: s.name, found: 0, inserted: 0, store_errors: 0, error: e instanceof Error ? e.message : "Scan failed" });
    }
  }

  const failedSites = summary.filter((result) => Boolean(result.error)).length;
  const storeErrors = summary.reduce((total, result) => total + result.store_errors, 0);
  const outcome = runOutcome(sites.length - failedSites, failedSites, sites.length);
  const partial = outcome.partial || storeErrors > 0;
  return NextResponse.json({
    success: outcome.success,
    partial,
    failed_sites: failedSites,
    store_errors: storeErrors,
    summary,
  }, { status: outcome.success ? (partial ? 207 : 200) : outcome.statusCode });
}

export const GET = POST;
