export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { buildPublishedArticleUrl } from "@/lib/autopilot-published-url";
import { resolveSiteRepoConfig } from "@/lib/autopilot-config";

interface AutopilotRun {
  id: number;
  site_id: number;
  site_name: string;
  keyword: string;
  article_title: string;
  github_url: string | null;
  published_url: string | null;
  image_url: string | null;
  status: string;
  language: string | null;
  created_at: string;
}

type RunRow = AutopilotRun & { site_url?: string | null };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteIdParam = searchParams.get("site_id");
  const sql = getSQL();

  try {
    try {
      await sql`ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'fr'`;
    } catch {
      // Column already exists or no permission — ignore
    }
    try {
      await sql`ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS published_url VARCHAR(1500)`;
    } catch {
      /* ignore */
    }

    let runs: RunRow[];

    if (siteIdParam) {
      const siteId = parseInt(siteIdParam, 10);
      if (isNaN(siteId)) {
        return NextResponse.json({ success: false, error: "Invalid site_id" }, { status: 400 });
      }

      runs = (await sql`
        SELECT ar.id, ar.site_id, s.name AS site_name, s.url AS site_url, ar.keyword, ar.article_title,
               ar.github_url, ar.published_url, ar.image_url, ar.status,
               COALESCE(ar.language, 'fr') AS language,
               ar.created_at
        FROM autopilot_runs ar
        LEFT JOIN sites s ON s.id = ar.site_id
        WHERE ar.site_id = ${siteId}
        ORDER BY ar.created_at DESC
        LIMIT 50
      `) as AutopilotRun[];
    } else {
      runs = (await sql`
        SELECT ar.id, ar.site_id, s.name AS site_name, s.url AS site_url, ar.keyword, ar.article_title,
               ar.github_url, ar.published_url, ar.image_url, ar.status,
               COALESCE(ar.language, 'fr') AS language,
               ar.created_at
        FROM autopilot_runs ar
        LEFT JOIN sites s ON s.id = ar.site_id
        ORDER BY ar.created_at DESC
        LIMIT 50
      `) as RunRow[];
    }

    const enriched: AutopilotRun[] = runs.map((r) => {
      const siteUrl = r.site_url;
      const repoConfig = resolveSiteRepoConfig(r.site_name ?? "").repoConfig;
      const computed =
        siteUrl && r.keyword
          ? buildPublishedArticleUrl(siteUrl, r.keyword, r.language ?? "fr", repoConfig)
          : null;
      const published_url = (r.published_url?.trim() || computed) ?? null;
      return {
        id: r.id,
        site_id: r.site_id,
        site_name: r.site_name,
        keyword: r.keyword,
        article_title: r.article_title,
        github_url: r.github_url,
        published_url,
        image_url: r.image_url,
        status: r.status,
        language: r.language,
        created_at: r.created_at,
      };
    });

    return NextResponse.json({ success: true, runs: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("History fetch error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
