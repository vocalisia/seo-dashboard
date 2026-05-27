/**
 * Vercel cron wrapper for /api/autopilot/weekly.
 *
 * Vercel scheduled crons can only issue GET requests, but the original autopilot
 * weekly endpoint is POST-only and lives at /api/autopilot/weekly. This wrapper
 * is registered in vercel.json (Mondays 09:00 UTC) and forwards the call so the
 * full publish pipeline runs once per week on every active site.
 *
 * Restored 2026-05-22 after the autopilot cron was orphaned by the 2026-04-28
 * "migrate to local-only" commit (a58f933): Windows scheduled task targeted
 * localhost:3001 where seo-dashboard dev server was no longer running.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 800; // autopilot weekly can run 5-10 min for 20+ sites

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";

async function runWeeklyAutopilot(request: Request): Promise<NextResponse> {
  // Build the self-call URL — same pattern as src/app/api/autopilot/weekly/route.ts
  // VERCEL_PROJECT_PRODUCTION_URL = canonical prod URL (stable)
  // VERCEL_URL = preview deployment URL (changes each deploy)
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(request.url).origin);

  const cronSecret = process.env.CRON_SECRET?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cronSecret) {
    headers["x-cron-secret"] = cronSecret;
  }

  try {
    const res = await fetch(`${baseUrl}/api/autopilot/weekly`, {
      method: "POST",
      signal: AbortSignal.timeout(720000), // 12 min, slightly below maxDuration
      headers,
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({
      success: res.ok,
      forwarded_to: `${baseUrl}/api/autopilot/weekly`,
      upstream_status: res.status,
      result: data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message, baseUrl },
      { status: 500 }
    );
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;
  return runWeeklyAutopilot(request);
}

export const POST = GET;
