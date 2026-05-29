// Daily Brave Search rank tracking — 06:00 UTC.
// Delegates to /api/rank-tracker/check so the heavy logic lives once.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { logError } from "@/lib/logger";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  try {
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/rank-tracker/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SECRET || "",
      },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: res.ok, rank_tracker: data });
  } catch (e) {
    logError("cron.rank-tracker-daily", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}

export const POST = GET;
