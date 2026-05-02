// Daily alerts — runs at 07:30 UTC, after GSC daily sync.
// Fires position drops, indexation failures, sends Slack + email + AI summary.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  try {
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/alerts/check`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SECRET || "",
      },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: res.ok, alerts: data });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

export const POST = GET;
