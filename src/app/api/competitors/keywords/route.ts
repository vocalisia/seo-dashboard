export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { logError } from "@/lib/logger";
import { requireApiSession } from "@/lib/api-auth";
import { ensureCompetitorResearchSchema } from "@/lib/competitor-research-schema";

const QUESTION_WORDS = [
  "comment", "pourquoi", "combien", "quand", "quel", "quelle", "quels", "quelles", "qu'est", "qu est",
  "est-ce", "où", "ou", "qui", "que", "quoi",
  "how", "what", "why", "when", "which", "where", "who", "is", "are", "does", "do", "can", "should",
  "best", "top", "meilleur", "meilleure", "comparatif",
];

interface KeywordRow {
  keyword: string;
  volume: number;
  volume_source: string | null;
  position: number;
  difficulty: string;
  intent: string;
}

interface CategoryStats {
  count: number;
  total_volume: number;
  top: KeywordRow[];
}

function isQuestion(kw: string): boolean {
  const lower = kw.toLowerCase().trim();
  if (lower.includes("?")) return true;
  return QUESTION_WORDS.some((w) => lower.startsWith(w + " ") || lower.startsWith(w + "'"));
}

function wordCount(kw: string): number {
  return kw.trim().split(/\s+/).filter(Boolean).length;
}

function categorize(kw: string): "questions" | "longtail" | "general" {
  if (isQuestion(kw)) return "questions";
  if (wordCount(kw) >= 4) return "longtail";
  return "general";
}

/**
 * GET /api/competitors/keywords?site_id=X&competitor_domain=Y
 *
 * Returns ALL keywords for that competitor split into 3 categories:
 *  - general  (1-3 words)
 *  - longtail (4+ words)
 *  - questions (starts with question word)
 *
 * Each category includes count, total volume, top-5 keywords by volume.
 */
export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const siteIdRaw = req.nextUrl.searchParams.get("site_id");
  const domain = req.nextUrl.searchParams.get("competitor_domain")?.trim();

  if (!siteIdRaw || !domain) {
    return NextResponse.json(
      { success: false, error: "site_id and competitor_domain required" },
      { status: 400 },
    );
  }
  const siteId = Number(siteIdRaw);
  if (!Number.isInteger(siteId) || siteId <= 0 || domain.length > 500) {
    return NextResponse.json(
      { success: false, error: "site_id invalid" },
      { status: 400 },
    );
  }

  const sql = getSQL();
  try {
    await ensureCompetitorResearchSchema(sql);
    const rows = (await sql`
      SELECT
        cr.keyword,
        COALESCE(kp.volume_market, cr.estimated_volume) AS estimated_volume,
        kp.volume_source,
        cr.competitor_position,
        cr.difficulty,
        cr.intent
      FROM competitor_research cr
      LEFT JOIN LATERAL (
        SELECT tk.volume_market, tk.volume_source
        FROM tracked_keywords tk
        WHERE LOWER(tk.keyword) = LOWER(cr.keyword)
          AND tk.volume_source LIKE 'google_kp_real_%'
          AND tk.volume_market IS NOT NULL
          AND tk.volume_market > 0
        ORDER BY tk.volume_market DESC
        LIMIT 1
      ) kp ON TRUE
      WHERE cr.site_id = ${siteId}
        AND LOWER(cr.competitor_domain) = LOWER(${domain})
        AND cr.keyword IS NOT NULL
        AND cr.engine_version = 'local-research-v2'
        AND cr.source_kind = 'public_web'
      ORDER BY estimated_volume DESC NULLS LAST, cr.evidence_score DESC NULLS LAST
    `) as {
      keyword: string;
      estimated_volume: number | null;
      volume_source: string | null;
      competitor_position: number | null;
      difficulty: string | null;
      intent: string | null;
    }[];

    const buckets: Record<"general" | "longtail" | "questions", KeywordRow[]> = {
      general: [],
      longtail: [],
      questions: [],
    };

    for (const r of rows) {
      const kw = (r.keyword || "").trim();
      if (!kw) continue;
      const cat = categorize(kw);
      buckets[cat].push({
        keyword: kw,
        volume: Number(r.estimated_volume) || 0,
        volume_source: r.volume_source,
        position: Number(r.competitor_position) || 0,
        difficulty: r.difficulty ?? "",
        intent: r.intent ?? "",
      });
    }

    function summarize(list: KeywordRow[]): CategoryStats {
      const total_volume = list.reduce((s, k) => s + k.volume, 0);
      return {
        count: list.length,
        total_volume,
        top: list.slice(0, 5),
      };
    }

    return NextResponse.json({
      success: true,
      site_id: siteId,
      competitor_domain: domain,
      total_keywords: rows.length,
      metric_boundaries: {
        volume: "verified_keyword_planner_import_only",
        position: "not_measured_for_public_research",
        difficulty: "not_measured",
      },
      categories: {
        general: summarize(buckets.general),
        longtail: summarize(buckets.longtail),
        questions: summarize(buckets.questions),
      },
    });
  } catch (err) {
    logError("competitors.keywords.GET", err, { siteId, domain });
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
