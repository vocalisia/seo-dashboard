// Daily GSC sync — light refresh of search_console_data (yesterday + today)
// Runs at 07:00 UTC every day. Differs from weekly which does 90-day backfill.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  // Delegate to the existing /api/sync endpoint (uses same Google auth + DB writes)
  // But limit to last 3 days to keep it fast
  try {
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/sync?days=3`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SECRET || "",
      },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: res.ok, daily_sync: data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// Vercel cron sends GET; Vercel cron path is GET-only. POST optional alias.
export const POST = GET;
