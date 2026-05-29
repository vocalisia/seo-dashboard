// POST /api/eeat/academic-scan?site_id=X — fetch + cache OpenAlex mentions.
// If no site_id provided, loops all active sites.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { ensureSchema, getSQL, isDatabaseConfigured } from "@/lib/db";
import { searchAcademicMentions, AcademicWork } from "@/lib/openalex";
import { logError, logger } from "@/lib/logger";

interface SiteRow {
  id: number;
  name: string;
  url: string;
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

async function storeWorks(siteId: number, works: AcademicWork[]): Promise<number> {
  if (works.length === 0) return 0;
  const sql = getSQL();
  let inserted = 0;
  for (const w of works) {
    try {
      const rows = (await sql`
        INSERT INTO academic_mentions (
          site_id, source_url, title, authors, year, doi,
          cited_by_count, source_type, source_domain, scanned_at
        )
        VALUES (
          ${siteId}, ${w.source_url}, ${w.title},
          ${JSON.stringify(w.authors)}::jsonb,
          ${w.year}, ${w.doi}, ${w.cited_by_count},
          ${w.source_type}, ${w.source_domain}, NOW()
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `) as Array<{ id: number }>;
      if (rows.length > 0) inserted += 1;
    } catch (e) {
      logError("eeat.academic-scan.store", e, { siteId, title: w.title.slice(0, 60) });
    }
  }
  return inserted;
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try { await ensureSchema(); } catch (e) { logError("eeat.academic-scan.ensureSchema", e); }

  const siteIdRaw = request.nextUrl.searchParams.get("site_id");
  const siteId = siteIdRaw ? parseInt(siteIdRaw, 10) : undefined;
  if (siteIdRaw && (!siteId || Number.isNaN(siteId))) {
    return NextResponse.json({ error: "Invalid site_id" }, { status: 400 });
  }

  const sites = await loadSites(siteId);
  if (sites.length === 0) {
    return NextResponse.json({ error: "No sites found" }, { status: 404 });
  }

  const summary: Array<{
    site_id: number;
    site: string;
    works_found: number;
    inserted: number;
    edu_gov_count: number;
  }> = [];

  for (const s of sites) {
    const domain = s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    try {
      const { works } = await searchAcademicMentions(domain);
      const inserted = await storeWorks(s.id, works);
      const eduGov = works.filter((w) =>
        /\.(edu|gov)(\.|$)/i.test(w.source_domain)
      ).length;
      summary.push({
        site_id: s.id,
        site: s.name,
        works_found: works.length,
        inserted,
        edu_gov_count: eduGov,
      });
      logger.info({
        ctx: "eeat.academic-scan",
        site: s.name,
        works_found: works.length,
        inserted,
        edu_gov_count: eduGov,
      });
    } catch (e) {
      logError("eeat.academic-scan", e, { site: s.name });
      summary.push({
        site_id: s.id,
        site: s.name,
        works_found: 0,
        inserted: 0,
        edu_gov_count: 0,
      });
    }
  }

  return NextResponse.json({ success: true, summary });
}

export const GET = POST;
