import { NextRequest, NextResponse } from "next/server";
import { scanNiche, NicheScanResult } from "@/lib/youtube";
import { auth } from "@/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const keywords: string[] = body.keywords;

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: "keywords[] requis" }, { status: 400 });
    }

    if (keywords.length > 10) {
      return NextResponse.json({ error: "Maximum 10 niches par scan (quota API)" }, { status: 400 });
    }

    const session = await auth();
    const accessToken = session?.accessToken as string | undefined;

    const results: NicheScanResult[] = [];

    for (const keyword of keywords) {
      const trimmed = keyword.trim();
      if (!trimmed) continue;
      try {
        const result = await scanNiche(trimmed, accessToken);
        results.push(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        results.push({
          keyword: trimmed,
          channelCount: 0,
          avgSubscribers: 0,
          topChannels: [],
          recentTopVideos: [],
          avgRecentViews: 0,
          demandScore: 0,
          competitionScore: 0,
          opportunityScore: 0,
          estimatedCPM: { min: 0, max: 0 },
          recommendation: "❌ Erreur lors du scan",
          error: message,
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
