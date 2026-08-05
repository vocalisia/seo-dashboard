import { fetchResearchText, parseResearchPublicUrl } from "@/lib/web-research-fetch";

export type WebSearchProvider = "bing_rss" | "duckduckgo_html";

export interface WebSearchResult {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  providers: WebSearchProvider[];
  positions: Partial<Record<WebSearchProvider, number>>;
}

export interface ResearchSource extends WebSearchResult {
  id: string;
  fetch_status: "ok" | "search_only";
  description: string;
  headings: string[];
  schema_types: string[];
  word_count: number;
  excerpt: string;
}

export interface ResearchEvidence {
  source_id: string;
  claim: string;
  score: number;
}

export interface WebResearchReport {
  query: string;
  locale: string;
  generated_at: string;
  data_status: "complete" | "partial" | "unavailable";
  search_providers: Record<WebSearchProvider, "ok" | "empty" | "failed">;
  answer: string;
  evidence: ResearchEvidence[];
  sources: ResearchSource[];
}

interface InternalSource extends ResearchSource {
  body_text: string;
}

const TRACKING_PARAMS = /^(utm_.+|gclid|fbclid|msclkid|ref|ref_src)$/i;
const SEARCH_USER_AGENT = "Mozilla/5.0 (compatible; SEO-Dashboard-Research/1.0)";

function decodeNumericEntity(raw: string, radix: number, fallback: string): string {
  const point = Number.parseInt(raw, radix);
  return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
    ? String.fromCodePoint(point)
    : fallback;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => decodeNumericEntity(hex, 16, match))
    .replace(/&#(\d+);/g, (match, dec: string) => decodeNumericEntity(dec, 10, match))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeResearchUrl(raw: string): string {
  const url = parseResearchPublicUrl(raw);
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function xmlValue(value: string): string {
  const cdata = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1];
  return cleanText(cdata ?? value);
}

function makeResult(
  rawUrl: string,
  title: string,
  snippet: string,
  provider: WebSearchProvider,
  position: number,
): WebSearchResult | null {
  try {
    const url = canonicalizeResearchUrl(rawUrl);
    const domain = new URL(url).hostname;
    if (domain.endsWith("bing.com") || domain.endsWith("duckduckgo.com") || domain.endsWith("microsoft.com")) {
      return null;
    }
    return {
      url,
      domain,
      title: cleanText(title).slice(0, 240) || domain,
      snippet: cleanText(snippet).slice(0, 500),
      providers: [provider],
      positions: { [provider]: position },
    };
  } catch {
    return null;
  }
}

export function parseBingRss(xml: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  let position = 0;
  for (const item of items) {
    position += 1;
    const block = item[1] ?? "";
    const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "";
    const snippet = block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "";
    const result = makeResult(xmlValue(link), xmlValue(title), xmlValue(snippet), "bing_rss", position);
    if (result) results.push(result);
  }
  return results.slice(0, 10);
}

function decodeDuckDuckGoUrl(rawHref: string): string {
  const href = decodeHtmlEntities(rawHref);
  try {
    const redirect = new URL(href, "https://duckduckgo.com");
    const target = redirect.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : redirect.toString();
  } catch {
    return href;
  }
}

export function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blocks = html.matchAll(/<div[^>]+class="[^"]*result(?:\s|__)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*result(?:\s|__)[^"]*"|<\/body>)/gi);
  let position = 0;
  for (const blockMatch of blocks) {
    const block = blockMatch[1] ?? "";
    const anchor = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    position += 1;
    const snippet = block.match(/<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] ?? "";
    const result = makeResult(decodeDuckDuckGoUrl(anchor[1]), anchor[2], snippet, "duckduckgo_html", position);
    if (result) results.push(result);
  }

  // DuckDuckGo changes wrappers periodically; retain a conservative redirect fallback.
  if (results.length === 0) {
    let fallbackPosition = 0;
    for (const match of html.matchAll(/<a[^>]+href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      fallbackPosition += 1;
      const result = makeResult(decodeDuckDuckGoUrl(match[1]), match[2], "", "duckduckgo_html", fallbackPosition);
      if (result) results.push(result);
    }
  }
  return results.slice(0, 10);
}

function researchDedupeKey(raw: string): string {
  const url = new URL(raw);
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  return `${host}${url.pathname}${url.search}`;
}

