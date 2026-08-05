import {
  canonicalizeResearchUrl,
  crawlResearchResults,
  searchWebNoKey,
  toPublicResearchSource,
} from "@/lib/web-research";
import {
  buildKeywordClusters,
  buildResearchAnswer,
  buildResearchClaims,
  inferResearchIntent,
  normalizeResearchText,
  researchTokens,
  researchRegistrableDomain,
  scoreResearchSources,
} from "@/lib/research-analysis";
import type {
  ResearchDepth,
  ResearchFocus,
  ResearchQueryStep,
  WebResearchOptions,
  WebResearchReport,
  WebSearchProvider,
  WebSearchResult,
} from "@/lib/web-research-types";

export interface PlannedResearchQuery {
  id: string;
  query: string;
  purpose: ResearchQueryStep["purpose"];
  round: 1 | 2;
  weight: number;
}

export interface SearchBatch {
  plan: PlannedResearchQuery;
  results: WebSearchResult[];
  providers: WebResearchReport["search_providers"];
}

function cleanQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function institutionalSuffix(locale: string): string {
  const normalized = locale.toLowerCase().replace("_", "-");
  if (normalized.endsWith("-ch")) return "sources officielles site:admin.ch";
  if (normalized.endsWith("-be")) return "sources officielles site:belgium.be";
  if (normalized.endsWith("-ca")) return "sources officielles site:canada.ca";
  if (normalized.endsWith("-de")) return "offizielle quellen site:bund.de";
  return "sources officielles site:gouv.fr";
}

function pushUnique(
  plans: PlannedResearchQuery[],
  seen: Set<string>,
  query: string,
  purpose: PlannedResearchQuery["purpose"],
  round: 1 | 2,
  weight: number,
  maxQueries: number,
): void {
  if (plans.length >= maxQueries) return;
  const cleaned = cleanQuery(query);
  const key = normalizeResearchText(cleaned);
  if (cleaned.length < 2 || seen.has(key)) return;
  seen.add(key);
  plans.push({
    id: "Q" + (plans.length + 1),
    query: cleaned,
    purpose,
    round,
    weight,
  });
}

export function planResearchQueries(
  query: string,
  options: {
    locale: string;
    depth: ResearchDepth;
    focus: ResearchFocus;
    maxQueries: number;
  },
): PlannedResearchQuery[] {
  const base = cleanQuery(query);
  const plans: PlannedResearchQuery[] = [];
  const seen = new Set<string>();
  pushUnique(plans, seen, base, "primary", 1, 1, options.maxQueries);
  pushUnique(plans, seen, base + " guide méthode", "overview", 1, 0.92, options.maxQueries);

  if (options.focus === "competitors") {
    pushUnique(plans, seen, base + " concurrents alternatives comparatif", "comparison", 1, 0.94, options.maxQueries);
    pushUnique(plans, seen, base + " questions avis", "questions", 1, 0.82, options.maxQueries);
  } else if (options.focus === "content") {
    pushUnique(plans, seen, base + " questions fréquentes", "questions", 1, 0.94, options.maxQueries);
    pushUnique(plans, seen, base + " étude données méthodologie", "evidence", 1, 0.9, options.maxQueries);
  } else {
    pushUnique(plans, seen, base + " comparatif alternatives", "comparison", 1, 0.86, options.maxQueries);
    pushUnique(plans, seen, base + " questions fréquentes", "questions", 1, 0.84, options.maxQueries);
  }

  if (options.depth === "deep") {
    pushUnique(plans, seen, base + " " + institutionalSuffix(options.locale), "evidence", 1, 0.88, options.maxQueries);
  }
  return plans;
}

async function executePlans(
  plans: PlannedResearchQuery[],
  locale: string,
  signal: AbortSignal,
): Promise<SearchBatch[]> {
  const results = new Array<SearchBatch>(plans.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < plans.length && !signal.aborted) {
      const index = cursor;
      cursor += 1;
      const plan = plans[index];
      const search = await searchWebNoKey(plan.query, locale, 12, { signal });
      results[index] = { plan, results: search.results, providers: search.providers };
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, plans.length) }, () => worker()));
  return results.filter(Boolean);
}

