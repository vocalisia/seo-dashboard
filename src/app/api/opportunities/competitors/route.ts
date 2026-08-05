export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";
import { runWebResearch } from "@/lib/web-research";

interface Competitor {
  url: string;
  name: string;
  title: string;
  description: string;
  source_id: string;
  evidence_score: number;
  discovery_rank: number;
  rank_scope: "multi_source_fused_discovery";
}

function readKeywords(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
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
  const opportunityId = body.opportunity_id;
  if (!Number.isInteger(opportunityId) || Number(opportunityId) <= 0) {
    return NextResponse.json({ success: false, error: "opportunity_id required" }, { status: 400 });
  }

  const sql = getSQL();
  try {
    const rows = await sql`
      SELECT id, niche, core_keywords
      FROM market_opportunities
      WHERE id = ${opportunityId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    const opportunity = rows[0] as { id: number; niche: string; core_keywords: unknown };
    const keywords = readKeywords(opportunity.core_keywords);
    const researchQuery = [opportunity.niche, ...keywords.slice(0, 2)].filter(Boolean).join(" ");
    const report = await runWebResearch(researchQuery, {
      locale: "fr-FR",
      maxSources: 12,
      maxQueries: 8,
      depth: "deep",
      focus: "competitors",
    });
    const competitors: Competitor[] = report.sources.slice(0, 8).map((source, index) => ({
      url: source.url,
      name: source.domain,
      title: source.title,
      description: source.description,
      source_id: source.id,
      evidence_score: source.source_score ?? 0,
      discovery_rank: index + 1,
      rank_scope: "multi_source_fused_discovery",
    }));

    if (competitors.length > 0) {
      await sql`
        UPDATE market_opportunities
        SET competitors = ${JSON.stringify(competitors)}
        WHERE id = ${opportunityId}
      `;
    }

    return NextResponse.json({
      success: report.data_status !== "unavailable",
      data_status: report.data_status,
      competitors,
      queries: (report.query_plan ?? []).map((step) => step.query),
      providers: report.search_providers,
      rank_scope: "multi_source_fused_discovery",
      ranking_notice: "L'ordre reflète la fusion des sources publiques, pas un classement Google.",
      metric_boundaries: report.metric_boundaries,
    }, { status: report.data_status === "unavailable" ? 503 : 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Research unavailable" },
      { status: 500 },
    );
  }
}
