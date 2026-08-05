import type {
  CrawledResearchSource,
  ResearchClaim,
  ResearchCoverage,
  ResearchEvidence,
  ResearchIntent,
  ResearchKeywordCluster,
  ResearchKeywordOpportunity,
  ResearchSource,
} from "@/lib/web-research-types";

const STOP_WORDS = new Set([
  "avec", "aux", "ces", "dans", "des", "elle", "est", "ils", "les", "leur", "mais", "mes",
  "mon", "nos", "notre", "nous", "par", "pas", "plus", "pour", "que", "qui", "ses", "son",
  "sur", "une", "vos", "votre", "vous", "the", "and", "are", "for", "from", "how", "into",
  "its", "not", "that", "this", "what", "when", "where", "which", "with", "your", "der", "die",
  "das", "den", "ein", "eine", "für", "mit", "und", "von", "wie",
]);

const JUNK_TEXT = /\b(cookie|cookies|confidentialit|privacy|connexion|login|newsletter|javascript|menu|navigation)\b/i;
const QUESTION_START = /^(comment|pourquoi|combien|quand|quel|quelle|quels|quelles|où|ou|qui|que|quoi|how|why|what|when|where|which|who)\b/i;

export function normalizeResearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function researchTokens(value: string): string[] {
  return normalizeResearchText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function uniqueTokens(value: string): Set<string> {
  return new Set(researchTokens(value));
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = intersectionSize(a, b);
  const union = a.size + b.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const containment = intersection / Math.min(a.size, b.size);
  return Math.max(jaccard, containment * 0.82);
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp",
  "com.br", "com.mx", "com.sg", "com.tr", "com.cn", "com.hk", "co.za",
]);

export function researchRegistrableDomain(domain: string): string {
  const labels = domain.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo)
    ? labels.slice(-3).join(".")
    : lastTwo;
}

export function inferResearchIntent(query: string): ResearchIntent {
  const normalized = normalizeResearchText(query);
  if (/\b(acheter|commande|commander|devis|inscription|reservation|buy|order|quote|subscribe)\b/.test(normalized)) {
    return "transactional";
  }
  if (/\b(meilleur|comparatif|alternative|avis|versus|best|review|compare|vs)\b/.test(normalized)) {
    return "commercial";
  }
  if (/\b(site officiel|connexion|login|adresse|contact|official site)\b/.test(normalized)) {
    return "navigational";
  }
  return "informational";
}

function isInstitutionalDomain(domain: string): boolean {
  const host = domain.toLowerCase();
  return host.endsWith(".gov") || host.endsWith(".edu")
    || host === "admin.ch" || host.endsWith(".admin.ch")
    || host === "gouv.fr" || host.endsWith(".gouv.fr")
    || host === "europa.eu" || host.endsWith(".europa.eu")
    || host === "who.int" || host.endsWith(".who.int")
    || host === "oecd.org" || host.endsWith(".oecd.org");
}

export function scoreResearchSources(
  query: string,
  sources: CrawledResearchSource[],
): CrawledResearchSource[] {
  const queryTokens = uniqueTokens(query);
  return sources.map((source) => {
    const signals: string[] = [];
    let score = source.fetch_status === "ok" ? 28 : 5;
    if (source.fetch_status === "ok") signals.push("crawled_content");
    if (source.providers.length > 1) {
      score += 12;
      signals.push("multi_provider_match");
    }
    const matchedQueries = source.matched_queries?.length ?? 0;
    if (matchedQueries > 1) {
      score += Math.min(15, (matchedQueries - 1) * 5);
      signals.push("multi_query_match");
    }
    const titleTokens = uniqueTokens(source.title + " " + source.description);
    const titleOverlap = queryTokens.size > 0 ? intersectionSize(queryTokens, titleTokens) / queryTokens.size : 0;
    if (titleOverlap > 0) {
      score += Math.min(18, titleOverlap * 22);
      signals.push("query_title_overlap");
    }
    if (source.word_count >= 500) {
      score += source.word_count >= 1_500 ? 10 : 6;
      signals.push("substantial_visible_text");
    }
    if (source.schema_types.length > 0) {
      score += 5;
      signals.push("structured_data");
    }
    if (isInstitutionalDomain(source.domain)) {
      score += 12;
      signals.push("institutional_domain");
    }
    score += Math.min(10, (source.retrieval_score ?? 0) / 10);
    return {
      ...source,
      source_score: boundedScore(score),
      source_signals: signals,
    };
  });
}

interface EvidenceCandidate extends ResearchEvidence {
  domain: string;
  tokens: Set<string>;
}

function hasNegation(value: string): boolean {
  return /\b(ne|n|pas|jamais|aucun|aucune|sans|non|not|never|no|cannot|cant|without)\b/i
    .test(normalizeResearchText(value));
}

function numericFacts(value: string): Set<string> {
  return new Set(value.match(/\b\d+(?:[.,]\d+)?(?:\s?%|\s?[a-z]{1,5})?\b/gi) ?? []);
}

