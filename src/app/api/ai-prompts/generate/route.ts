export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAI } from "@/lib/ai";
import { z } from "zod";

const BodySchema = z.object({
  topic: z.string().min(1).max(300),
  lang: z.enum(["fr", "en", "de", "es", "it"]).default("fr"),
});

interface PromptItem {
  prompt: string;
  intent: "info" | "transac" | "comm" | "nav";
  reasoning: string;
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

  const { topic, lang } = parsed.data;

  const systemPrompt = `Tu es expert SEO/AI search. Génère 30 prompts en ${lang} qu'un utilisateur taperait dans ChatGPT/Gemini sur le thème "${topic}". Réponds UNIQUEMENT en JSON valide (pas de markdown): [{"prompt":"...","intent":"info|transac|comm|nav","reasoning":"..."}]. Diversifie les intentions: info (informationnel), transac (transactionnel), comm (commercial/comparatif), nav (navigationnel/marque).`;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("AI timeout")), 30000)
  );

  try {
    const text = await Promise.race([
      askAI([{ role: "user", content: systemPrompt }], "creative", 2500),
      timeoutPromise,
    ]);

    let prompts: PromptItem[] = [];
    try {
      const cleaned = text
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();
      prompts = JSON.parse(cleaned) as PromptItem[];
    } catch {
      // fallback: split by lines
      prompts = text
        .split("\n")
        .filter((l) => l.trim().length > 5)
        .slice(0, 30)
        .map((l) => ({
          prompt: l.replace(/^\d+\.\s*/, "").trim(),
          intent: "info" as const,
          reasoning: "",
        }));
    }

    return NextResponse.json({ success: true, prompts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
