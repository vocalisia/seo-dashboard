export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL } from "@/lib/db";
import { runWebResearch, type WebResearchReport } from "@/lib/web-research";

const requestSchema = z.object({
  query: z.string().trim().min(2).max(300),
  locale: z.string().regex(/^[a-z]{2}(?:[-_][A-Z]{2})?$/).default("fr-FR"),
  max_sources: z.number().int().min(1).max(12).default(10),
  max_queries: z.number().int().min(1).max(8).optional(),
  depth: z.enum(["quick", "deep"]).default("deep"),
  focus: z.enum(["general", "competitors", "content"]).default("general"),
  force_refresh: z.boolean().default(false),
});

interface CacheRow {
  response: WebResearchReport;
  researched_at: string;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function consumeResearchQuota(actor: string, forceRefresh: boolean): number | null {
  const now = Date.now();
  const windowMs = forceRefresh ? 5 * 60_000 : 60_000;
  const maxRequests = forceRefresh ? 5 : 20;
  const key = `${actor}:${forceRefresh ? "refresh" : "request"}`;
  const current = rateBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count <= maxRequests) return null;
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
}

async function ensureResearchCache(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS web_research_cache (
      cache_key TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      locale VARCHAR(12) NOT NULL,
      response JSONB NOT NULL,
      data_status VARCHAR(20) NOT NULL,
      researched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_web_research_recent
      ON web_research_cache(researched_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS web_research_rate_limits (
      actor_hash VARCHAR(64) NOT NULL,
      bucket_name VARCHAR(30) NOT NULL,
      bucket_start TIMESTAMPTZ NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      cost_units INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (actor_hash, bucket_name, bucket_start)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS web_research_documents (
      source_id TEXT PRIMARY KEY,
      canonical_url TEXT NOT NULL,
      domain TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      excerpt TEXT,
      headings JSONB NOT NULL DEFAULT '[]'::jsonb,
      schema_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      providers JSONB NOT NULL DEFAULT '[]'::jsonb,
      fetch_status VARCHAR(20) NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      source_score DECIMAL(8,2),
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS web_research_query_sources (
      cache_key TEXT NOT NULL,
      source_id TEXT NOT NULL,
      citation_id VARCHAR(20),
      fused_rank INTEGER NOT NULL,
      matched_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (cache_key, source_id)
    )
  `;
  await sql`ALTER TABLE web_research_query_sources ADD COLUMN IF NOT EXISTS citation_id VARCHAR(20)`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_web_research_documents_domain
      ON web_research_documents(domain, last_seen_at DESC)
  `;
}

export function researchDocumentId(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}

async function persistResearchIndex(
  sql: ReturnType<typeof getSQL>,
  key: string,
  report: WebResearchReport,
): Promise<void> {
  await sql.transaction([
    sql`DELETE FROM web_research_query_sources WHERE cache_key = ${key}`,
    ...report.sources.flatMap((source, index) => {
      const documentId = researchDocumentId(source.url);
      return [
      sql`
        INSERT INTO web_research_documents
          (source_id, canonical_url, domain, title, description, excerpt,
           headings, schema_types, providers, fetch_status, word_count,
           source_score, first_seen_at, last_seen_at)
        VALUES (
          ${documentId}, ${source.url}, ${source.domain}, ${source.title},
          ${source.description}, ${source.excerpt},
          ${JSON.stringify(source.headings)}::jsonb,
          ${JSON.stringify(source.schema_types)}::jsonb,
          ${JSON.stringify(source.providers)}::jsonb,
          ${source.fetch_status}, ${source.word_count},
          ${source.source_score ?? null}, NOW(), NOW()
        )
        ON CONFLICT (source_id) DO UPDATE SET
          canonical_url = EXCLUDED.canonical_url,
          domain = EXCLUDED.domain,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          excerpt = EXCLUDED.excerpt,
          headings = EXCLUDED.headings,
          schema_types = EXCLUDED.schema_types,
          providers = EXCLUDED.providers,
          fetch_status = EXCLUDED.fetch_status,
          word_count = EXCLUDED.word_count,
          source_score = EXCLUDED.source_score,
          last_seen_at = NOW()
      `,
      sql`
        INSERT INTO web_research_query_sources
          (cache_key, source_id, citation_id, fused_rank, matched_queries, linked_at)
        VALUES (
          ${key}, ${documentId}, ${source.id}, ${index + 1},
          ${JSON.stringify(source.matched_queries ?? [])}::jsonb, NOW()
        )
        ON CONFLICT (cache_key, source_id) DO UPDATE SET
          fused_rank = EXCLUDED.fused_rank,
          citation_id = EXCLUDED.citation_id,
          matched_queries = EXCLUDED.matched_queries,
          linked_at = NOW()
      `,
      ];
    }),
  ]);
}

async function consumeSharedResearchQuota(
  sql: ReturnType<typeof getSQL>,
  actor: string,
  input: { forceRefresh: boolean; depth: "quick" | "deep" },
): Promise<number | null> {
  const windowMs = input.forceRefresh ? 5 * 60_000 : 60_000;
  const bucketName = input.forceRefresh ? "refresh" : "request";
  const bucketStartMs = Math.floor(Date.now() / windowMs) * windowMs;
  const bucketStart = new Date(bucketStartMs).toISOString();
  const cost = (input.depth === "deep" ? 4 : 1) + (input.forceRefresh ? 2 : 0);
  const maxCost = input.forceRefresh ? 24 : 40;
  const actorHash = createHash("sha256").update(actor).digest("hex");
  const rows = await sql`
    INSERT INTO web_research_rate_limits
      (actor_hash, bucket_name, bucket_start, request_count, cost_units)
    VALUES (${actorHash}, ${bucketName}, ${bucketStart}, 1, ${cost})
    ON CONFLICT (actor_hash, bucket_name, bucket_start)
    DO UPDATE SET
      request_count = web_research_rate_limits.request_count + 1,
      cost_units = web_research_rate_limits.cost_units + EXCLUDED.cost_units
    RETURNING cost_units
  ` as Array<{ cost_units: number }>;
  if (Number(rows[0]?.cost_units ?? 0) <= maxCost) return null;
  return Math.max(1, Math.ceil((bucketStartMs + windowMs - Date.now()) / 1_000));
}

function cacheKey(
  query: string,
  locale: string,
  maxSources: number,
  maxQueries: number | undefined,
  depth: string,
  focus: string,
): string {
  return createHash("sha256")
    .update([
      "local-research-v2",
      query.toLowerCase().replace(/\s+/g, " ").trim(),
      locale.toLowerCase(),
      maxSources,
      maxQueries ?? "auto",
      depth,
      focus,
    ].join("|"))
    .digest("hex");
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.issues.map((issue) => issue.message).join("; ")
      : "Invalid JSON request body";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  const actor = authState.session?.user?.email
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "local";
  const retryAfter = consumeResearchQuota(actor, body.force_refresh);
  if (retryAfter !== null) {
    return NextResponse.json(
      { success: false, error: "Research rate limit exceeded", retry_after_seconds: retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    const sql = getSQL();
    await ensureResearchCache(sql);
    const sharedRetryAfter = await consumeSharedResearchQuota(sql, actor, {
      forceRefresh: body.force_refresh,
      depth: body.depth,
    });
    if (sharedRetryAfter !== null) {
      return NextResponse.json(
        { success: false, error: "Shared research rate limit exceeded", retry_after_seconds: sharedRetryAfter },
        { status: 429, headers: { "Retry-After": String(sharedRetryAfter) } },
      );
    }
    const key = cacheKey(
      body.query,
      body.locale,
      body.max_sources,
      body.max_queries,
      body.depth,
      body.focus,
    );

    if (!body.force_refresh) {
      const cached = await sql`
        SELECT response, researched_at
        FROM web_research_cache
        WHERE cache_key = ${key}
          AND researched_at >= NOW() - INTERVAL '24 hours'
        LIMIT 1
      ` as CacheRow[];
      if (cached.length > 0) {
        return NextResponse.json({ success: true, cached: true, report: cached[0].response });
      }
    }

    const report = await runWebResearch(body.query, {
      locale: body.locale,
      maxSources: body.max_sources,
      maxQueries: body.max_queries,
      depth: body.depth,
      focus: body.focus,
    });

    // Do not cache an outage: the next request should retry both public providers.
    if (report.data_status !== "unavailable") {
      await sql`
        INSERT INTO web_research_cache
          (cache_key, query, locale, response, data_status, researched_at)
        VALUES
          (${key}, ${body.query}, ${body.locale}, ${JSON.stringify(report)}::jsonb, ${report.data_status}, NOW())
        ON CONFLICT (cache_key) DO UPDATE SET
          response = EXCLUDED.response,
          data_status = EXCLUDED.data_status,
          researched_at = NOW()
      `;
      try {
        await persistResearchIndex(sql, key, report);
      } catch {
        // The report cache remains valid even if the reusable document index needs a later retry.
      }
    }

    return NextResponse.json({
      success: report.data_status !== "unavailable",
      cached: false,
      report,
    }, { status: report.data_status === "unavailable" ? 502 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Research failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const sql = getSQL();
    await ensureResearchCache(sql);
    const [rows, counts] = await Promise.all([
      sql`
      SELECT query, locale, data_status, researched_at,
             jsonb_array_length(COALESCE(response->'sources', '[]'::jsonb))::int AS source_count
      FROM web_research_cache
      ORDER BY researched_at DESC
      LIMIT 30
      `,
      sql`SELECT COUNT(*)::int AS document_count FROM web_research_documents`,
    ]);
    return NextResponse.json({
      success: true,
      engine: "local-research-v2",
      indexed_documents: Number((counts as Array<{ document_count: number }>)[0]?.document_count ?? 0),
      research: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unable to load research history" },
      { status: 500 },
    );
  }
}
