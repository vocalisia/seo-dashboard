// Daily alerts — runs at 07:30 UTC, after GSC daily sync.
// Fires position drops, indexation failures, sends Slack + email + AI summary.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { POST as checkAlerts } from "@/app/api/alerts/check/route";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  try {
    const res = await checkAlerts(new NextRequest(
      new URL("/api/alerts/check", request.url),
      { method: "POST", headers: request.headers },
    ));
    const data = await res.json().catch(() => ({}));
    const success = res.ok && data?.success !== false;
    return NextResponse.json(
      { success, upstream_status: res.status, alerts: data },
      { status: success ? 200 : 502 },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

export const POST = GET;
