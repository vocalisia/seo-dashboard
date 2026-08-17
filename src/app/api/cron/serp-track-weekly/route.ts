// Weekly SERP tracking — Mondays 09:00 UTC. Snapshots top 10 Google results
// for top KW per site, detects new competitors, AI-analyses moves.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { internalDashboardUrl } from "@/lib/internal-api-origin";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  try {
    const res = await fetch(internalDashboardUrl(request, "/api/serp-track"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SECRET || "",
      },
    });
    const data = await res.json().catch(() => ({}));
    const success = res.ok && data?.success !== false;
    return NextResponse.json(
      { success, upstream_status: res.status, serp_track: data },
      { status: success ? 200 : 502 },
    );
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

export const POST = GET;
