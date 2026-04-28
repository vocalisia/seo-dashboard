export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { requireCronSecret } from "@/lib/cron-auth";

interface Site {
  id: number;
  name: string;
  url: string;
}

/**
 * POST /api/competitors/weekly — Vercel cron every Monday 7am
 * Runs competitor research for ALL active sites with GSC data.
 * Stores results in competitor_research table.
 */
export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const sql = getSQL();

  try {
    // Ensure table exists
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

    // Get active sites with GSC data
    const sites = (await sql`
      SELECT DISTINCT s.id, s.name, s.url
      FROM sites s
      INNER JOIN search_console_data scd ON scd.site_id = s.id
      WHERE s.is_active = true
        AND scd.date >= NOW() - INTERVAL '30 days'
      ORDER BY s.id
    `) as Site[];

    const results = [];

    for (const site of sites) {
      try {
        // Get our top keywords
        const ourKw = (await sql`
          SELECT query FROM search_console_data
          WHERE site_id = ${site.id} AND date >= NOW() - INTERVAL '30 days' AND query IS NOT NULL
          GROUP BY query ORDER BY SUM(impressions) DESC LIMIT 20
        `) as { query: string }[];

        const ourTopKw = ourKw.map((k) => k.query).join(", ");
        const ourSet = new Set(ourKw.map((k) => k.query.toLowerCase()));

        // Ask Perplexity
        const prompt = `Analyse ${site.url} (${site.name}). Find 5-8 direct competitors. For each, list their top 10 keywords with estimated monthly volume >= 1000. Our keywords: ${ourTopKw || "unknown"}. Find GAPS = keywords competitors rank top 20 for but we don't.
RESPOND IN STRICT JSON ONLY:
{"competitors":[{"domain":"x.com","description":"..."}],"keyword_gaps":[{"keyword":"...","volume":2500,"competitor":"x.com","competitor_position":5,"difficulty":"medium","intent":"informational"}]}
Rules: volume >= 1000, max 30 gaps, sort by volume DESC.`;

        const raw = await askAI([{ role: "user", content: prompt }], "search", 3000);
        const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
        const parsed = JSON.parse(cleaned);

        const gaps = (parsed.keyword_gaps || [])
          .filter((g: { volume: number; keyword: string }) => g.volume >= 1000 && !ourSet.has(g.keyword.toLowerCase()))
          .slice(0, 30);

        // Clear old + store new
        await sql`DELETE FROM competitor_research WHERE site_id = ${site.id}`;
        for (const g of gaps) {
          await sql`
            INSERT INTO competitor_research
            (site_id, competitor_domain, keyword, estimated_volume, competitor_position, difficulty, intent)
            VALUES (${site.id}, ${g.competitor}, ${g.keyword}, ${g.volume}, ${g.competitor_position}, ${g.difficulty}, ${g.intent})
          `;
        }

        results.push({ site: site.name, gaps: gaps.length, status: "ok" });
      } catch (err) {
        results.push({ site: site.name, gaps: 0, status: "failed", error: err instanceof Error ? err.message : "unknown" });
      }
    }

    return NextResponse.json({ success: true, sites: sites.length, results });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
