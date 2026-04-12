export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";

interface NicheData {
  query: string;
  total_clicks: string;
  total_impressions: string;
  avg_position: string;
  site_count: string;
}

/**
 * POST /api/opportunities/scan
 *
 * Scans all GSC data + Perplexity market research to find untapped niches
 * where creating a NEW dedicated site/blog could capture significant traffic.
 *
 * Returns scored opportunities with traffic projections.
 */
export async function POST() {
  const sql = getSQL();

  try {
    // 1. Aggregate keyword themes across ALL sites (find cross-site patterns)
    const nicheData = (await sql`
      SELECT
        query,
        SUM(clicks) AS total_clicks,
        SUM(impressions) AS total_impressions,
        AVG(position) AS avg_position,
        COUNT(DISTINCT site_id) AS site_count
      FROM search_console_data
      WHERE date >= NOW() - INTERVAL '30 days'
        AND query IS NOT NULL
        AND country IS NULL
        AND impressions >= 10
      GROUP BY query
      ORDER BY SUM(impressions) DESC
      LIMIT 100
    `) as NicheData[];

    // 2. Get existing site names to know what's already covered
    const sites = await sql`SELECT name, url FROM sites WHERE is_active = true`;
    const siteNames = sites.map((s) => `${s.name} (${s.url})`).join(", ");

    // 3. Build keyword themes (top 50 by impressions)
    const topKeywords = nicheData
      .slice(0, 50)
      .map((n) => `"${n.query}" (${n.total_impressions} impr, pos ${parseFloat(n.avg_position).toFixed(1)}, ${n.site_count} sites)`)
      .join("\n");

    // 4. Ask Perplexity for market opportunities
    const prompt = `I own these websites: ${siteNames}

My sites cover: voice AI, Tesla/EV magazine, CBD Europe, crypto/trust, business Switzerland, sales training, AI hub, AI agents, lead generation, SEO tools, beauty/fashion.

My top 50 keywords across all sites (with impressions and position):
${topKeywords}

TASK: Analyze my current portfolio and identify 8-10 NEW BUSINESS OPPORTUNITIES where I should create a DEDICATED website, blog, magazine, or e-commerce store.

CRITICAL RULES:
- DIVERSIFY across DIFFERENT sectors (NOT all in the same niche)
- Each opportunity must be in a DIFFERENT industry/sector
- Cover a MIX of: health/wellness, education, real estate, food/nutrition, travel, legal, insurance, SaaS tools, finance (non-crypto), B2B services, lifestyle, tech, automotive, energy, fitness, parenting, pets, home improvement
- Maximum 2 opportunities related to existing niches (AI, crypto, CBD)
- The rest MUST be in completely NEW sectors

For each opportunity:
1. The niche/market (be specific and UNIQUE from other opportunities)
2. Why it's an opportunity (gap in my portfolio, growing market, connection to existing sites)
3. Recommended site type: blog | magazine | e-commerce | saas | directory
4. Estimated monthly search volume for the core keywords (be realistic, based on real search data)
5. Competition level: low | medium | high
6. Monetization model: ads | affiliate | e-commerce | subscription | lead-gen
7. Estimated monthly traffic at 6 months (realistic projection)
8. Estimated monthly revenue potential (EUR)
9. Suggested domain name (2-3 options, .com or .ch or .fr)
10. First 5 article titles to seed the site

RESPOND IN STRICT JSON ONLY:
{
  "opportunities": [
    {
      "niche": "Specific niche name",
      "reason": "Why this is a good opportunity",
      "site_type": "blog",
      "core_keywords": ["kw1", "kw2", "kw3"],
      "monthly_volume": 50000,
      "competition": "medium",
      "monetization": "affiliate",
      "projected_traffic_6m": 5000,
      "projected_revenue_6m": 1500,
      "suggested_domains": ["domain1.com", "domain2.ch"],
      "seed_articles": ["Title 1", "Title 2", "Title 3", "Title 4", "Title 5"],
      "confidence_score": 85
    }
  ]
}

Rules:
- Only suggest niches NOT already covered by my current sites
- monthly_volume must be >= 10000 for the combined core keywords
- Be realistic with projections (not overly optimistic)
- confidence_score: 0-100 based on data quality and market viability
- Sort by confidence_score DESC`;

    let aiResponse = "";
    try {
      aiResponse = await askAI([{ role: "user", content: prompt }], "search", 4000);
    } catch (err) {
      console.error("Opportunity scan failed:", err);
      return NextResponse.json({ success: false, error: "AI research failed" });
    }

    // 5. Parse response
    const cleaned = aiResponse
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    let parsed: {
      opportunities: {
        niche: string;
        reason: string;
        site_type: string;
        core_keywords: string[];
        monthly_volume: number;
        competition: string;
        monetization: string;
        projected_traffic_6m: number;
        projected_revenue_6m: number;
        suggested_domains: string[];
        seed_articles: string[];
        confidence_score: number;
      }[];
    };

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ success: false, error: "AI returned invalid JSON", raw: cleaned.slice(0, 1000) });
    }

    // 6. Store in DB
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS market_opportunities (
          id SERIAL PRIMARY KEY,
          niche VARCHAR(200),
          reason TEXT,
          site_type VARCHAR(50),
          core_keywords JSONB,
          monthly_volume INTEGER,
          competition VARCHAR(20),
          monetization VARCHAR(50),
          projected_traffic_6m INTEGER,
          projected_revenue_6m INTEGER,
          suggested_domains JSONB,
          seed_articles JSONB,
          confidence_score INTEGER,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `;

      // Clear old scan
      await sql`DELETE FROM market_opportunities WHERE status = 'pending'`;

      for (const opp of (parsed.opportunities || [])) {
        await sql`
          INSERT INTO market_opportunities
          (niche, reason, site_type, core_keywords, monthly_volume, competition, monetization,
           projected_traffic_6m, projected_revenue_6m, suggested_domains, seed_articles, confidence_score)
          VALUES (${opp.niche}, ${opp.reason}, ${opp.site_type}, ${JSON.stringify(opp.core_keywords)},
                  ${opp.monthly_volume}, ${opp.competition}, ${opp.monetization},
                  ${opp.projected_traffic_6m}, ${opp.projected_revenue_6m},
                  ${JSON.stringify(opp.suggested_domains)}, ${JSON.stringify(opp.seed_articles)},
                  ${opp.confidence_score})
        `;
      }
    } catch (err) {
      console.error("Failed to store opportunities:", err);
    }

    return NextResponse.json({
      success: true,
      opportunities: parsed.opportunities || [],
      keywords_analyzed: nicheData.length,
      sites_analyzed: sites.length,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}

/**
 * GET /api/opportunities/scan — Returns cached opportunities from DB
 */
export async function GET() {
  const sql = getSQL();
  try {
    const rows = await sql`
      SELECT * FROM market_opportunities
      ORDER BY confidence_score DESC
    `;
    return NextResponse.json({ success: true, opportunities: rows });
  } catch {
    return NextResponse.json({ success: true, opportunities: [] });
  }
}
