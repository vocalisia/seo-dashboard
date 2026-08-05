export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAICached } from "@/lib/ai-cache";
import { requireCronOrUser } from "@/lib/cron-auth";
import { logError } from "@/lib/logger";
import { searchWebNoKey, type WebSearchProvider, type WebSearchResult } from "@/lib/web-research";

interface SerpEntry {
  position: number;
  url: string;
  domain: string;
  title: string;
  source: WebSearchProvider;
}

interface SerpInsight {
  query: string;
  site_id: number;
  site_name: string;
  result_source: WebSearchProvider;
  our_position: number | null;
  top_3_domains: string[];
  new_competitors_top10: string[]; // domains absent from the previous same-source snapshot
  ai_analysis: string;
}

async function ensureSerpTable(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS competitor_serp_history (
      id SERIAL PRIMARY KEY,
      site_id INTEGER REFERENCES sites(id),
      query TEXT NOT NULL,
      snapshot_at DATE DEFAULT CURRENT_DATE,
      results JSONB NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'legacy_unknown',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(site_id, query, snapshot_at)
    )
  `;
  await sql`ALTER TABLE competitor_serp_history ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'legacy_unknown'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_serp_site_query ON competitor_serp_history(site_id, query, snapshot_at DESC)`;
}

type SearchProviderStates = Awaited<ReturnType<typeof searchWebNoKey>>["providers"];

export function resultsForSource(results: WebSearchResult[], source: WebSearchProvider): SerpEntry[] {
  return results
    .filter((result) => result.providers.includes(source))
    .sort((a, b) => (a.positions[source] ?? Number.MAX_SAFE_INTEGER) - (b.positions[source] ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 10)
    .map((result, index) => ({
      position: result.positions[source] ?? index + 1,
      url: result.url,
      domain: result.domain,
      title: result.title,
      source,
    }));
}

export function selectResultSnapshot(
  results: WebSearchResult[],
  providers: SearchProviderStates,
): { source: WebSearchProvider; results: SerpEntry[] } | null {
  for (const source of ["bing_rss", "duckduckgo_html"] as const) {
    if (providers[source] !== "ok") continue;
    const sourceResults = resultsForSource(results, source);
    if (sourceResults.length > 0) return { source, results: sourceResults };
  }
  return null;
}

export async function POST(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const sql = getSQL();
  await ensureSerpTable(sql);

  const today = new Date().toISOString().slice(0, 10);

  // 1. Get top KW per site (max 5 KW per site, sites limit 5 to keep cost reasonable)
  const sites = (await sql`
    SELECT s.id, s.name, s.url
    FROM sites s
    WHERE s.is_active = true
    ORDER BY (
      SELECT COUNT(*) FROM search_console_data
      WHERE site_id = s.id AND date >= CURRENT_DATE - 7
    ) DESC
    LIMIT 5
  `) as Array<{ id: number; name: string; url: string }>;

  const insights: SerpInsight[] = [];

  for (const site of sites) {
    const topKw = (await sql`
      SELECT query, SUM(impressions) AS impressions, AVG(position) AS pos
      FROM search_console_data
      WHERE site_id = ${site.id}
        AND date >= CURRENT_DATE - 7
        AND query IS NOT NULL
      GROUP BY query
      HAVING SUM(impressions) >= 50 AND AVG(position) <= 30 AND AVG(position) >= 4
      ORDER BY SUM(impressions) DESC
      LIMIT 3
    `) as Array<{ query: string; impressions: string; pos: string }>;

    for (const kw of topKw) {
      try {
        // Source snapshot: Bing RSS first, DuckDuckGo HTML only as fallback.
        const search = await searchWebNoKey(kw.query, "fr-FR", 20);
        const snapshot = selectResultSnapshot(search.results, search.providers);
        if (!snapshot) {
          logError("serp-track.searchUnavailable", new Error("No sourced search results"), {
            site: site.name,
            query: kw.query,
            providers: search.providers,
          });
          continue;
        }
        const { source: resultSource, results: sourceResults } = snapshot;

        // Save snapshot
        await sql`
          INSERT INTO competitor_serp_history (site_id, query, snapshot_at, results, source)
          VALUES (${site.id}, ${kw.query}, CURRENT_DATE, ${JSON.stringify(sourceResults)}, ${resultSource})
          ON CONFLICT (site_id, query, snapshot_at) DO UPDATE SET
            results = EXCLUDED.results,
            source = EXCLUDED.source
        `;

        // Compare only with the latest snapshot from the same provider.
        const prevRows = (await sql`
          SELECT results FROM competitor_serp_history
          WHERE site_id = ${site.id}
            AND query = ${kw.query}
            AND source = ${resultSource}
            AND snapshot_at < CURRENT_DATE
          ORDER BY snapshot_at DESC
          LIMIT 1
        `) as Array<{ results: SerpEntry[] }>;
        const prev: SerpEntry[] = prevRows.length > 0 ? (prevRows[0].results as SerpEntry[]) : [];
        const prevDomains = new Set(prev.map((p) => p.domain));
        let ourDomain = "";
        try { ourDomain = new URL(site.url).hostname.replace(/^www\./, ""); } catch { ourDomain = site.url; }
        // Strict eTLD-style match: exact or subdomain (avoids "ai.com" matching "vocalis-ai.com")
        const isOurs = (d: string): boolean => {
          if (!d || !ourDomain) return false;
          return d === ourDomain || d.endsWith(`.${ourDomain}`);
        };
        const currDomains = sourceResults.map((c) => c.domain);
        const newCompetitors = prevRows.length === 0
          ? []
          : [...new Set(currDomains.filter((d) => !prevDomains.has(d) && !isOurs(d)))];

        const ourEntry = sourceResults.find((e) => isOurs(e.domain));

        // Optional AI narrative runs only after a sourced provider snapshot exists.
        let analysis = "";
        if (newCompetitors.length > 0) {
          try {
            const { reply: analysisReply } = await askAICached({
              cacheKey: `serp-track-analysis:web-source-v1:${resultSource}:${site.id}:${kw.query}:${today}:${newCompetitors.join(",")}`,
              messages: [
                { role: "system", content: "Tu es un Head of SEO. Analyse en max 80 mots français. Formule des hypothèses explicites, n'invente aucun fait, puis propose une action pour cette semaine." },
                { role: "user", content: `Mot-clé : "${kw.query}"\nSource vérifiée du snapshot : ${resultSource}\nNotre site : ${site.name} (${ourEntry ? `position ${ourEntry.position} dans ce snapshot` : "absent du top 10 de ce snapshot"})\nNouveaux domaines depuis le précédent snapshot de même source : ${newCompetitors.join(", ")}\nTop 3 du snapshot : ${sourceResults.slice(0, 3).map((e) => `${e.position}. ${e.domain}`).join(" | ")}` },
              ],
              model: "smart",
              maxTokens: 300,
            });
            analysis = analysisReply;
          } catch { analysis = ""; }
        }

        insights.push({
          query: kw.query,
          site_id: site.id,
          site_name: site.name,
          result_source: resultSource,
          our_position: ourEntry?.position ?? null,
          top_3_domains: sourceResults.slice(0, 3).map((e) => e.domain),
          new_competitors_top10: newCompetitors,
          ai_analysis: analysis,
        });
      } catch (e) {
        // Skip this KW on error
        logError("serp-track.kw", e, { site: site.name, query: kw.query });
      }
    }
  }

  return NextResponse.json({
    success: true,
    sites_tracked: sites.length,
    insights_count: insights.length,
    new_competitor_alerts: insights.filter((i) => i.new_competitors_top10.length > 0).length,
    insights,
  });
}

export async function GET() {
  try {
    const sql = getSQL();
    await ensureSerpTable(sql);

    // Recent insights from last 14 days
    const rows = await sql`
      SELECT h.site_id, s.name AS site_name, h.query, h.snapshot_at, h.results,
             h.source AS result_source
      FROM competitor_serp_history h
      JOIN sites s ON s.id = h.site_id
      WHERE h.snapshot_at >= CURRENT_DATE - 14
      ORDER BY h.snapshot_at DESC
      LIMIT 100
    `;

    return NextResponse.json({ success: true, snapshots: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg, snapshots: [] }, { status: 500 });
  }
}
