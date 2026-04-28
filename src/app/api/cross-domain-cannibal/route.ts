import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface SitePerf {
  site_id: number;
  site_name: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

interface CrossCannib {
  query: string;
  total_impressions: number;
  total_clicks: number;
  sites_count: number;
  sites: SitePerf[];
  best_site: string;
  worst_position_diff: number;
  suggested_action: string;
}

export async function GET(request: NextRequest) {
  const days = parseInt(request.nextUrl.searchParams.get("days") || "28");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");

  if (isLocalDevDemoMode()) return NextResponse.json([]);

  try {
    const sql = getSQL();

    // Toutes les queries où ≥2 sites du portfolio rankent
    const rows = await sql`
      SELECT
        scd.query,
        scd.site_id,
        s.name AS site_name,
        scd.page,
        SUM(scd.clicks) AS clicks,
        SUM(scd.impressions) AS impressions,
        AVG(scd.position) AS position
      FROM search_console_data scd
      INNER JOIN sites s ON s.id = scd.site_id
      WHERE scd.date >= NOW() - INTERVAL '1 day' * ${days}
        AND scd.query IS NOT NULL
        AND s.is_active = true
      GROUP BY scd.query, scd.site_id, s.name, scd.page
      HAVING SUM(scd.impressions) > 20
    `;

    // Group par query, garde celles avec ≥2 sites distincts
    const byQuery: Record<string, SitePerf[]> = {};
    for (const r of rows as Record<string, unknown>[]) {
      const q = String(r.query);
      if (!byQuery[q]) byQuery[q] = [];
      byQuery[q].push({
        site_id: Number(r.site_id),
        site_name: String(r.site_name),
        page: String(r.page),
        clicks: Number(r.clicks),
        impressions: Number(r.impressions),
        position: Number(r.position),
      });
    }

    const conflicts: CrossCannib[] = [];
    for (const [query, sites] of Object.entries(byQuery)) {
      const distinctSites = new Set(sites.map(s => s.site_id));
      if (distinctSites.size < 2) continue;

      // Aggrege par site (un site peut avoir plusieurs pages)
      const siteAgg: Record<number, SitePerf> = {};
      for (const s of sites) {
        if (!siteAgg[s.site_id]) {
          siteAgg[s.site_id] = { ...s };
        } else {
          siteAgg[s.site_id].clicks += s.clicks;
          siteAgg[s.site_id].impressions += s.impressions;
          // Garde la meilleure pos
          if (s.position < siteAgg[s.site_id].position) {
            siteAgg[s.site_id].position = s.position;
            siteAgg[s.site_id].page = s.page;
          }
        }
      }
      const siteList = Object.values(siteAgg).sort((a, b) => a.position - b.position);

      const totalImp = siteList.reduce((s, x) => s + x.impressions, 0);
      const totalClicks = siteList.reduce((s, x) => s + x.clicks, 0);
      if (totalImp < 100) continue;

      const positions = siteList.map(s => s.position);
      const posDiff = Math.max(...positions) - Math.min(...positions);

      // Si tous très proches en position OU si 2 sites en page 1 → conflit
      const onPage1 = siteList.filter(s => s.position <= 10).length;
      const conflict = onPage1 >= 2 || posDiff < 5;
      if (!conflict) continue;

      const best = siteList[0];
      const action = onPage1 >= 2
        ? `🚨 ${onPage1} sites en page 1 — choisir 1 canonical (${best.site_name})`
        : posDiff < 3
        ? `⚡ Sites trop proches — différencier les angles ou consolider`
        : `ℹ️ Surveiller, 1 site dominant (${best.site_name})`;

      conflicts.push({
        query,
        total_impressions: totalImp,
        total_clicks: totalClicks,
        sites_count: siteList.length,
        sites: siteList,
        best_site: best.site_name,
        worst_position_diff: Number(posDiff.toFixed(1)),
        suggested_action: action,
      });
    }

    conflicts.sort((a, b) => b.total_impressions - a.total_impressions);
    return NextResponse.json(conflicts.slice(0, limit));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
