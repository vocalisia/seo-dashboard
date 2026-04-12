export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface AutopilotRow {
  id: number;
  keyword: string;
  language: string;
  github_url: string;
  created_at: string;
}

interface SiteRow {
  url: string;
}

interface ArticleIndexation {
  id: number;
  keyword: string;
  language: string;
  url: string;
  status_code: number | null;
  indexed: boolean;
}

/**
 * Derive the live blog URL from a GitHub file URL.
 * GitHub URL pattern: https://github.com/{owner}/{repo}/blob/main/{path}/{lang-prefix}{slug}-{date}.mdx
 * Extract the slug portion and build: {siteUrl}/blog/{slug}
 */
function deriveLiveUrl(siteUrl: string, githubUrl: string): string | null {
  try {
    // Extract filename from GitHub URL
    // e.g. .../content/blog/en-my-keyword-2026-04-12.mdx
    const parts = githubUrl.split("/");
    const filename = parts[parts.length - 1]; // e.g. "en-my-keyword-2026-04-12.mdx"

    if (!filename) return null;

    // Remove .mdx extension
    let slug = filename.replace(/\.mdx?$/, "");

    // Remove language prefix if present (e.g. "en-", "de-", "es-")
    slug = slug.replace(/^[a-z]{2}-/, "");

    // Remove trailing date pattern (e.g. "-2026-04-12")
    slug = slug.replace(/-\d{4}-\d{2}-\d{2}$/, "");

    const baseUrl = siteUrl.replace(/\/$/, "");
    return `${baseUrl}/blog/${slug}`;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteIdParam = searchParams.get("site_id");

  if (!siteIdParam) {
    return NextResponse.json(
      { success: false, error: "site_id required" },
      { status: 400 }
    );
  }

  const siteId = parseInt(siteIdParam, 10);
  if (isNaN(siteId)) {
    return NextResponse.json(
      { success: false, error: "Invalid site_id" },
      { status: 400 }
    );
  }

  const sql = getSQL();

  try {
    // Get the site URL
    const siteRows = (await sql`
      SELECT url FROM sites WHERE id = ${siteId} LIMIT 1
    `) as SiteRow[];

    if (siteRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Site not found" },
        { status: 404 }
      );
    }

    const siteUrl = siteRows[0].url;

    // Fetch published articles that have a github_url
    const runs = (await sql`
      SELECT id, keyword, COALESCE(language, 'fr') AS language,
             github_url, created_at
      FROM autopilot_runs
      WHERE site_id = ${siteId}
        AND status = 'published'
        AND github_url IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 100
    `) as AutopilotRow[];

    const articles: ArticleIndexation[] = [];

    for (const run of runs) {
      const liveUrl = deriveLiveUrl(siteUrl, run.github_url);

      if (!liveUrl) {
        articles.push({
          id: run.id,
          keyword: run.keyword,
          language: run.language,
          url: run.github_url,
          status_code: null,
          indexed: false,
        });
        continue;
      }

      let statusCode: number | null = null;
      let indexed = false;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(liveUrl, {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
        });

        clearTimeout(timeout);
        statusCode = response.status;
        indexed = statusCode === 200;
      } catch {
        // Network error, timeout, etc. → not indexed
        statusCode = null;
        indexed = false;
      }

      articles.push({
        id: run.id,
        keyword: run.keyword,
        language: run.language,
        url: liveUrl,
        status_code: statusCode,
        indexed,
      });
    }

    return NextResponse.json({ success: true, articles });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Indexation check error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
