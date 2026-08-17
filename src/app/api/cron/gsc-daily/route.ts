// Daily GSC sync — light refresh of search_console_data (yesterday + today)
// Runs at 07:00 UTC every day. Differs from weekly which does 90-day backfill.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { internalDashboardUrl } from "@/lib/internal-api-origin";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  // Delegate to the existing /api/sync endpoint (uses same Google auth + DB writes)
  // Pull last 7 days so we cover the GSC 2-3d finalisation lag + a safety buffer.
  // ON CONFLICT DO UPDATE makes re-ingesting prior dates idempotent.
  try {
    const targetUrl = internalDashboardUrl(request, "/api/sync?days=7&source=gsc");
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SECRET || "",
      },
    });
    const data = await res.json().catch(() => ({}));
    const success = res.ok && data?.success !== false;
    return NextResponse.json({ success, upstream_status: res.status, daily_sync: data }, { status: success ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// Vercel cron sends GET; Vercel cron path is GET-only. POST optional alias.
export const POST = GET;
