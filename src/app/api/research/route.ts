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
  max_sources: z.number().int().min(1).max(8).default(5),
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
}

function cacheKey(query: string, locale: string, maxSources: number): string {
  return createHash("sha256")
    .update(`${query.toLowerCase().replace(/\s+/g, " ").trim()}|${locale.toLowerCase()}|${maxSources}`)
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
    const key = cacheKey(body.query, body.locale, body.max_sources);

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
    const rows = await sql`
      SELECT query, locale, data_status, researched_at,
             jsonb_array_length(COALESCE(response->'sources', '[]'::jsonb))::int AS source_count
      FROM web_research_cache
      ORDER BY researched_at DESC
      LIMIT 30
    `;
    return NextResponse.json({ success: true, research: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unable to load research history" },
      { status: 500 },
    );
  }
}
