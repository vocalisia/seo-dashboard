export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI, AIProviderError } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";
import { logError } from "@/lib/logger";
import { hasSufficientCompetitorResearch, prepareCompetitorResearchRows } from "@/lib/competitor-research-guard";

interface Site {
  id: number;
  name: string;
  url: string;
}

type SQLClient = ReturnType<typeof getSQL>;

interface ResearchResult {
  competitors: { domain: string; description: string }[];
  gaps: {
    keyword: string;
    volume: number;
    competitor: string;
    competitor_position: number;
    difficulty: string;
    intent: string;
    source?: "ai_estimate" | "keyword_planner" | "cache" | "fallback_gsc_signal";
  }[];
  ourKeywordsCount: number;
}

function isQuestionLike(keyword: string): boolean {
  const lower = keyword.toLowerCase().trim();
  if (!lower) return false;
  if (lower.includes("?")) return true;
  return /^(comment|pourquoi|combien|quand|quel|quelle|quels|quelles|où|ou|qui|que|quoi|est-ce|qu'est|qu est|how|what|why|when|which|where|who|is|are|does|do|can|should|best|top|meilleur|meilleure|comparatif)\b/i.test(lower);
}

function wordCount(keyword: string): number {
  return keyword.trim().split(/\s+/).filter(Boolean).length;
}

function formatAIError(err: unknown): string {
  if (err instanceof AIProviderError) {
    // Human-readable, provider-aware
    return err.message;
  }
  if (err instanceof Error) {
    return err.message.slice(0, 300);
  }
  return "AI research failed — réessaie";
}

async function runResearchForSite(site: Site, sql: SQLClient): Promise<ResearchResult> {
  const ourKeywords = (await sql`
    SELECT query,
           SUM(clicks) AS clicks,
           SUM(impressions) AS impressions,
           AVG(position) AS position
    FROM search_console_query_data
    WHERE site_id = ${site.id}
      AND date >= NOW() - INTERVAL '30 days'
      AND query IS NOT NULL
    GROUP BY query
    ORDER BY SUM(impressions) DESC
    LIMIT 100
  `) as { query: string; clicks: string; impressions: string; position: string }[];

  const ourTopKeywords = ourKeywords.slice(0, 20).map((k) => k.query).join(", ");
  const ourKeywordSet = new Set(ourKeywords.map((k) => k.query.toLowerCase()));

  const competitorPrompt = `Analyse the website ${site.url} (${site.name}).

TASK 1: Find the 5-8 direct competitors of this website. These are sites targeting the same audience and topics.

TASK 2: For each competitor, list their top 10-15 keywords that:
- Have estimated monthly search volume >= 1000 for head/commercial terms
- Also include useful question/long-tail gaps even if estimated volume is lower (>= 100), because they feed FAQ, AIO and content briefs
- Are commercially relevant
- The competitor ranks in top 20 for

TASK 3: Our site currently ranks for these keywords: ${ourTopKeywords || "unknown"}
Identify GAPS = keywords where competitors rank well but "${site.url}" does NOT appear in top 30.

RESPOND IN STRICT JSON FORMAT ONLY (no markdown, no explanation):
{
  "competitors": [
    { "domain": "competitor1.com", "description": "Brief description of what they do" }
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
- volume is an estimate, not a Google truth. Be conservative.
- head/commercial gaps should be >= 1000 estimated searches/month.
- question/long-tail gaps may be >= 100 estimated searches/month if they are strongly relevant.
- include at least 5 question-style gaps when the market has real informational searches (comment/how/what/best/comparatif).
- Only include keywords genuinely relevant to ${site.name}
- Sort keyword_gaps by volume DESC
- Maximum 30 keyword gaps
- Be accurate with volume estimates`;

/* Legacy synthetic fallback removed: it fabricated competitor gaps from our own GSC data.
function inferCompetitors(site: Site): { domain: string; description: string }[] {
  const host = site.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").toLowerCase();
  if (host.includes("meilleurartisan")) {
    return [
      { domain: "renovero.ch", description: "Plateforme suisse de devis travaux et artisans." },
      { domain: "ofri.ch", description: "Marketplace suisse pour demandes de travaux et artisans." },
      { domain: "local.ch", description: "Annuaire local suisse avec fiches d'entreprises et artisans." },
      { domain: "houzy.ch", description: "Services suisses autour de la maison, rénovation et propriétaires." },
      { domain: "devis.ch", description: "Service suisse de demandes de devis pour travaux." },
    ];
  }
  if (host.includes("recouvrementpro")) {
    return [
      { domain: "frontenacrecouvrement.com", description: "Cabinet de recouvrement au Canada." },
      { domain: "agence-recouvrement.ca", description: "Services de recouvrement pour entreprises." },
      { domain: "groupechoquette.com", description: "Recouvrement et gestion de comptes clients." },
      { domain: "legalwizz.com", description: "Services juridiques et documents pour entreprises." },
    ];
  }
  if (host.includes("boursier") || host.includes("stock-market")) {
    return [
      { domain: "cash.ch", description: "Actualité financière et marchés suisses." },
      { domain: "zonebourse.com", description: "Données boursières, actions et analyses." },
      { domain: "swissquote.ch", description: "Courtier et contenus de marché en Suisse." },
      { domain: "investing.com", description: "Portail global de données financières." },
    ];
  }
  if (host.includes("facture") || host.includes("recouvrement")) {
    return [
      { domain: "litige.fr", description: "Procédures et modèles pour litiges et impayés." },
      { domain: "legalstart.fr", description: "Services juridiques en ligne pour entreprises." },
      { domain: "captaincontrat.com", description: "Contrats et accompagnement juridique." },
      { domain: "rubypayeur.com", description: "Recouvrement et information entreprise." },
    ];
  }
  return [
    { domain: "competitor-a.example", description: `Concurrent à valider pour ${site.name}.` },
    { domain: "competitor-b.example", description: `Acteur de marché proche de ${site.name}.` },
    { domain: "competitor-c.example", description: `Site thématique comparable à ${site.name}.` },
  ];
}

async function runFallbackResearchForSite(site: Site, sql: SQLClient): Promise<ResearchResult> {
  const rows = (await sql`
    SELECT query, SUM(impressions) AS impressions
    FROM search_console_query_data
    WHERE site_id = ${site.id}
      AND date >= NOW() - INTERVAL '90 days'
      AND query IS NOT NULL
    GROUP BY query
    ORDER BY SUM(impressions) DESC
    LIMIT 20
  `) as { query: string; impressions: string }[];

  const competitors = inferCompetitors(site);
  const seeds = rows.map((row) => row.query).filter(Boolean);
  const fallbackSeeds = seeds.length > 0 ? seeds : [site.name.toLowerCase()];
  const gaps = fallbackSeeds.slice(0, 12).map((keyword, index) => {
    const questionPrefix = isQuestionLike(keyword) ? "" : index % 3 === 0 ? "meilleur " : index % 3 === 1 ? "comparatif " : "comment choisir ";
    return {
      keyword: `${questionPrefix}${keyword}`.trim().slice(0, 500),
      volume: Math.max(100, Math.round((Number(rows[index]?.impressions ?? 0) || 100) / 10) * 10),
      competitor: competitors[index % competitors.length]?.domain ?? competitors[0].domain,
      competitor_position: (index % 10) + 1,
      difficulty: index < 4 ? "medium" : "low",
      intent: isQuestionLike(keyword) ? "informational" : index % 2 === 0 ? "commercial" : "informational",
      source: "fallback_gsc_signal" as const,
    };
  });

  return {
    competitors,
    gaps,
    ourKeywordsCount: rows.length,
  };
}
*/

  const aiResponse = await askAI(
    [{ role: "user", content: competitorPrompt }],
    "search",
    3000
  );

  const cleaned = aiResponse
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  let parsed: {
    competitors: { domain: string; description: string }[];
    keyword_gaps: ResearchResult["gaps"];
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  // Build portfolio domain set to filter out self-references and sister sites
  const portfolioRows = (await sql`SELECT url FROM sites`) as { url: string }[];
  const portfolioDomains = new Set(
    portfolioRows.map((r) => r.url.replace(/^https?:\/\/(www\.)?/, "").toLowerCase().replace(/\/.*$/, ""))
  );

  function isPortfolioDomain(d: string): boolean {
    const norm = d.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "");
    return portfolioDomains.has(norm);
  }

  const filteredGaps = (parsed.keyword_gaps || [])
    .filter((g) => {
      const isQuestionOrLongtail = isQuestionLike(g.keyword) || wordCount(g.keyword) >= 4 || /informational/i.test(g.intent ?? "");
      const minVolume = isQuestionOrLongtail ? 100 : 1000;
      return g.volume >= minVolume && !ourKeywordSet.has(g.keyword.toLowerCase());
    })
    .filter((g) => !isPortfolioDomain(g.competitor))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 30);

  // Also filter competitors list (UI shows them)
  parsed.competitors = (parsed.competitors || []).filter((c) => !isPortfolioDomain(c.domain));

  return {
    competitors: parsed.competitors || [],
    gaps: filteredGaps.map((gap) => ({ ...gap, source: "ai_estimate" as const })),
    ourKeywordsCount: ourKeywords.length,
  };
}

