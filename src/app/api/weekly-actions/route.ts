export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";

interface KwOpportunity {
  site_id: number;
  site_name: string;
  site_url: string;
  query: string;
  position: number;
  impressions: number;
  clicks: number;
  monthly_volume: number;
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

function shareAtPosition(pos: number): number {
  if (pos <= 1) return 0.90;
  if (pos <= 2) return 0.78;
  if (pos <= 3) return 0.65;
  if (pos <= 5) return 0.48;
  if (pos <= 7) return 0.35;
  if (pos <= 10) return 0.25;
  if (pos <= 15) return 0.14;
  if (pos <= 20) return 0.08;
  if (pos <= 30) return 0.04;
  if (pos <= 50) return 0.02;
  return 0.01;
}

function classifyAction(pos: number, monthlyVol: number): KwOpportunity["action_type"] {
  if (pos <= 3) return "maintain";
  if (pos <= 10) return "optimize";
  if (pos <= 20 && monthlyVol >= 100) return "push";
  if (pos <= 30 && monthlyVol >= 500) return "push";
  if (monthlyVol >= 1000) return "create";
  return "maintain";
}

export async function GET(_req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ success: false, error: "DB not configured", actions: [] }, { status: 503 });
  }

  try {
    const sql = getSQL();

    // Top opportunités: dernier 7j, position 4-30, volume estimé > 50/mois
    const rows = await sql`
      SELECT
        s.id AS site_id,
        s.name AS site_name,
        s.url AS site_url,
        gsc.query,
        ROUND(AVG(gsc.position)::numeric, 1) AS position,
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
      .map((r) => {
        const position = Number(r.position) || 0;
        const impressions = Number(r.impressions) || 0;
        const clicks = Number(r.clicks) || 0;
        // Weekly impressions → ~monthly
        const monthlyImpr = impressions * (30 / 7);
        const share = shareAtPosition(position);
        const monthlyVolume = share > 0 ? Math.round(monthlyImpr / share) : 0;
        // Potential gain if reaching top 3
        const potentialClicks = Math.max(0, Math.round(monthlyVolume * (ctrAtPosition(3) - ctrAtPosition(position))));
        return {
          site_id: Number(r.site_id),
          site_name: String(r.site_name),
          site_url: String(r.site_url),
          query: String(r.query),
          position,
          impressions,
          clicks,
          monthly_volume: monthlyVolume,
          potential_clicks: potentialClicks,
          action_type: classifyAction(position, monthlyVolume),
        };
      })
      .filter((o) => o.position >= 4 && o.position <= 30 && o.potential_clicks >= 20)
      .sort((a, b) => b.potential_clicks - a.potential_clicks)
      .slice(0, 10);

    // AI executive summary
    let aiSummary = "";
    if (opportunities.length > 0) {
      const summary = opportunities.slice(0, 5).map((o, i) =>
        `${i + 1}. "${o.query}" sur ${o.site_name} (pos ${o.position.toFixed(1)}, vol ${o.monthly_volume}/mois → +${o.potential_clicks} clics si top 3)`
      ).join("\n");

      const prompt = `Voici les 5 mots-clés prioritaires de la semaine pour notre portefeuille SEO multi-sites :

${summary}

Génère un PLAN D'ACTION HEBDO ULTRA-CONCRET (max 200 mots, en français) :
1. Top 3 actions à faire LUNDI matin (avec qui s'en occupe : SEO / rédacteur / dev)
2. Estimation du gain en clics/mois si tout est exécuté
3. 1 risque à surveiller cette semaine

Style: bullet points, marqueurs ✅ 🚀 ⚠️, pas de blabla.`;

      try {
        aiSummary = await askAI(
          [
            { role: "system", content: "Tu es un Head of SEO d'une agence française. Tu pilotes 17 sites et tu donnes des consignes claires à ton équipe chaque lundi matin." },
            { role: "user", content: prompt },
          ],
          "smart",
          800
        );
      } catch (e) {
        aiSummary = `Erreur IA : ${e instanceof Error ? e.message : "unknown"}`;
      }
    }

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      total_potential_clicks: opportunities.reduce((s, o) => s + o.potential_clicks, 0),
      actions: opportunities,
      ai_summary: aiSummary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
