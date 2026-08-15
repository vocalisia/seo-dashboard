export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAICached } from "@/lib/ai-cache";
import { requireApiSession } from "@/lib/api-auth";
import { buildLocalAIPrompts, parseGeneratedAIPrompts } from "@/lib/ai-prompt-engine";
import { z } from "zod";

const BodySchema = z.object({
  topic: z.string().min(1).max(300),
  lang: z.enum(["fr", "en", "de", "es", "it"]).default("fr"),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;
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
  const localPrompts = buildLocalAIPrompts(topic, lang);

  if (process.env.AI_PROMPTS_LIVE_ENABLED !== "true") {
    return NextResponse.json({
      success: true,
      prompts: localPrompts,
      source: "local_engine",
      notice: "30 prompts générés localement sans API.",
    });
  }

  const systemPrompt = `Tu es expert SEO/AI search. Génère 30 prompts en ${lang} qu'un utilisateur taperait dans ChatGPT/Gemini sur le thème "${topic}". Réponds UNIQUEMENT en JSON valide (pas de markdown): [{"prompt":"...","intent":"info|transac|comm|nav","reasoning":"..."}]. Diversifie les intentions: info (informationnel), transac (transactionnel), comm (commercial/comparatif), nav (navigationnel/marque).`;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("AI timeout")), 30000)
  );

  try {
    const today = new Date().toISOString().slice(0, 10);
    const answer = await Promise.race([
      askAICached({
        cacheKey: `ai-prompts:${topic}:${lang}:${today}`,
        messages: [{ role: "user", content: systemPrompt }],
        model: "creative",
        maxTokens: 2500,
        fallback: "",
      }),
      timeoutPromise,
    ]);
    const prompts = answer.ai_unavailable ? null : parseGeneratedAIPrompts(answer.reply);
    if (!prompts) {
      return NextResponse.json({ success: true, prompts: localPrompts, source: "local_engine", notice: "Réponse externe indisponible ou invalide; 30 prompts locaux vérifiés ont été utilisés." });
    }
    return NextResponse.json({ success: true, prompts, source: answer.cached ? "validated_cache" : "validated_ai", notice: "30 prompts externes validés strictement." });
  } catch (err) {
    return NextResponse.json({ success: true, prompts: localPrompts, source: "local_engine", notice: `Moteur externe indisponible; fallback local utilisé (${err instanceof Error ? err.message : "erreur inconnue"}).` });
  }
}