async function runFallbackResearchForSite(site: Site, sql: SQLClient): Promise<ResearchResult> {
  const rows = (await sql`
    SELECT query
    FROM search_console_query_data
    WHERE site_id = ${site.id}
      AND date >= NOW() - INTERVAL '90 days'
      AND query IS NOT NULL
    GROUP BY query
    LIMIT 20
  `) as { query: string }[];

  // GSC can only show our own visibility. It cannot prove a competitor's rank or volume.
  return {
    competitors: [],
    gaps: [],
    ourKeywordsCount: rows.length,
  };
}

/**
 * POST /api/competitors
 * body: { site_id: number | "all" }
 *
 * Uses the unified Gemini/Perplexity router to:
 * 1. Find 5-10 direct competitors
 * 2. Extract their top keywords with estimated volume
 * 3. Compare with our GSC keywords
 * 4. Return gaps (keywords where competitor ranks but we don't, volume >= 1000)
 *
 * site_id === "all" → loops through all active sites and aggregates.
 */
interface CachedResearch {
  site_id: number;
  competitor_domain: string;
  competitor_description: string | null;
  keyword: string;
  estimated_volume: number;
  competitor_position: number;
  difficulty: string;
  intent: string;
  researched_at: string;
}

async function loadCachedResearch(sql: SQLClient, siteId: number, maxAgeDays = 60): Promise<ResearchResult | null> {
  // INTERVAL value must be embedded — Neon tagged template can't parametrize INTERVAL literals.
  // maxAgeDays is internally controlled (not user input) so embedding is safe.
  const safeDays = Math.max(1, Math.floor(maxAgeDays));
  const rows = (await sql`
    SELECT site_id, competitor_domain, competitor_description, keyword,
           estimated_volume, competitor_position, difficulty, intent, researched_at
    FROM competitor_research
    WHERE site_id = ${siteId}
      AND researched_at >= NOW() - (${safeDays} || ' days')::interval
    ORDER BY estimated_volume DESC
  `) as CachedResearch[];

  if (rows.length === 0) return null;

  const competitorMap = new Map<string, { domain: string; description: string }>();
  for (const r of rows) {
    if (!competitorMap.has(r.competitor_domain)) {
      competitorMap.set(r.competitor_domain, {
        domain: r.competitor_domain,
        description: r.competitor_description ?? "",
      });
    }
  }

  return {
    competitors: Array.from(competitorMap.values()),
    gaps: rows.map((r) => ({
      keyword: r.keyword,
      volume: Number(r.estimated_volume) || 0,
      competitor: r.competitor_domain,
      competitor_position: Number(r.competitor_position) || 0,
      difficulty: r.difficulty ?? "",
      intent: r.intent ?? "",
      source: "cache" as const,
    })),
    ourKeywordsCount: 0,
  };
}

