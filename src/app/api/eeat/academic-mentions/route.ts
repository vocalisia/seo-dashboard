// GET /api/eeat/academic-mentions?site_id=X — list cached academic mentions.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { ensureSchema, getSQL, isDatabaseConfigured } from "@/lib/db";
import { logError } from "@/lib/logger";

interface AcademicRow {
  id: number;
  site_id: number;
  source_url: string | null;
  title: string;
  authors: string[] | null;
  year: number | null;
  doi: string | null;
  cited_by_count: number;
  source_type: string | null;
  source_domain: string | null;
  scanned_at: string;
  site_name?: string | null;
}

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try { await ensureSchema(); } catch (e) { logError("eeat.academic-mentions.ensureSchema", e); }

  const siteIdRaw = request.nextUrl.searchParams.get("site_id");
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const eduGovOnly = request.nextUrl.searchParams.get("edu_gov") === "1";

  const siteId = siteIdRaw ? parseInt(siteIdRaw, 10) : null;
  if (siteIdRaw && (!siteId || Number.isNaN(siteId))) {
    return NextResponse.json({ error: "Invalid site_id" }, { status: 400 });
  }

  const limit = limitRaw
    ? Math.min(500, Math.max(1, parseInt(limitRaw, 10) || 100))
    : 100;

  const sql = getSQL();
  let rows: AcademicRow[];
  try {
    if (siteId) {
      rows = (await sql`
        SELECT am.id, am.site_id, am.source_url, am.title, am.authors, am.year,
               am.doi, am.cited_by_count, am.source_type, am.source_domain, am.scanned_at,
               s.name AS site_name
          FROM academic_mentions am
          LEFT JOIN sites s ON s.id = am.site_id
         WHERE am.site_id = ${siteId}
         ORDER BY am.cited_by_count DESC, am.year DESC NULLS LAST
         LIMIT ${limit}
      `) as AcademicRow[];
    } else {
      rows = (await sql`
        SELECT am.id, am.site_id, am.source_url, am.title, am.authors, am.year,
               am.doi, am.cited_by_count, am.source_type, am.source_domain, am.scanned_at,
               s.name AS site_name
          FROM academic_mentions am
          LEFT JOIN sites s ON s.id = am.site_id
         ORDER BY am.cited_by_count DESC, am.year DESC NULLS LAST
         LIMIT ${limit}
      `) as AcademicRow[];
    }
  } catch (e) {
    logError("eeat.academic-mentions.list", e);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const filtered = eduGovOnly
    ? rows.filter((r) => /\.(edu|gov)(\.|$)/i.test(r.source_domain ?? ""))
    : rows;

  const total = filtered.length;
  const eduGov = rows.filter((r) => /\.(edu|gov)(\.|$)/i.test(r.source_domain ?? "")).length;
  const totalCitations = rows.reduce((sum, r) => sum + (r.cited_by_count ?? 0), 0);

  return NextResponse.json({
    success: true,
    mentions: filtered,
    stats: { total, edu_gov: eduGov, total_citations: totalCitations },
  });
}
