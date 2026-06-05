import { NextRequest, NextResponse } from "next/server";
import { scanNiche, NicheScanResult } from "@/lib/youtube";
import { auth } from "@/auth";
import { requireApiSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE = new Map<string, { ts: number; result: NicheScanResult }>();

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

function errorResult(keyword: string, message: string): NicheScanResult {
  return {
    keyword,
    channelCount: 0,
    avgSubscribers: 0,
    topChannels: [],
    recentTopVideos: [],
    avgRecentViews: 0,
    demandScore: 0,
    competitionScore: 0,
    opportunityScore: 0,
    estimatedCPM: { min: 0, max: 0 },
    recommendation: "Erreur lors du scan",
    error: message,
  };
}

export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const body = await request.json() as { keywords?: unknown };
    const rawKeywords = body.keywords;

    if (!Array.isArray(rawKeywords) || rawKeywords.length === 0) {
      return NextResponse.json({ error: "keywords[] requis" }, { status: 400 });
    }

    if (rawKeywords.length > 10) {
      return NextResponse.json({ error: "Maximum 10 niches par scan (quota API)" }, { status: 400 });
    }

    const cleanKeywords = rawKeywords
      .map((keyword) => (typeof keyword === "string" ? keyword.trim() : ""))
      .filter(Boolean)
      .slice(0, 10);

    if (cleanKeywords.length === 0) {
      return NextResponse.json({ error: "Aucun mot-cle exploitable" }, { status: 400 });
    }

    const session = await auth();
    const accessToken = session?.accessToken as string | undefined;
    const now = Date.now();
    let cacheHits = 0;

    const results = await mapLimit(cleanKeywords, 2, async (keyword): Promise<NicheScanResult> => {
      const cacheKey = keyword.toLowerCase();
      const cached = CACHE.get(cacheKey);
      if (cached && now - cached.ts < CACHE_TTL_MS) {
        cacheHits++;
        return cached.result;
      }

      try {
        const result = await scanNiche(keyword, accessToken);
        CACHE.set(cacheKey, { ts: now, result });
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        return errorResult(keyword, message);
      }
    });

    return NextResponse.json({
      success: true,
      results,
      cache_hits: cacheHits,
      quota_units_estimated: (cleanKeywords.length - cacheHits) * 202,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