async function persistResearchForSite(site: Site, sql: SQLClient, research: ResearchResult): Promise<boolean> {
  const rows = prepareCompetitorResearchRows(research.gaps ?? [], research.competitors ?? []);
  if (!hasSufficientCompetitorResearch(rows)) {
    console.warn(`Competitor research preserved for site ${site.id}: replacement was insufficient`);
    return false;
  }

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
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_research_natural_key
        ON competitor_research(site_id, LOWER(competitor_domain), LOWER(keyword))
    `;

    await sql.transaction([
      sql`DELETE FROM competitor_research WHERE site_id = ${site.id}`,
      ...rows.map((row) => sql`
        INSERT INTO competitor_research
        (site_id, competitor_domain, competitor_description, keyword, estimated_volume, competitor_position, difficulty, intent)
        VALUES (${site.id}, ${row.domain}, ${row.description}, ${row.keyword}, ${row.volume},
                ${row.position}, ${row.difficulty}, ${row.intent})
      `),
    ]);
    return true;
  } catch (err) {
    logError("competitors.persistResearchForSite", err, { siteId: site.id });
    return false;
  }
}
export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: { site_id?: number | "all"; force_refresh?: boolean };
  try {
    body = (await req.json()) as { site_id?: number | "all"; force_refresh?: boolean };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { site_id, force_refresh } = body;
  if (!site_id) {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();

  // "all" mode: run sequentially per site, aggregate results
  if (site_id === "all") {
    try {
      const activeSites = (await sql`SELECT id, name, url FROM sites WHERE is_active = true ORDER BY id`) as Site[];
      if (activeSites.length === 0) {
        return NextResponse.json({ success: false, error: "Aucun site actif" });
      }

      const perSite: { site: string; competitors: number; gaps: number; status: "cached" | "complete" | "preserved" | "unavailable"; error?: string }[] = [];
      const errors: string[] = [];
      let aiFallbackOnly = false;

      for (const s of activeSites) {
        // Cache-first: skip AI call if cache exists (and not force_refresh)
        if (!force_refresh) {
          const cached = await loadCachedResearch(sql, s.id);
          if (cached) {
            perSite.push({ site: s.name, competitors: cached.competitors.length, gaps: cached.gaps.length, status: "cached" });
            continue;
          }
        }
        if (aiFallbackOnly) {
          const fallback = await runFallbackResearchForSite(s, sql);
          const message = "AI provider unavailable; no competitor volume or position was generated.";
          errors.push(`${s.name}: ${message}`);
          perSite.push({ site: s.name, competitors: fallback.competitors.length, gaps: fallback.gaps.length, status: "unavailable", error: message });
          continue;
        }
        try {
          const r = await runResearchForSite(s, sql);
          const persisted = await persistResearchForSite(s, sql, r);
          const preserved = persisted ? null : await loadCachedResearch(sql, s.id, 3650);
          const reported = preserved ?? r;
          if (!persisted) {
            const message = "The rescan was insufficient; the existing cache was preserved.";
            errors.push(`${s.name}: ${message}`);
            perSite.push({ site: s.name, competitors: reported.competitors.length, gaps: reported.gaps.length, status: "preserved", error: message });
          } else {
            perSite.push({ site: s.name, competitors: reported.competitors.length, gaps: reported.gaps.length, status: "complete" });
          }
        } catch (err) {
          const msg = formatAIError(err);
          errors.push(`${s.name}: ${msg}`);
          // Try fallback to recent cache only. Older cache must not look fresh.
          const cached = await loadCachedResearch(sql, s.id, 60);
          if (cached) {
            perSite.push({ site: s.name, competitors: cached.competitors.length, gaps: cached.gaps.length, status: "cached", error: `Rescan unavailable: ${msg}` });
          } else {
            const fallback = await runFallbackResearchForSite(s, sql);
            perSite.push({ site: s.name, competitors: fallback.competitors.length, gaps: fallback.gaps.length, status: "unavailable", error: msg });
          }
          // Once the provider is clearly unavailable, finish remaining sites with dashboard-derived fallback.
          if (err instanceof AIProviderError && (err.code === "credit_low" || err.code === "no_key" || err.code === "auth" || err.code === "rate_limit")) {
            aiFallbackOnly = true;
          }
        }
      }

      return NextResponse.json({
        success: errors.length === 0,
        status: errors.length === 0 ? "complete" : errors.length === activeSites.length ? "failed" : "partial",
        mode: "all",
        sites_processed: perSite.length,
        sites_total: activeSites.length,
        per_site: perSite,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (err) {
      return NextResponse.json({ success: false, error: formatAIError(err) }, { status: 500 });
    }
  }

  try {
    const sites = (await sql`SELECT * FROM sites WHERE id = ${site_id} LIMIT 1`) as Site[];
    if (sites.length === 0) {
      return NextResponse.json({ success: false, error: "Site not found" }, { status: 404 });
    }
    const site = sites[0];

    // Cache-first: serve cached analysis if recent (skip AI call to avoid credit issues)
    if (!force_refresh) {
      const cached = await loadCachedResearch(sql, site.id);
      if (cached) {
        return NextResponse.json({
          success: true,
          site: site.name,
          cached: true,
          competitors: cached.competitors,
          gaps: cached.gaps,
          our_keywords_count: cached.ourKeywordsCount,
          total_gaps: cached.gaps.length,
          min_volume: 1000,
        });
      }
    }

    try {
      const result = await runResearchForSite(site, sql);
      const persisted = await persistResearchForSite(site, sql, result);
      if (!persisted) {
        const preserved = await loadCachedResearch(sql, site.id, 3650);
        if (preserved) {
          return NextResponse.json({
            success: true,
            site: site.name,
            cached: true,
            stale: true,
            warning: "The new rescan was insufficient. The previous analysis was preserved.",
            competitors: preserved.competitors,
            gaps: preserved.gaps,
            our_keywords_count: preserved.ourKeywordsCount,
            total_gaps: preserved.gaps.length,
            min_volume: 1000,
          });
        }
      }
      return NextResponse.json({
        success: true,
        site: site.name,
        cached: false,
        warning: persisted ? undefined : "The rescan is insufficient and was not saved.",
        competitors: result.competitors,
        gaps: result.gaps,
        our_keywords_count: result.ourKeywordsCount,
        total_gaps: result.gaps.length,
        min_volume: 1000,
      });    } catch (err) {
      // Fallback to recent cache only. Older cache must not look fresh.
      const cached = await loadCachedResearch(sql, site.id, 60);
      if (cached) {
        return NextResponse.json({
          success: true,
          site: site.name,
          cached: true,
          stale: true,
          competitors: cached.competitors,
          gaps: cached.gaps,
          our_keywords_count: cached.ourKeywordsCount,
          total_gaps: cached.gaps.length,
          min_volume: 1000,
        });
      }
      const fallback = await runFallbackResearchForSite(site, sql);
      return NextResponse.json({
        success: true,
        site: site.name,
        cached: false,
        fallback: true,
        warning: `${formatAIError(err)} Aucun volume ni position concurrentielle non vérifiée n'est affiché.`,
        competitors: fallback.competitors,
        gaps: fallback.gaps,
        our_keywords_count: fallback.ourKeywordsCount,
        total_gaps: fallback.gaps.length,
        min_volume: 100,
      });
    }
  } catch (err) {
    logError("competitors.research", err);
    return NextResponse.json({ success: false, error: formatAIError(err) }, { status: 500 });
  }
}

