export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";

/**
 * GET /api/keywords/high-volume?site_id=X&min_vol=1000
 * Returns tracked + competitor keywords ≥ min_vol for a site.
 *
 * POST /api/keywords/high-volume?site_id=X&min_vol=1000
 * Discovers high-volume keywords from competitor_research for the site
 * and inserts them into tracked_keywords if not already present.
 * Returns { added, already_tracked, total_high_vol }
 */

interface HighVolKw {
  keyword: string;
  volume: number;
  source: string;
  already_tracked: boolean;
}

export async function GET(req: NextRequest) {
  const siteId = parseInt(req.nextUrl.searchParams.get("site_id") ?? "", 10);
  const minVol = parseInt(req.nextUrl.searchParams.get("min_vol") ?? "1000", 10);

  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();

  // High-volume from competitor_research (discovered via AI/Perplexity)
  const crRows = (await sql`
    SELECT DISTINCT keyword, estimated_volume AS volume, 'competitor_research' AS source
    FROM competitor_research
    WHERE site_id = ${siteId} AND estimated_volume >= ${minVol}
    ORDER BY estimated_volume DESC
  `) as { keyword: string; volume: number; source: string }[];

  // High-volume from tracked_keywords (already tracked)
  const tkRows = (await sql`
    SELECT keyword, COALESCE(volume_market, volume_fr, 0) AS volume, 'tracked' AS source
    FROM tracked_keywords
    WHERE site_id = ${siteId} AND is_active = true
      AND COALESCE(volume_market, volume_fr, 0) >= ${minVol}
    ORDER BY COALESCE(volume_market, volume_fr, 0) DESC
  `) as { keyword: string; volume: number; source: string }[];

  // Find which CR keywords are NOT yet tracked
  const trackedSet = new Set(tkRows.map((r) => r.keyword.toLowerCase().trim()));
  const results: HighVolKw[] = [
    ...tkRows.map((r) => ({ ...r, already_tracked: true })),
    ...crRows
      .filter((r) => !trackedSet.has(r.keyword.toLowerCase().trim()))
      .map((r) => ({ ...r, already_tracked: false })),
  ];

  results.sort((a, b) => b.volume - a.volume);

  return NextResponse.json({
    success: true,
    site_id: siteId,
    min_vol: minVol,
    total: results.length,
    keywords: results,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  const siteId = parseInt(req.nextUrl.searchParams.get("site_id") ?? "", 10);
  const minVol = parseInt(req.nextUrl.searchParams.get("min_vol") ?? "1000", 10);

  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();

  // Site URL for building target_url + market
  const siteRows = (await sql`SELECT url FROM sites WHERE id = ${siteId} LIMIT 1`) as { url: string }[];
  const siteUrl = siteRows[0]?.url ?? "";
  const host = siteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
  const market = host.endsWith(".ch") ? "CH"
    : host.endsWith(".ca") ? "CA"
    : host.endsWith(".be") ? "BE"
    : host.endsWith(".fr") ? "FR"
    : "FR";

  // High-volume keywords from competitor_research not yet tracked
  const crRows = (await sql`
    SELECT DISTINCT keyword, estimated_volume AS volume
    FROM competitor_research
    WHERE site_id = ${siteId} AND estimated_volume >= ${minVol}
  `) as { keyword: string; volume: number }[];

  const existingRows = (await sql`
    SELECT LOWER(keyword) AS kw FROM tracked_keywords WHERE site_id = ${siteId} AND is_active = true
  `) as { kw: string }[];
  const existingSet = new Set(existingRows.map((r) => r.kw));

  const toAdd = crRows.filter((r) => !existingSet.has(r.keyword.toLowerCase().trim()));

  let added = 0;
  for (const r of toAdd) {
    const slug = r.keyword.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
    const targetUrl = `https://${host}/blog/${slug}`;
    await sql`
      INSERT INTO tracked_keywords
        (site_id, keyword, target_url, is_active, created_at, volume_market, volume_fr,
         market, current_position, current_impressions, current_clicks, updated_at, confidence, volume_source)
      VALUES
        (${siteId}, ${r.keyword}, ${targetUrl}, true, NOW(), ${r.volume}, ${r.volume},
         ${market}, NULL, 0, 0, NOW(), 0.85, 'competitor_research_high_vol')
      ON CONFLICT DO NOTHING
    `;
    added++;
  }

  return NextResponse.json({
    success: true,
    site_id: siteId,
    min_vol: minVol,
    total_high_vol: crRows.length,
    already_tracked: crRows.length - toAdd.length,
    added,
  });
}
