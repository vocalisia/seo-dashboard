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

  // PRIMARY SOURCE: tracked_keywords with REAL Google KP volumes ≥ minVol
  // These are the only truly reliable volumes (verified via Google Ads KP)
  const tkReal = (await sql`
    SELECT keyword,
      COALESCE(volume_market, volume_fr, 0) AS volume,
      volume_source,
      'google_kp_réel' AS source_label,
      true AS already_tracked
    FROM tracked_keywords
    WHERE site_id = ${siteId} AND is_active = true
      AND COALESCE(volume_market, volume_fr, 0) >= ${minVol}
      AND volume_source LIKE 'google_kp_real%'
    ORDER BY COALESCE(volume_market, volume_fr, 0) DESC
  `) as { keyword: string; volume: number; volume_source: string; source_label: string; already_tracked: boolean }[];

  // SECONDARY SOURCE: competitor_research with estimates ≥ minVol
  // (may be over-estimated by LLM, flagged as 'estimate')
  const crRows = (await sql`
    SELECT DISTINCT keyword,
      estimated_volume AS volume,
      'estimate_concurrent' AS source_label,
      false AS already_tracked
    FROM competitor_research
    WHERE site_id = ${siteId} AND estimated_volume >= ${minVol}
    ORDER BY estimated_volume DESC
  `) as { keyword: string; volume: number; source_label: string; already_tracked: boolean }[];

  // TERTIARY: All tracked ≥ minVol (including non-KP sources)
  const tkAll = (await sql`
    SELECT keyword,
      COALESCE(volume_market, volume_fr, 0) AS volume,
      COALESCE(volume_source, 'estimate') AS volume_source,
      CASE WHEN volume_source LIKE 'google_kp_real%' THEN 'google_kp_réel'
           WHEN volume_source LIKE 'google_kp_niche%' THEN 'google_kp_vérifié_faible'
           ELSE 'estimate_llm' END AS source_label,
      true AS already_tracked
    FROM tracked_keywords
    WHERE site_id = ${siteId} AND is_active = true
      AND COALESCE(volume_market, volume_fr, 0) >= ${minVol}
    ORDER BY COALESCE(volume_market, volume_fr, 0) DESC
  `) as { keyword: string; volume: number; volume_source: string; source_label: string; already_tracked: boolean }[];

  // Merge: dedupe by keyword (prefer real > estimate)
  const seen = new Map<string, HighVolKw>();
  for (const r of tkAll) seen.set(r.keyword.toLowerCase(), { keyword: r.keyword, volume: r.volume, source: r.source_label, already_tracked: true });
  for (const r of crRows) {
    const k = r.keyword.toLowerCase();
    if (!seen.has(k)) seen.set(k, { keyword: r.keyword, volume: r.volume, source: r.source_label, already_tracked: false });
  }

  const results: HighVolKw[] = Array.from(seen.values()).sort((a, b) => b.volume - a.volume);
  // Expose real vs estimate counts
  const realCount = tkReal.length;

  return NextResponse.json({
    success: true,
    site_id: siteId,
    min_vol: minVol,
    total: results.length,
    real_google_kp: realCount,
    estimates: results.length - realCount,
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

  // High-volume keywords to add:
  // 1. From tracked_keywords of OTHER sites with real Google KP volumes ≥ minVol
  //    (cross-pollinate: if "cbd montpellier" works for CBD Europa it may work elsewhere)
  // 2. From competitor_research with estimates ≥ minVol (secondary, flagged as estimate)
  const crRows = (await sql`
    SELECT DISTINCT keyword, estimated_volume AS volume, 'competitor_research_estimate' AS vol_source
    FROM competitor_research
    WHERE site_id = ${siteId} AND estimated_volume >= ${minVol}
    UNION
    -- Real Google KP keywords from tracked_keywords of the SAME site
    SELECT keyword, COALESCE(volume_market, volume_fr) AS volume, volume_source AS vol_source
    FROM tracked_keywords
    WHERE site_id = ${siteId} AND is_active = true
      AND COALESCE(volume_market, volume_fr, 0) >= ${minVol}
      AND volume_source LIKE 'google_kp_real%'
    ORDER BY volume DESC
  `) as { keyword: string; volume: number; vol_source: string }[];

  const existingRows = (await sql`
    SELECT LOWER(keyword) AS kw FROM tracked_keywords WHERE site_id = ${siteId} AND is_active = true
  `) as { kw: string }[];
  const existingSet = new Set(existingRows.map((r) => r.kw));

  const toAdd = crRows.filter((r) => !existingSet.has(r.keyword.toLowerCase().trim()));

  let added = 0;
  for (const r of toAdd) {
    const slug = r.keyword.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
    const targetUrl = `https://${host}/blog/${slug}`;
    const volSrc = r.vol_source?.startsWith("google_kp_real") ? r.vol_source : "competitor_research_high_vol";
    const conf = r.vol_source?.startsWith("google_kp_real") ? 1.0 : 0.8;
    await sql`
      INSERT INTO tracked_keywords
        (site_id, keyword, target_url, is_active, created_at, volume_market, volume_fr,
         market, current_position, current_impressions, current_clicks, updated_at, confidence, volume_source)
      VALUES
        (${siteId}, ${r.keyword}, ${targetUrl}, true, NOW(), ${r.volume}, ${r.volume},
         ${market}, NULL, 0, 0, NOW(), ${conf}, ${volSrc})
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