/**
 * GET /api/competitors?site_id=X
 * Returns cached competitor research from DB
 */
export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteId = req.nextUrl.searchParams.get("site_id");
  if (!siteId) {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }

  const sql = getSQL();
  try {
    const rows = await sql`
      SELECT
        id,
        site_id,
        competitor_domain,
        keyword,
        estimated_volume,
        competitor_position,
        difficulty,
        intent,
        researched_at
      FROM competitor_research
      WHERE site_id = ${parseInt(siteId, 10)}
      ORDER BY estimated_volume DESC
    ` as {
      id: number;
      site_id: number;
      competitor_domain: string;
      keyword: string;
      estimated_volume: number;
      competitor_position: number;
      difficulty: string;
      intent: string;
      researched_at: string;
    }[];

    // Group by competitor with aggregated stats
    const competitorMap: Record<string, {
      domain: string;
      found_keywords_count: number;
      total_volume: number;
    }> = {};
    for (const row of rows) {
      const domain = row.competitor_domain;
      if (!competitorMap[domain]) {
        competitorMap[domain] = { domain, found_keywords_count: 0, total_volume: 0 };
      }
      competitorMap[domain].found_keywords_count += 1;
      competitorMap[domain].total_volume += Number(row.estimated_volume) || 0;
    }

    // Map rows to gaps format (normalize field names)
    const gaps = rows.map((r) => ({
      keyword: r.keyword,
      volume: Number(r.estimated_volume) || 0,
      competitor: r.competitor_domain,
      competitor_domain: r.competitor_domain,
      competitor_position: Number(r.competitor_position) || 0,
      difficulty: r.difficulty ?? "",
      intent: r.intent ?? "",
      source: "cache" as const,
    }));

    return NextResponse.json({
      success: true,
      gaps,
      competitors: Object.values(competitorMap).sort((a, b) => b.total_volume - a.total_volume),
      total: rows.length,
    });
  } catch {
    return NextResponse.json({ success: true, gaps: [], competitors: [], total: 0 });
  }
}
