export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAI, generateImage, MODELS } from "@/lib/ai";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["write", "translate", "image", "analyze", "research", "competitor"]),
  prompt: z.string().min(1).max(4000),
  context: z.string().optional(),
  targetLang: z.string().optional(),
  tone: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());

    if (body.action === "image") {
      const url = await generateImage(body.prompt);
      return NextResponse.json({ success: true, url });
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
    }

    const reply = await askAI(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: body.prompt },
      ],
      model,
      2000
    );

    return NextResponse.json({ success: true, reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
