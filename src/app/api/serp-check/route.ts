import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/api-auth";
import { runWebResearch, type ResearchSource } from "@/lib/web-research";
import { parseResearchPublicUrl } from "@/lib/web-research-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  query: z.string().trim().min(2).max(300),
  site_url: z.string().trim().max(2_048).optional(),
  locale: z.string().regex(/^[a-z]{2}(?:[-_][A-Z]{2})?$/).default("fr-FR"),
});

function normalizedSite(raw?: string): { url: string; domain: string } | null {
  if (!raw) return null;
  const url = parseResearchPublicUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return { url: url.toString(), domain: url.hostname.replace(/^www\./i, "") };
}

function normalizedQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function sourceMatchesExactQuery(source: ResearchSource, query: string): boolean {
  const expected = normalizedQuery(query);
  return (source.matched_queries ?? []).some((matched) => normalizedQuery(matched) === expected);
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.issues.map((issue) => issue.message).join("; ")
      : "Invalid JSON request body";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  let site: ReturnType<typeof normalizedSite>;
  try {
    site = normalizedSite(body.site_url);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Invalid site URL" },
      { status: 400 },
    );
  }

  try {
    const report = await runWebResearch(body.query, { locale: body.locale, maxSources: 8 });
    const allSiteSources = site
      ? report.sources.filter((source) =>
          source.domain === site.domain || source.domain.endsWith(`.${site.domain}`)
        )
      : [];
    const exactSiteSources = allSiteSources.filter((source) => sourceMatchesExactQuery(source, body.query));
    return NextResponse.json({
      success: report.data_status !== "unavailable",
      query: body.query,
      analysis: report.answer,
      data_status: report.data_status,
      sources: report.sources,
      evidence: report.evidence,
      providers: report.search_providers,
      ranking_scope: "public_bing_rss_and_duckduckgo_html_discovery",
      ranking_notice: "Positions propres à chaque source publique; elles ne sont jamais présentées comme des positions Google.",
      site: site ? {
        ...site,
        visible_in_sources: exactSiteSources.length > 0,
        matching_sources: exactSiteSources,
        visible_in_expanded_research: allSiteSources.length > 0,
        expanded_query_sources: allSiteSources,
      } : null,
    }, { status: report.data_status === "unavailable" ? 502 : 200 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "SERP research failed" },
      { status: 500 },
    );
  }
}
