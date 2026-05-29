// Brand mention monitoring: Reddit + HackerNews (no auth, free public APIs).
// Reddit:  https://www.reddit.com/search.json?q=<query>&sort=new&limit=25
// HN:      https://hn.algolia.com/api/v1/search?query=<query>&tags=story&hitsPerPage=25
//
// Storage table: `brand_mentions` (see lib/db.ts ensureSchema).

import { logError, logger } from "@/lib/logger";

export type MentionSource = "reddit" | "hackernews";

export interface BrandMention {
  source: MentionSource;
  title: string;
  url: string;
  score: number;
  created_at_external: string; // ISO
  body: string;
  sentiment: "positive" | "neutral" | "negative";
}

// Reddit blocks generic bots — use a realistic browser UA.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const POSITIVE_WORDS = [
  "great",
  "love",
  "awesome",
  "excellent",
  "amazing",
  "best",
  "recommend",
  "génial",
  "super",
  "excellent",
  "parfait",
  "top",
];
const NEGATIVE_WORDS = [
  "bad",
  "terrible",
  "awful",
  "worst",
  "hate",
  "scam",
  "broken",
  "fail",
  "nul",
  "arnaque",
  "horrible",
  "déçu",
];

function detectSentiment(text: string): BrandMention["sentiment"] {
  const lower = text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_WORDS) if (lower.includes(w)) pos += 1;
  for (const w of NEGATIVE_WORDS) if (lower.includes(w)) neg += 1;
  if (neg > pos) return "negative";
  if (pos > neg) return "positive";
  return "neutral";
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn({ ctx: "brand-mentions.fetch", url, status: res.status });
      return null;
    }
    return (await res.json()) as unknown;
  } catch (e) {
    logError("brand-mentions.fetch", e, { url });
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface RedditChild {
  data?: {
    title?: string;
    permalink?: string;
    url?: string;
    score?: number;
    created_utc?: number;
    selftext?: string;
  };
}

export async function searchReddit(query: string): Promise<BrandMention[]> {
  // Try multiple Reddit endpoints — main domain frequently blocks bot UAs.
  const endpoints = [
    `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25`,
    `https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=25`,
    `https://api.reddit.com/search?q=${encodeURIComponent(query)}&sort=new&limit=25`,
  ];
  let json: { data?: { children?: RedditChild[] } } | null = null;
  for (const u of endpoints) {
    json = (await fetchJson(u)) as { data?: { children?: RedditChild[] } } | null;
    if (json?.data?.children && json.data.children.length > 0) break;
  }
  const children = json?.data?.children ?? [];
  const out: BrandMention[] = [];
  for (const c of children) {
    const d = c.data;
    if (!d || !d.title) continue;
    const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : d.url ?? "";
    const body = d.selftext ?? "";
    const createdIso = d.created_utc
      ? new Date(d.created_utc * 1000).toISOString()
      : new Date().toISOString();
    out.push({
      source: "reddit",
      title: d.title.slice(0, 500),
      url: permalink.slice(0, 1000),
      score: typeof d.score === "number" ? d.score : 0,
      created_at_external: createdIso,
      body: body.slice(0, 2000),
      sentiment: detectSentiment(`${d.title} ${body}`),
    });
  }
  return out;
}

interface HnHit {
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  objectID?: string;
  points?: number | null;
  created_at?: string;
  story_text?: string | null;
  comment_text?: string | null;
}

export async function searchHN(query: string): Promise<BrandMention[]> {
  const u = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
    query
  )}&tags=story&hitsPerPage=25`;
  const json = (await fetchJson(u)) as { hits?: HnHit[] } | null;
  const hits = json?.hits ?? [];
  const out: BrandMention[] = [];
  for (const h of hits) {
    const title = h.title ?? h.story_title ?? "";
    if (!title) continue;
    const url =
      h.url ??
      h.story_url ??
      (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : "");
    const body = h.story_text ?? h.comment_text ?? "";
    out.push({
      source: "hackernews",
      title: title.slice(0, 500),
      url: (url ?? "").slice(0, 1000),
      score: typeof h.points === "number" ? h.points : 0,
      created_at_external: h.created_at ?? new Date().toISOString(),
      body: body.slice(0, 2000),
      sentiment: detectSentiment(`${title} ${body}`),
    });
  }
  return out;
}

/**
 * Search Reddit + HackerNews for mentions of a domain and/or brand name.
 * Returns a unified, deduplicated list (by URL).
 */
export async function unifiedSearch(
  domain: string,
  brandName?: string
): Promise<BrandMention[]> {
  const cleanDomain = (domain || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .trim();
  const parts = [cleanDomain];
  if (brandName && brandName.trim()) parts.push(brandName.trim());
  const query = parts.filter(Boolean).join(" OR ");

  const [reddit, hn] = await Promise.all([
    searchReddit(query),
    searchHN(query),
  ]);

  const seen = new Set<string>();
  const merged: BrandMention[] = [];
  for (const m of [...reddit, ...hn]) {
    const key = m.url || `${m.source}:${m.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(m);
  }
  return merged;
}
