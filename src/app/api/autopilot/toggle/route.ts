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
    VALUES ('autopilot_enabled', 'false'::jsonb)
    ON CONFLICT (key) DO NOTHING
  `;
}

function scheduledPublicationUnlocked(): boolean {
  return process.env.ALLOW_SCHEDULED_PUBLICATION?.trim().toLowerCase() === "true";
}

export async function GET() {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  try {
    const sql = getSQL();
    await ensureConfig(sql);
    const rows = await sql`SELECT value, updated_at FROM app_config WHERE key = 'autopilot_enabled'`;
    const locked = !scheduledPublicationUnlocked();
    const enabled = !locked && rows.length > 0 && rows[0].value === true;
    return NextResponse.json({ success: true, enabled, locked, updated_at: rows[0]?.updated_at ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg, enabled: false, locked: true }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  try {
    const sql = getSQL();
    await ensureConfig(sql);

    const body = await req.json().catch(() => ({}));
    const enabled = body.enabled === true;
    if (enabled && !scheduledPublicationUnlocked()) {
      return NextResponse.json(
        {
          success: false,
          enabled: false,
          locked: true,
          error: "La publication planifiée est verrouillée : chaque article doit être validé manuellement.",
        },
        { status: 409 }
      );
    }
    await sql`
      INSERT INTO app_config (key, value, updated_at)
      VALUES ('autopilot_enabled', ${JSON.stringify(enabled)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
    return NextResponse.json({ success: true, enabled, locked: !scheduledPublicationUnlocked() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
