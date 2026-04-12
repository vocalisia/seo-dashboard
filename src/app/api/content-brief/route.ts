import { NextRequest, NextResponse } from "next/server";
import { askAI } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      query: string;
      position?: number;
      impressions?: number;
    };

    const { query, position = 0, impressions = 0 } = body;
    if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

    const prompt = `Tu es expert SEO. Génère un brief de contenu complet pour positionner sur le mot clé "${query}" (position actuelle: ${position.toFixed(1)}, ${impressions} impressions/mois).
Génère:
1. **Titre SEO optimisé** (60 car max)
2. **Meta description** (155 car max)
3. **Structure H2/H3** (plan détaillé avec 5-7 sections)
4. **Mots clés sémantiques** à intégrer (10 termes)
5. **Questions FAQ** à couvrir (5 questions)
6. **Intention de recherche** (info/transac/nav + explication)
7. **Longueur recommandée** et format
8. **CTA suggéré**
Format markdown.`;

    const brief = await askAI([{ role: "user", content: prompt }], "fast", 1500);
    return NextResponse.json({ brief });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
