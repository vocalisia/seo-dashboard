export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { requireCronOrUser } from "@/lib/cron-auth";

interface SerpEntry {
  position: number;
  url: string;
  domain: string;
  title: string;
}

interface SerpInsight {
  query: string;
  site_id: number;
  site_name: string;
  our_position: number | null;
  top_3_domains: string[];
  new_competitors_top10: string[]; // domains that weren't in top 10 last week
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
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(site_id, query, snapshot_at)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_serp_site_query ON competitor_serp_history(site_id, query, snapshot_at DESC)`;
}

// Parse Perplexity-style structured response into entries
function parseSerpResults(text: string): SerpEntry[] {
  const lines = text.split("\n").filter(Boolean);
  const entries: SerpEntry[] = [];
  let pos = 1;
  for (const line of lines) {
    const urlMatch = line.match(/https?:\/\/[^\s\])"]+/);
    if (!urlMatch) continue;
    const url = urlMatch[0].replace(/[.,;:!?\)\]"]+$/, "");
    let domain = "";
    try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { continue; }
    const title = line.replace(url, "").replace(/^[\d.\-\)\s*]+/, "").replace(/[\[\]*]/g, "").trim().slice(0, 200);
    entries.push({ position: pos++, url, domain, title });
    if (entries.length >= 10) break;
  }
  return entries;
}

export async function POST(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const sql = getSQL();
  await ensureSerpTable(sql);

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
        // Use Perplexity to get current top 10 results
        const serpText = await askAI(
          [
            { role: "system", content: "Tu es un crawler SERP. Tu retournes UNIQUEMENT les 10 premiers résultats Google pour le mot-clé donné, format strict ligne par ligne : `position. titre — https://url`. Pas de blabla, pas d'intro." },
            { role: "user", content: `Top 10 résultats Google FR actuels pour : "${kw.query}". Retourne 10 lignes au format "1. Titre — URL" — c'est tout.` },
          ],
          "search",
          800
        );
        const top10 = parseSerpResults(serpText);
        if (top10.length === 0) continue;

        // Save snapshot
        await sql`
          INSERT INTO competitor_serp_history (site_id, query, snapshot_at, results)
          VALUES (${site.id}, ${kw.query}, CURRENT_DATE, ${JSON.stringify(top10)})
          ON CONFLICT (site_id, query, snapshot_at) DO UPDATE SET results = EXCLUDED.results
        `;

        // Compare with last week
        const prevRows = await sql`
          SELECT results FROM competitor_serp_history
          WHERE site_id = ${site.id}
            AND query = ${kw.query}
            AND snapshot_at < CURRENT_DATE
          ORDER BY snapshot_at DESC
          LIMIT 1
        `;
        const prev: SerpEntry[] = prevRows.length > 0 ? (prevRows[0].results as SerpEntry[]) : [];
        const prevDomains = new Set(prev.map((p) => p.domain));
        const currDomains = top10.map((c) => c.domain);
        const newCompetitors = currDomains.filter((d) => !prevDomains.has(d) && !site.url.includes(d));

        const ourDomain = new URL(site.url).hostname.replace(/^www\./, "");
        const ourEntry = top10.find((e) => e.domain.includes(ourDomain) || ourDomain.includes(e.domain));

        // AI analyse
        let analysis = "";
        if (newCompetitors.length > 0) {
          try {
            analysis = await askAI(
              [
                { role: "system", content: "Tu es un Head of SEO. Analyse en max 80 mots français : pourquoi ce concurrent vient de monter dans le top 10 ? quel risque pour nous ? quoi faire cette semaine ?" },
                { role: "user", content: `Mot-clé : "${kw.query}"\nNotre site : ${site.name} (${ourEntry ? `position ${ourEntry.position}` : "hors top 10"})\nNouveaux concurrents top 10 cette semaine : ${newCompetitors.join(", ")}\nTop 3 actuel : ${top10.slice(0, 3).map((e) => `${e.position}. ${e.domain}`).join(" | ")}` },
              ],
              "smart",
              300
            );
          } catch { analysis = ""; }
        }

        insights.push({
          query: kw.query,
          site_id: site.id,
          site_name: site.name,
          our_position: ourEntry?.position ?? null,
          top_3_domains: top10.slice(0, 3).map((e) => e.domain),
          new_competitors_top10: newCompetitors,
          ai_analysis: analysis,
        });
      } catch (e) {
        // Skip this KW on error
        console.error(`SERP track failed for ${site.name}/${kw.query}:`, e);
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
  const sql = getSQL();
  await ensureSerpTable(sql);

  // Recent insights from last 14 days
  const rows = await sql`
    SELECT h.site_id, s.name AS site_name, h.query, h.snapshot_at, h.results
    FROM competitor_serp_history h
    JOIN sites s ON s.id = h.site_id
    WHERE h.snapshot_at >= CURRENT_DATE - 14
    ORDER BY h.snapshot_at DESC
    LIMIT 100
  `;

  return NextResponse.json({ success: true, snapshots: rows });
}
