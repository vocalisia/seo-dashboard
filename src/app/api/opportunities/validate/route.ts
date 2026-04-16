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

    const prompt = `I want to create a website about "${opp.niche}".

Core keywords: ${keywords.join(", ")}

Known competitors: ${competitors.map((c: { url: string; name: string }) => c.url || c.name).join(", ")}

TASK: Do a DEEP competitive analysis to determine if this niche is REALISTICALLY attackable.

Analyze for EACH core keyword:
1. What types of sites currently rank in top 10? (big brands, small blogs, forums, reddit, news sites, niche sites)
2. Are there WEAK results in the top 10-20? (reddit threads, quora answers, old articles from 2020, thin content, forums = EASY to beat)
3. What is the estimated Domain Rating (DR) of the top 3 ranking sites? (DR < 30 = easy, 30-50 = medium, > 50 = hard)
4. Is there a clear CONTENT GAP? (topics not well covered, outdated info, missing angles)
5. How long would it take a new site to reach page 1? (months estimate)

Then give an OVERALL VERDICT:

RESPOND IN STRICT JSON:
{
  "verdict": "GO" | "RISKY" | "NO_GO",
  "verdict_reason": "Clear explanation why",
  "attackability_score": 0-100,
  "time_to_page1_months": 6,
  "keyword_analysis": [
    {
      "keyword": "the keyword",
      "top_results_type": "mix of blogs and forums",
      "weak_results_found": true,
      "weak_results_examples": ["reddit thread ranking #4", "2019 article at #7"],
      "estimated_difficulty": "easy" | "medium" | "hard",
      "avg_competitor_dr": 35
    }
  ],
  "content_gaps": ["Gap 1: no one covers X angle", "Gap 2: all articles are outdated"],
  "strategy_recommendation": "Specific strategy to attack this niche",
  "quick_wins": ["Keyword 1 has reddit ranking = write better article", "Keyword 2 has thin content at #5"]
}

BE HONEST. If this niche is too competitive, say NO_GO. I prefer honest analysis over optimistic projections.`;

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
