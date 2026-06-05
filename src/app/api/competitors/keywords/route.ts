export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { logError } from "@/lib/logger";

const QUESTION_WORDS = [
  "comment", "pourquoi", "combien", "quand", "quel", "quelle", "quels", "quelles", "qu'est", "qu est",
  "est-ce", "où", "ou", "qui", "que", "quoi",
  "how", "what", "why", "when", "which", "where", "who", "is", "are", "does", "do", "can", "should",
  "best", "top", "meilleur", "meilleure", "comparatif",
];

interface KeywordRow {
  keyword: string;
  volume: number;
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
  const siteIdRaw = req.nextUrl.searchParams.get("site_id");
  const domain = req.nextUrl.searchParams.get("competitor_domain");

  if (!siteIdRaw || !domain) {
    return NextResponse.json(
      { success: false, error: "site_id and competitor_domain required" },
      { status: 400 },
    );
  }
  const siteId = parseInt(siteIdRaw, 10);
  if (!Number.isFinite(siteId)) {
    return NextResponse.json(
      { success: false, error: "site_id invalid" },
      { status: 400 },
    );
  }

  const sql = getSQL();
  try {
    const rows = (await sql`
      SELECT keyword, estimated_volume, competitor_position, difficulty, intent
      FROM competitor_research
      WHERE site_id = ${siteId}
        AND LOWER(competitor_domain) = LOWER(${domain})
        AND keyword IS NOT NULL
      ORDER BY estimated_volume DESC
    `) as {
      keyword: string;
      estimated_volume: number;
      competitor_position: number;
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
