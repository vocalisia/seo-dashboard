export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getSQL, initDB } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { buildOpportunityCandidates, type OpportunityCandidate, type OpportunityKeywordRow } from "@/lib/opportunity-engine";
import { buildExternalSignalRows, fetchGoogleSerpSnapshot } from "@/lib/opportunity-sources";
import { requireApiSession } from "@/lib/api-auth";

interface AggregatedKeywordRow {
  query: string;
  impressions_30d: string;
  impressions_prev_30d: string;
  clicks_30d: string;
  avg_position_30d: string;
  site_count: string;
}

interface StoredOpportunity {
  id?: number;
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
  target_countries: string[];
  target_languages: string[];
  competitors: { url: string; name: string }[];
  success_rate: number;
  revenue_timeline: { m1: number; m3: number; m6: number; m12: number };
  business_model: Record<string, unknown>;
  confidence_score: number;
  signal_source?: string;
  momentum_pct?: number;
  average_position?: number;
  opportunity_type?: string;
  sample_queries?: string[];
  status?: string;
  score_breakdown?: {
    growth: number;
    volume: number;
    weakness: number;
    specificity: number;
    business: number;
    portfolioDistance: number;
  };
  serp_evidence?: {
    relatedQuestions: string[];
    relatedSearches: string[];
    resultTitles: string[];
  };
}

type OpportunityInsertable = StoredOpportunity;

const PORTFOLIO_HINTS = [
  "voice ai",
  "tesla ev",
  "cbd europe",
  "crypto trust",
  "business switzerland",
  "sales training",
  "ai hub",
  "ai agents",
  "lead generation",
  "seo tools",
  "beauty fashion",
];

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function inferSiteType(candidate: OpportunityCandidate): string {
  if (candidate.intent === "commercial") return "directory";
  if (candidate.opportunityType === "question") return "blog";
  if (candidate.keywords.some((keyword) => /logiciel|software|saas|tool/i.test(keyword))) return "saas";
  return "magazine";
}

function inferMonetization(candidate: OpportunityCandidate): string {
  if (candidate.intent === "commercial") return "lead-gen";
  if (candidate.keywords.some((keyword) => /comparatif|best|meilleur|prix|tarif/i.test(keyword))) return "affiliate";
  return "ads";
}

function inferCompetition(candidate: OpportunityCandidate): string {
  if (candidate.averagePosition >= 18 && candidate.signalScore >= 0.7) return "low";
  if (candidate.averagePosition >= 12) return "medium";
  return "high";
}

function fallbackOpportunity(candidate: OpportunityCandidate): StoredOpportunity {
  const siteType = inferSiteType(candidate);
  const monetization = inferMonetization(candidate);
  const competition = inferCompetition(candidate);
  const root = slugify(candidate.clusterLabel.split(" ").slice(0, 3).join(" "));
  const projectedTraffic6m = Math.round(candidate.monthlyVolume * 0.1);
  const projectedRevenue6m = monetization === "lead-gen"
    ? Math.round(projectedTraffic6m * 1.5)
    : monetization === "affiliate"
      ? Math.round(projectedTraffic6m * 0.7)
      : Math.round(projectedTraffic6m * 0.25);
  const confidence = Math.round(candidate.signalScore * 100);

  return {
    niche: candidate.clusterLabel,
    reason: [
      `${candidate.monthlyVolume.toLocaleString("en-US")} monthly impressions detected in GSC-like demand.`,
      `${candidate.momentumPct}% momentum over the previous 30-day window.`,
      candidate.rationale.join(". "),
    ].join(" "),
    site_type: siteType,
    core_keywords: candidate.keywords.slice(0, 5),
    monthly_volume: candidate.monthlyVolume,
    competition,
    monetization,
    projected_traffic_6m: projectedTraffic6m,
    projected_revenue_6m: projectedRevenue6m,
    suggested_domains: [`${root}hub.com`, `${root}guide.com`].filter(Boolean),
    seed_articles: candidate.keywords.slice(0, 5).map((keyword) => `Guide complet: ${keyword}`),
    target_countries: ["FRA", "CHE", "BEL"],
    target_languages: ["fr"],
    competitors: [],
    success_rate: Math.max(25, Math.round(confidence * 0.8)),
    revenue_timeline: {
      m1: 0,
      m3: Math.round(projectedRevenue6m * 0.25),
      m6: projectedRevenue6m,
      m12: Math.round(projectedRevenue6m * 2.2),
    },
    business_model: {
      type: `${siteType} focused on ${candidate.intent} demand`,
      how_to_monetize: `Build a content moat around ${candidate.clusterLabel} and monetize through ${monetization}.`,
      launch_angle: candidate.rationale,
    },
    confidence_score: confidence,
    signal_source: candidate.portfolioDistance >= 0.7 ? "gsc+external" : "gsc",
    momentum_pct: candidate.momentumPct,
    average_position: candidate.averagePosition,
    opportunity_type: candidate.opportunityType,
    sample_queries: candidate.sampleQueries,
    status: "pending",
    score_breakdown: candidate.scoreBreakdown,
    serp_evidence: candidate.serpEvidence ?? {
      relatedQuestions: [],
      relatedSearches: [],
      resultTitles: [],
    },
  };
}

