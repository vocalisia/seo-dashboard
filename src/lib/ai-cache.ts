// Cache-first wrapper around askAI() — avoids billing surprises by serving cached
// responses when AI providers are exhausted (Gemini/Perplexity
// may be over budget on a given day).
//
// Usage:
//   const reply = await askAICached({
//     cacheKey: `seo-action:${actionId}:${siteId}`,
//     messages: [...],
//     model: "smart",
//     maxTokens: 2000,
//     ttlDays: 30,
//     fallback: "Markdown shown when AI fails and no cache exists.",
//   });

import { createHash } from "crypto";
import { askAI, AIProviderError, MODELS } from "./ai";
import { getSQL } from "./db";

interface AskAICachedOpts {
  cacheKey?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  model?: keyof typeof MODELS;
  maxTokens?: number;
  ttlDays?: number;
  fallback?: string;
  bypassCache?: boolean;
}

interface CachedResult {
  reply: string;
  cached: boolean;
  cached_at?: string;
  ai_unavailable?: boolean;
  error_detail?: string;
}

async function ensureCacheTable(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS ai_response_cache (
      cache_key TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      model TEXT,
      cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function hashKey(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function deriveKey(opts: AskAICachedOpts): string {
  if (opts.cacheKey) return hashKey(opts.cacheKey);
  // Auto-derive from messages + model
  const seed = JSON.stringify({ m: opts.messages, model: opts.model ?? "fast" });
  return hashKey(seed);
}

/**
 * Cache-first AI call. Looks up DB cache first, then calls askAI() if missed,
 * then persists the new response. On AI provider failure, returns the fallback
 * (or older cache if available) instead of throwing.
 */
export async function askAICached(opts: AskAICachedOpts): Promise<CachedResult> {
  const sql = getSQL();
  const key = deriveKey(opts);
  const ttlDays = Math.max(1, Math.floor(opts.ttlDays ?? 30));

  // Lookup fresh cache
  if (!opts.bypassCache) {
    try {
      await ensureCacheTable(sql);
      const rows = (await sql`
        SELECT response, cached_at FROM ai_response_cache
        WHERE cache_key = ${key}
          AND cached_at >= NOW() - (${ttlDays} || ' days')::interval
        LIMIT 1
      `) as Array<{ response: string; cached_at: string }>;
      if (rows.length > 0) {
        return { reply: rows[0].response, cached: true, cached_at: rows[0].cached_at };
      }
    } catch {
      // table not ready / DB issue → continue to AI call
    }
  }

  // AI call
  try {
    const reply = await askAI(opts.messages, opts.model ?? "fast", opts.maxTokens ?? 1500);
    // Persist
    try {
      await sql`
        INSERT INTO ai_response_cache (cache_key, response, model, cached_at)
        VALUES (${key}, ${reply}, ${opts.model ?? "fast"}, NOW())
        ON CONFLICT (cache_key) DO UPDATE
          SET response = EXCLUDED.response, cached_at = NOW()
      `;
    } catch { /* cache write failure non-blocking */ }
    return { reply, cached: false };
  } catch (err) {
    const detail = err instanceof AIProviderError ? err.message : (err instanceof Error ? err.message : "AI unavailable");

    // Try stale cache (up to 1 year) as last resort before fallback
    try {
      const stale = (await sql`
        SELECT response, cached_at FROM ai_response_cache
        WHERE cache_key = ${key}
        ORDER BY cached_at DESC
        LIMIT 1
      `) as Array<{ response: string; cached_at: string }>;
      if (stale.length > 0) {
        return { reply: stale[0].response, cached: true, cached_at: stale[0].cached_at, ai_unavailable: true, error_detail: detail };
      }
    } catch { /* ignore */ }

    // Final fallback: caller-provided stub or generic message
    const fallback = opts.fallback ?? `**IA indisponible pour cette analyse.**\n\nLe dashboard a essaye Gemini/Perplexity, puis utilise le cache, les donnees Search Console et les calculs locaux. Aucun appel Anthropic/OpenAI n'est lance par defaut.`;
    return { reply: fallback, cached: false, ai_unavailable: true, error_detail: detail };
  }
}
