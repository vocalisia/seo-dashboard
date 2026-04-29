import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "100");

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  if (isLocalDevDemoMode()) return NextResponse.json([]);

  try {
    const sql = getSQL();
    const isAll = siteId === "all";

    // Compare bucket récent (0-14j) vs bucket plus ancien (15-42j)
    // Decay = chute clics ≥30% OU chute position ≥2 OU chute CTR ≥25%
    const rows = isAll
      ? await sql`
        WITH recent AS (
          SELECT page, query, site_id,
            SUM(clicks) AS clicks,
            SUM(impressions) AS impressions,
            AVG(position) AS position,
            AVG(ctr) AS ctr
          FROM search_console_data
          WHERE date >= NOW() - INTERVAL '14 days'
            AND query IS NOT NULL
            AND page IS NOT NULL
          GROUP BY page, query, site_id
        ),
        older AS (
          SELECT page, query, site_id,
            SUM(clicks) / 2.0 AS clicks,
            SUM(impressions) / 2.0 AS impressions,
            AVG(position) AS position,
            AVG(ctr) AS ctr
          FROM search_console_data
          WHERE date >= NOW() - INTERVAL '42 days'
            AND date <  NOW() - INTERVAL '14 days'
            AND query IS NOT NULL
            AND page IS NOT NULL
          GROUP BY page, query, site_id
        )
        SELECT
          r.page, r.query, r.site_id,
          s.name AS site_name,
          r.clicks AS clicks_recent, o.clicks AS clicks_older,
          r.impressions AS imp_recent, o.impressions AS imp_older,
          r.position AS pos_recent, o.position AS pos_older,
          r.ctr AS ctr_recent, o.ctr AS ctr_older
        FROM recent r
        INNER JOIN older o ON o.page = r.page AND o.query = r.query AND o.site_id = r.site_id
        LEFT JOIN sites s ON s.id = r.site_id
        WHERE o.clicks >= 5 AND o.impressions >= 100
      `
      : await sql`
        WITH recent AS (
          SELECT page, query,
            SUM(clicks) AS clicks,
            SUM(impressions) AS impressions,
            AVG(position) AS position,
            AVG(ctr) AS ctr
          FROM search_console_data
          WHERE site_id = ${parseInt(siteId)}
            AND date >= NOW() - INTERVAL '14 days'
            AND query IS NOT NULL
            AND page IS NOT NULL
          GROUP BY page, query
        ),
        older AS (
          SELECT page, query,
            SUM(clicks) / 2.0 AS clicks,
            SUM(impressions) / 2.0 AS impressions,
            AVG(position) AS position,
            AVG(ctr) AS ctr
          FROM search_console_data
          WHERE site_id = ${parseInt(siteId)}
            AND date >= NOW() - INTERVAL '42 days'
            AND date <  NOW() - INTERVAL '14 days'
            AND query IS NOT NULL
            AND page IS NOT NULL
          GROUP BY page, query
        )
        SELECT
          r.page, r.query,
          ${parseInt(siteId)}::int AS site_id,
          NULL::text AS site_name,
          r.clicks AS clicks_recent, o.clicks AS clicks_older,
          r.impressions AS imp_recent, o.impressions AS imp_older,
          r.position AS pos_recent, o.position AS pos_older,
          r.ctr AS ctr_recent, o.ctr AS ctr_older
        FROM recent r
        INNER JOIN older o ON o.page = r.page AND o.query = r.query
        WHERE o.clicks >= 5 AND o.impressions >= 100
      `;

    const decays = (rows as Record<string, unknown>[]).map(r => {
      const cR = Number(r.clicks_recent);
      const cO = Number(r.clicks_older);
      const pR = Number(r.pos_recent);
      const pO = Number(r.pos_older);
      const ctrR = Number(r.ctr_recent);
      const ctrO = Number(r.ctr_older);

      const clicksDrop = cO > 0 ? (cR - cO) / cO * 100 : 0;
      const posDrop = pR - pO;
      const ctrDrop = ctrO > 0 ? (ctrR - ctrO) / ctrO * 100 : 0;

      const isDecay = clicksDrop <= -30 || posDrop >= 2 || ctrDrop <= -25;
      if (!isDecay) return null;

      let severity: "CRIT"|"HIGH"|"MED" = "MED";
      let reason = "";
      if (clicksDrop <= -50) { severity = "CRIT"; reason = `🚨 Chute clics ${Math.round(clicksDrop)}%`; }
      else if (clicksDrop <= -30) { severity = "HIGH"; reason = `⚠️ Chute clics ${Math.round(clicksDrop)}%`; }
      else if (posDrop >= 3) { severity = "HIGH"; reason = `⚠️ Position +${posDrop.toFixed(1)}`; }
      else if (ctrDrop <= -40) { severity = "HIGH"; reason = `⚠️ CTR ${Math.round(ctrDrop)}%`; }
      else reason = `📉 Tendance baissière`;

      return {
        page: r.page,
        query: r.query,
        site_id: r.site_id !== undefined ? Number(r.site_id) : null,
        site_name: r.site_name ? String(r.site_name) : null,
        clicks_recent: Math.round(cR),
        clicks_older: Math.round(cO),
        clicks_drop_pct: Math.round(clicksDrop),
        position_recent: Number(pR.toFixed(1)),
        position_older: Number(pO.toFixed(1)),
        position_drop: Number(posDrop.toFixed(1)),
        ctr_drop_pct: Math.round(ctrDrop),
        severity,
        reason,
      };
    }).filter(Boolean);

    const order: Record<"CRIT"|"HIGH"|"MED", number> = { CRIT: 0, HIGH: 1, MED: 2 };
    decays.sort((a, b) => {
      if (!a || !b) return 0;
      const sa = order[a.severity];
      const sb = order[b.severity];
      if (sa !== sb) return sa - sb;
      return a.clicks_drop_pct - b.clicks_drop_pct;
    });

    return NextResponse.json(decays.slice(0, limit));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
