export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { askAICached } from "@/lib/ai-cache";
import { z } from "zod";

const BodySchema = z.object({
  keywords: z.array(z.string()).min(1).max(200),
});

interface Cluster {
  cluster_name: string;
  keywords: string[];
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 400 }
    );
  }

  const { keywords } = parsed.data;

  const prompt = `Groupe ces ${keywords.length} mots-clés en clusters sémantiques. Réponds UNIQUEMENT en JSON valide: [{"cluster_name":"...","keywords":["..."]}]. Mots-clés: ${keywords.slice(0, 100).join(", ")}`;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("AI timeout")), 30000)
  );

  try {
    const kwHash = createHash("sha256").update(keywords.slice(0, 100).join("|")).digest("hex").slice(0, 16);
    const text = await Promise.race([
      askAICached({
        cacheKey: `kwpro:${kwHash}`,
        messages: [{ role: "user", content: prompt }],
        model: "fast",
        maxTokens: 1500,
      }).then((r) => r.reply),
      timeoutPromise,
    ]);

    let clusters: Cluster[] = [];
    try {
      const cleaned = text
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();
      clusters = JSON.parse(cleaned) as Cluster[];
    } catch {
      clusters = [{ cluster_name: "Tous les mots-clés", keywords }];
    }

    return NextResponse.json({ success: true, clusters });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
