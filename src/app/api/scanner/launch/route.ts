export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSQL, initDB } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { buildLaunchPlan, type LaunchPlan } from "@/lib/scanner-enrichment";
import { logger } from "@/lib/logger";

const LaunchInput = z.object({
  opportunity_id: z.number().int().positive(),
  domain: z.string().trim().min(3).max(120).optional(),
});

interface OpportunityRow {
  id: number;
  niche: string;
  site_type: string;
  core_keywords: unknown;
  sample_queries: unknown;
  serp_evidence: unknown;
  suggested_domains: unknown;
  target_languages: unknown;
  status: string;
  launch_plan: LaunchPlan | null;
}

function parseJsonArrayField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * POST /api/scanner/launch
 *
 * Lightweight "Launch this niche" stub. Creates:
 *  1. A pending site row (no GitHub repo — that's the heavy `/api/opportunities/deploy`)
 *  2. A content_plan with the 3-4 launch articles
 *  3. tracked_keywords seeds for the core keywords
 *  4. Marks opportunity as `planned`
 *
 * Body: { opportunity_id: number; domain?: string }
 */
export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let parsed: z.infer<typeof LaunchInput>;
  try {
    const raw = await req.json();
    parsed = LaunchInput.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  const sql = getSQL();

  try {
    await initDB();

    const rows = (await sql`
      SELECT id, niche, site_type, core_keywords, sample_queries, serp_evidence,
             suggested_domains, target_languages, status, launch_plan
      FROM market_opportunities WHERE id = ${parsed.opportunity_id} LIMIT 1
    `) as OpportunityRow[];

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
    }

    const opp = rows[0];
    const coreKeywords = parseJsonArrayField(opp.core_keywords);
    const sampleQueries = parseJsonArrayField(opp.sample_queries);
    const suggestedDomains = parseJsonArrayField(opp.suggested_domains);
    const languages = parseJsonArrayField(opp.target_languages);

    let relatedQuestions: string[] = [];
    if (opp.serp_evidence && typeof opp.serp_evidence === "object") {
      const serp = opp.serp_evidence as { relatedQuestions?: unknown };
      relatedQuestions = parseJsonArrayField(serp.relatedQuestions);
    }

    const plan = opp.launch_plan ?? buildLaunchPlan({
      niche: opp.niche,
      core_keywords: coreKeywords,
      sample_queries: sampleQueries,
      related_questions: relatedQuestions,
    });

    // Choose domain
    const domain = parsed.domain?.trim() || suggestedDomains[0] || `${opp.niche.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.com`;
    const siteName = opp.niche.slice(0, 100);
    const siteUrl = `https://${domain}`;

    // 1. Insert or fetch site (stub — no GitHub yet)
    let siteId: number;
    const existing = (await sql`SELECT id FROM sites WHERE url = ${siteUrl} LIMIT 1`) as Array<{ id: number }>;
    if (existing.length > 0) {
      siteId = existing[0].id;
    } else {
      const langArrayPg = languages.length > 0 ? languages : ["fr", "en"];
      const inserted = (await sql`
        INSERT INTO sites (name, url, is_active, target_languages)
        VALUES (${siteName}, ${siteUrl}, false, ${langArrayPg as unknown as string[]})
        RETURNING id
      `) as Array<{ id: number }>;
      siteId = inserted[0].id;
    }

    // 2. Insert content plan rows (idempotent: skip if title already exists for site)
    let plannedArticles = 0;
    for (const article of plan.articles) {
      const dup = (await sql`
        SELECT id FROM content_plan
        WHERE site_id = ${siteId} AND title = ${article.title}
        LIMIT 1
      `) as Array<{ id: number }>;
      if (dup.length > 0) continue;
      await sql`
        INSERT INTO content_plan (site_id, opportunity_id, title, target_keyword, status, priority)
        VALUES (${siteId}, ${opp.id}, ${article.title}, ${article.target_keyword}, 'planned', ${article.priority})
      `;
      plannedArticles += 1;
    }

    // 3. Seed tracked_keywords (top 5 core keywords)
    let seededKeywords = 0;
    for (const kw of coreKeywords.slice(0, 5)) {
      const dup = (await sql`
        SELECT id FROM tracked_keywords WHERE site_id = ${siteId} AND keyword = ${kw} LIMIT 1
      `) as Array<{ id: number }>;
      if (dup.length > 0) continue;
      await sql`
        INSERT INTO tracked_keywords (site_id, keyword, is_active)
        VALUES (${siteId}, ${kw}, true)
      `;
      seededKeywords += 1;
    }

    // 4. Update opportunity status + persist plan
    await sql`
      UPDATE market_opportunities
      SET status = 'planned', launch_plan = ${JSON.stringify(plan)}
      WHERE id = ${opp.id}
    `;

    logger.info(
      { opp_id: opp.id, site_id: siteId, articles: plannedArticles, keywords: seededKeywords },
      "scanner launch stub created"
    );

    return NextResponse.json({
      success: true,
      site_id: siteId,
      domain,
      site_url: siteUrl,
      planned_articles: plannedArticles,
      seeded_keywords: seededKeywords,
      launch_plan: plan,
      message: `Site stub créé: ${siteUrl}. ${plannedArticles} articles planifiés, ${seededKeywords} keywords trackés. Lance "Créer ce site" pour pousser sur GitHub.`,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
