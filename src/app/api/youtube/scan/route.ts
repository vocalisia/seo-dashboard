import { NextRequest, NextResponse } from "next/server";
import { scanNiche, NicheScanResult } from "@/lib/youtube";
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
    monetizationSignal: "low",
    monetizationBasis: "keyword_category_heuristic",
    measurementSource: "unavailable",
    measurementWindow: "unavailable",
    subscriberDataStatus: "unavailable",
    likeDataStatus: "unavailable",
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
      return NextResponse.json({ error: "Maximum 10 niches par scan" }, { status: 400 });
    }

    const cleanKeywords = rawKeywords
      .map((keyword) => (typeof keyword === "string" ? keyword.trim() : ""))
      .filter(Boolean)
      .slice(0, 10);

    if (cleanKeywords.length === 0) {
      return NextResponse.json({ error: "Aucun mot-cle exploitable" }, { status: 400 });
    }

    const now = Date.now();
    let cacheHits = 0;
    let quotaUnitsEstimated = 0;

    const results = await mapLimit(cleanKeywords, 2, async (keyword): Promise<NicheScanResult> => {
      const cacheKey = keyword.toLowerCase();
      const cached = CACHE.get(cacheKey);
      if (cached && now - cached.ts < CACHE_TTL_MS) {
        cacheHits++;
        return cached.result;
      }

      try {
        const result = await scanNiche(keyword);
        if (result.measurementSource === "youtube_data_api") quotaUnitsEstimated += 202;
        CACHE.set(cacheKey, { ts: now, result });
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        return errorResult(keyword, message);
      }
    });

    const successfulResults = results.filter((result) => !result.error);
    const failedResults = results.filter((result) => Boolean(result.error));

    if (successfulResults.length === 0) {
      return NextResponse.json({
        success: false,
        partial: false,
        error: "Aucune niche n'a pu être mesurée via l'API ni la recherche publique YouTube.",
        results,
        cache_hits: cacheHits,
        quota_units_estimated: quotaUnitsEstimated,
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      partial: failedResults.length > 0,
      results,
      cache_hits: cacheHits,
      quota_units_estimated: quotaUnitsEstimated,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
