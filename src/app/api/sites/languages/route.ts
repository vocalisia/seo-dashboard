export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

interface SiteLangRow {
  id: number;
  name: string;
  target_languages: string[] | null;
}

/**
 * GET /api/sites/languages → list all sites with their target_languages
 */
export async function GET() {
  const sql = getSQL();
  try {
    // Ensure column exists (idempotent migration)
    try {
      await sql`ALTER TABLE sites ADD COLUMN IF NOT EXISTS target_languages TEXT[] DEFAULT ARRAY['fr']`;
    } catch {
      // ignore
    }

    const sites = (await sql`
      SELECT id, name, COALESCE(target_languages, ARRAY['fr']::TEXT[]) AS target_languages
      FROM sites
      WHERE is_active = true
      ORDER BY name
    `) as SiteLangRow[];

    return NextResponse.json({ success: true, sites });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * POST /api/sites/languages
 *   body: { site_id: number, languages: string[] }
 */
export async function POST(req: NextRequest) {
  let body: { site_id?: number; languages?: string[] };
  try {
    body = (await req.json()) as { site_id?: number; languages?: string[] };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { site_id, languages } = body;

  if (!site_id || typeof site_id !== "number") {
    return NextResponse.json({ success: false, error: "site_id required" }, { status: 400 });
  }
  if (!Array.isArray(languages) || languages.length === 0) {
    return NextResponse.json({ success: false, error: "languages must be a non-empty array" }, { status: 400 });
  }

  // Whitelist valid language codes
  const VALID = new Set(["fr", "en", "de", "es", "it", "nl", "pt"]);
  const cleaned = languages.filter((l) => VALID.has(l));

  if (cleaned.length === 0) {
    return NextResponse.json({ success: false, error: "No valid languages provided" }, { status: 400 });
  }

  const sql = getSQL();
  try {
    await sql`
      UPDATE sites
      SET target_languages = ${cleaned}
      WHERE id = ${site_id}
    `;
    return NextResponse.json({ success: true, site_id, languages: cleaned });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
