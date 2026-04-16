import type { OpportunityKeywordRow } from "./opportunity-engine";

const SUGGEST_PREFIXES = [
  "comment",
  "pourquoi",
  "meilleur",
  "prix",
  "logiciel",
  "outil",
  "vs",
];

const TREND_LOCALES = [
  { geo: "FR", language: "fr-FR" },
  { geo: "US", language: "en-US" },
  { geo: "GB", language: "en-GB" },
];

type SerpSnapshot = {
  relatedQuestions: string[];
  relatedSearches: string[];
  resultTitles: string[];
};

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

type SuggestResponse = [string, string[]] | [string, string[], unknown, unknown];

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeQuery(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractSerpSnippetValues(html: string, marker: RegExp): string[] {
  const values: string[] = [];
  for (const match of html.matchAll(marker)) {
    const value = decodeHtml(match[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (value) values.push(value);
  }
  return dedupe(values);
}

export async function fetchGoogleSuggestions(seed: string): Promise<string[]> {
  const variants = dedupe([seed, ...SUGGEST_PREFIXES.map((prefix) => `${prefix} ${seed}`)]);
  const collected: string[] = [];

  await Promise.all(
    variants.map(async (query) => {
      try {
        const url = new URL("https://suggestqueries.google.com/complete/search");
        url.searchParams.set("client", "firefox");
        url.searchParams.set("hl", "fr");
        url.searchParams.set("q", query);

        const response = await fetchWithTimeout(url.toString(), {
          headers: { "User-Agent": "Mozilla/5.0 SEO Dashboard Opportunity Scanner" },
          next: { revalidate: 3600 },
        });
        if (!response.ok) return;

        const data = (await response.json()) as SuggestResponse;
        const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
        collected.push(...suggestions);
      } catch {
        // ignore provider errors; the main engine should still work from GSC data
      }
    })
  );

  return dedupe(collected).slice(0, 30);
}

export async function fetchTrendingQueries(limit = 25): Promise<string[]> {
  const collected: string[] = [];

  await Promise.all(
    TREND_LOCALES.map(async ({ geo, language }) => {
      try {
        const url = new URL("https://trends.google.com/trending/rss");
        url.searchParams.set("geo", geo);
        const response = await fetchWithTimeout(url.toString(), {
          headers: { "Accept-Language": language, "User-Agent": "Mozilla/5.0 SEO Dashboard Opportunity Scanner" },
          next: { revalidate: 3600 },
        });
        if (!response.ok) return;

        const xml = await response.text();
        const matches = Array.from(xml.matchAll(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/g));
        for (const match of matches.slice(1)) {
          if (match[1]) collected.push(match[1]);
        }
      } catch {
        // ignore provider errors
      }
    })
  );

  return dedupe(collected).slice(0, limit);
}

export async function fetchGoogleSerpSnapshot(query: string): Promise<SerpSnapshot> {
  try {
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("hl", "fr");
    url.searchParams.set("gl", "fr");
    url.searchParams.set("q", query);

    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      next: { revalidate: 3600 },
    }, 5000);

    if (!response.ok) {
      return { relatedQuestions: [], relatedSearches: [], resultTitles: [] };
    }

    const html = await response.text();
    const relatedQuestions = extractSerpSnippetValues(
      html,
      /"(?:related-question-pair|question)":\{"(?:.+?)?"?question":"([^"]+)"/g
    );
    const relatedSearches = extractSerpSnippetValues(
      html,
      /"query":"([^"]+)","label":"[^"]*related searches/gi
    );
    const resultTitles = extractSerpSnippetValues(
      html,
      /<h3[^>]*>(.*?)<\/h3>/g
    ).slice(0, 10);

    if (html.length > 0 && relatedQuestions.length === 0 && relatedSearches.length === 0 && resultTitles.length === 0) {
      console.warn(`[opportunity-sources] SERP snapshot returned no usable signals for query "${query}"`);
    }

    return {
      relatedQuestions: relatedQuestions.slice(0, 10),
      relatedSearches: relatedSearches.slice(0, 10),
      resultTitles,
    };
  } catch {
    return { relatedQuestions: [], relatedSearches: [], resultTitles: [] };
  }
}

export async function buildExternalSignalRows(
  baseKeywords: string[],
  existingQueries: Set<string>
): Promise<OpportunityKeywordRow[]> {
  const seeds = dedupe(baseKeywords).slice(0, 5);
  const suggestionGroups = await Promise.all(seeds.map((seed) => fetchGoogleSuggestions(seed)));
  const trending = await fetchTrendingQueries();
  const serpSnapshots = await Promise.all(seeds.slice(0, 3).map((seed) => fetchGoogleSerpSnapshot(seed)));
  const serpDerived = serpSnapshots.flatMap((snapshot) => [
    ...snapshot.relatedQuestions,
    ...snapshot.relatedSearches,
  ]);

  const rows: OpportunityKeywordRow[] = [];

  for (const query of dedupe([...suggestionGroups.flat(), ...trending, ...serpDerived])) {
    const normalized = normalizeQuery(query);
    if (!normalized || existingQueries.has(normalized)) continue;

    const words = normalized.split(" ").length;
    const fromTrendFeed = trending.some((item) => normalizeQuery(item) === normalized);
    const fromSerp = serpDerived.some((item) => normalizeQuery(item) === normalized);
    const impressionsBase = fromTrendFeed ? 9000 : fromSerp ? 6500 : 5500;

    rows.push({
      query,
      impressions_30d: impressionsBase + Math.max(0, words - 2) * 900,
      impressions_prev_30d: fromTrendFeed ? Math.round(impressionsBase * 0.25) : fromSerp ? Math.round(impressionsBase * 0.45) : Math.round(impressionsBase * 0.55),
      clicks_30d: Math.round(impressionsBase * 0.015),
      avg_position_30d: fromTrendFeed ? 26 : fromSerp ? 23 : 22,
      site_count: 0,
    });
  }

  return rows.slice(0, 80);
}
