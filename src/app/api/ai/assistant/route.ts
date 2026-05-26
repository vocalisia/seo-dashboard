export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAI, generateImage, MODELS, AIProviderError } from "@/lib/ai";
import { getSQL } from "@/lib/db";
import { z } from "zod";
import { createHash } from "crypto";
import { logError } from "@/lib/logger";

const schema = z.object({
  action: z.enum(["write", "translate", "image", "analyze", "research", "competitor", "eeat"]),
  prompt: z.string().min(1).max(4000),
  context: z.string().optional(),
  targetLang: z.string().optional(),
  tone: z.string().optional(),
});

interface CacheRow {
  response: string;
  cached_at: string;
}

async function ensureCacheTable(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS ai_widget_cache (
      cache_key TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      prompt TEXT NOT NULL,
      context TEXT,
      response TEXT NOT NULL,
      cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function makeCacheKey(action: string, prompt: string, context?: string): string {
  return createHash("sha256").update(`${action}|${prompt}|${context ?? ""}`).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());

    if (body.action === "image") {
      const url = await generateImage(body.prompt);
      return NextResponse.json({ success: true, url });
    }

    // Cache-first: check ai_widget_cache before calling AI (saves budget)
    const sql = getSQL();
    try {
      await ensureCacheTable(sql);
      const cacheKey = makeCacheKey(body.action, body.prompt, body.context);
      const cached = (await sql`
        SELECT response, cached_at FROM ai_widget_cache
        WHERE cache_key = ${cacheKey}
          AND cached_at >= NOW() - INTERVAL '30 days'
        LIMIT 1
      `) as CacheRow[];
      if (cached.length > 0) {
        return NextResponse.json({
          success: true,
          reply: cached[0].response,
          cached: true,
          cached_at: cached[0].cached_at,
        });
      }
    } catch (cacheErr) {
      // Cache miss / table not ready — fall through to AI call
      logError("ai.assistant.cacheLookup", cacheErr, { action: body.action });
    }

    let systemPrompt = "";
    let model: keyof typeof MODELS = "fast";

    if (body.action === "write") {
      systemPrompt = `Tu es un rédacteur SEO expert francophone. Ton: ${body.tone ?? "professionnel"}. Réponds en markdown structuré (H2/H3, listes, gras). Optimisé Google E-E-A-T. Pas de hallucination.`;
      model = "creative";
    } else if (body.action === "translate") {
      const lang = body.targetLang ?? "en";
      const langName: Record<string, string> = {
        fr: "français",
        en: "anglais",
        de: "allemand",
        es: "espagnol",
        it: "italien",
      };
      const langLabel = langName[lang] ?? lang;
      systemPrompt = `Tu es un traducteur professionnel. Traduis vers ${langLabel} en gardant le ton, les nuances SEO, et la mise en forme markdown. Ne traduis pas les noms propres ni les marques.`;
      model = "smart";
    } else if (body.action === "analyze") {
      systemPrompt = `Tu es un consultant SEO senior. Analyse les données fournies et donne 3-5 recommandations actionnables et priorisées. Format markdown concis. Contexte: ${body.context ?? "aucun"}.`;
      model = "smart";
    } else if (body.action === "research") {
      systemPrompt = `Tu es un expert SEO avec accès SERP temps réel. Recherche les données 2026 actuelles. Cite tes sources (URLs). Réponds en markdown structuré FR. Contexte: ${body.context ?? "aucun"}.`;
      model = "search";
    } else if (body.action === "competitor") {
      systemPrompt = `Tu es un analyste concurrentiel SEO avec accès web temps réel. Identifie concurrents directs (top 10 SERP), extrait leurs mots-clés, contenu récent, backlinks visibles, faiblesses. Cite URLs. Format markdown FR. Contexte: ${body.context ?? "aucun"}.`;
      model = "search";
    } else if (body.action === "eeat") {
      // E-E-A-T pipeline kept for completeness; same cache-first applied above
      systemPrompt = "Tu es rédacteur SEO senior expert E-E-A-T. Tu cites systématiquement tes sources. Tu n'inventes jamais de faits.";
      model = "smart";
    }

    try {
      const reply = await askAI(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: body.prompt },
        ],
        model,
        2000
      );

      // Persist to cache for future calls
      try {
        const cacheKey = makeCacheKey(body.action, body.prompt, body.context);
        await sql`
          INSERT INTO ai_widget_cache (cache_key, action, prompt, context, response)
          VALUES (${cacheKey}, ${body.action}, ${body.prompt}, ${body.context ?? null}, ${reply})
          ON CONFLICT (cache_key) DO UPDATE
            SET response = EXCLUDED.response, cached_at = NOW()
        `;
      } catch { /* cache write failure shouldn't block response */ }

      return NextResponse.json({ success: true, reply, cached: false });
    } catch (aiErr) {
      // AI call failed — return graceful fallback (instead of raw error)
      const msg = aiErr instanceof AIProviderError ? aiErr.message : (aiErr instanceof Error ? aiErr.message : "AI unavailable");
      const friendly = msg.includes("Crédit") || msg.includes("ExceededBudget") || msg.includes("budget")
        ? `**Crédit AI épuisé.** Cette analyse n'est pas encore en cache. Régénère via Claude Code: \`node _kw-verify/refresh-ai-widget.mjs\` ou recharge un provider (Perplexity Pro / Anthropic).`
        : `**Erreur AI temporaire**: ${msg}. Réessaie dans quelques secondes ou utilise un autre provider.`;
      return NextResponse.json({
        success: true,
        reply: friendly,
        cached: false,
        ai_unavailable: true,
        error_detail: msg,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
