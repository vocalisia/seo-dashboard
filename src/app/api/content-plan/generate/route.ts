export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { z } from "zod";

const BodySchema = z.object({
  siteId: z.number().int().positive(),
});

interface Opportunity {
  keyword: string;
  clicks: number;
  impressions: number;
  position: number;
  volume: number;
  type: "gap" | "striking" | "low_ctr";
}

interface ContentItem {
  title: string;
  target_keyword: string;
  score: number;
  rationale: string;
  volume: number;
  difficulty: string;
}

async function ensureContentPlanTable(sql: ReturnType<typeof getSQL>) {
  await sql`
    CREATE TABLE IF NOT EXISTS content_plan_items (
      id SERIAL PRIMARY KEY,
      site_id INT REFERENCES sites(id),
      title VARCHAR(500) NOT NULL,
      target_keyword VARCHAR(300) NOT NULL,
      score FLOAT DEFAULT 0,
      rationale TEXT,
      difficulty VARCHAR(20) DEFAULT 'medium',
      volume INT DEFAULT 0,
      status VARCHAR(20) DEFAULT 'todo',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 400 }
    );
  }

  const { siteId } = parsed.data;
  const sql = getSQL();

  try {
    await ensureContentPlanTable(sql);

    // 1. Collect opportunities: striking distance (pos 11-30), low CTR, gap keywords
    const strikingRows = await sql`
      SELECT
        query AS keyword,
        SUM(clicks)::int AS clicks,
        SUM(impressions)::int AS impressions,
        AVG(position)::float AS position,
        AVG(ctr)::float AS ctr
      FROM search_console_data
      WHERE site_id = ${siteId}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
      GROUP BY query
      HAVING AVG(position) BETWEEN 11 AND 30
        AND SUM(impressions) >= 100
      ORDER BY SUM(impressions) DESC
      LIMIT 50
    ` as { keyword: string; clicks: number; impressions: number; position: number; ctr: number }[];

    const lowCtrRows = await sql`
      SELECT
        query AS keyword,
        SUM(clicks)::int AS clicks,
        SUM(impressions)::int AS impressions,
        AVG(position)::float AS position,
        AVG(ctr)::float AS ctr
      FROM search_console_data
      WHERE site_id = ${siteId}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
      GROUP BY query
      HAVING AVG(position) <= 10
        AND AVG(ctr) < 0.03
        AND SUM(impressions) >= 200
      ORDER BY SUM(impressions) DESC
      LIMIT 30
    ` as { keyword: string; clicks: number; impressions: number; position: number; ctr: number }[];

    const opportunities: Opportunity[] = [
      ...strikingRows.map((r) => {
        const pos = Number(r.position);
        const imp = Number(r.impressions);
        const share = pos <= 20 ? 0.08 : 0.04;
        const volume = Math.round(imp / share);
        return { keyword: r.keyword, clicks: r.clicks, impressions: r.impressions, position: pos, volume, type: "striking" as const };
      }),
      ...lowCtrRows.map((r) => {
        const pos = Number(r.position);
        const imp = Number(r.impressions);
        const share = pos <= 3 ? 0.65 : pos <= 5 ? 0.48 : 0.25;
        const volume = Math.round(imp / share);
        return { keyword: r.keyword, clicks: r.clicks, impressions: r.impressions, position: pos, volume, type: "low_ctr" as const };
      }),
    ];

    // Deduplicate
    const seen = new Set<string>();
    const unique = opportunities.filter((o) => {
      if (seen.has(o.keyword)) return false;
      seen.add(o.keyword);
      return true;
    });

    const top30 = unique.sort((a, b) => b.volume - a.volume).slice(0, 30);

    if (top30.length === 0) {
      return NextResponse.json({ success: false, error: "Pas assez de données GSC pour générer un plan" }, { status: 400 });
    }

    // 2. Ask AI to generate titles + rationale for top 20
    const keywordList = top30.map((o) => `- "${o.keyword}" (vol: ${o.volume}, pos: ${o.position.toFixed(0)}, type: ${o.type})`).join("\n");

    const aiPrompt = `Tu es expert SEO. Pour chaque mot-clé ci-dessous, génère un titre d'article optimisé SEO et une justification courte. Réponds UNIQUEMENT en JSON valide: [{"keyword":"...","title":"...","rationale":"..."}]\n\nMots-clés:\n${keywordList}`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI timeout")), 30000)
    );

    let aiItems: { keyword: string; title: string; rationale: string }[] = [];
    try {
      const text = await Promise.race([
        askAI([{ role: "user", content: aiPrompt }], "smart", 3000),
        timeoutPromise,
      ]);
      const cleaned = text
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();
      aiItems = JSON.parse(cleaned) as typeof aiItems;
    } catch {
      aiItems = top30.map((o) => ({
        keyword: o.keyword,
        title: `Guide complet: ${o.keyword}`,
        rationale: o.type === "striking" ? "Position 11-30: une amélioration = page 1" : "CTR faible: optimiser le titre peut doubler le trafic",
      }));
    }

    // 3. Score + build top 20
    const aiMap: Record<string, { title: string; rationale: string }> = {};
    for (const item of aiItems) {
      aiMap[item.keyword] = { title: item.title, rationale: item.rationale };
    }

    const scored: ContentItem[] = top30.map((o) => {
      const difficultyScore = o.volume > 10000 ? 0.3 : o.volume > 3000 ? 0.6 : 0.9;
      const typeBonus = o.type === "striking" ? 1.5 : 1.0;
      const score = Math.round(o.volume * difficultyScore * typeBonus);
      const difficulty = o.volume > 10000 ? "hard" : o.volume > 3000 ? "medium" : "easy";
      const ai = aiMap[o.keyword];
      return {
        title: ai?.title ?? `Guide: ${o.keyword}`,
        target_keyword: o.keyword,
        score,
        rationale: ai?.rationale ?? "",
        volume: o.volume,
        difficulty,
      };
    }).sort((a, b) => b.score - a.score).slice(0, 20);

    // 4. Save to DB
    await sql`DELETE FROM content_plan_items WHERE site_id = ${siteId}`;

    for (const item of scored) {
      await sql`
        INSERT INTO content_plan_items (site_id, title, target_keyword, score, rationale, difficulty, volume, status)
        VALUES (${siteId}, ${item.title}, ${item.target_keyword}, ${item.score}, ${item.rationale}, ${item.difficulty}, ${item.volume}, 'todo')
      `;
    }

    const rows = await sql`
      SELECT * FROM content_plan_items WHERE site_id = ${siteId} ORDER BY score DESC LIMIT 20
    `;

    return NextResponse.json({ success: true, items: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
