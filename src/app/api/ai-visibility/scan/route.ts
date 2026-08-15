export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAICached } from "@/lib/ai-cache";
import { requireApiSession } from "@/lib/api-auth";
import { calculateVisibilityScore } from "@/lib/ai-visibility-score";
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
  measured: boolean;
  measurement_status: "live" | "cache" | "unavailable";
  error?: string;
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
  search: "Recherche web",
  smart: "Analyse",
  fast: "Rapide",
  creative: "Créatif",
};

async function scanWithTimeout(
  query: string,
  brand: string,
  model: LLMKey,
  siteId: number
): Promise<ScanResultItem> {
  const prompt = `Réponds à cette question: "${query}". Liste 5 sites/marques que tu recommandes pour ce sujet. Donne une réponse structurée avec une liste numérotée.`;

  const timeoutPromise = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 28000)
  );

  let text = "";
  try {
    const today = new Date().toISOString().slice(0, 10);
    const answer = await Promise.race([
      askAICached({
        cacheKey: `aivis:${siteId}:${model}:${query}:${today}`,
        messages: [{ role: "user", content: prompt }],
        model,
        maxTokens: 600,
        fallback: "",
      }),
      timeoutPromise.then((reply) => ({ reply, cached: false, ai_unavailable: true, error_detail: "timeout" })),
    ]);
    if (answer.ai_unavailable) {
      return {
        query,
        llm: LLM_LABELS[model],
        mentioned: false,
        indirect: false,
        position: null,
        competitors: [],
        measured: false,
        measurement_status: "unavailable",
        error: answer.error_detail || "Fournisseur indisponible",
      };
    }
    text = answer.reply;
    const { mentioned, indirect, position } = detectBrand(text, brand);
    const competitors = extractCompetitors(text, brand);
    return {
      query,
      llm: LLM_LABELS[model],
      mentioned,
      indirect,
      position,
      competitors,
      measured: true,
      measurement_status: answer.cached ? "cache" : "live",
    };
  } catch (error) {
    return {
      query,
      llm: LLM_LABELS[model],
      mentioned: false,
      indirect: false,
      position: null,
      competitors: [],
      measured: false,
      measurement_status: "unavailable",
      error: error instanceof Error ? error.message : "Fournisseur indisponible",
    };
  }
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;
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

  const { brand, queries, siteId } = parsed.data;

  const models: LLMKey[] = ["search", "smart", "fast", "creative"];

  try {
    const tasks: Promise<ScanResultItem>[] = [];
    for (const query of queries) {
      for (const model of models) {
        tasks.push(scanWithTimeout(query, brand, model, siteId));
      }
    }

    const results = await Promise.all(tasks);

    const coverage = calculateVisibilityScore(results);

    return NextResponse.json({
      success: true,
      results,
      score: coverage.score,
      coverage,
      methodology: "Quatre modes de génération sont demandés. Le fournisseur réellement disponible peut être commun à plusieurs modes; aucun nom de plateforme n'est attribué sans preuve. Les indisponibilités sont exclues du score.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
