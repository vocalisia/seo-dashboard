export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google-auth";
import { requireApiSession } from "@/lib/api-auth";

interface IndexingRequestBody {
  url: string;
}

interface IndexingResponse {
  success: boolean;
  url?: string;
  notification?: unknown;
  error?: string;
}

/**
 * POST /api/indexing/request
 * Request Google to index a URL via the Indexing API.
 * Body: { url: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse<IndexingResponse>> {
  const authState = await requireApiSession();
  if (authState.unauthorized) {
    return authState.unauthorized as NextResponse<IndexingResponse>;
  }

  let body: IndexingRequestBody;
  try {
    body = (await req.json()) as IndexingRequestBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { url } = body;
  if (!url || typeof url !== "string") {
    return NextResponse.json({ success: false, error: "url (string) required" }, { status: 400 });
  }

  try {
    const auth = getGoogleAuth();
    const client = await (auth as { getClient: () => Promise<{ getAccessToken: () => Promise<{ token?: string | null }> }> }).getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      return NextResponse.json({ success: false, error: "Failed to obtain access token" }, { status: 500 });
    }

    const response = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        url,
        type: "URL_UPDATED",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[indexing] Google API error ${response.status}:`, errorText);
      return NextResponse.json(
        { success: false, error: `Google Indexing API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const notification = await response.json();
    console.log(`[indexing] Successfully requested indexing for: ${url}`);

    return NextResponse.json({
      success: true,
      url,
      notification,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[indexing] Error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
