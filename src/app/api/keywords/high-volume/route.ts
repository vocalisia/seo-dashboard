export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { ensureSchemaOnce, getSQL } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";

/**
 * GET /api/keywords/high-volume?site_id=X&min_imp=100
 * Returns untracked high-impression GSC keywords (real sector keywords)
 * + known high-vol tracked keywords. Used to populate the discovery panel.
 *
 * POST /api/keywords/high-volume?site_id=X
 * body: { keywords: [{ keyword, volume, source }] }
 * Inserts the given keywords into tracked_keywords.
 */

export interface DiscoveredKw {
  keyword: string;
  impressions: number;
  clicks: number;
  avg_position: number;
  volume: number; // estimated from impressions
  source: "gsc_real" | "kp_real" | "competitor_estimate";
  already_tracked: boolean;
}

export async function GET(req: NextRequest) {
  const siteId = parseInt(req.nextUrl.searchParams.get("site_id") ?? "", 10);
  const minImp = parseInt(req.nextUrl.searchParams.get("min_imp") ?? "50", 10);

  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }

  await ensureSchemaOnce();
  const sql = getSQL();
  const results: DiscoveredKw[] = [];

  // 1. GSC real impressions — untracked queries with many impressions in the last 90d
  // These are real keywords in the site's sector (Google confirmed the site appears for them)
  const gscRows = (await sql`
    SELECT q.query,
      SUM(q.impressions) AS imp,
      SUM(q.clicks) AS clicks,
      SUM(q.impressions * q.position)::float / NULLIF(SUM(q.impressions), 0) AS pos
    FROM search_console_query_data q
    JOIN (
      SELECT MAX(date) AS end_date
      FROM search_console_query_data
      WHERE site_id = ${siteId}
        AND position BETWEEN 1 AND 200
    ) anchor ON TRUE
    WHERE q.site_id = ${siteId}
      AND q.date >= (anchor.end_date - INTERVAL '89 days')::date
      AND q.date <= anchor.end_date
      AND q.query IS NOT NULL
      AND q.position BETWEEN 1 AND 200
      AND LENGTH(q.query) BETWEEN 4 AND 80
      AND q.query NOT LIKE '%site:%'
      AND q.query NOT LIKE '%@%'
      AND q.query NOT LIKE '%"%'
      AND q.query NOT LIKE '(%'
      AND q.query !~ ' (OR|AND) '
      AND q.query !~ '[а-яёА-ЯЁ一-龯ぁ-んァ-ン]'
      AND NOT EXISTS (
        SELECT 1 FROM tracked_keywords tk
        WHERE tk.site_id = ${siteId} AND LOWER(tk.keyword) = LOWER(q.query) AND tk.is_active = true
      )
    GROUP BY q.query
    HAVING SUM(q.impressions) >= ${minImp}
    ORDER BY SUM(q.impressions) DESC
    LIMIT 50
  `) as { query: string; imp: number; clicks: number; pos: number }[];

  for (const r of gscRows) {
    const imp = Number(r.imp);
    // No fabricated volume: real signals only (impressions, position, clicks from GSC).
    results.push({
      keyword: r.query,
      impressions: imp,
      clicks: Number(r.clicks),
      avg_position: Math.round(Number(r.pos) * 10) / 10,
      volume: 0,
      source: "gsc_real",
      already_tracked: false,
    });
  }

  results.sort((a, b) => b.impressions - a.impressions || a.avg_position - b.avg_position);

  return NextResponse.json({
    success: true,
    site_id: siteId,
    total: results.length,
    untracked: results.filter((r) => !r.already_tracked).length,
    keywords: results,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  const siteId = parseInt(req.nextUrl.searchParams.get("site_id") ?? "", 10);
  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }

  let body: { keywords?: { keyword: string; source?: string }[] } = {};
  try {
    body = await req.json() as { keywords?: { keyword: string; source?: string }[] };
  } catch { body = {}; }

  // Skip operator/boolean junk queries (site:, quotes, OR/AND, parens, overly long)
  const isJunk = (k: string) =>
    /site:|["()]|(\s(OR|AND)\s)/.test(k) || k.length > 80;
  const toAdd = body.keywords?.filter((k) => k.keyword && k.keyword.length > 0 && !isJunk(k.keyword)) ?? [];
  if (toAdd.length === 0) {
    return NextResponse.json({ success: true, added: 0 });
  }

  await ensureSchemaOnce();
  const sql = getSQL();

  const siteRows = (await sql`SELECT url FROM sites WHERE id = ${siteId} LIMIT 1`) as { url: string }[];
  const siteUrl = siteRows[0]?.url ?? "";
  const host = siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
  const market = host.endsWith(".ch") ? "CH" : host.endsWith(".ca") ? "CA" : host.endsWith(".be") ? "BE" : host.endsWith(".fr") ? "FR" : "FR";

  let added = 0;
  for (const r of toAdd) {
    const slug = r.keyword.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
    const targetUrl = `https://${host}/blog/${slug}`;
    // volume_market/volume_fr = NULL on purpose: we do NOT have real Google KP volume.
    // Position + impressions + clicks are taken from REAL recent GSC data (last 30d).
    await sql`
      INSERT INTO tracked_keywords
        (site_id, keyword, target_url, is_active, created_at, volume_market, volume_fr,
         market, current_position, current_impressions, current_clicks, updated_at, confidence, volume_source)
      SELECT
        ${siteId}, ${r.keyword}, ${targetUrl}, true, NOW(), NULL, NULL,
        ${market},
        (SELECT ROUND((SUM(d.impressions * d.position)::float / NULLIF(SUM(d.impressions), 0))::numeric, 1)
           FROM search_console_query_data d
           JOIN (
             SELECT MAX(date) AS end_date
             FROM search_console_query_data
             WHERE site_id = ${siteId}
               AND LOWER(query) = LOWER(${r.keyword})
               AND position BETWEEN 1 AND 200
           ) anchor ON TRUE
           WHERE d.site_id = ${siteId} AND LOWER(d.query) = LOWER(${r.keyword})
             AND d.date >= (anchor.end_date - INTERVAL '29 days')::date
             AND d.date <= anchor.end_date
             AND d.impressions > 0
             AND d.position BETWEEN 1 AND 200),
        COALESCE((SELECT SUM(d.impressions) FROM search_console_query_data d
           JOIN (
             SELECT MAX(date) AS end_date
             FROM search_console_query_data
             WHERE site_id = ${siteId}
               AND LOWER(query) = LOWER(${r.keyword})
               AND position BETWEEN 1 AND 200
           ) anchor ON TRUE
           WHERE d.site_id = ${siteId} AND LOWER(d.query) = LOWER(${r.keyword})
             AND d.date >= (anchor.end_date - INTERVAL '29 days')::date
             AND d.date <= anchor.end_date), 0),
        COALESCE((SELECT SUM(d.clicks) FROM search_console_query_data d
           JOIN (
             SELECT MAX(date) AS end_date
             FROM search_console_query_data
             WHERE site_id = ${siteId}
               AND LOWER(query) = LOWER(${r.keyword})
               AND position BETWEEN 1 AND 200
           ) anchor ON TRUE
           WHERE d.site_id = ${siteId} AND LOWER(d.query) = LOWER(${r.keyword})
             AND d.date >= (anchor.end_date - INTERVAL '29 days')::date
             AND d.date <= anchor.end_date), 0),
        NOW(), 0.5, 'gsc_discovery_no_volume'
      ON CONFLICT DO NOTHING
    `;
    added++;
  }

  return NextResponse.json({ success: true, added, total: toAdd.length });
}
