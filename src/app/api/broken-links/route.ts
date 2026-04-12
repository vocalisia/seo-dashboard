export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface BrokenLink {
  url: string;
  status_code: number;
}

async function checkUrl(url: string, timeout: number): Promise<{ url: string; ok: boolean; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    return { url, ok: res.ok, status: res.status };
  } catch {
    // Timeout or network error → treat as broken (status 0)
    return { url, ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  let body: { site_id?: number };
  try {
    body = (await req.json()) as { site_id?: number };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { site_id } = body;

  if (!site_id || typeof site_id !== "number") {
    return NextResponse.json(
      { success: false, error: "site_id required (number)" },
      { status: 400 }
    );
  }

  const sql = getSQL();

  try {
    // 1. Get site URL
    const siteRows = (await sql`
      SELECT url FROM sites WHERE id = ${site_id} LIMIT 1
    `) as { url: string }[];

    if (siteRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Site not found" },
        { status: 404 }
      );
    }

    // 2. Get distinct pages from GSC (last 30d, limit 50)
    const pageRows = (await sql`
      SELECT DISTINCT page
      FROM search_console_data
      WHERE site_id = ${site_id}
        AND date >= NOW() - INTERVAL '30 days'
        AND page IS NOT NULL
        AND page != ''
      LIMIT 50
    `) as { page: string }[];

    if (pageRows.length === 0) {
      return NextResponse.json({
        success: true,
        total_checked: 0,
        broken: [],
        healthy: 0,
        broken_count: 0,
        message: "No pages found in search_console_data for last 30 days",
      });
    }

    const urls = pageRows.map((r) => r.page);

    // 3. Check each URL (HEAD, 10s timeout)
    const results = await Promise.all(
      urls.map((url) => checkUrl(url, 10_000))
    );

    const broken: BrokenLink[] = results
      .filter((r) => !r.ok)
      .map((r) => ({ url: r.url, status_code: r.status }));

    const healthy = results.filter((r) => r.ok).length;

    return NextResponse.json({
      success: true,
      total_checked: results.length,
      broken,
      healthy,
      broken_count: broken.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Broken links error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
