export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";
import { persistResearchForSite, runResearchForSite } from "../route";

interface Site {
  id: number;
  name: string;
  url: string;
}

/**
 * Weekly refresh using the same no-key, multi-source research engine as the
 * interactive competitor tool. Public pages can prove observed topics and
 * domains, but they cannot prove Google volume, difficulty, or position.
 */
export async function POST(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const sql = getSQL();
  try {
    const sites = (await sql`
      SELECT DISTINCT s.id, s.name, s.url
      FROM sites s
      INNER JOIN search_console_data scd ON scd.site_id = s.id
      WHERE s.is_active = true
        AND scd.date >= NOW() - INTERVAL '30 days'
      ORDER BY s.id
    `) as Site[];

    const results: Array<{
      site: string;
      competitors: number;
      observed_topics: number;
      status: "complete" | "preserved" | "unavailable";
      error?: string;
    }> = [];

    for (const site of sites) {
      try {
        const research = await runResearchForSite(site, sql);
        const persisted = await persistResearchForSite(site, sql, research);
        results.push({
          site: site.name,
          competitors: research.competitors.length,
          observed_topics: research.gaps.length,
          status: persisted ? "complete" : "preserved",
          error: persisted
            ? undefined
            : "Le nouveau résultat était insuffisant; le cache vérifié précédent a été conservé.",
        });
      } catch (error) {
        results.push({
          site: site.name,
          competitors: 0,
          observed_topics: 0,
          status: "unavailable",
          error: error instanceof Error ? error.message : "Recherche publique indisponible",
        });
      }
    }

    const unavailable = results.filter((result) => result.status === "unavailable").length;
    return NextResponse.json({
      success: unavailable === 0,
      status: unavailable === 0 ? "complete" : unavailable === sites.length ? "failed" : "partial",
      engine: "local-research-v2",
      metric_boundaries: {
        observed_topics: "Titres et intertitres observés sur des pages publiques.",
        volume: "Non calculé sans source Keyword Planner ou équivalente.",
        google_position: "Non calculée depuis les moteurs publics.",
        difficulty: "Non calculée sans fournisseur dédié.",
      },
      sites: sites.length,
      results,
    }, { status: unavailable === sites.length && sites.length > 0 ? 503 : 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Recherche hebdomadaire indisponible" },
      { status: 500 },
    );
  }
}
