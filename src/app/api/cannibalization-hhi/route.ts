import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface PageEntry { page: string; impressions: number; clicks: number; position: number }

interface CannibRow {
  query: string;
  url_count: number;
  total_impressions: number;
  total_clicks: number;
  pages: PageEntry[];
  hhi: number;
  severity: "HIGH" | "MED" | "LOW";
  estimated_loss: number;
  suggested_action: string;
  site_id: number | null;
  site_name: string | null;
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const days = parseInt(request.nextUrl.searchParams.get("days") || "28");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  if (isLocalDevDemoMode()) return NextResponse.json([]);

  try {
    const sql = getSQL();
    const isAll = siteId === "all";

    const rows = isAll
      ? await sql`
          SELECT
            d.query, d.page, d.site_id, s.name AS site_name,
            SUM(d.impressions) AS impressions,
            SUM(d.clicks) AS clicks,
            AVG(d.position) AS position
          FROM search_console_data d
          LEFT JOIN sites s ON s.id = d.site_id
          WHERE d.date >= NOW() - INTERVAL '1 day' * ${days}
            AND d.query IS NOT NULL
            AND d.page IS NOT NULL
          GROUP BY d.query, d.page, d.site_id, s.name
          HAVING SUM(d.impressions) > 10
        `
      : await sql`
          SELECT
            query, page,
            ${parseInt(siteId)}::int AS site_id,
            NULL::text AS site_name,
            SUM(impressions) AS impressions,
            SUM(clicks) AS clicks,
            AVG(position) AS position
          FROM search_console_data
          WHERE site_id = ${parseInt(siteId)}
            AND date >= NOW() - INTERVAL '1 day' * ${days}
            AND query IS NOT NULL
            AND page IS NOT NULL
          GROUP BY query, page
          HAVING SUM(impressions) > 10
        `;

    // Group par (query, site_id)
    const grouped: Record<string, { siteId: number | null; siteName: string | null; pages: PageEntry[] }> = {};
    for (const r of rows as Record<string, unknown>[]) {
      const q = String(r.query);
      const sid = r.site_id !== undefined && r.site_id !== null ? Number(r.site_id) : null;
      const key = isAll ? `${q}|||${String(sid)}` : q;
      if (!grouped[key]) {
        grouped[key] = { siteId: sid, siteName: r.site_name ? String(r.site_name) : null, pages: [] };
      }
      grouped[key].pages.push({
        page: String(r.page),
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        position: Number(r.position),
      });
    }

    const cannibs: CannibRow[] = [];
    for (const [key, { siteId: sid, siteName, pages }] of Object.entries(grouped)) {
      if (pages.length < 2) continue;
      const totalImp = pages.reduce((s, p) => s + p.impressions, 0);
      if (totalImp < 50) continue;

      const hhi = pages.reduce((s, p) => {
        const share = p.impressions / totalImp;
        return s + share * share;
      }, 0);

      pages.sort((a, b) => b.impressions - a.impressions);
      const sorted = pages.slice(0, 5);

      const minPos = Math.min(...pages.map(p => p.position));
      const maxPos = Math.max(...pages.map(p => p.position));
      const posSpread = maxPos - minPos;

      let severity: "HIGH" | "MED" | "LOW" = "LOW";
      if (hhi < 0.6 && posSpread < 5) severity = "HIGH";
      else if (hhi < 0.75 && posSpread < 10) severity = "MED";

      const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
      const bestCtr = Math.max(...pages.map(p => p.clicks / Math.max(1, p.impressions)));
      const estimated_loss = Math.max(0, Math.round(totalImp * bestCtr - totalClicks));

      const suggestion = severity === "HIGH"
        ? `🚨 Merger ou 301 ${pages.length - 1} URL(s) vers la meilleure (#1)`
        : severity === "MED"
        ? "⚡ Différencier les angles ou ajouter rel=canonical"
        : "ℹ️ Surveiller, pas critique";

      const query = isAll ? key.split("|||")[0] : key;
      cannibs.push({
        query,
        url_count: pages.length,
        total_impressions: totalImp,
        total_clicks: totalClicks,
        pages: sorted,
        hhi: Number(hhi.toFixed(3)),
        severity,
        estimated_loss,
        suggested_action: suggestion,
        site_id: sid,
        site_name: siteName,
      });
    }

    cannibs.sort((a, b) => b.estimated_loss - a.estimated_loss);
    return NextResponse.json(cannibs.slice(0, limit));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
