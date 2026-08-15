export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { normalizeSeoTitle } from "@/lib/autopilot-utils";
import { requireApiSession } from "@/lib/api-auth";
import { z } from "zod";

const BodySchema = z.object({
  siteId: z.number().int().positive(),
});

type OpportunityType = "striking" | "low_ctr";

interface Opportunity {
  keyword: string;
  target_url: string | null;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
  type: OpportunityType;
}

interface ContentItem {
  title: string;
  target_keyword: string;
  target_url: string | null;
  action_type: "refresh_existing" | "improve_snippet";
  opportunity_type: OpportunityType;
  score: number;
  rationale: string;
  clicks: number;
  impressions: number;
  position: number;
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
      difficulty VARCHAR(20) DEFAULT 'unknown',
      volume INT DEFAULT 0,
      status VARCHAR(20) DEFAULT 'todo',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE content_plan_items ALTER COLUMN difficulty SET DEFAULT 'unknown'`;
  await sql`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS target_url TEXT`;
  await sql`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS action_type VARCHAR(40)`;
  await sql`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS opportunity_type VARCHAR(40)`;
  await sql`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS clicks INT DEFAULT 0`;
  await sql`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS impressions INT DEFAULT 0`;
  await sql`ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS position FLOAT`;
}

export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;
  const parsedSiteId = Number(req.nextUrl.searchParams.get("siteId"));
  if (!Number.isInteger(parsedSiteId) || parsedSiteId <= 0) {
    return NextResponse.json({ success: false, error: "siteId must be a positive integer" }, { status: 400 });
  }
  try {
    const sql = getSQL();
    await ensureContentPlanTable(sql);
    const rows = await sql`
      SELECT * FROM content_plan_items WHERE site_id = ${parsedSiteId} ORDER BY score DESC LIMIT 20
    `;
    return NextResponse.json({
      success: true,
      items: rows,
      source: "saved_gsc_plan",
      methodology: "Plan sauvegardé issu des mesures GSC des 30 jours disponibles au moment de sa dernière génération.",
    });
  } catch (reason) {
    return NextResponse.json({ success: false, error: reason instanceof Error ? reason.message : "Unable to read content plan" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { siteId } = parsed.data;
  const sql = getSQL();

  try {
    await ensureContentPlanTable(sql);

    const queryPages = await sql`
      WITH aggregated AS (
        SELECT
          query AS keyword,
          page AS target_url,
          SUM(clicks)::int AS clicks,
          SUM(impressions)::int AS impressions,
          (SUM(impressions * position)::float / NULLIF(SUM(impressions), 0)) AS position,
          (SUM(clicks)::float / NULLIF(SUM(impressions), 0)) AS ctr
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND date >= NOW() - INTERVAL '30 days'
          AND query IS NOT NULL
          AND page IS NOT NULL
        GROUP BY query, page
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY keyword ORDER BY impressions DESC, clicks DESC) AS page_rank
        FROM aggregated
      )
      SELECT keyword, target_url, clicks, impressions, position, ctr
      FROM ranked
      WHERE page_rank = 1
      ORDER BY impressions DESC
      LIMIT 250
    ` as Array<{ keyword: string; target_url: string | null; clicks: number; impressions: number; position: number; ctr: number }>;

    const opportunities: Opportunity[] = [];
    for (const row of queryPages) {
      const position = Number(row.position);
      const impressions = Number(row.impressions);
      const ctr = Number(row.ctr);
      if (position >= 11 && position <= 30 && impressions >= 100) {
        opportunities.push({ ...row, clicks: Number(row.clicks), impressions, position, ctr, type: "striking" });
      } else if (position <= 10 && ctr < 0.03 && impressions >= 200) {
        opportunities.push({ ...row, clicks: Number(row.clicks), impressions, position, ctr, type: "low_ctr" });
      }
    }

    const top = opportunities
      .sort((left, right) => {
        const leftScore = left.impressions * (left.type === "striking" ? 1.5 : 1);
        const rightScore = right.impressions * (right.type === "striking" ? 1.5 : 1);
        return rightScore - leftScore;
      })
      .slice(0, 20);

    if (top.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Pas assez de données GSC pour proposer une action fiable sur les 30 derniers jours.",
      }, { status: 422 });
    }

    const items: ContentItem[] = top.map((opportunity) => {
      const actionType = opportunity.type === "striking" ? "refresh_existing" : "improve_snippet";
      const rationale = opportunity.type === "striking"
        ? `Requête GSC en position moyenne ${opportunity.position.toFixed(1)} avec ${opportunity.impressions} impressions observées sur 30 jours. Renforcer la page déjà positionnée avant de créer une nouvelle URL.`
        : `Requête GSC en position moyenne ${opportunity.position.toFixed(1)}, avec ${(opportunity.ctr * 100).toFixed(1)} % de CTR et ${opportunity.impressions} impressions sur 30 jours. Tester d'abord le title et la meta description de la page existante.`;
      return {
        title: normalizeSeoTitle(opportunity.keyword, opportunity.keyword),
        target_keyword: opportunity.keyword,
        target_url: opportunity.target_url,
        action_type: actionType,
        opportunity_type: opportunity.type,
        score: Math.round(opportunity.impressions * (opportunity.type === "striking" ? 1.5 : 1)),
        rationale,
        clicks: opportunity.clicks,
        impressions: opportunity.impressions,
        position: opportunity.position,
      };
    });

    const existingRows = await sql`
      SELECT LOWER(target_keyword) AS target_keyword, status
      FROM content_plan_items
      WHERE site_id = ${siteId}
    ` as Array<{ target_keyword: string; status: string }>;
    const existingStatus = new Map(existingRows.map((row) => [row.target_keyword, row.status]));

    await sql`DELETE FROM content_plan_items WHERE site_id = ${siteId}`;

    for (const item of items) {
      const previousStatus = existingStatus.get(item.target_keyword.toLowerCase());
      const status = previousStatus === "doing" || previousStatus === "done" ? previousStatus : "todo";
      await sql`
        INSERT INTO content_plan_items (
          site_id, title, target_keyword, target_url, action_type, opportunity_type,
          score, rationale, difficulty, volume, clicks, impressions, position, status
        ) VALUES (
          ${siteId}, ${item.title}, ${item.target_keyword}, ${item.target_url}, ${item.action_type}, ${item.opportunity_type},
          ${item.score}, ${item.rationale}, 'unknown', 0, ${item.clicks}, ${item.impressions}, ${item.position}, ${status}
        )
      `;
    }

    const rows = await sql`
      SELECT * FROM content_plan_items WHERE site_id = ${siteId} ORDER BY score DESC LIMIT 20
    `;

    return NextResponse.json({
      success: true,
      items: rows,
      source: "gsc_30d",
      methodology: "Score = impressions GSC x 1,5 pour les positions 11-30, sinon impressions GSC. Aucune difficulté SEO ni volume non sourcé n'est inventé.",
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
