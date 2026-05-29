// Daily brand mentions scan — runs 07:00 UTC.
// Loops all active sites, calls /api/brand-mentions/scan internally.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  try {
    const baseUrl =
      process.env.NEXTAUTH_URL || process.env.AUTH_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/brand-mentions/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": process.env.CRON_SECRET || "",
      },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: res.ok, brand_mentions: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}

export const POST = GET;
