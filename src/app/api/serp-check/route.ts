import { NextRequest, NextResponse } from "next/server";
import { askAICached } from "@/lib/ai-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Uses Perplexity (web search) to analyze real-time SERPs for a keyword
export async function POST(req: NextRequest) {
  try {
    const { query, site_url } = await req.json() as { query: string; site_url?: string };
    if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

    const prompt = `Analyse les résultats de recherche Google actuels pour le mot clé "${query}"${site_url ? ` (site analysé: ${site_url})` : ""}.

Donne-moi :
1. **Top 5 résultats actuels** (titre + domaine + pourquoi ils rankent)
2. **Intention de recherche dominante** (info/transac/nav/local)
3. **Format de contenu qui domine** (article, liste, vidéo, produit...)
4. **Longueur estimée** du contenu qui rank en top 3
5. **Questions People Also Ask** (3-5 questions)
6. **Featured snippet** présent ? Si oui, quel format ?
7. **Difficulté estimée** (faible/moyenne/élevée) et pourquoi
8. **Angle différenciateur** pour se démarquer

Format markdown, sois précis et basé sur les vrais résultats actuels.`;

    const market = site_url ? new URL(site_url.startsWith("http") ? site_url : `https://${site_url}`).hostname : "global";
    const { reply: analysis } = await askAICached({
      cacheKey: `serp-check:${query}:${market}`,
      messages: [{ role: "user", content: prompt }],
      model: "search",
      maxTokens: 1200,
    });
    return NextResponse.json({ analysis, query });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
