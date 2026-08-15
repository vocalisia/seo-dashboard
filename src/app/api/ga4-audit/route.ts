import { getSQL } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { NextResponse } from "next/server";
import { classifyGA4AuditStatus, type GA4AuditStatus } from "@/lib/ga4-audit";

export const dynamic = "force-dynamic";

export interface SiteGA4Status {
  id: number;
  name: string;
  url: string;
  ga_property_id: string | null;
  status: GA4AuditStatus;
  last_data_date: string | null;
  sessions_7d: number;
  sessions_30d: number;
}

export async function GET() {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  try {
    const sql = getSQL();

    const rows = await sql`
      SELECT
        s.id,
        s.name,
        s.url,
        s.ga_property_id,
        COALESCE(d7.sessions_7d, 0)::int  AS sessions_7d,
        COALESCE(d30.sessions_30d, 0)::int AS sessions_30d,
        d30.last_date AS last_data_date
      FROM sites s
      LEFT JOIN (
        SELECT site_id, SUM(sessions) AS sessions_7d
        FROM analytics_daily
        WHERE date >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY site_id
      ) d7 ON d7.site_id = s.id
      LEFT JOIN (
        SELECT site_id, SUM(sessions) AS sessions_30d, MAX(date) AS last_date
        FROM analytics_daily
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY site_id
      ) d30 ON d30.site_id = s.id
      WHERE s.is_active = true
      ORDER BY s.name
    `;

    const result: SiteGA4Status[] = rows.map(r => {
      const status = classifyGA4AuditStatus(r.ga_property_id, r.sessions_30d);
      return {
        id: Number(r.id),
        name: String(r.name),
        url: String(r.url),
        ga_property_id: r.ga_property_id ? String(r.ga_property_id) : null,
        status,
        last_data_date: r.last_data_date ? String(r.last_data_date).split("T")[0] : null,
        sessions_7d: Number(r.sessions_7d),
        sessions_30d: Number(r.sessions_30d),
      };
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