function cleanJsonBlock(input: string): string {
  return input
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

async function enrichCandidatesWithAI(candidates: OpportunityCandidate[]): Promise<StoredOpportunity[] | null> {
  const shortlist = candidates.map((candidate, index) => ({
    id: index + 1,
    niche_hint: candidate.clusterLabel,
    keywords: candidate.keywords.slice(0, 5),
    monthly_volume: candidate.monthlyVolume,
    momentum_pct: candidate.momentumPct,
    average_position: candidate.averagePosition,
    signal_score: candidate.signalScore,
    opportunity_type: candidate.opportunityType,
    intent: candidate.intent,
    rationale: candidate.rationale,
    score_breakdown: candidate.scoreBreakdown,
  }));

  const prompt = `You are enriching SEO niche opportunities from first-party search demand.

The shortlist below is already computed from real query clusters. Do NOT invent random sectors.
For each item, keep the same niche direction and keywords, but turn it into a launch-ready business opportunity.

INPUT:
${JSON.stringify(shortlist, null, 2)}

RULES:
- Stay close to the provided niche_hint and keywords.
- monthly_volume must stay realistic and close to the input.
- Prefer niches with clear content gaps, business intent, or rising long-tail demand.
- Suggested domains must be simple and brandable.
- Seed articles must directly attack the listed keywords.
- Competitors can be empty if you are unsure. Never hallucinate weird URLs.
- Return 5 to 8 items max.

RESPOND IN STRICT JSON:
{
  "opportunities": [
    {
      "niche": "Specific niche",
      "reason": "Concrete explanation based on rising demand, SERP gap, and portfolio distance",
      "site_type": "blog | magazine | e-commerce | saas | directory",
      "core_keywords": ["kw1", "kw2"],
      "monthly_volume": 12000,
      "competition": "low | medium | high",
      "monetization": "ads | affiliate | e-commerce | subscription | lead-gen",
      "projected_traffic_6m": 1800,
      "projected_revenue_6m": 900,
      "suggested_domains": ["example.com"],
      "seed_articles": ["title 1", "title 2", "title 3", "title 4", "title 5"],
      "target_countries": ["FRA", "CHE"],
      "target_languages": ["fr"],
      "competitors": [],
      "success_rate": 65,
      "revenue_timeline": {"m1": 0, "m3": 120, "m6": 900, "m12": 2200},
      "business_model": {
        "type": "short description",
        "how_to_monetize": "practical monetization plan"
      },
      "confidence_score": 78
    }
  ]
}`;

  const aiResponse = await askAI([{ role: "user", content: prompt }], "search", 3200);
  const cleaned = cleanJsonBlock(aiResponse);
  if (!cleaned) {
    throw new Error("AI returned an empty response");
  }
  const parsed = JSON.parse(cleaned) as { opportunities?: StoredOpportunity[] };
  return parsed.opportunities?.length ? parsed.opportunities : null;
}

async function enrichCandidatesWithFreeSerpContext(candidates: OpportunityCandidate[]): Promise<OpportunityCandidate[]> {
  const snapshots = await Promise.all(
    candidates.slice(0, 4).map((candidate) => fetchGoogleSerpSnapshot(candidate.clusterLabel))
  );

  return candidates.map((candidate, index) => {
    const snapshot = snapshots[index];
    if (!snapshot) return candidate;

    const extraQueries = [...candidate.sampleQueries, ...snapshot.relatedQuestions, ...snapshot.relatedSearches]
      .filter(Boolean)
      .slice(0, 8);
    const extraRationale = [...candidate.rationale];

    if (snapshot.relatedQuestions.length > 0) {
      extraRationale.push(`${snapshot.relatedQuestions.length} PAA-style questions found`);
    }
    if (snapshot.relatedSearches.length > 0) {
      extraRationale.push(`${snapshot.relatedSearches.length} related searches found`);
    }

    return {
      ...candidate,
      sampleQueries: extraQueries,
      rationale: extraRationale.slice(0, 6),
      serpEvidence: {
        relatedQuestions: snapshot.relatedQuestions.slice(0, 8),
        relatedSearches: snapshot.relatedSearches.slice(0, 8),
        resultTitles: snapshot.resultTitles.slice(0, 8),
      },
    };
  });
}

function sanitizeOpportunity(
  raw: Partial<StoredOpportunity>,
  fallback: StoredOpportunity
): OpportunityInsertable {
  return {
    niche: typeof raw.niche === "string" && raw.niche.trim() ? raw.niche.trim() : fallback.niche,
    reason: typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : fallback.reason,
    site_type: typeof raw.site_type === "string" && raw.site_type.trim() ? raw.site_type : fallback.site_type,
    core_keywords: Array.isArray(raw.core_keywords) && raw.core_keywords.length
      ? raw.core_keywords.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.core_keywords,
    monthly_volume: Number.isFinite(raw.monthly_volume) ? Math.round(raw.monthly_volume as number) : fallback.monthly_volume,
    competition: typeof raw.competition === "string" && raw.competition.trim() ? raw.competition : fallback.competition,
    monetization: typeof raw.monetization === "string" && raw.monetization.trim() ? raw.monetization : fallback.monetization,
    projected_traffic_6m: Number.isFinite(raw.projected_traffic_6m)
      ? Math.round(raw.projected_traffic_6m as number)
      : fallback.projected_traffic_6m,
    projected_revenue_6m: Number.isFinite(raw.projected_revenue_6m)
      ? Math.round(raw.projected_revenue_6m as number)
      : fallback.projected_revenue_6m,
    suggested_domains: Array.isArray(raw.suggested_domains) && raw.suggested_domains.length
      ? raw.suggested_domains.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 3)
      : fallback.suggested_domains,
    seed_articles: Array.isArray(raw.seed_articles) && raw.seed_articles.length
      ? raw.seed_articles.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.seed_articles,
    target_countries: Array.isArray(raw.target_countries) && raw.target_countries.length
      ? raw.target_countries.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.target_countries,
    target_languages: Array.isArray(raw.target_languages) && raw.target_languages.length
      ? raw.target_languages.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 5)
      : fallback.target_languages,
    competitors: Array.isArray(raw.competitors)
      ? raw.competitors
          .filter((value): value is { url: string; name: string } => (
            typeof value === "object" &&
            value !== null &&
            typeof (value as { url?: unknown }).url === "string" &&
            typeof (value as { name?: unknown }).name === "string"
          ))
          .slice(0, 5)
      : fallback.competitors,
    success_rate: Number.isFinite(raw.success_rate) ? Math.round(raw.success_rate as number) : fallback.success_rate,
    revenue_timeline:
      raw.revenue_timeline &&
      typeof raw.revenue_timeline === "object" &&
      !Array.isArray(raw.revenue_timeline)
        ? (() => {
            const timeline = raw.revenue_timeline as Record<string, string | number | null | undefined>;
            return {
              m1: toNumber(timeline.m1),
              m3: toNumber(timeline.m3),
              m6: toNumber(timeline.m6),
              m12: toNumber(timeline.m12),
            };
          })()
        : fallback.revenue_timeline,
    business_model:
      raw.business_model && typeof raw.business_model === "object" && !Array.isArray(raw.business_model)
        ? raw.business_model
        : fallback.business_model,
    confidence_score: Number.isFinite(raw.confidence_score)
      ? Math.round(raw.confidence_score as number)
      : fallback.confidence_score,
    signal_source: typeof raw.signal_source === "string" && raw.signal_source.trim() ? raw.signal_source : fallback.signal_source,
    momentum_pct: Number.isFinite(raw.momentum_pct) ? Number(raw.momentum_pct) : fallback.momentum_pct,
    average_position: Number.isFinite(raw.average_position) ? Number(raw.average_position) : fallback.average_position,
    opportunity_type: typeof raw.opportunity_type === "string" && raw.opportunity_type.trim()
      ? raw.opportunity_type
      : fallback.opportunity_type,
    sample_queries: Array.isArray(raw.sample_queries) && raw.sample_queries.length
      ? raw.sample_queries.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 6)
      : fallback.sample_queries,
    status: typeof raw.status === "string" && raw.status.trim() ? raw.status : fallback.status,
    score_breakdown:
      raw.score_breakdown &&
      typeof raw.score_breakdown === "object" &&
      !Array.isArray(raw.score_breakdown)
        ? {
            growth: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).growth),
            volume: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).volume),
            weakness: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).weakness),
            specificity: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).specificity),
            business: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).business),
            portfolioDistance: toNumber((raw.score_breakdown as Record<string, string | number | null | undefined>).portfolioDistance),
          }
        : fallback.score_breakdown,
    serp_evidence:
      raw.serp_evidence &&
      typeof raw.serp_evidence === "object" &&
      !Array.isArray(raw.serp_evidence)
        ? {
            relatedQuestions: Array.isArray((raw.serp_evidence as Record<string, unknown>).relatedQuestions)
              ? ((raw.serp_evidence as Record<string, unknown>).relatedQuestions as unknown[])
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .slice(0, 8)
              : fallback.serp_evidence?.relatedQuestions ?? [],
            relatedSearches: Array.isArray((raw.serp_evidence as Record<string, unknown>).relatedSearches)
              ? ((raw.serp_evidence as Record<string, unknown>).relatedSearches as unknown[])
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .slice(0, 8)
              : fallback.serp_evidence?.relatedSearches ?? [],
            resultTitles: Array.isArray((raw.serp_evidence as Record<string, unknown>).resultTitles)
              ? ((raw.serp_evidence as Record<string, unknown>).resultTitles as unknown[])
                  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                  .slice(0, 8)
              : fallback.serp_evidence?.resultTitles ?? [],
          }
        : fallback.serp_evidence,
  };
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
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  const sql = getSQL();

  try {
    await initDB();

    const nicheData = (await sql`
      WITH current_window AS (
        SELECT
          query,
          SUM(impressions) AS impressions_30d,
          SUM(clicks) AS clicks_30d,
          AVG(position) AS avg_position_30d,
          COUNT(DISTINCT site_id) AS site_count
        FROM search_console_data
        WHERE date >= NOW() - INTERVAL '30 days'
          AND query IS NOT NULL
          AND impressions >= 5
        GROUP BY query
      ),
      previous_window AS (
        SELECT
          query,
          SUM(impressions) AS impressions_prev_30d
        FROM search_console_data
        WHERE date >= NOW() - INTERVAL '60 days'
          AND date < NOW() - INTERVAL '30 days'
          AND query IS NOT NULL
          AND impressions >= 5
        GROUP BY query
      )
      SELECT
        c.query,
        c.impressions_30d,
        COALESCE(p.impressions_prev_30d, 0) AS impressions_prev_30d,
        c.clicks_30d,
        c.avg_position_30d,
        c.site_count
      FROM current_window c
      LEFT JOIN previous_window p ON p.query = c.query
      WHERE c.impressions_30d >= 25
      ORDER BY c.impressions_30d DESC
      LIMIT 500
    `) as AggregatedKeywordRow[];

    const sites = await sql`SELECT name, url FROM sites WHERE is_active = true`;
    const keywordRows: OpportunityKeywordRow[] = nicheData.map((row) => ({
      query: row.query,
      impressions_30d: toNumber(row.impressions_30d),
      impressions_prev_30d: toNumber(row.impressions_prev_30d),
      clicks_30d: toNumber(row.clicks_30d),
      avg_position_30d: toNumber(row.avg_position_30d),
      site_count: toNumber(row.site_count),
    }));

    const existingQueries = new Set(keywordRows.map((row) => row.query.toLowerCase().trim()));
    const baseKeywordSeeds = keywordRows
      .sort((a, b) => b.impressions_30d - a.impressions_30d)
      .slice(0, 12)
      .map((row) => row.query);
    const externalRows = await buildExternalSignalRows(baseKeywordSeeds, existingQueries);
    const mergedRows = [...keywordRows, ...externalRows];

    const candidates = await enrichCandidatesWithFreeSerpContext(
      buildOpportunityCandidates(mergedRows, {
      minVolume: 5000,
      maxCandidates: 8,
      existingPortfolioHints: [...PORTFOLIO_HINTS, ...sites.map((site) => `${site.name ?? ""} ${site.url ?? ""}`)],
    })
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        opportunities: [],
        keywords_analyzed: mergedRows.length,
        sites_analyzed: sites.length,
      });
    }

    let opportunities: StoredOpportunity[] =
      candidates.map((candidate) => fallbackOpportunity(candidate));

    try {
      const enriched = await enrichCandidatesWithAI(candidates);
      if (enriched?.length) {
        opportunities = enriched
          .slice(0, candidates.length)
          .map((opp, index) => sanitizeOpportunity(opp, fallbackOpportunity(candidates[index]!)));
      }
    } catch (err) {
      console.error("Opportunity enrichment failed, using deterministic fallback:", err);
    }

    try {
      await sql.transaction(
        [
          sql`DELETE FROM market_opportunities WHERE status = 'pending'`,
          ...opportunities.map((opp) => sql`
            INSERT INTO market_opportunities
            (niche, reason, site_type, core_keywords, monthly_volume, competition, monetization,
             projected_traffic_6m, projected_revenue_6m, suggested_domains, seed_articles,
             target_countries, target_languages, competitors, business_model, success_rate, revenue_timeline, confidence_score,
             signal_source, momentum_pct, average_position, opportunity_type, sample_queries, score_breakdown, serp_evidence)
            VALUES (${opp.niche}, ${opp.reason}, ${opp.site_type}, ${JSON.stringify(opp.core_keywords)},
                    ${opp.monthly_volume}, ${opp.competition}, ${opp.monetization},
                    ${opp.projected_traffic_6m}, ${opp.projected_revenue_6m},
                    ${JSON.stringify(opp.suggested_domains)}, ${JSON.stringify(opp.seed_articles)},
                    ${JSON.stringify(opp.target_countries ?? [])}, ${JSON.stringify(opp.target_languages ?? [])},
                    ${JSON.stringify(opp.competitors ?? [])}, ${JSON.stringify(opp.business_model ?? {})},
                    ${opp.success_rate ?? 0}, ${JSON.stringify(opp.revenue_timeline ?? {})},
                    ${opp.confidence_score}, ${opp.signal_source ?? "gsc"},
                    ${opp.momentum_pct ?? 0}, ${opp.average_position ?? 0},
                    ${opp.opportunity_type ?? "emerging"}, ${JSON.stringify(opp.sample_queries ?? [])},
                    ${JSON.stringify(opp.score_breakdown ?? {})}, ${JSON.stringify(opp.serp_evidence ?? {})})
          `),
        ]
      );
    } catch (err) {
      console.error("Failed to store opportunities:", err);
    }

    const persistedRows = await sql`
      SELECT *
      FROM market_opportunities
      ORDER BY confidence_score DESC, created_at DESC
      LIMIT 100
    `;

    return NextResponse.json({
      success: true,
      opportunities: persistedRows,
      keywords_analyzed: mergedRows.length,
      sites_analyzed: sites.length,
      candidate_count: candidates.length,
      external_signals_added: externalRows.length,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}

/**
 * GET /api/opportunities/scan — Returns cached opportunities from DB
 */
export async function GET() {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized;
  }

  const sql = getSQL();
  try {
    const rows = await sql`
      SELECT * FROM market_opportunities
      ORDER BY confidence_score DESC
      LIMIT 100
    `;
    return NextResponse.json({ success: true, opportunities: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to load opportunities", opportunities: [] },
      { status: 500 }
    );
  }
}
