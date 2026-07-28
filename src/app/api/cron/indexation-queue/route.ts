/**
 * Google Indexing API must not be used for ordinary SEO pages.
 * Keep the endpoint explicit so legacy cron calls stop safely instead of
 * submitting sitemap URLs to an unsupported Google API.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const authResult = await requireCronOrUser(request);
  if (authResult) return authResult;

  return NextResponse.json(
    {
      success: false,
      disabled: true,
      mode: "sitemap_discovery_only",
      error: "Google Indexing API is disabled for ordinary content. Use sitemap discovery instead.",
    },
    { status: 422 }
  );
}