export function mergeSearchResults(groups: WebSearchResult[][], limit = 10): WebSearchResult[] {
  const merged = new Map<string, WebSearchResult>();
  for (const group of groups) {
    for (const result of group) {
      const key = researchDedupeKey(result.url);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...result, providers: [...result.providers], positions: { ...result.positions } });
        continue;
      }
      for (const provider of result.providers) {
        if (!existing.providers.includes(provider)) existing.providers.push(provider);
      }
      for (const [provider, position] of Object.entries(result.positions) as Array<[WebSearchProvider, number]>) {
        const previous = existing.positions[provider];
        existing.positions[provider] = previous === undefined ? position : Math.min(previous, position);
      }
      if (!existing.snippet && result.snippet) existing.snippet = result.snippet;
    }
  }
  return [...merged.values()]
    .sort((a, b) => {
      const aConsensus = a.providers.length;
      const bConsensus = b.providers.length;
      if (aConsensus !== bConsensus) return bConsensus - aConsensus;
      const aPos = Math.min(...Object.values(a.positions).filter((v): v is number => typeof v === "number"));
      const bPos = Math.min(...Object.values(b.positions).filter((v): v is number => typeof v === "number"));
      return aPos - bPos;
    })
    .slice(0, Math.max(1, Math.min(20, limit)));
}

function localeParts(locale: string): { language: string; market: string } {
  const normalized = locale.toLowerCase().replace("_", "-");
  const [language = "fr", market = language === "fr" ? "fr" : "us"] = normalized.split("-");
  return {
    language: /^[a-z]{2}$/.test(language) ? language : "fr",
    market: /^[a-z]{2}$/.test(market) ? market : "fr",
  };
}

async function fetchSearchText(url: URL): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": SEARCH_USER_AGENT, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Search provider returned ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > 300_000) {
    throw new Error("Search provider response is too large");
  }
  return readTextLimited(response, 300_000);
}

export async function searchWebNoKey(
  query: string,
  locale = "fr-FR",
  limit = 10,
): Promise<{ results: WebSearchResult[]; providers: WebResearchReport["search_providers"] }> {
  const normalizedQuery = query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (normalizedQuery.length < 2) throw new Error("Research query is too short");
  const { language, market } = localeParts(locale);

  const bingUrl = new URL("https://www.bing.com/search");
  bingUrl.searchParams.set("q", normalizedQuery);
  bingUrl.searchParams.set("format", "rss");
  bingUrl.searchParams.set("setlang", language);
  bingUrl.searchParams.set("cc", market);

  const duckUrl = new URL("https://html.duckduckgo.com/html/");
  duckUrl.searchParams.set("q", normalizedQuery);
  duckUrl.searchParams.set("kl", `${market}-${language}`);

  const [bingSettled, duckSettled] = await Promise.allSettled([
    fetchSearchText(bingUrl),
    fetchSearchText(duckUrl),
  ]);
  const bing = bingSettled.status === "fulfilled" ? parseBingRss(bingSettled.value) : [];
  const duck = duckSettled.status === "fulfilled" ? parseDuckDuckGoHtml(duckSettled.value) : [];

  return {
    results: mergeSearchResults([bing, duck], limit),
    providers: {
      bing_rss: bingSettled.status === "rejected" ? "failed" : bing.length > 0 ? "ok" : "empty",
      duckduckgo_html: duckSettled.status === "rejected" ? "failed" : duck.length > 0 ? "ok" : "empty",
    },
  };
}

async function readTextLimited(response: Response, maxBytes = 500_000): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: bytes < maxBytes });
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

function metaContent(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return cleanText(value);
  }
  return "";
}

function extractSchemaTypes(html: string): string[] {
  const types = new Set<string>();
  for (const script of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const match of (script[1] ?? "").matchAll(/["']@type["']\s*:\s*["']([^"']+)["']/gi)) {
      if (match[1]) types.add(match[1].slice(0, 80));
    }
  }
  return [...types].slice(0, 20);
}

function htmlToVisibleText(html: string): string {
  return cleanText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, ". ")
      .replace(/<\/(?:p|li|h[1-6]|article|section|div)>/gi, ". "),
  );
}

