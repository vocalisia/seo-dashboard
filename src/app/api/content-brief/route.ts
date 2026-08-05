import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/api-auth";
import { runWebResearch, type WebResearchReport } from "@/lib/web-research";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  query: z.string().trim().min(2).max(300),
  locale: z.string().regex(/^[a-z]{2}(?:[-_][A-Z]{2})?$/).default("fr-FR"),
});

function cleanExternalText(value: string, maxLength = 100): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[#*<>\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleForQuery(query: string): string {
  const normalized = cleanExternalText(query, 48);
  return (normalized.charAt(0).toUpperCase() + normalized.slice(1) + " : guide pratique").slice(0, 60);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export function buildSourcedContentBrief(query: string, report: WebResearchReport): string {
  const cleanQuery = cleanExternalText(query, 120);
  const clusters = report.keyword_clusters ?? [];
  const observedHeadings = unique(report.sources.flatMap((source) =>
    source.headings.map((heading) => cleanExternalText(heading))
  )).filter((heading) => heading.length >= 6);
  const clusterLabels = unique(clusters.map((cluster) => cleanExternalText(cluster.label)));
  const sections = unique([
    "Comprendre " + cleanQuery,
    ...clusterLabels,
    ...observedHeadings,
    "Choisir la bonne approche pour " + cleanQuery,
    "Questions fréquentes",
  ]).slice(0, 7);
  const semanticTerms = unique(clusters.flatMap((cluster) =>
    cluster.keywords.map((item) => cleanExternalText(item.keyword))
  )).filter((term) => term.toLowerCase() !== cleanQuery.toLowerCase()).slice(0, 12);
  const observedQuestions = unique(clusters.flatMap((cluster) =>
    cluster.keywords
      .filter((item) => item.kind === "question")
      .map((item) => cleanExternalText(item.keyword))
  ));
  const faq = unique([
    ...observedQuestions,
    "Qu'est-ce que " + cleanQuery + " ?",
    "Comment choisir " + cleanQuery + " ?",
    "Quels critères comparer pour " + cleanQuery + " ?",
    "Quelles erreurs éviter avec " + cleanQuery + " ?",
    "Comment évaluer les résultats liés à " + cleanQuery + " ?",
  ]).slice(0, 5);
  const wordMedian = median(report.sources
    .filter((source) => source.fetch_status === "ok" && source.word_count > 0)
    .map((source) => source.word_count));
  const wordTarget = wordMedian == null
    ? "À définir après analyse éditoriale; aucune longueur concurrente exploitable n'a été observée."
    : "Repère observé: médiane d'environ "
      + Math.max(300, Math.round(wordMedian / 100) * 100)
      + " mots sur les pages extraites. Adapter à l'intention, sans remplir artificiellement.";
  const intent = report.inferred_intent ?? "informational";
  const sourceLines = report.sources.slice(0, 8)
    .map((source, index) =>
      (index + 1) + ". [" + cleanExternalText(source.title, 100) + "](" + source.url + ") — " + source.domain
    );
  const corroborated = (report.claims ?? [])
    .filter((claim) => claim.confidence === "corroborated")
    .slice(0, 5)
    .map((claim) =>
      "- " + cleanExternalText(claim.statement, 220) + " [preuves: " + claim.source_ids.join(", ") + "]"
    );

  return [
    "# Brief SEO sourcé — " + cleanQuery,
    "",
    "**Titre SEO proposé :** " + titleForQuery(cleanQuery),
    ("**Meta description proposée :** Découvrez " + cleanQuery
      + ", les critères utiles, les choix possibles et les réponses essentielles. Décidez avec des sources vérifiables.").slice(0, 155),
    "**Intention détectée :** " + intent,
    "**Statut des données :** " + report.data_status,
    "",
    "## Angle éditorial",
    "Répondre directement à l'intention autour de « " + cleanQuery
      + " », comparer les options observées et relier chaque affirmation factuelle à une source.",
    "",
    "## Structure H2/H3",
    ...sections.map((section, index) => (index + 1) + ". H2 — " + section),
    "",
    "## Termes et sous-thèmes observés",
    ...(semanticTerms.length > 0 ? semanticTerms.map((term) => "- " + term) : ["- Aucun terme récurrent suffisamment étayé."]),
    "",
    "## Questions fréquentes",
    ...faq.map((question) => "- " + question),
    "",
    "## Faits corroborés à exploiter avec citation",
    ...(corroborated.length > 0 ? corroborated : ["- Aucun fait multi-source suffisamment corroboré; vérifier manuellement avant publication."]),
    "",
    "## Longueur et format",
    wordTarget,
    "",
    "## CTA",
    "Proposer une prochaine étape utile et contextuelle, sans promesse non vérifiée.",
    "",
    "## Sources consultées",
    ...(sourceLines.length > 0 ? sourceLines : ["Aucune source publique exploitable."]),
    "",
    "_Limites : les volumes, la difficulté SEO et les positions Google ne sont pas déduits de ces pages publiques._",
  ].join("\n");
}

async function createBrief(query: string, locale: string) {
  const report = await runWebResearch(query, {
    locale,
    maxSources: 10,
    maxQueries: 6,
    depth: "deep",
    focus: "content",
  });
  return { report, brief: buildSourcedContentBrief(query, report) };
}

export async function POST(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await req.json());
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join("; ")
      : "Invalid JSON";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  try {
    const { report, brief } = await createBrief(body.query, body.locale);
    return NextResponse.json({
      success: report.data_status !== "unavailable",
      brief,
      cached: false,
      ai_unavailable: false,
      engine: "local-research-v2",
      data_status: report.data_status,
      sources: report.sources,
      metric_boundaries: report.metric_boundaries,
    }, { status: report.data_status === "unavailable" ? 502 : 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Content research failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  const parsed = requestSchema.safeParse({
    query: req.nextUrl.searchParams.get("query") ?? "",
    locale: req.nextUrl.searchParams.get("locale") ?? "fr-FR",
  });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "query required" }, { status: 400 });
  }
  try {
    const { report, brief } = await createBrief(parsed.data.query, parsed.data.locale);
    return new NextResponse(brief, {
      status: report.data_status === "unavailable" ? 502 : 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Content research failed" },
      { status: 500 },
    );
  }
}
