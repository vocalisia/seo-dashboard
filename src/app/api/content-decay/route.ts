import { getSQL } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Severity = "CRIT" | "HIGH" | "MED";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const siteId = request.nextUrl.searchParams.get("siteId");
  const limit = Math.max(10, Math.min(500, parseInt(request.nextUrl.searchParams.get("limit") || "100", 10) || 100));

  if (!siteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });
  if (isLocalDevDemoMode()) return NextResponse.json([]);

  const headers = () => ({
    "X-Response-Time": `${Date.now() - startedAt}ms`,
    "Server-Timing": `app;dur=${Date.now() - startedAt}`,
  });

  try {
    const sql = getSQL();
    const isAll = siteId === "all";
    const parsedSiteId = parseInt(siteId, 10);
    if (!isAll && !Number.isFinite(parsedSiteId)) {
      return NextResponse.json({ error: "invalid siteId" }, { status: 400 });
    }

    const rows = (isAll ? await sql`
      WITH recent AS (
        SELECT
          page,
          site_id,
          SUM(clicks) AS clicks,
          SUM(impressions) AS impressions,
          SUM(clicks)::float / NULLIF(SUM(impressions), 0) AS ctr,
          SUM(position * impressions)::float / NULLIF(SUM(impressions), 0) AS position
        FROM search_console_data
        WHERE date >= (CURRENT_DATE - INTERVAL '14 days')::date
          AND page IS NOT NULL
        GROUP BY page, site_id
      ),
      older AS (
        SELECT
          page,
          site_id,
          SUM(clicks) / 2.0 AS clicks,
          SUM(impressions) / 2.0 AS impressions,
          (SUM(clicks)::float / NULLIF(SUM(impressions), 0)) AS ctr,
          SUM(position * impressions)::float / NULLIF(SUM(impressions), 0) AS position
        FROM search_console_data
        WHERE date >= (CURRENT_DATE - INTERVAL '42 days')::date
          AND date < (CURRENT_DATE - INTERVAL '14 days')::date
          AND page IS NOT NULL
        GROUP BY page, site_id
      ),
      query_scores AS (
        SELECT
          page,
          site_id,
          query,
          SUM(clicks) AS clicks,
          ROW_NUMBER() OVER (PARTITION BY page, site_id ORDER BY SUM(clicks) DESC, query ASC) AS rn
        FROM search_console_data
        WHERE date >= (CURRENT_DATE - INTERVAL '42 days')::date
          AND page IS NOT NULL
          AND query IS NOT NULL
        GROUP BY page, site_id, query
      ),
      top_queries AS (
        SELECT page, site_id, string_agg(query, ', ' ORDER BY clicks DESC, query ASC) AS queries
        FROM query_scores
        WHERE rn <= 3
        GROUP BY page, site_id
      )
      SELECT
        r.page,
        r.site_id,
        s.name AS site_name,
        tq.queries AS query,
        r.clicks AS clicks_recent,
        o.clicks AS clicks_older,
        r.impressions AS imp_recent,
        o.impressions AS imp_older,
        r.position AS pos_recent,
        o.position AS pos_older,
        r.ctr AS ctr_recent,
        o.ctr AS ctr_older
      FROM recent r
      INNER JOIN older o ON o.page = r.page AND o.site_id = r.site_id
      LEFT JOIN sites s ON s.id = r.site_id
      LEFT JOIN top_queries tq ON tq.page = r.page AND tq.site_id = r.site_id
      WHERE o.clicks >= 5 AND o.impressions >= 100
    ` : await sql`
      WITH recent AS (
        SELECT
          page,
          site_id,
          SUM(clicks) AS clicks,
          SUM(impressions) AS impressions,
          SUM(clicks)::float / NULLIF(SUM(impressions), 0) AS ctr,
          SUM(position * impressions)::float / NULLIF(SUM(impressions), 0) AS position
        FROM search_console_data
        WHERE site_id = ${parsedSiteId}
          AND date >= (CURRENT_DATE - INTERVAL '14 days')::date
          AND page IS NOT NULL
        GROUP BY page, site_id
      ),
      older AS (
        SELECT
          page,
          site_id,
          SUM(clicks) / 2.0 AS clicks,
          SUM(impressions) / 2.0 AS impressions,
          (SUM(clicks)::float / NULLIF(SUM(impressions), 0)) AS ctr,
          SUM(position * impressions)::float / NULLIF(SUM(impressions), 0) AS position
        FROM search_console_data
        WHERE site_id = ${parsedSiteId}
          AND date >= (CURRENT_DATE - INTERVAL '42 days')::date
          AND date < (CURRENT_DATE - INTERVAL '14 days')::date
          AND page IS NOT NULL
        GROUP BY page, site_id
      ),
      query_scores AS (
        SELECT
          page,
          site_id,
          query,
          SUM(clicks) AS clicks,
          ROW_NUMBER() OVER (PARTITION BY page, site_id ORDER BY SUM(clicks) DESC, query ASC) AS rn
        FROM search_console_data
        WHERE site_id = ${parsedSiteId}
          AND date >= (CURRENT_DATE - INTERVAL '42 days')::date
          AND page IS NOT NULL
          AND query IS NOT NULL
        GROUP BY page, site_id, query
      ),
      top_queries AS (
        SELECT page, site_id, string_agg(query, ', ' ORDER BY clicks DESC, query ASC) AS queries
        FROM query_scores
        WHERE rn <= 3
        GROUP BY page, site_id
      )
      SELECT
        r.page,
        r.site_id,
        NULL::text AS site_name,
        tq.queries AS query,
        r.clicks AS clicks_recent,
        o.clicks AS clicks_older,
        r.impressions AS imp_recent,
        o.impressions AS imp_older,
        r.position AS pos_recent,
        o.position AS pos_older,
        r.ctr AS ctr_recent,
        o.ctr AS ctr_older
      FROM recent r
      INNER JOIN older o ON o.page = r.page AND o.site_id = r.site_id
      LEFT JOIN top_queries tq ON tq.page = r.page AND tq.site_id = r.site_id
      WHERE o.clicks >= 5 AND o.impressions >= 100
    `) as Record<string, unknown>[];

    const decays = rows.map((r) => {
      const cR = Number(r.clicks_recent || 0);
      const cO = Number(r.clicks_older || 0);
      const pR = Number(r.pos_recent || 0);
      const pO = Number(r.pos_older || 0);
      const ctrR = Number(r.ctr_recent || 0);
      const ctrO = Number(r.ctr_older || 0);

      const clicksDrop = cO > 0 ? ((cR - cO) / cO) * 100 : 0;
      const posDrop = pR > 0 && pO > 0 ? pR - pO : 0;
      const ctrDrop = ctrO > 0 ? ((ctrR - ctrO) / ctrO) * 100 : 0;
      const lostClicks = Math.max(0, Math.round(cO - cR));
      const isDecay = clicksDrop <= -30 || posDrop >= 2 || ctrDrop <= -25;
      if (!isDecay) return null;

      let severity: Severity = "MED";
      let reason = "Tendance baissiere";
      let action = "Verifier le contenu, le title et les requetes principales.";
      if (clicksDrop <= -50 && lostClicks >= 5) {
        severity = "CRIT";
        reason = `Chute de clics ${Math.round(clicksDrop)}%`;
        action = "Priorite: rafraichir la page, renforcer le maillage interne et verifier les SERP.";
      } else if (clicksDrop <= -30) {
        severity = "HIGH";
        reason = `Clics en baisse ${Math.round(clicksDrop)}%`;
        action = "Comparer les requetes perdues et mettre a jour les sections qui repondent mal.";
      } else if (posDrop >= 3) {
        severity = "HIGH";
        reason = `Position degradee de ${posDrop.toFixed(1)}`;
        action = "Verifier concurrence, fraicheur du contenu et liens internes vers cette page.";
      } else if (ctrDrop <= -25) {
        reason = `CTR en baisse ${Math.round(ctrDrop)}%`;
        action = "Tester un title/meta plus fort et aligner l'intention de recherche.";
      }

      return {
        page: String(r.page || ""),
        query: String(r.query || ""),
        site_id: r.site_id !== undefined ? Number(r.site_id) : null,
        site_name: r.site_name ? String(r.site_name) : null,
        clicks_recent: Math.round(cR),
        clicks_older: Math.round(cO),
        clicks_lost: lostClicks,
        clicks_drop_pct: Math.round(clicksDrop),
        impressions_recent: Math.round(Number(r.imp_recent || 0)),
        impressions_older: Math.round(Number(r.imp_older || 0)),
        position_recent: Number(pR.toFixed(1)),
        position_older: Number(pO.toFixed(1)),
        position_drop: Number(posDrop.toFixed(1)),
        ctr_drop_pct: Math.round(ctrDrop),
        severity,
        reason,
        action,
      };
    }).filter(Boolean);

    const order: Record<Severity, number> = { CRIT: 0, HIGH: 1, MED: 2 };
    decays.sort((a, b) => {
      if (!a || !b) return 0;
      const severityDelta = order[a.severity] - order[b.severity];
      if (severityDelta !== 0) return severityDelta;
      return Number(b.clicks_lost || 0) - Number(a.clicks_lost || 0);
    });

    return NextResponse.json(decays.slice(0, limit), { headers: headers() });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
