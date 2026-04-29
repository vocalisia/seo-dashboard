export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

export async function GET(req: NextRequest) {
  const siteId = req.nextUrl.searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json(
      { success: false, error: "siteId required" },
      { status: 400 }
    );
  }

  const sql = getSQL();

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
        id SERIAL PRIMARY KEY,
        site_id INT REFERENCES sites(id),
        score FLOAT NOT NULL,
        results JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    const rows = await sql`
      SELECT score, created_at
      FROM ai_visibility_snapshots
      WHERE site_id = ${parseInt(siteId, 10)}
      ORDER BY created_at DESC
      LIMIT 30
    `;

    return NextResponse.json({ success: true, history: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
