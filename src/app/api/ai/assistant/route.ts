export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAI, generateImage, MODELS, AIProviderError } from "@/lib/ai";
import { getSQL } from "@/lib/db";
import { z } from "zod";
import { createHash } from "crypto";
import { logError } from "@/lib/logger";
import { runWebResearch, type WebResearchReport } from "@/lib/web-research";
import { requireApiSession } from "@/lib/api-auth";

const GROUNDED_RESEARCH_CACHE_VERSION = "local-research-v2";

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

function isGroundedResearchAction(action: string): boolean {
  return action === "research" || action === "competitor" || action === "eeat";
}

function makeCacheKey(action: string, prompt: string, context?: string): string {
  const version = isGroundedResearchAction(action) ? `${GROUNDED_RESEARCH_CACHE_VERSION}|` : "";
  return createHash("sha256").update(`${version}${action}|${prompt}|${context ?? ""}`).digest("hex");
}

function parseCachedResearch(response: string): WebResearchReport | null {
  try {
    const parsed = JSON.parse(response) as Partial<WebResearchReport>;
    if (
      typeof parsed.answer !== "string"
      || !["complete", "partial", "unavailable"].includes(parsed.data_status ?? "")
      || !Array.isArray(parsed.sources)
      || !Array.isArray(parsed.evidence)
    ) {
      return null;
    }
    return parsed as WebResearchReport;
  } catch {
    return null;
  }
}

function researchPayload(report: WebResearchReport, cached: boolean, cachedAt?: string) {
  const success = report.data_status !== "unavailable";
  return {
    success,
    ...(!success ? { error: "Aucune source publique vérifiable n'a pu être récupérée." } : {}),
    reply: report.answer,
    cached,
    ...(cachedAt ? { cached_at: cachedAt } : {}),
    sources: report.sources,
    evidence: report.evidence,
    claims: report.claims ?? [],
    keyword_clusters: report.keyword_clusters ?? [],
    query_plan: report.query_plan ?? [],
    coverage: report.coverage ?? null,
    metric_boundaries: report.metric_boundaries ?? null,
    data_status: report.data_status,
  };
}

