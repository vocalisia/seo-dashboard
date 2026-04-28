export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const alertId = parseInt(id, 10);

  if (isNaN(alertId)) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  const sql = getSQL();

  try {
    await sql`UPDATE seo_alerts SET is_read = true WHERE id = ${alertId}`;
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
