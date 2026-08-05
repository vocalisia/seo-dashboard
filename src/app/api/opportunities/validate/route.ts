export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";

interface StoredCompetitor {
  url?: string;
  name?: string;
  title?: string;
  source_id?: string;
  evidence_score?: number;
}

interface StoredSerpEvidence {
  relatedQuestions: string[];
  relatedSearches: string[];
  resultTitles: string[];
  resultUrls: string[];
}

interface OpportunityValidation {
  verdict: "RISKY" | "NO_GO";
  verdict_reason: string;
  attackability_score: number;
  score_scope: "stored_evidence_coverage_not_keyword_difficulty";
  time_to_page1_months: null;
  time_to_page1_status: "not_measured";
  keyword_analysis: Array<{
    keyword: string;
    observed_domains: string[];
    estimated_difficulty: "unknown";
    avg_competitor_dr: null;
    google_position: null;
  }>;
  content_gaps: string[];
  strategy_recommendation: string;
  quick_wins: string[];
  metric_boundaries: {
    search_volume: "not_measured";
    keyword_difficulty: "not_measured";
    backlink_authority: "not_measured";
    google_position: "not_measured";
  };
  engine_version: "local-validation-v2";
}

function readArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStrings(value: unknown): string[] {
  return readArray(value)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function readCompetitors(value: unknown): StoredCompetitor[] {
  return readArray(value)
    .filter((item): item is StoredCompetitor => typeof item === "object" && item !== null)
    .slice(0, 12);
}

function readSerpEvidence(value: unknown): StoredSerpEvidence {
  let parsed: Record<string, unknown> = {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    parsed = value as Record<string, unknown>;
  } else if (typeof value === "string") {
    try {
      const candidate = JSON.parse(value) as unknown;
      if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
  }
  return {
    relatedQuestions: readStrings(parsed.relatedQuestions),
    relatedSearches: readStrings(parsed.relatedSearches),
    resultTitles: readStrings(parsed.resultTitles),
    resultUrls: readStrings(parsed.resultUrls),
  };
}

function domainFromCompetitor(competitor: StoredCompetitor): string | null {
  const raw = competitor.url ?? competitor.name;
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw)
      .hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function buildStoredOpportunityValidation(
  niche: string,
  keywords: string[],
  competitors: StoredCompetitor[],
  evidence: StoredSerpEvidence,
): OpportunityValidation {
  const domains = Array.from(new Set(competitors
    .map(domainFromCompetitor)
    .filter((domain): domain is string => Boolean(domain))));
  const evidenceItems = Array.from(new Set([
    ...evidence.relatedQuestions,
    ...evidence.relatedSearches,
    ...evidence.resultTitles,
  ]));
  const sourceCount = domains.length;
  const evidenceCount = evidenceItems.length;
  const hasEnoughEvidence = sourceCount >= 2 && evidenceCount >= 2;
  const score = hasEnoughEvidence
    ? Math.min(60, 15 + sourceCount * 6 + Math.min(20, evidenceCount * 2))
    : 0;
  const questions = evidence.relatedQuestions.slice(0, 6);
  const contentGaps = (questions.length > 0 ? questions : evidence.relatedSearches)
    .slice(0, 6)
    .map((item) => "Vérifier puis couvrir le sous-thème déjà observé : " + item);
  const quickWins = domains.slice(0, 5)
    .map((domain) => "Comparer manuellement la couverture, les sources et la fraîcheur de " + domain + ".");

  return {
    verdict: hasEnoughEvidence ? "RISKY" : "NO_GO",
    verdict_reason: hasEnoughEvidence
      ? "Des concurrents et sous-thèmes publics sont enregistrés pour « " + niche
        + " », mais le dashboard ne possède pas de mesure de difficulté SEO, de backlinks ou de rang Google permettant un GO honnête."
      : "Les preuves enregistrées sont insuffisantes. Charge d'abord les concurrents et la recherche approfondie; aucun score favorable ne sera inventé.",
    attackability_score: score,
    score_scope: "stored_evidence_coverage_not_keyword_difficulty",
    time_to_page1_months: null,
    time_to_page1_status: "not_measured",
    keyword_analysis: keywords.map((keyword) => ({
      keyword,
      observed_domains: domains,
      estimated_difficulty: "unknown",
      avg_competitor_dr: null,
      google_position: null,
    })),
    content_gaps: contentGaps,
    strategy_recommendation:
      "Utiliser les preuves enregistrées pour préparer les angles. Mesurer ensuite volume, backlinks et SERP Google avec des sources dédiées avant toute décision de lancement.",
    quick_wins: quickWins,
    metric_boundaries: {
      search_volume: "not_measured",
      keyword_difficulty: "not_measured",
      backlink_authority: "not_measured",
      google_position: "not_measured",
    },
    engine_version: "local-validation-v2",
  };
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: { opportunity_id?: number };
  try {
    body = (await req.json()) as { opportunity_id?: number };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!Number.isInteger(body.opportunity_id) || Number(body.opportunity_id) <= 0) {
    return NextResponse.json({ success: false, error: "opportunity_id required" }, { status: 400 });
  }

  const sql = getSQL();
  try {
    const rows = await sql`
      SELECT id, niche, core_keywords, competitors, serp_evidence
      FROM market_opportunities
      WHERE id = ${body.opportunity_id}
        AND engine_version = 'local-opportunity-v2'
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    const opportunity = rows[0] as Record<string, unknown>;
    const analysis = buildStoredOpportunityValidation(
      String(opportunity.niche ?? ""),
      readStrings(opportunity.core_keywords).slice(0, 6),
      readCompetitors(opportunity.competitors),
      readSerpEvidence(opportunity.serp_evidence),
    );

    await sql`
      UPDATE market_opportunities
      SET validation = ${JSON.stringify(analysis)}
      WHERE id = ${body.opportunity_id}
    `;

    return NextResponse.json({
      success: true,
      niche: opportunity.niche,
      ...analysis,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Validation unavailable" },
      { status: 500 },
    );
  }
}
