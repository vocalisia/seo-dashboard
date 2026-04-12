export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";

interface Site {
  id: number;
  name: string;
  url: string;
}

interface CompetitorData {
  domain: string;
  description: string;
  keywords: { keyword: string; volume: number; position: number }[];
}

/**
 * POST /api/competitors
 * body: { site_id: number }
 *
 * Uses Perplexity (via Mammouth) to:
 * 1. Find 5-10 direct competitors
 * 2. Extract their top keywords with estimated volume
 * 3. Compare with our GSC keywords
 * 4. Return gaps (keywords where competitor ranks but we don't, volume >= 1000)
 */
export async function POST(req: NextRequest) {
  let body: { site_id?: number };
  try {
    body = (await req.json()) as { site_id?: number };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { site_id } = body;
  if (!site_id) {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();

  try {
    // 1. Get site info
    const sites = (await sql`SELECT * FROM sites WHERE id = ${site_id} LIMIT 1`) as Site[];
    if (sites.length === 0) {
      return NextResponse.json({ success: false, error: "Site not found" }, { status: 404 });
    }
    const site = sites[0];

    // 2. Get our current keywords from GSC
    const ourKeywords = (await sql`
      SELECT query,
             SUM(clicks) AS clicks,
             SUM(impressions) AS impressions,
             AVG(position) AS position
      FROM search_console_data
      WHERE site_id = ${site_id}
        AND date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
      GROUP BY query
      ORDER BY SUM(impressions) DESC
      LIMIT 100
    `) as { query: string; clicks: string; impressions: string; position: string }[];

    const ourTopKeywords = ourKeywords.slice(0, 20).map((k) => k.query).join(", ");
    const ourKeywordSet = new Set(ourKeywords.map((k) => k.query.toLowerCase()));

    // 3. Ask Perplexity to find competitors + their keywords
    const competitorPrompt = `Analyse the website ${site.url} (${site.name}).

TASK 1: Find the 5-8 direct competitors of this website. These are sites targeting the same audience and topics.

TASK 2: For each competitor, list their top 10-15 keywords that:
- Have estimated monthly search volume >= 1000
- Are commercially relevant
- The competitor ranks in top 20 for

TASK 3: Our site currently ranks for these keywords: ${ourTopKeywords || "unknown"}
Identify GAPS = keywords where competitors rank well but "${site.url}" does NOT appear in top 30.

RESPOND IN STRICT JSON FORMAT ONLY (no markdown, no explanation):
{
  "competitors": [
    {
      "domain": "competitor1.com",
      "description": "Brief description of what they do"
    }
  ],
  "keyword_gaps": [
    {
      "keyword": "the keyword phrase",
      "volume": 2500,
      "competitor": "competitor1.com",
      "competitor_position": 5,
      "difficulty": "medium",
      "intent": "informational|commercial|transactional"
    }
  ]
}

Rules:
- volume MUST be >= 1000 monthly searches (estimate based on your knowledge)
- Only include keywords genuinely relevant to ${site.name}
- Sort keyword_gaps by volume DESC
- Maximum 30 keyword gaps
- Be accurate with volume estimates`;

    let aiResponse = "";
    try {
      aiResponse = await askAI(
        [{ role: "user", content: competitorPrompt }],
        "search",
        3000
      );
    } catch (err) {
      console.error("Perplexity competitor research failed:", err);
      return NextResponse.json({ success: false, error: "AI research failed — check Mammouth budget" });
    }

    // 4. Parse JSON response
    // Strip markdown code block if present
    const cleaned = aiResponse
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    let parsed: {
      competitors: { domain: string; description: string }[];
      keyword_gaps: {
        keyword: string;
        volume: number;
        competitor: string;
        competitor_position: number;
        difficulty: string;
        intent: string;
      }[];
    };

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse competitor JSON:", cleaned.slice(0, 500));
      return NextResponse.json({
        success: false,
        error: "AI returned invalid JSON — retry",
        raw: cleaned.slice(0, 1000),
      });
    }

    // 5. Filter gaps: volume >= 1000, not in our keywords
    const filteredGaps = (parsed.keyword_gaps || [])
      .filter((g) => g.volume >= 1000 && !ourKeywordSet.has(g.keyword.toLowerCase()))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 30);

    // 6. Store competitors in DB (create table if needed)
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS competitor_research (
          id SERIAL PRIMARY KEY,
          site_id INTEGER REFERENCES sites(id),
          competitor_domain VARCHAR(500),
          competitor_description TEXT,
          keyword VARCHAR(500),
          estimated_volume INTEGER,
          competitor_position DECIMAL(6,2),
          difficulty VARCHAR(20),
          intent VARCHAR(30),
          researched_at TIMESTAMP DEFAULT NOW()
        )
      `;
      // Clear old research for this site
      await sql`DELETE FROM competitor_research WHERE site_id = ${site_id}`;

      for (const gap of filteredGaps) {
        await sql`
          INSERT INTO competitor_research
          (site_id, competitor_domain, keyword, estimated_volume, competitor_position, difficulty, intent)
          VALUES (${site_id}, ${gap.competitor}, ${gap.keyword}, ${gap.volume},
                  ${gap.competitor_position}, ${gap.difficulty}, ${gap.intent})
        `;
      }
    } catch (err) {
      console.error("Failed to store competitor research:", err);
    }

    return NextResponse.json({
      success: true,
      site: site.name,
      competitors: parsed.competitors || [],
      gaps: filteredGaps,
      our_keywords_count: ourKeywords.length,
      total_gaps: filteredGaps.length,
      min_volume: 1000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Competitor research error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * GET /api/competitors?site_id=X
 * Returns cached competitor research from DB
 */
export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("site_id");
  if (!siteId) {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();
  try {
    const rows = await sql`
      SELECT * FROM competitor_research
      WHERE site_id = ${parseInt(siteId, 10)}
      ORDER BY estimated_volume DESC
    `;

    // Group by competitor
    const competitorMap: Record<string, { domain: string; keywords: typeof rows }> = {};
    for (const row of rows) {
      const domain = row.competitor_domain as string;
      if (!competitorMap[domain]) {
        competitorMap[domain] = { domain, keywords: [] };
      }
      competitorMap[domain].keywords.push(row);
    }

    return NextResponse.json({
      success: true,
      gaps: rows,
      competitors: Object.values(competitorMap),
      total: rows.length,
    });
  } catch {
    return NextResponse.json({ success: true, gaps: [], competitors: [], total: 0 });
  }
}
