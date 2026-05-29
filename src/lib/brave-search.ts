// Brave Search API client — rank tracking sans CAPTCHA.
// Free tier: 2000 req/month. Docs: https://api.search.brave.com/app/documentation
import { logError, logger } from "@/lib/logger";

export interface BraveSerpResult {
  position: number;
  url: string;
  title: string;
  description: string;
  domain: string;
}

interface BraveApiWebResultRaw {
  url?: string;
  title?: string;
  description?: string;
}

interface BraveApiResponse {
  web?: { results?: BraveApiWebResultRaw[] };
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

function getApiKey(): string | null {
  const k = process.env.BRAVE_SEARCH_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

export function isBraveConfigured(): boolean {
  return getApiKey() !== null;
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Run a Brave Search and return top N organic web results.
 * - Throws on auth/transport error so the caller can decide how to log/skip.
 * - Returns empty array if API key missing OR response has no `web.results`.
 */
export async function braveSearch(
  query: string,
  country: string = "FR",
  count: number = 10
): Promise<BraveSerpResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    logger.warn({ ctx: "brave-search" }, "BRAVE_SEARCH_API_KEY missing — skipping");
    return [];
  }
  if (!query || !query.trim()) return [];

  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("country", country.toUpperCase());
  url.searchParams.set("count", String(Math.min(20, Math.max(1, count))));
  url.searchParams.set("safesearch", "moderate");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brave Search ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as BraveApiResponse;
  const raw: BraveApiWebResultRaw[] = json.web?.results ?? [];

  const results: BraveSerpResult[] = [];
  let position = 1;
  for (const r of raw) {
    if (!r.url) continue;
    const domain = safeDomain(r.url);
    if (!domain) continue;
    results.push({
      position,
      url: r.url,
      title: (r.title || "").slice(0, 300),
      description: (r.description || "").replace(/<[^>]+>/g, "").slice(0, 500),
      domain,
    });
    position += 1;
    if (results.length >= count) break;
  }
  return results;
}

/**
 * Find the position of `targetDomain` within Brave SERP results.
 * Matches root domain ignoring leading `www.` and any subdomain prefix.
 * Returns null if not in the returned results window.
 */
export function findDomainPosition(
  results: BraveSerpResult[],
  targetDomain: string
): number | null {
  if (!targetDomain) return null;
  const target = targetDomain.replace(/^www\./i, "").toLowerCase();
  for (const r of results) {
    if (r.domain === target || r.domain.endsWith(`.${target}`)) {
      return r.position;
    }
  }
  return null;
}

/**
 * Extract a comparable root domain from a tracked site URL/property.
 * Strips protocol, www, and trailing path.
 */
export function siteRootDomain(siteUrl: string | null | undefined): string {
  if (!siteUrl) return "";
  const cleaned = siteUrl.replace(/^sc-domain:/i, "https://");
  try {
    return new URL(cleaned).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return cleaned.replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

/** Used by smoke test: validates API-key format without consuming a real query. */
export function validateApiKeyFormat(key: string | undefined): {
  ok: boolean;
  reason: string;
} {
  if (!key) return { ok: false, reason: "missing" };
  const trimmed = key.trim();
  if (trimmed.length < 16) return { ok: false, reason: "too_short" };
  if (!/^[A-Za-z0-9_\-]+$/.test(trimmed)) return { ok: false, reason: "invalid_chars" };
  return { ok: true, reason: "ok" };
}

export async function logBraveError(ctx: string, err: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  logError(ctx, err, extra);
}
