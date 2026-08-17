// Daily brand mentions scan — runs 07:00 UTC.
// Loops all active sites, calls /api/brand-mentions/scan internally.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";
import { internalDashboardUrl } from "@/lib/internal-api-origin";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  try {
    const res = await fetch(internalDashboardUrl(request, "/api/brand-mentions/scan"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SECRET || "",
      },
    });
    const data = await res.json().catch(() => ({}));
    const success = res.ok && data?.success !== false;
    return NextResponse.json(
      { success, upstream_status: res.status, brand_mentions: data },
      { status: success ? 200 : 502 },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}

export const POST = GET;
