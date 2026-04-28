import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface CannibRow {
  query: string;
  url_count: number;
  total_impressions: number;
  total_clicks: number;
  pages: { page: string; impressions: number; clicks: number; position: number }[];
  hhi: number;
  severity: "HIGH" | "MED" | "LOW";
  estimated_loss: number;
  suggested_action: string;
}

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const days = parseInt(request.nextUrl.searchParams.get("days") || "28");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  if (isLocalDevDemoMode()) return NextResponse.json([]);

  try {
    const sql = getSQL();
    const id = parseInt(siteId);

    // Queries avec ≥2 URLs concurrentes
    const rows = await sql`
      SELECT
        query,
        page,
        SUM(impressions) AS impressions,
        SUM(clicks) AS clicks,
        AVG(position) AS position
      FROM search_console_data
      WHERE site_id = ${id}
        AND date >= NOW() - INTERVAL '1 day' * ${days}
        AND query IS NOT NULL
        AND page IS NOT NULL
      GROUP BY query, page
      HAVING SUM(impressions) > 10
    `;

    // Group par query
    const grouped: Record<string, { page: string; impressions: number; clicks: number; position: number }[]> = {};
    for (const r of rows as Record<string, unknown>[]) {
      const q = String(r.query);
      if (!grouped[q]) grouped[q] = [];
      grouped[q].push({
        page: String(r.page),
        impressions: Number(r.impressions),
        clicks: Number(r.clicks),
        position: Number(r.position),
      });
    }

    // Calc HHI + severity
    const cannibs: CannibRow[] = [];
    for (const [query, pages] of Object.entries(grouped)) {
      if (pages.length < 2) continue;
      const totalImp = pages.reduce((s, p) => s + p.impressions, 0);
      if (totalImp < 50) continue;

      // HHI = sum(share^2) — 1 = monopole, 0 = dispersion totale
      const hhi = pages.reduce((s, p) => {
        const share = p.impressions / totalImp;
        return s + share * share;
      }, 0);

      pages.sort((a, b) => b.impressions - a.impressions);
      const sorted = pages.slice(0, 5);

      // Severity = positions proches + HHI bas (= concurrence vraie)
      const minPos = Math.min(...pages.map(p => p.position));
      const maxPos = Math.max(...pages.map(p => p.position));
      const posSpread = maxPos - minPos;

      let severity: "HIGH" | "MED" | "LOW" = "LOW";
      if (hhi < 0.6 && posSpread < 5) severity = "HIGH";
      else if (hhi < 0.75 && posSpread < 10) severity = "MED";

      // Estimation perte = clics qui auraient eu lieu si toute l'attention sur la #1
      const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
      const bestCtr = Math.max(...pages.map(p => p.clicks / Math.max(1, p.impressions)));
      const estimated_loss = Math.max(0, Math.round(totalImp * bestCtr - totalClicks));

      const suggestion = severity === "HIGH"
        ? `🚨 Merger ou 301 ${pages.length - 1} URL(s) vers la meilleure (#1)`
        : severity === "MED"
        ? "⚡ Différencier les angles ou ajouter rel=canonical"
        : "ℹ️ Surveiller, pas critique";

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
      });
    }

    cannibs.sort((a, b) => b.estimated_loss - a.estimated_loss);
    return NextResponse.json(cannibs.slice(0, limit));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
