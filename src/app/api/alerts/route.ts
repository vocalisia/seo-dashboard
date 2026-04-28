export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const siteIdParam = searchParams.get("site_id");
  const unreadOnly = searchParams.get("unread_only") === "true";

  const sql = getSQL();

  try {
    // Ensure table exists (idempotent)
    await sql`
      CREATE TABLE IF NOT EXISTS seo_alerts (
        id SERIAL PRIMARY KEY,
        site_id INTEGER REFERENCES sites(id),
        alert_type VARCHAR(50),
        severity VARCHAR(20),
        keyword VARCHAR(500),
        message TEXT,
        data JSONB,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    let alerts;

    if (siteIdParam && unreadOnly) {
      const siteId = parseInt(siteIdParam, 10);
      alerts = await sql`
        SELECT a.*, s.name AS site_name, s.url AS site_url
        FROM seo_alerts a
        LEFT JOIN sites s ON s.id = a.site_id
        WHERE a.site_id = ${siteId} AND a.is_read = false
        ORDER BY a.created_at DESC
        LIMIT 200
      `;
    } else if (siteIdParam) {
      const siteId = parseInt(siteIdParam, 10);
      alerts = await sql`
        SELECT a.*, s.name AS site_name, s.url AS site_url
        FROM seo_alerts a
        LEFT JOIN sites s ON s.id = a.site_id
        WHERE a.site_id = ${siteId}
        ORDER BY a.created_at DESC
        LIMIT 200
      `;
    } else if (unreadOnly) {
      alerts = await sql`
        SELECT a.*, s.name AS site_name, s.url AS site_url
        FROM seo_alerts a
        LEFT JOIN sites s ON s.id = a.site_id
        WHERE a.is_read = false
        ORDER BY a.created_at DESC
        LIMIT 200
      `;
    } else {
      alerts = await sql`
        SELECT a.*, s.name AS site_name, s.url AS site_url
        FROM seo_alerts a
        LEFT JOIN sites s ON s.id = a.site_id
        ORDER BY a.created_at DESC
        LIMIT 200
      `;
    }

    return NextResponse.json({ success: true, alerts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Alerts fetch error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
