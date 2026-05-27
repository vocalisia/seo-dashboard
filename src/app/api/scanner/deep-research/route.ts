export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";

import { getSQL, initDB } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { runDeepResearch, type DeepResearchPayload } from "@/lib/scanner-enrichment";
import { logger } from "@/lib/logger";

const DeepResearchInput = z.object({
  niche: z.string().trim().min(2).max(200),
  keyword: z.string().trim().min(2).max(200).optional(),
  force: z.boolean().optional(),
});

function nicheKey(niche: string, keyword: string): string {
  const seed = `${niche.toLowerCase().trim()}::${keyword.toLowerCase().trim()}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 48);
}

/**
 * POST /api/scanner/deep-research
 *
 * Real SERP deep research for a niche keyword. Scrapes Google SERP (free, no API key),
 * extracts top 3 page content, derives content angles + gaps.
 *
 * Cached in `scanner_deep_research` with 7-day TTL.
 *
 * body: { niche: string; keyword?: string; force?: boolean }
 */
export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let parsed: z.infer<typeof DeepResearchInput>;
  try {
    const raw = await req.json();
    parsed = DeepResearchInput.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  const niche = parsed.niche;
  const keyword = parsed.keyword?.trim() || niche;
  const key = nicheKey(niche, keyword);

  const sql = getSQL();

  try {
    await initDB();

    // Cache hit?
    if (!parsed.force) {
      const cached = (await sql`
        SELECT research_json, created_at, expires_at
        FROM scanner_deep_research
        WHERE niche_key = ${key} AND expires_at > NOW()
        LIMIT 1
      `) as Array<{ research_json: DeepResearchPayload; created_at: string; expires_at: string }>;
      if (cached.length > 0) {
        return NextResponse.json({
          success: true,
          cached: true,
          fetched_at: cached[0].created_at,
          expires_at: cached[0].expires_at,
          research: cached[0].research_json,
        });
      }
    }

    const research = await runDeepResearch(keyword, niche);

    // Persist (upsert)
    try {
      await sql`
        INSERT INTO scanner_deep_research (niche_key, keyword, research_json, created_at, expires_at)
        VALUES (${key}, ${keyword}, ${JSON.stringify(research)}, NOW(), NOW() + INTERVAL '7 days')
        ON CONFLICT (niche_key) DO UPDATE
          SET research_json = EXCLUDED.research_json,
              keyword = EXCLUDED.keyword,
              created_at = NOW(),
              expires_at = NOW() + INTERVAL '7 days'
      `;
    } catch (err) {
      logger.warn({ err }, "scanner_deep_research persist failed (non-blocking)");
    }

    return NextResponse.json({
      success: true,
      cached: false,
      fetched_at: research.fetched_at,
      research,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/scanner/deep-research?niche=...&keyword=...
 * Read-only cache lookup. Returns null if no cache.
 */
export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const url = new URL(req.url);
  const niche = url.searchParams.get("niche")?.trim() ?? "";
  const keyword = url.searchParams.get("keyword")?.trim() || niche;

  if (!niche || niche.length < 2) {
    return NextResponse.json({ success: false, error: "niche query param required" }, { status: 400 });
  }

  const key = nicheKey(niche, keyword);
  const sql = getSQL();

  try {
    const rows = (await sql`
      SELECT research_json, created_at, expires_at
      FROM scanner_deep_research
      WHERE niche_key = ${key} AND expires_at > NOW()
      LIMIT 1
    `) as Array<{ research_json: DeepResearchPayload; created_at: string; expires_at: string }>;

    if (rows.length === 0) {
      return NextResponse.json({ success: true, cached: false, research: null });
    }

    return NextResponse.json({
      success: true,
      cached: true,
      fetched_at: rows[0].created_at,
      expires_at: rows[0].expires_at,
      research: rows[0].research_json,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
