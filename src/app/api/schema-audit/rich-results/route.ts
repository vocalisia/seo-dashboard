// Direct Google Rich Results Test API endpoint.
// POST { url: string } → official Google verdict + detected types.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { testRichResults } from "@/lib/rich-results";
import { ensureSchema } from "@/lib/db";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try { await ensureSchema(); } catch (e) { logError("schema-audit/rich-results.ensureSchema", e); }

  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }
    url = body.url.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await testRichResults(url);
  return NextResponse.json({ success: true, url, ...result });
}

export async function GET(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  try { await ensureSchema(); } catch (e) { logError("schema-audit/rich-results.ensureSchema", e); }
  const result = await testRichResults(url);
  return NextResponse.json({ success: true, url, ...result });
}
