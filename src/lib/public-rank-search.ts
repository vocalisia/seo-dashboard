import { searchWebNoKey, type WebSearchResult } from "@/lib/web-research";
import type { BraveSerpResult } from "@/lib/brave-search";

const FRENCH_MARKETS = new Set(["FR", "CH", "BE", "CA"]);

export function publicRankLocale(country: string): string {
  const market = /^[A-Z]{2}$/.test(country.toUpperCase()) ? country.toUpperCase() : "FR";
  const language = FRENCH_MARKETS.has(market) ? "fr" : "en";
  return `${language}-${market}`;
}

export function mapPublicRankResults(results: WebSearchResult[]): BraveSerpResult[] {
  return results.slice(0, 10).flatMap((result, index) => {
    try {
      const domain = new URL(result.url).hostname.replace(/^www\./i, "").toLowerCase();
      if (!domain) return [];
      return [{
        position: index + 1,
        url: result.url,
        title: result.title,
        description: result.snippet,
        domain,
      }];
    } catch {
      return [];
    }
  });
}

export async function publicWebRankSearch(
  query: string,
  country: string,
): Promise<BraveSerpResult[]> {
  const snapshot = await searchWebNoKey(query, publicRankLocale(country), 10);
  const results = mapPublicRankResults(snapshot.results);
  if (results.length === 0) {
    throw new Error("Public web search returned no usable result");
  }
  return results;
}
