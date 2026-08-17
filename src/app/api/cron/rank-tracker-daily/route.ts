// Daily Brave Search rank tracking — 06:00 UTC.
// Delegates to /api/rank-tracker/check so the heavy logic lives once.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { logError } from "@/lib/logger";
import { POST as checkTrackedRanks } from "@/app/api/rank-tracker/check/route";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  try {
    const res = await checkTrackedRanks(new NextRequest(
      new URL("/api/rank-tracker/check?limit=2", request.url),
      { method: "POST", headers: request.headers },
    ));
    const data = await res.json().catch(() => ({}));
    const success = res.ok && data?.success !== false;
    return NextResponse.json(
      { success, upstream_status: res.status, rank_tracker: data },
      { status: success ? 200 : 502 },
    );
  } catch (e) {
    logError("cron.rank-tracker-daily", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}

export const POST = GET;
