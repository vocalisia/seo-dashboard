import { getSQL, initDB } from "@/lib/db";
import { NextResponse } from "next/server";
import { askAI } from "@/lib/ai";

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function analyzeWithAI(siteName: string, siteUrl: string, data: {
  topQueries: { query: string; clicks: number; impressions: number; position: number }[];
  gains: { query: string; gain: number; position_now: number }[];
  losses: { query: string; gain: number; position_now: number }[];
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
}) {
  const prompt = `Tu es un expert SEO. Analyse les données Google Search Console de la semaine pour le site "${siteName}" (${siteUrl}) et génère un rapport actionnable en français.

## Données de la semaine :
- Clics totaux : ${data.totalClicks}
- Impressions totales : ${data.totalImpressions}
- Position moyenne : ${data.avgPosition.toFixed(1)}

## Top 10 mots clés (clics) :
${data.topQueries.slice(0, 10).map(q => `- "${q.query}" : pos ${q.position.toFixed(1)}, ${q.clicks} clics, ${q.impressions} impressions`).join('\n')}

## Gains de position cette semaine (top 5) :
${data.gains.slice(0, 5).map(g => `- "${g.query}" : +${g.gain} positions → maintenant pos ${g.position_now}`).join('\n') || "Aucun gain significatif"}

## Pertes de position cette semaine (top 5) :
${data.losses.slice(0, 5).map(g => `- "${g.query}" : ${g.gain} positions → maintenant pos ${g.position_now}`).join('\n') || "Aucune perte significative"}

## Opportunités (pos 11-20, nombreuses impressions) :
${data.topQueries.filter(q => q.position >= 11 && q.position <= 20).slice(0, 5).map(q => `- "${q.query}" : pos ${q.position.toFixed(1)}, ${q.impressions} impressions`).join('\n') || "Aucune"}

Génère un rapport structuré avec :
1. **Résumé de la semaine** (2-3 phrases)
2. **Actions prioritaires** (3-5 actions concrètes avec quel contenu créer/optimiser et pour quel mot clé)
3. **Textes SEO à produire** (titre d'article ou de page + mot clé cible + pourquoi maintenant)

Sois très concret et actionnable. Format markdown.`;

  return await askAI([{ role: "user", content: prompt }], "smart", 1500);
}

export async function POST() {
  try {
    await initDB(); // ensure weekly_reports table exists
    const sql = getSQL();
    const sites = await sql`SELECT * FROM sites WHERE is_active = true`;

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const results = [];

    for (const site of sites) {
      try {
        // Données 7 derniers jours
        const topQueries = await sql`
          SELECT query,
            SUM(clicks) as clicks,
            SUM(impressions) as impressions,
            AVG(position) as position
          FROM search_console_data
          WHERE site_id = ${site.id}
            AND date >= NOW() - INTERVAL '7 days'
            AND query IS NOT NULL
          GROUP BY query
          ORDER BY SUM(clicks) DESC
          LIMIT 50
        `;

        if (topQueries.length === 0) {
          results.push({ site: site.name, status: "no_data" });
          continue;
        }

        // Gains/pertes semaine vs semaine
        const gainRows = await sql`
          WITH cur AS (
            SELECT query, AVG(position) as pos_now
            FROM search_console_data
            WHERE site_id = ${site.id} AND date >= NOW() - INTERVAL '7 days' AND query IS NOT NULL
            GROUP BY query
          ),
          prev AS (
            SELECT query, AVG(position) as pos_prev
            FROM search_console_data
            WHERE site_id = ${site.id}
              AND date >= NOW() - INTERVAL '14 days'
              AND date < NOW() - INTERVAL '7 days'
              AND query IS NOT NULL
            GROUP BY query
          )
          SELECT c.query,
            ROUND((p.pos_prev - c.pos_now)::numeric, 1) as gain,
            ROUND(c.pos_now::numeric, 1) as position_now
          FROM cur c JOIN prev p ON p.query = c.query
          WHERE ABS(p.pos_prev - c.pos_now) > 0.5
          ORDER BY gain DESC
          LIMIT 20
        `;

        const gains = gainRows.filter(g => Number(g.gain) > 0).map(g => ({
          query: g.query, gain: Number(g.gain), position_now: Number(g.position_now)
        }));
        const losses = gainRows.filter(g => Number(g.gain) < 0).map(g => ({
          query: g.query, gain: Number(g.gain), position_now: Number(g.position_now)
        }));

        const totalClicks = topQueries.reduce((s: number, q: Record<string, unknown>) => s + Number(q.clicks), 0);
        const totalImpressions = topQueries.reduce((s: number, q: Record<string, unknown>) => s + Number(q.impressions), 0);
        const avgPos = topQueries.reduce((s: number, q: Record<string, unknown>) => s + Number(q.position), 0) / topQueries.length;

        const opportunities = topQueries
          .filter((q: Record<string, unknown>) => Number(q.position) >= 11 && Number(q.position) <= 20)
          .slice(0, 5)
          .map((q: Record<string, unknown>) => ({
            query: String(q.query), impressions: Number(q.impressions), position: Number(q.position)
          }));

        const aiReport = await analyzeWithAI(site.name, site.url, {
          topQueries: topQueries.map((q: Record<string, unknown>) => ({
            query: String(q.query), clicks: Number(q.clicks), impressions: Number(q.impressions), position: Number(q.position)
          })),
          gains, losses, totalClicks, totalImpressions, avgPosition: avgPos,
        });

        await sql`
          INSERT INTO weekly_reports (site_id, week_start, summary, recommendations, top_opportunities)
          VALUES (
            ${site.id}, ${weekStartStr},
            ${`Semaine du ${weekStartStr} — ${totalClicks} clics, ${totalImpressions} impressions, position moy. ${avgPos.toFixed(1)}`},
            ${aiReport || "Rapport non disponible (clé OpenAI manquante)"},
            ${JSON.stringify(opportunities)}
          )
          ON CONFLICT (site_id, week_start) DO UPDATE SET
            summary = EXCLUDED.summary,
            recommendations = EXCLUDED.recommendations,
            top_opportunities = EXCLUDED.top_opportunities,
            created_at = NOW()
        `;

        results.push({ site: site.name, status: "ok", clicks: totalClicks });
      } catch (err: unknown) {
        results.push({ site: site.name, status: "error", error: err instanceof Error ? err.message : "Unknown" });
      }
    }

    return NextResponse.json({ success: true, week: weekStartStr, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
