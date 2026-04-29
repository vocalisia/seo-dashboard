export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

function classifyIntent(keyword: string): string {
  const kw = keyword.toLowerCase();
  if (/\b(acheter|buy|prix|price|commander|devis|tarif|cost|shop|boutique)\b/.test(kw))
    return "transac";
  if (/\b(meilleur|best|comparatif|vs|alternative|avis|review|top)\b/.test(kw))
    return "comm";
  if (/\b(comment|how|pourquoi|why|qu.est|what is|guide|tutoriel|tutorial)\b/.test(kw))
    return "info";
  return "info";
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  const minClicks = parseInt(sp.get("minClicks") ?? "2000", 10);
  const minWords = parseInt(sp.get("minWords") ?? "3", 10);
  const posMin = parseFloat(sp.get("posMin") ?? "1");
  const posMax = parseFloat(sp.get("posMax") ?? "100");

  if (!siteId) {
    return NextResponse.json(
      { success: false, error: "siteId required" },
      { status: 400 }
    );
  }

  const sql = getSQL();
  const isAll = siteId === "all";

  try {
    const rows = (isAll ? await sql`
      SELECT
        s.name AS site_name,
        scd.query AS keyword,
        SUM(scd.clicks)::int AS clicks,
        SUM(scd.impressions)::int AS impressions,
        AVG(scd.position)::float AS position
      FROM search_console_data scd
      JOIN sites s ON s.id = scd.site_id
      WHERE scd.date >= NOW() - INTERVAL '30 days'
        AND scd.query IS NOT NULL
      GROUP BY s.name, scd.query
      HAVING
        SUM(scd.clicks) >= ${minClicks}
        AND array_length(string_to_array(scd.query, ' '), 1) >= ${minWords}
        AND AVG(scd.position) BETWEEN ${posMin} AND ${posMax}
      ORDER BY SUM(scd.clicks) DESC
      LIMIT 500
    ` : await sql`
      SELECT
        query AS keyword,
        SUM(clicks)::int AS clicks,
        SUM(impressions)::int AS impressions,
        AVG(position)::float AS position
      FROM search_console_data
      WHERE site_id = ${parseInt(siteId, 10)}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
      GROUP BY query
      HAVING
        SUM(clicks) >= ${minClicks}
        AND array_length(string_to_array(query, ' '), 1) >= ${minWords}
        AND AVG(position) BETWEEN ${posMin} AND ${posMax}
      ORDER BY SUM(clicks) DESC
      LIMIT 500
    `) as { keyword: string; clicks: number; impressions: number; position: number; site_name?: string }[];

    const enriched = rows.map((r) => {
      const pos = Number(r.position);
      const imp = Number(r.impressions);
      const share =
        pos <= 1 ? 0.9 : pos <= 3 ? 0.65 : pos <= 5 ? 0.48 : pos <= 10 ? 0.25 : pos <= 20 ? 0.08 : 0.02;
      const volume = Math.round(imp / share);
      const difficulty =
        volume > 10000 ? "hard" : volume > 3000 ? "medium" : "easy";
      const intent = classifyIntent(r.keyword);
      return { ...r, volume, difficulty, intent, site_name: r.site_name };
    });

    return NextResponse.json({ success: true, keywords: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
