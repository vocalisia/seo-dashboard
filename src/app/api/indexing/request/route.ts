export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
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

  // Google Indexing API is restricted to JobPosting and livestream VideoObject.
  // Regular SEO articles must be discovered through the sitemap and normal crawl.
  return NextResponse.json(
    {
      success: false,
      url,
      error: "Google Indexing API is disabled for ordinary content. Submit or refresh the sitemap instead.",
    },
    { status: 422 },
  );
}