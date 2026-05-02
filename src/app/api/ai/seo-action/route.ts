export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { askAI } from "@/lib/ai";
import { requireApiSession } from "@/lib/api-auth";
import { z } from "zod";

const schema = z.object({
  siteId: z.number().int().positive(),
  query: z.string().min(1).max(500),
  position: z.number().nonnegative(),
  monthlyVolume: z.number().nonnegative(),
  actionType: z.enum(["push", "optimize", "maintain", "create"]),
  siteUrl: z.string().url().optional(),
});

const SYSTEM_PROMPT = `Tu es un consultant SEO senior français pour PME/agences. Tu donnes des plans d'action concrets, chiffrés, actionnables sous 24h.
Style: bullet points, marqueurs ✅ ❌ 🚀, pas de blabla, max 250 mots.
Toujours inclure: 1) Diagnostic en 1 phrase, 2) 3-5 actions précises avec délai, 3) Résultat attendu chiffré.`;

function buildPrompt(input: z.infer<typeof schema>): string {
  const ctxSite = input.siteUrl ? `\nSite: ${input.siteUrl}` : "";
  const base = `Mot-clé: "${input.query}"${ctxSite}
Position actuelle: ${input.position.toFixed(1)}
Volume mensuel estimé: ${input.monthlyVolume.toLocaleString('fr-FR')} recherches/mois
Type d'action demandée: ${input.actionType}`;

  switch (input.actionType) {
    case "push":
      return `${base}\n\nObjectif: Pousser cette page de la position ${input.position.toFixed(0)} vers le top 10 (idéalement top 5).
Donne-moi un plan d'attaque CONCRET pour les 14 prochains jours:
- Quels 3 articles internes créer pour booster ce KW (avec slugs SEO précis)?
- Quels 2 backlinks viser (sites cibles + pitch en 2 lignes)?
- Quels ajustements on-page IMMEDIATS (title, H1, meta, internal links)?
- Combien de clics gagnés estimés à 30j et 90j?`;
    case "optimize":
      return `${base}\n\nObjectif: Optimiser cette page déjà top 10 pour booster CTR + position.
Donne-moi:
- Nouveau title (60 chars) optimisé CTR avec angle émotionnel/chiffre/question
- Nouvelle meta description (155 chars) qui pousse au clic
- 3 améliorations H2/contenu pour rich snippets (FAQ, table, liste)
- Schema.org à ajouter (FAQPage, HowTo, Article)
- Estimé: % gain CTR attendu`;
    case "maintain":
      return `${base}\n\nObjectif: Maintenir cette position top 3.
Donne-moi:
- Quels 2 risques surveiller (concurrents qui montent, déclin contenu)
- Combien de fois rafraîchir le contenu par an (date update, stats récentes)
- 3 KPIs à monitorer chaque semaine
- Quels backlinks défendre en priorité`;
    case "create":
      return `${base}\n\nObjectif: Créer du contenu DEDIE sur ce mot-clé (pas encore de page rankée).
Donne-moi:
- Brief article complet: titre H1 (60 chars), meta description, 8 H2 avec angle SEO
- 5 KW longue traîne associés à inclure naturellement
- Mot-cible principal + sémantique (entités, NER)
- Type de contenu (guide / comparatif / cas client / how-to)
- Combien de mots viser et pourquoi
- Position cible à 60 jours`;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiSession();
  if (auth.unauthorized) return auth.unauthorized;

  try {
    const body = schema.parse(await req.json());
    const userPrompt = buildPrompt(body);

    const response = await askAI(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      "smart",
      1200
    );

    return NextResponse.json({
      success: true,
      query: body.query,
      actionType: body.actionType,
      response,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
