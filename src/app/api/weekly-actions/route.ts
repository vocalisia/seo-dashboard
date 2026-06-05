export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { askAICached } from "@/lib/ai-cache";
import { requireApiSession } from "@/lib/api-auth";

interface KwOpportunity {
  site_id: number;
  site_name: string;
  site_url: string;
  query: string;
  position: number;
  impressions: number;
  clicks: number;
  monthly_impressions: number;
  potential_clicks: number;
  action_type: "push" | "optimize" | "maintain" | "create";
}

function ctrAtPosition(pos: number): number {
  if (pos <= 1) return 0.32;
  if (pos <= 2) return 0.18;
  if (pos <= 3) return 0.12;
  if (pos <= 5) return 0.07;
  if (pos <= 7) return 0.04;
  if (pos <= 10) return 0.025;
  if (pos <= 15) return 0.012;
  if (pos <= 20) return 0.006;
  if (pos <= 30) return 0.003;
  return 0.001;
}

function classifyAction(pos: number, monthlyImpressions: number): KwOpportunity["action_type"] {
  if (pos <= 3) return "maintain";
  if (pos <= 10) return "optimize";
  if (pos <= 20 && monthlyImpressions >= 100) return "push";
  if (pos <= 30 && monthlyImpressions >= 500) return "push";
  if (monthlyImpressions >= 1000) return "create";
  return "maintain";
}

function buildLocalSummary(opportunities: KwOpportunity[]): string {
  if (opportunities.length === 0) return "";
  return [
    "Plan d'action hebdo:",
    ...opportunities.slice(0, 3).map((o, i) =>
      `${i + 1}. ${o.site_name}: travailler "${o.query}" (pos ${o.position.toFixed(1)}, potentiel +${o.potential_clicks} clics/mois sur impressions GSC).`
    ),
    `Gain total estime: +${opportunities.reduce((sum, o) => sum + o.potential_clicks, 0).toLocaleString()} clics/mois si les quick wins passent top 3.`,
    "Risque: verifier que la page cible correspond bien a l'intention avant de modifier title/contenu.",
  ].join("\n");
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ success: false, error: "DB not configured", actions: [] }, { status: 503 });
  }

  const headers = () => ({
    "X-Response-Time": `${Date.now() - startedAt}ms`,
    "Server-Timing": `app;dur=${Date.now() - startedAt}`,
  });

  try {
    const sql = getSQL();
    const rows = await sql`
      SELECT
        s.id AS site_id,
        s.name AS site_name,
        s.url AS site_url,
        gsc.query,
        ROUND((SUM(gsc.position * gsc.impressions)::numeric / NULLIF(SUM(gsc.impressions), 0)), 1) AS position,
        SUM(gsc.impressions) AS impressions,
        SUM(gsc.clicks) AS clicks
      FROM search_console_data gsc
      JOIN sites s ON s.id = gsc.site_id
      WHERE gsc.date >= CURRENT_DATE - 7
        AND s.is_active = true
        AND gsc.query IS NOT NULL
      GROUP BY s.id, s.name, s.url, gsc.query
      HAVING SUM(gsc.impressions) >= 10
      ORDER BY SUM(gsc.impressions) DESC
      LIMIT 500
    `;

    const opportunities: KwOpportunity[] = (rows as Array<Record<string, unknown>>)
      .map((row) => {
        const position = Number(row.position) || 0;
        const impressions = Number(row.impressions) || 0;
        const clicks = Number(row.clicks) || 0;
        const monthlyImpressions = impressions * (30 / 7);
        const potentialClicks = Math.max(0, Math.round(monthlyImpressions * (ctrAtPosition(3) - ctrAtPosition(position))));
        return {
          site_id: Number(row.site_id),
          site_name: String(row.site_name),
          site_url: String(row.site_url),
          query: String(row.query),
          position,
          impressions,
          clicks,
          monthly_impressions: Math.round(monthlyImpressions),
          potential_clicks: potentialClicks,
          action_type: classifyAction(position, monthlyImpressions),
        };
      })
      .filter((o) => o.position >= 4 && o.position <= 30 && o.potential_clicks >= 20)
      .sort((a, b) => b.potential_clicks - a.potential_clicks)
      .slice(0, 10);

    let aiSummary = buildLocalSummary(opportunities);
    if (req.nextUrl.searchParams.get("ai") === "1" && opportunities.length > 0) {
      try {
        const prompt = `Voici les mots-cles prioritaires:\n\n${opportunities.slice(0, 5).map((o, i) =>
          `${i + 1}. "${o.query}" sur ${o.site_name} (pos ${o.position.toFixed(1)}, impressions mensuelles GSC ${o.monthly_impressions}, potentiel +${o.potential_clicks})`
        ).join("\n")}\n\nGenere un plan d'action SEO hebdo concret en francais, max 200 mots.`;
        const today = new Date().toISOString().slice(0, 10);
        const signature = opportunities.slice(0, 5).map((o) => `${o.site_id}:${o.query}`).join("|");
        const { reply } = await askAICached({
          cacheKey: `weekly-actions:${today}:${signature}`,
          messages: [{ role: "user", content: prompt }],
          model: "smart",
          maxTokens: 800,
        });
        aiSummary = reply;
      } catch {
        // Keep local deterministic summary.
      }
    }

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      total_potential_clicks: opportunities.reduce((sum, o) => sum + o.potential_clicks, 0),
      actions: opportunities,
      ai_summary: aiSummary,
    }, { headers: headers() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message, actions: [] }, { status: 500 });
  }
}
