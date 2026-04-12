export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface AutopilotRun {
  id: number;
  site_id: number;
  site_name: string;
  keyword: string;
  article_title: string;
  github_url: string | null;
  image_url: string | null;
  status: string;
  language: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteIdParam = searchParams.get("site_id");
  const sql = getSQL();

  try {
    // Add language column if it doesn't exist yet (migration-free approach)
    try {
      await sql`ALTER TABLE autopilot_runs ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'fr'`;
    } catch {
      // Column already exists or no permission — ignore
    }

    let runs: AutopilotRun[];

    if (siteIdParam) {
      const siteId = parseInt(siteIdParam, 10);
      if (isNaN(siteId)) {
        return NextResponse.json({ success: false, error: "Invalid site_id" }, { status: 400 });
      }

      runs = (await sql`
        SELECT ar.id, ar.site_id, s.name AS site_name, ar.keyword, ar.article_title,
               ar.github_url, ar.image_url, ar.status,
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
        SELECT ar.id, ar.site_id, s.name AS site_name, ar.keyword, ar.article_title,
               ar.github_url, ar.image_url, ar.status,
               COALESCE(ar.language, 'fr') AS language,
               ar.created_at
        FROM autopilot_runs ar
        LEFT JOIN sites s ON s.id = ar.site_id
        ORDER BY ar.created_at DESC
        LIMIT 50
      `) as AutopilotRun[];
    }

    return NextResponse.json({ success: true, runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("History fetch error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
