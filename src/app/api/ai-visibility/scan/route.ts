export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAI } from "@/lib/ai";
import { z } from "zod";

const BodySchema = z.object({
  siteId: z.number().int().positive(),
  brand: z.string().min(1).max(200),
  queries: z.array(z.string().min(1)).min(1).max(10),
});

type LLMKey = "search" | "smart" | "fast" | "creative";

interface ScanResultItem {
  query: string;
  llm: string;
  mentioned: boolean;
  indirect: boolean;
  position: number | null;
  competitors: { name: string; rank: number }[];
}

function detectBrand(
  text: string,
  brand: string
): { mentioned: boolean; indirect: boolean; position: number | null } {
  const brandBase = brand.replace(/\.(com|fr|net|org|io|ch|ai)$/i, "");
  const patterns = [
    new RegExp(`\\b${escapeRegex(brand)}\\b`, "i"),
    new RegExp(`\\b${escapeRegex(brandBase)}\\b`, "i"),
  ];

  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    for (const pat of patterns) {
      if (pat.test(lines[i])) {
        return { mentioned: true, indirect: false, position: i + 1 };
      }
    }
  }

  // indirect: brand mentioned but not in a list context
  for (const pat of patterns) {
    if (pat.test(text)) {
      return { mentioned: false, indirect: true, position: null };
    }
  }

  return { mentioned: false, indirect: false, position: null };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCompetitors(
  text: string,
  brand: string
): { name: string; rank: number }[] {
  const brandBase = brand.replace(/\.(com|fr|net|org|io|ch|ai)$/i, "");
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const competitors: { name: string; rank: number }[] = [];
  const seen = new Set<string>();

  lines.forEach((line, i) => {
    const domainMatch = line.match(
      /([a-z0-9-]+\.(com|fr|net|org|io|ch|ai|co|de|uk))/i
    );
    if (domainMatch) {
      const name = domainMatch[1].toLowerCase();
      const isBrand =
        name.includes(brand.toLowerCase()) ||
        name.includes(brandBase.toLowerCase());
      if (!isBrand && !seen.has(name) && competitors.length < 5) {
        seen.add(name);
        competitors.push({ name, rank: i + 1 });
      }
    }
  });

  return competitors;
}

const LLM_LABELS: Record<LLMKey, string> = {
  search: "Perplexity",
  smart: "Claude",
  fast: "Gemini",
  creative: "Mistral",
};

async function scanWithTimeout(
  query: string,
  brand: string,
  model: LLMKey
): Promise<ScanResultItem> {
  const prompt = `Réponds à cette question: "${query}". Liste 5 sites/marques que tu recommandes pour ce sujet. Donne une réponse structurée avec une liste numérotée.`;

  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 28000)
  );

  let text = "";
  try {
    text = await Promise.race([
      askAI([{ role: "user", content: prompt }], model, 600),
      timeoutPromise,
    ]);
  } catch {
    return {
      query,
      llm: LLM_LABELS[model],
      mentioned: false,
      indirect: false,
      position: null,
      competitors: [],
    };
  }

  const { mentioned, indirect, position } = detectBrand(text, brand);
  const competitors = extractCompetitors(text, brand);

  return {
    query,
    llm: LLM_LABELS[model],
    mentioned,
    indirect,
    position,
    competitors,
  };
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

  const { brand, queries } = parsed.data;

  const models: LLMKey[] = ["search", "smart", "fast", "creative"];

  try {
    const tasks: Promise<ScanResultItem>[] = [];
    for (const query of queries) {
      for (const model of models) {
        tasks.push(scanWithTimeout(query, brand, model));
      }
    }

    const results = await Promise.all(tasks);

    const mentionedCount = results.filter((r) => r.mentioned).length;
    const score =
      results.length > 0
        ? Math.round((mentionedCount / results.length) * 100)
        : 0;

    return NextResponse.json({ success: true, results, score });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
