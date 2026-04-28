export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";

/**
 * POST /api/opportunities/validate
 * body: { opportunity_id: number }
 *
 * Deep validation of a niche opportunity:
 * 1. Asks Perplexity to analyze the SERP for core keywords
 * 2. Checks if competitors are beatable (forum/reddit ranking = easy)
 * 3. Evaluates content gaps
 * 4. Returns a GO / RISKY / NO-GO verdict
 */
export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  let body: { opportunity_id?: number };
  try {
    body = (await req.json()) as { opportunity_id?: number };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { opportunity_id } = body;
  if (!opportunity_id) {
    return NextResponse.json({ success: false, error: "opportunity_id required" }, { status: 400 });
  }

  const sql = getSQL();

  try {
    const rows = await sql`SELECT * FROM market_opportunities WHERE id = ${opportunity_id} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    const opp = rows[0];
    const keywords = Array.isArray(opp.core_keywords) ? opp.core_keywords : JSON.parse(opp.core_keywords as string);
    const competitors = opp.competitors ? (Array.isArray(opp.competitors) ? opp.competitors : JSON.parse(opp.competitors as string)) : [];

    const prompt = `Je veux créer un site sur "${opp.niche}".

Mots-clés principaux : ${keywords.join(", ")}

Concurrents connus : ${competitors.map((c: { url: string; name: string }) => c.url || c.name).join(", ")}

MISSION : Fais une analyse concurrentielle APPROFONDIE pour savoir si cette niche est ATTAQUABLE de manière réaliste.

Pour CHAQUE mot-clé principal, analyse :
1. Quels types de sites rankent actuellement dans le top 10 ? (grosses marques, petits blogs, forums, Reddit, sites d'actu, sites de niche)
2. Y a-t-il des résultats FAIBLES dans le top 10-20 ? (threads Reddit, réponses Quora, articles vieux de 2020, contenu mince, forums = FACILES à battre)
3. Quel est le Domain Rating (DR) estimé des 3 sites du top 3 ? (DR < 30 = facile, 30-50 = moyen, > 50 = difficile)
4. Y a-t-il un GAP DE CONTENU clair ? (sujets mal couverts, infos obsolètes, angles manquants)
5. Combien de temps faudrait-il à un nouveau site pour atteindre la page 1 ? (estimation en mois)

Donne ensuite un VERDICT GLOBAL.

⚠️ TOUTES LES RÉPONSES TEXTE DOIVENT ÊTRE EN FRANÇAIS NATUREL.

Réponds en JSON STRICT :
{
  "verdict": "GO" | "RISKY" | "NO_GO",
  "verdict_reason": "Explication claire EN FRANÇAIS",
  "attackability_score": 0-100,
  "time_to_page1_months": 6,
  "keyword_analysis": [
    {
      "keyword": "le mot-clé",
      "top_results_type": "mélange blogs et forums (en français)",
      "weak_results_found": true,
      "weak_results_examples": ["thread Reddit en position 4", "article de 2019 en position 7"],
      "estimated_difficulty": "easy" | "medium" | "hard",
      "avg_competitor_dr": 35
    }
  ],
  "content_gaps": ["Gap 1 : personne ne couvre l'angle X", "Gap 2 : tous les articles sont obsolètes"],
  "strategy_recommendation": "Stratégie spécifique en français pour attaquer cette niche",
  "quick_wins": ["Mot-clé 1 a un ranking Reddit = écrire un meilleur article", "Mot-clé 2 a du contenu mince en position 5"]
}

SOIS HONNÊTE. Si la niche est trop compétitive, dis NO_GO. Je préfère une analyse honnête à des projections optimistes.`;

    let aiResponse = "";
    try {
      aiResponse = await askAI([{ role: "user", content: prompt }], "search", 3000);
    } catch (err) {
      return NextResponse.json(
        { success: false, error: "AI analysis failed: " + (err instanceof Error ? err.message : "unknown") },
        { status: 502 }
      );
    }

    const cleaned = aiResponse
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ success: false, error: "AI returned invalid JSON", raw: cleaned.slice(0, 1000) });
    }

    // Store validation result
    try {
      await sql`
        ALTER TABLE market_opportunities ADD COLUMN IF NOT EXISTS validation JSONB
      `;
      await sql`
        UPDATE market_opportunities
        SET validation = ${JSON.stringify(analysis)}
        WHERE id = ${opportunity_id}
      `;
    } catch (err) {
      console.error("Failed to store validation:", err);
    }

    return NextResponse.json({
      success: true,
      niche: opp.niche,
      ...analysis,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
