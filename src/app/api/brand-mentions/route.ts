// GET /api/brand-mentions?site_id=X&since=ISO_DATE — list cached mentions.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { ensureSchema, getSQL, isDatabaseConfigured } from "@/lib/db";
import { logError } from "@/lib/logger";

interface MentionRow {
  id: number;
  site_id: number;
  source: string;
  title: string;
  url: string | null;
  score: number;
  created_at_external: string | null;
  body: string | null;
  sentiment: string;
  scanned_at: string;
  site_name?: string | null;
}

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try { await ensureSchema(); } catch (e) { logError("brand-mentions.list.ensureSchema", e); }

  const siteIdRaw = request.nextUrl.searchParams.get("site_id");
  const sinceRaw = request.nextUrl.searchParams.get("since");
  const limitRaw = request.nextUrl.searchParams.get("limit");

  const siteId = siteIdRaw ? parseInt(siteIdRaw, 10) : null;
  if (siteIdRaw && (!siteId || Number.isNaN(siteId))) {
    return NextResponse.json({ error: "Invalid site_id" }, { status: 400 });
  }

  let since: Date | null = null;
  if (sinceRaw) {
    const d = new Date(sinceRaw);
    if (!Number.isNaN(d.getTime())) since = d;
  }
  if (!since) {
    since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }

  const limit = limitRaw ? Math.min(500, Math.max(1, parseInt(limitRaw, 10) || 100)) : 100;
  const sinceIso = since.toISOString();

  const sql = getSQL();
  let mentions: MentionRow[];
  try {
    if (siteId) {
      mentions = (await sql`
        SELECT bm.id, bm.site_id, bm.source, bm.title, bm.url, bm.score,
               bm.created_at_external, bm.body, bm.sentiment, bm.scanned_at,
               s.name AS site_name
          FROM brand_mentions bm
          LEFT JOIN sites s ON s.id = bm.site_id
         WHERE bm.site_id = ${siteId}
           AND COALESCE(bm.created_at_external, bm.scanned_at) >= ${sinceIso}
         ORDER BY COALESCE(bm.created_at_external, bm.scanned_at) DESC
         LIMIT ${limit}
      `) as MentionRow[];
    } else {
      mentions = (await sql`
        SELECT bm.id, bm.site_id, bm.source, bm.title, bm.url, bm.score,
               bm.created_at_external, bm.body, bm.sentiment, bm.scanned_at,
               s.name AS site_name
          FROM brand_mentions bm
          LEFT JOIN sites s ON s.id = bm.site_id
         WHERE COALESCE(bm.created_at_external, bm.scanned_at) >= ${sinceIso}
         ORDER BY COALESCE(bm.created_at_external, bm.scanned_at) DESC
         LIMIT ${limit}
      `) as MentionRow[];
    }
  } catch (e) {
    logError("brand-mentions.list", e);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const total = mentions.length;
  const byReddit = mentions.filter((m) => m.source === "reddit").length;
  const byHN = mentions.filter((m) => m.source === "hackernews").length;
  const negative = mentions.filter((m) => m.sentiment === "negative").length;

  return NextResponse.json({
    success: true,
    mentions,
    stats: { total, reddit: byReddit, hackernews: byHN, negative },
    since: sinceIso,
  });
}
