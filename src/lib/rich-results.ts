// Google Rich Results Test API client.
// Uses the same GSC service-account credentials (GOOGLE_CREDENTIALS env).
// Endpoint: https://searchconsole.googleapis.com/v1/urlTesting/richResults:run
//
// 24h cache stored in `rich_results_cache` (see lib/db.ts ensureSchema).

import { getGoogleAuth } from "@/lib/google-auth";
import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { logger, logError } from "@/lib/logger";

const ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlTesting/richResults:run";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface RichResultsItem {
  richResultType?: string;
  items?: Array<{
    name?: string;
    issues?: Array<{ issueMessage?: string; severity?: string }>;
  }>;
}

export interface RichResultsRaw {
  testStatus?: { status?: string; details?: string };
  richResultsTestResult?: {
    verdict?: string;
    detectedItems?: RichResultsItem[];
  };
}

export interface RichResultsSummary {
  detected_types: string[];
  errors: string[];
  warnings: string[];
  verdict: string;
  google_verified: boolean;
  raw: RichResultsRaw;
  cached: boolean;
}

async function getAccessToken(): Promise<string | null> {
  try {
    const auth = getGoogleAuth();
    // GoogleAuth has getAccessToken(); narrow safely.
    const maybeAuth = auth as { getAccessToken?: () => Promise<unknown> };
    if (typeof maybeAuth.getAccessToken !== "function") return null;
    const tokenResp = await maybeAuth.getAccessToken();
    if (typeof tokenResp === "string") return tokenResp;
    if (
      typeof tokenResp === "object" &&
      tokenResp !== null &&
      "token" in tokenResp
    ) {
      const t = (tokenResp as { token?: unknown }).token;
      if (typeof t === "string") return t;
    }
    return null;
  } catch (e) {
    logError("rich-results.getAccessToken", e);
    return null;
  }
}

function summarize(raw: RichResultsRaw): {
  detected_types: string[];
  errors: string[];
  warnings: string[];
  verdict: string;
  google_verified: boolean;
} {
  const detected_types: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const verdict = raw.richResultsTestResult?.verdict ?? "VERDICT_UNSPECIFIED";

  const items = raw.richResultsTestResult?.detectedItems ?? [];
  for (const item of items) {
    if (item.richResultType) detected_types.push(item.richResultType);
    for (const sub of item.items ?? []) {
      for (const issue of sub.issues ?? []) {
        const msg = issue.issueMessage ?? "Issue";
        const sev = (issue.severity ?? "").toUpperCase();
        if (sev === "ERROR") errors.push(msg);
        else warnings.push(msg);
      }
    }
  }

  const google_verified =
    detected_types.length > 0 && errors.length === 0 && verdict === "PASS";

  return { detected_types, errors, warnings, verdict, google_verified };
}

async function readCache(url: string): Promise<RichResultsRaw | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const sql = getSQL();
    const rows = (await sql`
      SELECT google_response, cached_at
        FROM rich_results_cache
       WHERE url = ${url}
         AND cached_at > NOW() - INTERVAL '24 hours'
       ORDER BY cached_at DESC
       LIMIT 1
    `) as Array<{ google_response: RichResultsRaw }>;
    return rows[0]?.google_response ?? null;
  } catch (e) {
    logError("rich-results.readCache", e, { url });
    return null;
  }
}

async function writeCache(url: string, raw: RichResultsRaw): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    const sql = getSQL();
    await sql`
      INSERT INTO rich_results_cache (url, google_response, cached_at)
      VALUES (${url}, ${JSON.stringify(raw)}::jsonb, NOW())
    `;
  } catch (e) {
    logError("rich-results.writeCache", e, { url });
  }
}

/**
 * Run Google Rich Results Test against a URL.
 * Returns detected schema types + Google's verdict.
 * Cached 24h in `rich_results_cache`.
 */
export async function testRichResults(
  url: string
): Promise<RichResultsSummary> {
  if (!url || typeof url !== "string") {
    return {
      detected_types: [],
      errors: ["url required"],
      warnings: [],
      verdict: "VERDICT_UNSPECIFIED",
      google_verified: false,
      raw: {},
      cached: false,
    };
  }

  const cached = await readCache(url);
  if (cached) {
    return { ...summarize(cached), raw: cached, cached: true };
  }

  const token = await getAccessToken();
  if (!token) {
    return {
      detected_types: [],
      errors: ["Google auth unavailable"],
      warnings: [],
      verdict: "VERDICT_UNSPECIFIED",
      google_verified: false,
      raw: {},
      cached: false,
    };
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ ctx: "rich-results.fetch", status: res.status, url, body: text.slice(0, 500) });
      return {
        detected_types: [],
        errors: [`Google API error ${res.status}`],
        warnings: [],
        verdict: "VERDICT_UNSPECIFIED",
        google_verified: false,
        raw: {},
        cached: false,
      };
    }

    const raw = (await res.json()) as RichResultsRaw;
    await writeCache(url, raw);
    return { ...summarize(raw), raw, cached: false };
  } catch (e) {
    logError("rich-results.testRichResults", e, { url });
    return {
      detected_types: [],
      errors: [e instanceof Error ? e.message : "Unknown error"],
      warnings: [],
      verdict: "VERDICT_UNSPECIFIED",
      google_verified: false,
      raw: {},
      cached: false,
    };
  }
}