async function crawlResult(result: WebSearchResult, index: number): Promise<InternalSource> {
  const fallback: InternalSource = {
    ...result,
    id: `S${index + 1}`,
    fetch_status: "search_only",
    description: result.snippet,
    headings: [],
    schema_types: [],
    word_count: result.snippet ? result.snippet.split(/\s+/).length : 0,
    excerpt: result.snippet,
    body_text: result.snippet,
  };
  try {
    const response = await fetchResearchText(result.url, {
      headers: { "User-Agent": SEARCH_USER_AGENT, Accept: "text/html,text/plain;q=0.9" },
      timeoutMs: 12_000,
      maxBytes: 500_000,
      maxRedirects: 3,
    });
    const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
    if (response.status < 200 || response.status >= 300 ||
        (!contentType.includes("text/html") && !contentType.includes("text/plain"))) return fallback;
    const html = response.text;
    const bodyText = htmlToVisibleText(html).slice(0, 40_000);
    if (bodyText.length < 80) return fallback;
    const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || result.title;
    const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
      .map((match) => cleanText(match[1] ?? ""))
      .filter(Boolean)
      .slice(0, 20);
    const description = metaContent(html, "description") || metaContent(html, "og:description") || result.snippet;
    return {
      ...fallback,
      title: title.slice(0, 240),
      fetch_status: "ok",
      description: description.slice(0, 500),
      headings,
      schema_types: extractSchemaTypes(html),
      word_count: bodyText.split(/\s+/).filter(Boolean).length,
      excerpt: bodyText.slice(0, 2_000),
      body_text: bodyText,
    };
  } catch {
    return fallback;
  }
}

function researchTerms(query: string): string[] {
  const stop = new Set(["avec", "dans", "pour", "plus", "quel", "quelle", "comment", "the", "and", "for", "with"]);
  return query.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !stop.has(term));
}

export function buildResearchEvidence(query: string, sources: InternalSource[]): ResearchEvidence[] {
  const terms = researchTerms(query);
  const candidates: ResearchEvidence[] = [];
  for (const source of sources) {
    if (source.fetch_status !== "ok") continue;
    const sentences = source.excerpt.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim());
    let sourceCount = 0;
    for (const sentence of sentences) {
      if (sentence.length < 60 || sentence.length > 420) continue;
      const normalized = sentence.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const overlap = terms.filter((term) => normalized.includes(term)).length;
      if (overlap === 0) continue;
      candidates.push({ source_id: source.id, claim: sentence.slice(0, 360), score: overlap });
      sourceCount += 1;
      if (sourceCount >= 3) break;
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 8);
}

function buildLocalAnswer(query: string, evidence: ResearchEvidence[], sources: InternalSource[]): string {
  const sourceList = sources.slice(0, 8).map((source) =>
    `- [${source.id}] ${source.title} — ${source.url}`
  );
  if (evidence.length > 0) {
    return [
      `Synthèse documentée pour « ${query} » :`,
      ...evidence.slice(0, 6).map((item) => `- ${item.claim} [${item.source_id}]`),
      "",
      "Sources publiques reliées :",
      ...sourceList,
    ].join("\n");
  }
  if (sources.length > 0) {
    return [
      `Sources trouvées pour « ${query} », mais leur contenu n'a pas fourni assez de texte recoupable :`,
      ...sourceList,
    ].join("\n");
  }
  return `Aucune source publique exploitable n'a été trouvée pour « ${query} ».`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function toPublicResearchSource(source: InternalSource): ResearchSource {
  return {
    id: source.id,
    url: source.url,
    domain: source.domain,
    title: source.title,
    snippet: source.snippet,
    providers: source.providers,
    positions: source.positions,
    fetch_status: source.fetch_status,
    description: source.description,
    headings: source.headings,
    schema_types: source.schema_types,
    word_count: source.word_count,
    excerpt: source.excerpt,
  };
}

export async function runWebResearch(
  query: string,
  options: { locale?: string; maxSources?: number } = {},
): Promise<WebResearchReport> {
  const locale = options.locale ?? "fr-FR";
  const maxSources = Math.max(1, Math.min(8, options.maxSources ?? 5));
  const search = await searchWebNoKey(query, locale, Math.max(maxSources, 8));
  const crawled = await mapWithConcurrency(search.results.slice(0, maxSources), 3, crawlResult);
  const evidence = buildResearchEvidence(query, crawled);
  const sources = crawled.map(toPublicResearchSource);
  const fetchedCount = sources.filter((source) => source.fetch_status === "ok").length;
  const dataStatus = sources.length === 0 ? "unavailable" : fetchedCount >= Math.min(3, maxSources) ? "complete" : "partial";

  return {
    query: query.replace(/\s+/g, " ").trim(),
    locale,
    generated_at: new Date().toISOString(),
    data_status: dataStatus,
    search_providers: search.providers,
    answer: buildLocalAnswer(query, evidence, crawled),
    evidence,
    sources,
  };
}