export function deriveExpansionQueries(
  query: string,
  batches: SearchBatch[],
  remaining: number,
  existingCount: number,
): PlannedResearchQuery[] {
  if (remaining <= 0) return [];
  const queryTokens = new Set(researchTokens(query));
  const termDomains = new Map<string, Set<string>>();
  const termScores = new Map<string, number>();
  for (const batch of batches) {
    for (const [index, result] of batch.results.entries()) {
      const tokens = new Set(researchTokens(result.title + " " + result.snippet));
      for (const token of tokens) {
        if (queryTokens.has(token) || token.length < 4) continue;
        const domains = termDomains.get(token) ?? new Set<string>();
        domains.add(result.domain);
        termDomains.set(token, domains);
        termScores.set(token, (termScores.get(token) ?? 0) + 1 / (1 + index));
      }
    }
  }
  const terms = [...termScores.entries()]
    .filter(([term]) => (termDomains.get(term)?.size ?? 0) >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .slice(0, Math.max(2, remaining * 2));
  const plans: PlannedResearchQuery[] = [];
  const seen = new Set<string>(batches.map((batch) => normalizeResearchText(batch.plan.query)));
  for (let index = 0; index < terms.length && plans.length < remaining; index += 1) {
    const paired = terms[index + 1];
    const suffix = paired ? terms[index] + " " + paired : terms[index];
    const expanded = cleanQuery(query + " " + suffix);
    const key = normalizeResearchText(expanded);
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push({
      id: "Q" + (existingCount + plans.length + 1),
      query: expanded,
      purpose: "expansion",
      round: 2,
      weight: 0.8,
    });
    index += paired ? 1 : 0;
  }
  return plans;
}

interface FusedEntry {
  result: WebSearchResult;
  matchedQueries: Set<string>;
  score: number;
}

function fusionKey(url: string): string {
  try {
    const parsed = new URL(canonicalizeResearchUrl(url));
    return parsed.hostname.replace(/^www\./, "") + parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

export function fusePlannedSearchResults(batches: SearchBatch[], limit: number): WebSearchResult[] {
  const fused = new Map<string, FusedEntry>();
  for (const batch of batches) {
    for (const [index, result] of batch.results.entries()) {
      const rank = index + 1;
      const providerFactor = 1 + Math.max(0, result.providers.length - 1) * 0.18;
      const contribution = batch.plan.weight * providerFactor * (1 / (60 + rank));
      const key = fusionKey(result.url);
      const existing = fused.get(key);
      if (!existing) {
        fused.set(key, {
          result: { ...result, providers: [...result.providers], positions: { ...result.positions } },
          matchedQueries: new Set([batch.plan.query]),
          score: contribution,
        });
        continue;
      }
      existing.score += contribution;
      existing.matchedQueries.add(batch.plan.query);
      for (const provider of result.providers) {
        if (!existing.result.providers.includes(provider)) existing.result.providers.push(provider);
      }
      for (const provider of result.providers) {
        const position = result.positions[provider];
        if (position === undefined) continue;
        const previous = existing.result.positions[provider];
        existing.result.positions[provider] = previous === undefined ? position : Math.min(previous, position);
      }
      if (!existing.result.snippet && result.snippet) existing.result.snippet = result.snippet;
    }
  }

  const sorted = [...fused.values()].sort((a, b) =>
    b.score - a.score || b.matchedQueries.size - a.matchedQueries.size
  );
  const maxScore = sorted[0]?.score ?? 1;
  const enriched = sorted.map((entry) => ({
    ...entry.result,
    matched_queries: [...entry.matchedQueries],
    retrieval_score: Math.round((entry.score / maxScore) * 100),
  }));

  const selected: WebSearchResult[] = [];
  const domainCounts = new Map<string, number>();
  for (const passLimit of [1, 2]) {
    for (const result of enriched) {
      if (selected.length >= limit) break;
      if (selected.some((item) => fusionKey(item.url) === fusionKey(result.url))) continue;
      const host = result.domain.replace(/^www\./, "");
      const count = domainCounts.get(host) ?? 0;
      if (count >= passLimit) continue;
      domainCounts.set(host, count + 1);
      selected.push(result);
    }
  }
  return selected;
}

function aggregateProviderStatus(
  batches: SearchBatch[],
): Record<WebSearchProvider, "ok" | "empty" | "failed"> {
  const providers: WebSearchProvider[] = ["bing_rss", "duckduckgo_html"];
  return Object.fromEntries(providers.map((provider) => {
    const statuses = batches.map((batch) => batch.providers[provider]);
    const status = statuses.includes("ok")
      ? "ok"
      : statuses.includes("empty")
        ? "empty"
        : "failed";
    return [provider, status];
  })) as Record<WebSearchProvider, "ok" | "empty" | "failed">;
}

function querySteps(batches: SearchBatch[]): ResearchQueryStep[] {
  return batches.map((batch) => ({
    ...batch.plan,
    result_count: batch.results.length,
    provider_status: batch.providers,
  }));
}

function uniqueResultCount(batches: SearchBatch[]): number {
  const keys = new Set<string>();
  for (const batch of batches) for (const result of batch.results) keys.add(fusionKey(result.url));
  return keys.size;
}

export async function runWebResearchEngine(
  query: string,
  options: WebResearchOptions = {},
): Promise<WebResearchReport> {
  const normalizedQuery = cleanQuery(query);
  if (normalizedQuery.length < 2) throw new Error("Research query is too short");
  const locale = options.locale ?? "fr-FR";
  const depth = options.depth ?? "deep";
  const focus = options.focus ?? "general";
  const defaultQueries = depth === "deep" ? 6 : 3;
  const maxQueries = Math.max(1, Math.min(8, options.maxQueries ?? defaultQueries));
  const defaultSources = depth === "deep" ? 10 : 6;
  const maxSources = Math.max(1, Math.min(12, options.maxSources ?? defaultSources));
  const deadline = AbortSignal.timeout(50_000);

  const initialPlans = planResearchQueries(normalizedQuery, { locale, depth, focus, maxQueries });
  const firstRound = await executePlans(initialPlans, locale, deadline);
  const remaining = Math.max(0, maxQueries - initialPlans.length);
  const expansions = depth === "deep"
    ? deriveExpansionQueries(normalizedQuery, firstRound, remaining, initialPlans.length)
    : [];
  const secondRound = expansions.length > 0 && !deadline.aborted
    ? await executePlans(expansions, locale, deadline)
    : [];
  const batches = [...firstRound, ...secondRound];
  const providers = aggregateProviderStatus(batches);
  const fused = fusePlannedSearchResults(batches, maxSources);

  if (fused.length === 0) {
    return {
      query: normalizedQuery,
      locale,
      generated_at: new Date().toISOString(),
      data_status: "unavailable",
      search_providers: providers,
      answer: "Aucune source publique exploitable n'a été trouvée pour « " + normalizedQuery + " ».",
      evidence: [],
      sources: [],
      engine_version: "local-research-v2",
      depth,
      focus,
      inferred_intent: inferResearchIntent(normalizedQuery),
      query_plan: querySteps(batches),
      claims: [],
      keyword_clusters: [],
      coverage: {
        queries_planned: batches.length,
        queries_with_results: 0,
        results_discovered: 0,
        sources_selected: 0,
        sources_crawled: 0,
        independent_domains: 0,
        corroborated_claims: 0,
      },
      metric_boundaries: {
        search_volume: "not_measured",
        keyword_difficulty: "not_measured",
        google_position: "not_measured",
        public_search_positions: "bing_ddg_only",
      },
    };
  }

  const crawled = scoreResearchSources(
    normalizedQuery,
    await crawlResearchResults(fused, maxSources, 4, deadline),
  );
  const { evidence, claims } = buildResearchClaims(normalizedQuery, crawled);
  const clusters = buildKeywordClusters(normalizedQuery, crawled);
  const sources = crawled.map(toPublicResearchSource);
  const sourcesCrawled = sources.filter((source) => source.fetch_status === "ok").length;
  const crawledSources = sources.filter((source) => source.fetch_status === "ok");
  const independentDomains = new Set(
    crawledSources.map((source) => researchRegistrableDomain(source.domain)),
  ).size;
  const queriesWithResults = batches.filter((batch) => batch.results.length > 0).length;
  const corroboratedClaims = claims.filter((claim) => claim.confidence === "corroborated").length;
  const sourceById = new Map(crawledSources.map((source) => [source.id, source]));
  const evidenceDomains = new Set(
    evidence
      .map((item) => sourceById.get(item.source_id))
      .filter((source): source is (typeof crawledSources)[number] => Boolean(source))
      .map((source) => researchRegistrableDomain(source.domain)),
  ).size;
  const coverage = {
    queries_planned: batches.length,
    queries_with_results: queriesWithResults,
    results_discovered: uniqueResultCount(batches),
    sources_selected: sources.length,
    sources_crawled: sourcesCrawled,
    independent_domains: independentDomains,
    corroborated_claims: corroboratedClaims,
  };
  const complete = sourcesCrawled >= Math.min(3, maxSources)
    && independentDomains >= Math.min(3, maxSources)
    && queriesWithResults >= Math.min(2, batches.length)
    && (corroboratedClaims > 0 || evidenceDomains >= 3);

  return {
    query: normalizedQuery,
    locale,
    generated_at: new Date().toISOString(),
    data_status: complete ? "complete" : "partial",
    search_providers: providers,
    answer: buildResearchAnswer({ query: normalizedQuery, claims, clusters, sources, coverage }),
    evidence,
    sources,
    engine_version: "local-research-v2",
    depth,
    focus,
    inferred_intent: inferResearchIntent(normalizedQuery),
    query_plan: querySteps(batches),
    claims,
    keyword_clusters: clusters,
    coverage,
    metric_boundaries: {
      search_volume: "not_measured",
      keyword_difficulty: "not_measured",
      google_position: "not_measured",
      public_search_positions: "bing_ddg_only",
    },
  };
}
