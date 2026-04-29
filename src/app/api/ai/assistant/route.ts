export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAI, generateImage, MODELS } from "@/lib/ai";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["write", "translate", "image", "analyze", "research", "competitor", "eeat"]),
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

    // E-E-A-T pipeline: Perplexity (research + sources) → Sonnet (writing with citations)
    if (body.action === "eeat") {
      const researchPrompt = `Recherche approfondie sur: "${body.prompt}". Liste:
1. 5-10 sources autoritaires (sites .gov, .edu, études récentes 2024-2026, médias top tier)
2. Statistiques/chiffres clés vérifiables avec sources
3. Citations d'experts reconnus du domaine (avec leur titre/fonction)
4. Points de vue contradictoires si pertinent
5. Données récentes 2026

Format: liste structurée avec URL pour CHAQUE info. Pas d'opinion personnelle.`;

      const research = await askAI(
        [
          { role: "system", content: "Tu es un chercheur SEO avec accès SERP live. Cite toujours tes sources URL. Pas d'invention." },
          { role: "user", content: researchPrompt },
        ],
        "search",
        2500
      );

      const writingPrompt = `Rédige un article SEO E-E-A-T complet sur: "${body.prompt}"

Utilise EXCLUSIVEMENT les recherches ci-dessous (cite sources via [Source: nom](url)):

=== RECHERCHE ===
${research}
=== FIN RECHERCHE ===

Exigences E-E-A-T:
- **Experience**: ton 1ère personne quand pertinent, exemples concrets
- **Expertise**: vocabulaire précis du domaine, nuances techniques
- **Authority**: cite 5+ sources autoritaires avec liens markdown
- **Trust**: chiffres vérifiables, dates, attributions claires

Structure:
- H1 optimisé (60-70 chars)
- Intro (réponse rapide en 2 lignes pour AIO)
- 4-6 sections H2 logiques avec H3 si nécessaire
- Données + citations dans chaque section
- FAQ structurée (5 questions)
- Conclusion actionnable

Longueur: 1500-2500 mots. Markdown propre. Ton: ${body.tone ?? "expert professionnel"}.`;

      const article = await askAI(
        [
          { role: "system", content: "Tu es rédacteur SEO senior expert E-E-A-T. Tu cites systématiquement tes sources. Tu n'inventes jamais de faits." },
          { role: "user", content: writingPrompt },
        ],
        "smart",
        4000
      );

      return NextResponse.json({
        success: true,
        reply: article,
        meta: { research_phase: research, pipeline: "perplexity+sonnet" },
      });
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