function claimsCompatible(a: EvidenceCandidate, b: EvidenceCandidate): boolean {
  if (hasNegation(a.claim) !== hasNegation(b.claim)) return false;
  const aNumbers = numericFacts(a.claim);
  const bNumbers = numericFacts(b.claim);
  if (aNumbers.size === 0 || bNumbers.size === 0) return true;
  return intersectionSize(aNumbers, bNumbers) > 0;
}

function evidenceCandidates(query: string, sources: CrawledResearchSource[]): EvidenceCandidate[] {
  const queryTokens = uniqueTokens(query);
  const candidates: EvidenceCandidate[] = [];
  for (const source of sources) {
    if (source.fetch_status !== "ok") continue;
    const seen = new Set<string>();
    for (const raw of source.excerpt.split(/(?<=[.!?])\s+/)) {
      const sentence = raw.replace(/\s+/g, " ").trim();
      if (sentence.length < 55 || sentence.length > 300 || JUNK_TEXT.test(sentence)) continue;
      const normalized = normalizeResearchText(sentence);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const tokens = uniqueTokens(sentence);
      const overlap = intersectionSize(queryTokens, tokens);
      if (overlap === 0) continue;
      const coverage = overlap / Math.max(1, queryTokens.size);
      const score = boundedScore(coverage * 58 + Math.min(22, overlap * 7) + (source.source_score ?? 0) * 0.2);
      candidates.push({
        source_id: source.id,
        claim: sentence,
        score,
        domain: researchRegistrableDomain(source.domain),
        tokens,
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function buildResearchClaims(
  query: string,
  sources: CrawledResearchSource[],
): { evidence: ResearchEvidence[]; claims: ResearchClaim[] } {
  const candidates = evidenceCandidates(query, sources);
  const clusters: Array<{ representative: EvidenceCandidate; supports: EvidenceCandidate[] }> = [];
  for (const candidate of candidates) {
    let best: { cluster: (typeof clusters)[number]; similarity: number } | null = null;
    for (const cluster of clusters) {
      if (!claimsCompatible(candidate, cluster.representative)) continue;
      const similarity = tokenSimilarity(candidate.tokens, cluster.representative.tokens);
      if (similarity >= 0.48 && (!best || similarity > best.similarity)) best = { cluster, similarity };
    }
    if (best) {
      if (!best.cluster.supports.some((support) => support.domain === candidate.domain)) {
        best.cluster.supports.push(candidate);
      }
    } else {
      clusters.push({ representative: candidate, supports: [candidate] });
    }
    if (clusters.length >= 24) break;
  }

  const claims = clusters.map((cluster, index): ResearchClaim => {
    const supports = cluster.supports.sort((a, b) => b.score - a.score);
    const independentDomains = new Set(supports.map((support) => support.domain)).size;
    const average = supports.reduce((sum, support) => sum + support.score, 0) / supports.length;
    return {
      id: "C" + (index + 1),
      statement: supports[0].claim,
      support: supports.map((support) => ({
        source_id: support.source_id,
        excerpt: support.claim,
        score: support.score,
      })),
      source_ids: supports.map((support) => support.source_id),
      independent_domains: independentDomains,
      confidence: independentDomains >= 2 ? "corroborated" : "single_source",
      score: boundedScore(average + Math.min(18, (independentDomains - 1) * 9)),
    };
  }).sort((a, b) =>
    Number(b.confidence === "corroborated") - Number(a.confidence === "corroborated") || b.score - a.score
  ).slice(0, 10);

  const evidence = candidates
    .slice(0, 18)
    .map(({ source_id, claim, score }) => ({ source_id, claim, score }));
  return { evidence, claims };
}

interface KeywordCandidate {
  keyword: string;
  intent: ResearchIntent;
  kind: ResearchKeywordOpportunity["kind"];
  sourceIds: Set<string>;
  score: number;
  tokens: Set<string>;
}

function cleanKeywordPhrase(value: string): string | null {
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+[|—–]\s+.*$/, "")
    .replace(/[<>{}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\d\s:;,.#-]+|[\s:;,.#-]+$/g, "")
    .trim()
    .slice(0, 130);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const normalized = normalizeResearchText(cleaned);
  if (
    cleaned.length < 5
    || words.length < 2
    || words.length > 14
    || JUNK_TEXT.test(cleaned)
    || /^(accueil|en savoir plus|lire la suite|read more|home page)$/i.test(normalized)
  ) return null;
  return cleaned;
}

function inferKeywordKind(keyword: string, query: string): ResearchKeywordOpportunity["kind"] {
  if (QUESTION_START.test(keyword) || keyword.includes("?")) return "question";
  return tokenSimilarity(uniqueTokens(query), uniqueTokens(keyword)) >= 0.7 ? "core" : "supporting";
}

export function buildKeywordClusters(
  query: string,
  sources: CrawledResearchSource[],
): ResearchKeywordCluster[] {
  const candidateMap = new Map<string, KeywordCandidate>();
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const addCandidate = (raw: string, sourceId: string, baseScore: number) => {
    const keyword = cleanKeywordPhrase(raw);
    if (!keyword) return;
    const key = normalizeResearchText(keyword);
    const source = sourceMap.get(sourceId);
    const score = baseScore + (source?.source_score ?? 0) * 0.35;
    const existing = candidateMap.get(key);
    if (existing) {
      existing.sourceIds.add(sourceId);
      existing.score += baseScore * 0.4;
      return;
    }
    candidateMap.set(key, {
      keyword,
      intent: inferResearchIntent(keyword),
      kind: inferKeywordKind(keyword, query),
      sourceIds: new Set([sourceId]),
      score,
      tokens: uniqueTokens(keyword),
    });
  };

  for (const source of sources) {
    for (const segment of source.title.split(/\s+[|—–]\s+/)) addCandidate(segment, source.id, 28);
    for (const heading of source.headings.slice(0, 16)) addCandidate(heading, source.id, 34);
    for (const sentence of source.excerpt.split(/(?<=[!?])\s+/)) {
      if (QUESTION_START.test(sentence.trim()) || sentence.includes("?")) addCandidate(sentence, source.id, 30);
    }
  }

  const candidates = [...candidateMap.values()]
    .filter((candidate) => candidate.tokens.size >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 72);
  const grouped: Array<{ representative: KeywordCandidate; items: KeywordCandidate[] }> = [];
  for (const candidate of candidates) {
    const match = grouped.find((cluster) => {
      const shared = intersectionSize(candidate.tokens, cluster.representative.tokens);
      return shared >= 2 && tokenSimilarity(candidate.tokens, cluster.representative.tokens) >= 0.42;
    });
    if (match) match.items.push(candidate);
    else grouped.push({ representative: candidate, items: [candidate] });
  }

  return grouped.map((group, index): ResearchKeywordCluster => {
    const items = group.items.sort((a, b) => b.score - a.score).slice(0, 8);
    const sourceIds = [...new Set(items.flatMap((item) => [...item.sourceIds]))];
    const keywords = items.map((item): ResearchKeywordOpportunity => ({
      keyword: item.keyword,
      intent: item.intent,
      source_ids: [...item.sourceIds],
      source_count: item.sourceIds.size,
      evidence_score: boundedScore(item.score + Math.min(18, (item.sourceIds.size - 1) * 9)),
      kind: item.kind,
    }));
    return {
      id: "K" + (index + 1),
      label: items[0].keyword,
      intent: items[0].intent,
      keywords,
      source_ids: sourceIds,
      evidence_score: boundedScore(
        keywords.reduce((sum, item) => sum + item.evidence_score, 0) / keywords.length
        + Math.min(12, (sourceIds.length - 1) * 4),
      ),
    };
  }).sort((a, b) => b.evidence_score - a.evidence_score).slice(0, 14);
}

export function buildResearchAnswer(input: {
  query: string;
  claims: ResearchClaim[];
  clusters: ResearchKeywordCluster[];
  sources: ResearchSource[];
  coverage: ResearchCoverage;
}): string {
  const corroborated = input.claims.filter((claim) => claim.confidence === "corroborated").slice(0, 5);
  const singleSource = input.claims.filter((claim) => claim.confidence === "single_source").slice(0, 3);
  const lines = ["Recherche approfondie documentée pour « " + input.query + " » :", ""];
  if (corroborated.length > 0) {
    lines.push("Points recoupés :");
    for (const claim of corroborated) {
      lines.push("- " + claim.statement + " [" + claim.source_ids.join(", ") + "]");
    }
  } else if (singleSource.length > 0) {
    lines.push("Éléments trouvés, encore à recouper :");
    for (const claim of singleSource) lines.push("- " + claim.statement + " [" + claim.source_ids[0] + "]");
  } else {
    lines.push("Les pages trouvées ne contiennent pas assez de texte vérifiable pour produire une synthèse factuelle.");
  }
  if (corroborated.length > 0 && singleSource.length > 0) {
    lines.push("", "À confirmer avec une deuxième source indépendante :");
    for (const claim of singleSource) lines.push("- " + claim.statement + " [" + claim.source_ids[0] + "]");
  }
  if (input.clusters.length > 0) {
    lines.push("", "Angles et mots-clés observés dans les sources :");
    for (const cluster of input.clusters.slice(0, 6)) {
      lines.push("- " + cluster.label + " — " + cluster.keywords.length + " expression(s), "
        + cluster.source_ids.length + " source(s)");
    }
  }
  lines.push(
    "",
    "Couverture : " + input.coverage.queries_with_results + "/" + input.coverage.queries_planned
      + " requêtes utiles, " + input.coverage.sources_crawled + " pages lues sur "
      + input.coverage.independent_domains + " domaines.",
    "",
    "Sources publiques :",
    ...input.sources.slice(0, 12).map((source) => "- [" + source.id + "] " + source.title + " — " + source.url),
    "",
    "Limites : aucun volume de recherche, aucune difficulté de mot-clé et aucune position Google ne sont inventés.",
  );
  return lines.join("\n");
}
