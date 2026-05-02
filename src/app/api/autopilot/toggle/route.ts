export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";

async function ensureConfig(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key VARCHAR(100) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    INSERT INTO app_config (key, value)
    VALUES ('autopilot_enabled', 'true'::jsonb)
    ON CONFLICT (key) DO NOTHING
  `;
}

export async function GET() {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  const sql = getSQL();
  await ensureConfig(sql);
  const rows = await sql`SELECT value, updated_at FROM app_config WHERE key = 'autopilot_enabled'`;
  const enabled = rows.length > 0 ? rows[0].value === true : true;
  return NextResponse.json({ enabled, updated_at: rows[0]?.updated_at ?? null });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  const sql = getSQL();
  await ensureConfig(sql);

  const body = await req.json().catch(() => ({}));
  const enabled = !!body.enabled;
  await sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES ('autopilot_enabled', ${JSON.stringify(enabled)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  return NextResponse.json({ success: true, enabled });
}