function makeResearchQuery(prompt: string, context?: string): string {
  return [prompt.trim(), context?.trim() ? `Contexte: ${context.trim()}` : ""]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

function buildGroundedEeatBrief(
  topic: string,
  tone: string | undefined,
  report: WebResearchReport,
): string {
  const claims = report.evidence.slice(0, 6).map((item) => `- ${item.claim} [${item.source_id}]`);
  const headings = [...new Set(report.sources.flatMap((source) => source.headings))]
    .filter(Boolean)
    .slice(0, 8);
  return [
    `# ${topic.trim()}`,
    "",
    `**Brief E-E-A-T sourcé — ton : ${tone ?? "expert professionnel"}**`,
    "",
    "## Réponse documentée",
    ...(claims.length > 0 ? claims : ["Les sources récupérées ne permettent pas encore une synthèse factuelle suffisante."]),
    "",
    "## Plan éditorial recommandé",
    ...(headings.length > 0 ? headings.map((heading) => `- ${heading}`) : [
      "- Réponse courte à la question principale",
      "- Méthode et critères vérifiables",
      "- Limites et cas particuliers",
      "- Questions fréquentes",
    ]),
    "",
    "## Sources à citer",
    ...report.sources.map((source) => `- [${source.id}] ${source.title} — ${source.url}`),
    "",
    "_Ce brief n'invente ni volume, ni difficulté, ni backlink, ni position Google._",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const body = schema.parse(await req.json());
    const cacheContext = [body.context, body.tone ? `tone:${body.tone}` : "", body.targetLang ? `lang:${body.targetLang}` : ""]
      .filter(Boolean)
      .join("|");

    if (body.action === "image") {
      const url = await generateImage(body.prompt);
      return NextResponse.json({ success: true, url });
    }

    // Cache-first: check ai_widget_cache before calling AI (saves budget)
    const sql = getSQL();
    try {
      await ensureCacheTable(sql);
      const cacheKey = makeCacheKey(body.action, body.prompt, cacheContext);
      const cached = (await sql`
        SELECT response, cached_at FROM ai_widget_cache
        WHERE cache_key = ${cacheKey}
          AND cached_at >= NOW() - INTERVAL '30 days'
        LIMIT 1
      `) as CacheRow[];
      if (cached.length > 0) {
        if (isGroundedResearchAction(body.action)) {
          const report = parseCachedResearch(cached[0].response);
          if (report && report.data_status !== "unavailable") {
            return NextResponse.json(researchPayload(report, true, cached[0].cached_at));
          }
        } else {
          return NextResponse.json({
            success: true,
            reply: cached[0].response,
            cached: true,
            cached_at: cached[0].cached_at,
          });
        }
      }
    } catch (cacheErr) {
      // Cache miss / table not ready — fall through to the requested provider.
      logError("ai.assistant.cacheLookup", cacheErr, { action: body.action });
    }

    if (isGroundedResearchAction(body.action)) {
      try {
        const researched = await runWebResearch(makeResearchQuery(body.prompt, body.context), {
          locale: "fr-FR",
          maxSources: body.action === "competitor" ? 12 : 10,
          maxQueries: body.action === "competitor" ? 8 : 6,
          depth: "deep",
          focus: body.action === "competitor"
            ? "competitors"
            : body.action === "eeat"
              ? "content"
              : "general",
        });
        const report = body.action === "eeat"
          ? { ...researched, answer: buildGroundedEeatBrief(body.prompt, body.tone, researched) }
          : researched;

        // Do not cache provider outages so a later request retries public search.
        if (report.data_status !== "unavailable") {
          try {
            const cacheKey = makeCacheKey(body.action, body.prompt, cacheContext);
            await sql`
              INSERT INTO ai_widget_cache (cache_key, action, prompt, context, response)
              VALUES (${cacheKey}, ${body.action}, ${body.prompt}, ${body.context ?? null}, ${JSON.stringify(report)})
              ON CONFLICT (cache_key) DO UPDATE
                SET response = EXCLUDED.response, cached_at = NOW()
            `;
          } catch { /* cache write failure shouldn't block sourced research */ }
        }

        return NextResponse.json(
          researchPayload(report, false),
          { status: report.data_status === "unavailable" ? 502 : 200 },
        );
      } catch (researchErr) {
        const msg = researchErr instanceof Error ? researchErr.message : "Web research unavailable";
        return NextResponse.json({
          success: false,
          error: "Recherche web temporairement indisponible.",
          reply: "**Recherche web temporairement indisponible.** Aucune source publique vérifiable n'a pu être récupérée. Réessaie dans quelques instants.",
          cached: false,
          sources: [],
          evidence: [],
          data_status: "unavailable",
          error_detail: msg,
        }, { status: 502 });
      }
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
        const cacheKey = makeCacheKey(body.action, body.prompt, cacheContext);
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
      const friendly = msg.includes("fallback is disabled")
        ? "**Action générative indisponible.** Recherche, Concurrents et brief E-E-A-T restent disponibles sans API; cette action de rédaction ou traduction nécessite un provider configuré ou une réponse déjà en cache."
        : msg.includes("Crédit") || msg.includes("ExceededBudget") || msg.includes("budget")
          ? "**Credit AI epuise.** Cette analyse n'est pas encore en cache. Relance via cache local ou change de provider seulement si necessaire."
          : `**Erreur AI temporaire**: ${msg}. Reessaie dans quelques secondes ou utilise un autre provider.`;
      return NextResponse.json({
        success: false,
        error: friendly,
        reply: friendly,
        cached: false,
        ai_unavailable: true,
        error_detail: msg,
      }, { status: 503 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
