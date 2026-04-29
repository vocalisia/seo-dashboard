export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { askAI } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";

interface TranslatableFields {
  niche: string;
  reason: string;
  seed_articles: string[];
  sample_queries: string[];
  business_model_type?: string;
  business_model_how_to_monetize?: string;
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

    const raw = await askAI([{ role: "user", content: prompt }], "fast", 1200);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const translated = JSON.parse(cleaned) as Partial<TranslatableFields>;

    return NextResponse.json({
      success: true,
      target,
      original: {
        niche: payload.niche,
        reason: payload.reason,
      },
      translated,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
