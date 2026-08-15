import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAICached } from "@/lib/ai-cache";
import { isRecord } from "@/lib/api-response";
import { requireApiSession } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — declining articles detection
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const siteIdParam = req.nextUrl.searchParams.get("site_id");
    const siteId = Number(siteIdParam);
    if (!siteIdParam || !Number.isInteger(siteId) || siteId <= 0) {
      return NextResponse.json(
        { success: false, error: "site_id must be a positive integer" },
        { status: 400 },
      );
    }

    const sql = getSQL();

    // Ensure content_refresh table exists
    await sql`
      CREATE TABLE IF NOT EXISTS content_refresh (
        id SERIAL PRIMARY KEY,
        site_id INTEGER REFERENCES sites(id),
        page_url VARCHAR(1000),
        clicks_before INTEGER,
        clicks_after INTEGER,
        position_before DECIMAL(6,2),
        position_after DECIMAL(6,2),
        suggestions JSONB,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    const rows = await sql`
      WITH current_period AS (
        SELECT page,
               SUM(clicks) AS clicks_now,
               AVG(position) AS pos_now
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND date >= NOW() - INTERVAL '14 days'
          AND page IS NOT NULL
          AND country IS NULL
        GROUP BY page
      ),
      previous_period AS (
        SELECT page,
               SUM(clicks) AS clicks_prev,
               AVG(position) AS pos_prev
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND date >= NOW() - INTERVAL '28 days'
          AND date < NOW() - INTERVAL '14 days'
          AND page IS NOT NULL
          AND country IS NULL
        GROUP BY page
      )
      SELECT
        c.page,
        c.clicks_now::int,
        p.clicks_prev::int,
        ROUND(c.pos_now::numeric, 2) AS pos_now,
        ROUND(p.pos_prev::numeric, 2) AS pos_prev,
        (p.clicks_prev - c.clicks_now)::int AS clicks_decline,
        ROUND((c.pos_now - p.pos_prev)::numeric, 2) AS position_decline
      FROM current_period c
      JOIN previous_period p ON p.page = c.page
      WHERE (c.clicks_now + p.clicks_prev) >= 50
        AND (c.clicks_now < p.clicks_prev OR (c.pos_now - p.pos_prev) >= 3)
      ORDER BY (p.clicks_prev - c.clicks_now) DESC
    `;

    const suggestions = await sql`
      SELECT id, page_url, suggestions, status, created_at
      FROM content_refresh
      WHERE site_id = ${siteId}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return NextResponse.json({ success: true, pages: rows, suggestions });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — trigger AI refresh suggestions for a specific page
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Request body must be valid JSON" },
        { status: 400 },
      );
    }

    const siteId = isRecord(body) ? body.site_id : null;
    const rawPageUrl = isRecord(body) ? body.page_url : null;
    const pageUrl = typeof rawPageUrl === "string" ? rawPageUrl.trim() : "";
    if (
      typeof siteId !== "number"
      || !Number.isInteger(siteId)
      || siteId <= 0
      || !pageUrl
    ) {
      return NextResponse.json(
        { success: false, error: "site_id must be a positive integer and page_url is required" },
        { status: 400 },
      );
    }

    const sql = getSQL();

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS content_refresh (
        id SERIAL PRIMARY KEY,
        site_id INTEGER REFERENCES sites(id),
        page_url VARCHAR(1000),
        clicks_before INTEGER,
        clicks_after INTEGER,
        position_before DECIMAL(6,2),
        position_after DECIMAL(6,2),
        suggestions JSONB,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // Fetch site name
    const siteRows = await sql`SELECT name FROM sites WHERE id = ${siteId}`;
    if (siteRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Site not found" },
        { status: 404 },
      );
    }
    const siteName = String(siteRows[0].name);

    // Fetch decline metrics for this page
    const metrics = await sql`
      WITH current_period AS (
        SELECT page,
               SUM(clicks) AS clicks_now,
               AVG(position) AS pos_now
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND date >= NOW() - INTERVAL '14 days'
          AND page IS NOT NULL
          AND country IS NULL
          AND page = ${pageUrl}
        GROUP BY page
      ),
      previous_period AS (
        SELECT page,
               SUM(clicks) AS clicks_prev,
               AVG(position) AS pos_prev
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND date >= NOW() - INTERVAL '28 days'
          AND date < NOW() - INTERVAL '14 days'
          AND page IS NOT NULL
          AND country IS NULL
          AND page = ${pageUrl}
        GROUP BY page
      )
      SELECT
        c.clicks_now::int,
        p.clicks_prev::int,
        ROUND(c.pos_now::numeric, 2) AS pos_now,
        ROUND(p.pos_prev::numeric, 2) AS pos_prev
      FROM current_period c
      JOIN previous_period p ON p.page = c.page
    `;

    const clicksBefore = metrics[0]?.clicks_prev ?? 0;
    const clicksAfter = metrics[0]?.clicks_now ?? 0;
    const posBefore = metrics[0]?.pos_prev ?? 0;
    const posAfter = metrics[0]?.pos_now ?? 0;

    // Ask AI for optimization suggestions
    const prompt = `Analyze this URL ${pageUrl} for site ${siteName}. It's declining in Google rankings (position went from ${posBefore} to ${posAfter}, clicks dropped from ${clicksBefore} to ${clicksAfter}). Suggest 5 specific content improvements: title tag, meta description, new sections to add, internal links to add, and keyword density improvements. Respond in JSON format.`;

    const { reply: raw } = await askAICached({
      cacheKey: `content-refresh:${siteId}:${pageUrl}`,
      messages: [{ role: "user", content: prompt }],
      model: "smart",
      maxTokens: 2000,
    });

    // Parse AI response — extract JSON even if wrapped in markdown
    let suggestions: unknown;
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
      suggestions = JSON.parse(jsonStr);
    } catch {
      suggestions = { raw_response: raw };
    }

    // Store in DB
    const inserted = await sql`
      INSERT INTO content_refresh (site_id, page_url, clicks_before, clicks_after, position_before, position_after, suggestions, status)
      VALUES (${siteId}, ${pageUrl}, ${clicksBefore}, ${clicksAfter}, ${posBefore}, ${posAfter}, ${JSON.stringify(suggestions)}, 'pending')
      RETURNING *
    `;

    if (!inserted[0]) {
      throw new Error("Refresh suggestion was not persisted");
    }

    return NextResponse.json({ success: true, refresh: inserted[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
