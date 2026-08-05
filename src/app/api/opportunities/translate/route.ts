export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";

interface TranslatableFields {
  niche: string;
  reason: string;
  seed_articles: string[];
  sample_queries: string[];
  business_model_type?: string;
  business_model_how_to_monetize?: string;
}

function translateTextFallback(input: string): string {
  let out = input || "";
  const replacements: Array<[RegExp, string]> = [
    [/\bmonthly impressions detected in GSC-like demand\b/gi, "impressions mensuelles detectees via un signal proche GSC"],
    [/\bmomentum over the previous 30-day window\b/gi, "de momentum sur les 30 derniers jours"],
    [/\bfast-rising demand\b/gi, "demande en forte hausse"],
    [/\bSERP gap remains accessible\b/gi, "la SERP semble encore attaquable"],
    [/\bfar from existing portfolio\b/gi, "eloigne du portefeuille actuel"],
    [/\bstrong informational demand\b/gi, "forte demande informationnelle"],
    [/\bmagazine focused on informational demand\b/gi, "magazine oriente demande informationnelle"],
    [/\bBuild a content moat around\b/gi, "Construire un moat de contenu autour de"],
    [/\band monetize through ads\b/gi, "et monetiser via la publicite"],
    [/\bads\b/gi, "publicite"],
    [/\blongtail\b/gi, "longue traine"],
    [/\bemerging\b/gi, "emergent"],
    [/\bblog\b/gi, "blog"],
    [/\bmagazine\b/gi, "magazine"],
    [/\bdirectory\b/gi, "annuaire"],
    [/\bsaas\b/gi, "SaaS"],
    [/\be-commerce\b/gi, "e-commerce"],
  ];
  for (const [from, to] of replacements) out = out.replace(from, to);
  return out.trim();
}

function fallbackTranslation(payload: TranslatableFields): TranslatableFields {
  return {
    niche: translateTextFallback(payload.niche),
    reason: translateTextFallback(payload.reason),
    seed_articles: payload.seed_articles.map(translateTextFallback),
    sample_queries: payload.sample_queries.map(translateTextFallback),
    business_model_type: payload.business_model_type ? translateTextFallback(payload.business_model_type) : undefined,
    business_model_how_to_monetize: payload.business_model_how_to_monetize
      ? translateTextFallback(payload.business_model_how_to_monetize)
      : undefined,
  };
}

async function disabledExternalTranslation(request: unknown): Promise<{ reply: string }> {
  void request;
  throw new Error("External translation providers are disabled");
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: { opportunity_id?: number; target?: string };
  try {
    body = (await req.json()) as { opportunity_id?: number; target?: string };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const oppId = body.opportunity_id;
  const target = (body.target || "fr").toLowerCase();
  if (!oppId) {
    return NextResponse.json({ success: false, error: "opportunity_id required" }, { status: 400 });
  }
  if (target !== "fr") {
    return NextResponse.json({
      success: false,
      error: "Only the local French translation is available without an external provider.",
      api_key_required: false,
    }, { status: 400 });
  }

  const sql = getSQL();
  try {
    const rows = await sql`SELECT * FROM market_opportunities WHERE id = ${oppId} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }
    const opp = rows[0] as Record<string, unknown>;

    const businessModel = (() => {
      const bm = opp.business_model;
      if (!bm) return {};
      if (typeof bm === "string") {
        try { return JSON.parse(bm) as Record<string, unknown>; } catch { return {}; }
      }
      return bm as Record<string, unknown>;
    })();

    const payload: TranslatableFields = {
      niche: String(opp.niche ?? ""),
      reason: String(opp.reason ?? ""),
      seed_articles: Array.isArray(opp.seed_articles)
        ? (opp.seed_articles as unknown[]).map((s) => String(s))
        : (typeof opp.seed_articles === "string"
            ? (() => { try { return JSON.parse(opp.seed_articles as string) as string[]; } catch { return []; } })()
            : []),
      sample_queries: Array.isArray(opp.sample_queries)
        ? (opp.sample_queries as unknown[]).map((s) => String(s))
        : (typeof opp.sample_queries === "string"
            ? (() => { try { return JSON.parse(opp.sample_queries as string) as string[]; } catch { return []; } })()
            : []),
      business_model_type: businessModel.type ? String(businessModel.type) : undefined,
      business_model_how_to_monetize: businessModel.how_to_monetize ? String(businessModel.how_to_monetize) : undefined,
    };

    if (target === "fr") {
      return NextResponse.json({
        success: true,
        target,
        fallback: true,
        source: "local_translation_rules",
        api_key_required: false,
        original: {
          niche: payload.niche,
          reason: payload.reason,
        },
        translated: fallbackTranslation(payload),
      });
    }

    // Legacy provider-based translations are intentionally disabled.
    const langName: Record<string, string> = {
      fr: "français",
      en: "anglais",
      es: "espagnol",
      de: "allemand",
      it: "italien",
      pt: "portugais",
      nl: "néerlandais",
    };

    const prompt = `Traduis tous les champs suivants en ${langName[target] ?? target}.
Conserve la structure JSON exacte. Garde les noms propres et les marques inchangés.
Sois naturel et idiomatique, pas de traduction littérale.

INPUT:
${JSON.stringify(payload, null, 2)}

RÉPONSE en JSON strict avec EXACTEMENT les mêmes clés:
{
  "niche": "...",
  "reason": "...",
  "seed_articles": ["...", "..."],
  "sample_queries": ["...", "..."],
  "business_model_type": "...",
  "business_model_how_to_monetize": "..."
}`;

    let translated: Partial<TranslatableFields>;
    let fallback = false;
    try {
      const { reply: raw } = await disabledExternalTranslation({
        cacheKey: `opp-translate:${oppId}:${target}`,
        messages: [{ role: "user", content: prompt }],
        model: "fast",
        maxTokens: 1200,
      });
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      translated = JSON.parse(cleaned) as Partial<TranslatableFields>;
    } catch {
      translated = fallbackTranslation(payload);
      fallback = true;
    }

    return NextResponse.json({
      success: true,
      target,
      fallback,
      original: {
        niche: payload.niche,
        reason: payload.reason,
      },
      translated,
    });
    // End disabled provider path.
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
