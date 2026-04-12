import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET — declining articles detection
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const siteId = req.nextUrl.searchParams.get("site_id");
    if (!siteId) {
      return NextResponse.json({ error: "site_id required" }, { status: 400 });
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
        WHERE site_id = ${Number(siteId)}
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
        WHERE site_id = ${Number(siteId)}
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

    return NextResponse.json({ pages: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — trigger AI refresh suggestions for a specific page
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      site_id: number;
      page_url: string;
    };

    const { site_id, page_url } = body;
    if (!site_id || !page_url) {
      return NextResponse.json(
        { error: "site_id and page_url required" },
        { status: 400 }
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
    const siteRows = await sql`SELECT name FROM sites WHERE id = ${site_id}`;
    const siteName = siteRows[0]?.name ?? "Unknown";

    // Fetch decline metrics for this page
    const metrics = await sql`
      WITH current_period AS (
        SELECT page,
               SUM(clicks) AS clicks_now,
               AVG(position) AS pos_now
        FROM search_console_data
        WHERE site_id = ${site_id}
          AND date >= NOW() - INTERVAL '14 days'
          AND page IS NOT NULL
          AND country IS NULL
          AND page = ${page_url}
        GROUP BY page
      ),
      previous_period AS (
        SELECT page,
               SUM(clicks) AS clicks_prev,
               AVG(position) AS pos_prev
        FROM search_console_data
        WHERE site_id = ${site_id}
          AND date >= NOW() - INTERVAL '28 days'
          AND date < NOW() - INTERVAL '14 days'
          AND page IS NOT NULL
          AND country IS NULL
          AND page = ${page_url}
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
    const prompt = `Analyze this URL ${page_url} for site ${siteName}. It's declining in Google rankings (position went from ${posBefore} to ${posAfter}, clicks dropped from ${clicksBefore} to ${clicksAfter}). Suggest 5 specific content improvements: title tag, meta description, new sections to add, internal links to add, and keyword density improvements. Respond in JSON format.`;

    const raw = await askAI([{ role: "user", content: prompt }], "smart", 2000);

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
      VALUES (${site_id}, ${page_url}, ${clicksBefore}, ${clicksAfter}, ${posBefore}, ${posAfter}, ${JSON.stringify(suggestions)}, 'pending')
      RETURNING *
    `;

    return NextResponse.json({ refresh: inserted[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
