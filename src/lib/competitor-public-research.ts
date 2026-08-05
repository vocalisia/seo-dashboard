import type { ResearchSource, WebResearchReport } from "@/lib/web-research";

export interface PublicCompetitor {
  domain: string;
  description: string;
}

export interface PublicCompetitorGap {
  keyword: string;
  volume: null;
  competitor: string;
  competitor_position: null;
  difficulty: null;
  intent: "informational" | "commercial" | "transactional";
  source: "public_web";
  source_url: string;
  source_id: string;
  evidence_score: number;
  source_count: number;
  cluster: string;
  volume_source: null;
  position_source: null;
}

const GENERIC_PHRASES = new Set([
  "accueil",
  "contact",
  "connexion",
  "menu",
  "en savoir plus",
  "lire la suite",
  "actualités",
  "home",
  "login",
  "read more",
]);

function normalizeComparable(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCandidate(value: string): string | null {
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[<>\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\d\s:;,.#-]+|[\s:;,.#-]+$/g, "")
    .trim()
    .slice(0, 140);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const normalized = normalizeComparable(cleaned);
  if (
    cleaned.length < 5 ||
    words.length < 2 ||
    words.length > 12 ||
    GENERIC_PHRASES.has(normalized)
  ) {
    return null;
  }
  return cleaned;
}

function phrasesFromSource(source: ResearchSource): string[] {
  const raw = [
    ...source.title.split(/\s+[|—–]\s+/),
    ...source.headings,
  ];
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const value of raw) {
    const phrase = cleanCandidate(value);
    if (!phrase) continue;
    const key = normalizeComparable(phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
    if (phrases.length >= 8) break;
  }
  return phrases;
}

interface ObservedPhrase {
  keyword: string;
  intent: PublicCompetitorGap["intent"];
  evidenceScore: number;
  sourceCount: number;
  cluster: string;
}

function observedPhrases(report: WebResearchReport, source: ResearchSource): ObservedPhrase[] {
  const phrases = new Map<string, ObservedPhrase>();
  for (const keyword of phrasesFromSource(source)) {
    const key = normalizeComparable(keyword);
    phrases.set(key, {
      keyword,
      intent: inferIntent(keyword),
      evidenceScore: source.source_score ?? 40,
      sourceCount: 1,
      cluster: keyword,
    });
  }
  for (const cluster of report.keyword_clusters ?? []) {
    for (const keyword of cluster.keywords) {
      if (!keyword.source_ids.includes(source.id)) continue;
      const cleaned = cleanCandidate(keyword.keyword);
      if (!cleaned) continue;
      const key = normalizeComparable(cleaned);
      const intent = keyword.intent === "commercial" || keyword.intent === "transactional"
        ? keyword.intent
        : "informational";
      const existing = phrases.get(key);
      if (!existing || keyword.evidence_score > existing.evidenceScore) {
        phrases.set(key, {
          keyword: cleaned,
          intent,
          evidenceScore: keyword.evidence_score,
          sourceCount: keyword.source_count,
          cluster: cluster.label,
        });
      }
    }
  }
  return [...phrases.values()]
    .sort((a, b) => b.evidenceScore - a.evidenceScore)
    .slice(0, 14);
}

function inferIntent(keyword: string): PublicCompetitorGap["intent"] {
  const normalized = normalizeComparable(keyword);
  if (/\b(acheter|prix|devis|commander|abonnement|buy|price|order|subscribe)\b/.test(normalized)) {
    return "transactional";
  }
  if (/\b(meilleur|comparatif|alternative|avis|best|review|versus|vs)\b/.test(normalized)) {
    return "commercial";
  }
  return "informational";
}

function rootDomain(value: string): string {
  return value.toLowerCase().replace(/^www\./, "");
}

function isSameDomain(candidate: string, expected: string): boolean {
  return candidate === expected || candidate.endsWith(`.${expected}`);
}

export function buildPublicCompetitorResearch(
  report: WebResearchReport,
  options: {
    ownDomain: string;
    portfolioDomains?: Iterable<string>;
    ownKeywords?: Iterable<string>;
    maxCompetitors?: number;
    maxGaps?: number;
  },
): { competitors: PublicCompetitor[]; gaps: PublicCompetitorGap[] } {
  const ownDomain = rootDomain(options.ownDomain);
  const portfolio = new Set([...options.portfolioDomains ?? []].map(rootDomain));
  const ownKeywords = new Set([...options.ownKeywords ?? []].map(normalizeComparable));
  const competitors = new Map<string, PublicCompetitor>();
  const gaps: PublicCompetitorGap[] = [];
  const seenRows = new Set<string>();
  const maxCompetitors = Math.max(1, Math.min(12, options.maxCompetitors ?? 8));
  const maxGaps = Math.max(3, Math.min(60, options.maxGaps ?? 30));

  for (const source of report.sources) {
    const domain = rootDomain(source.domain);
    if (
      !domain ||
      isSameDomain(domain, ownDomain) ||
      [...portfolio].some((portfolioDomain) => isSameDomain(domain, portfolioDomain))
    ) {
      continue;
    }
    if (!competitors.has(domain)) {
      if (competitors.size >= maxCompetitors) continue;
      competitors.set(domain, {
        domain,
        description: source.description || source.title,
      });
    }
    for (const observed of observedPhrases(report, source)) {
      const normalized = normalizeComparable(observed.keyword);
      const key = `${domain}\u0000${normalized}`;
      if (!normalized || ownKeywords.has(normalized) || seenRows.has(key)) continue;
      seenRows.add(key);
      gaps.push({
        keyword: observed.keyword,
        volume: null,
        competitor: domain,
        competitor_position: null,
        difficulty: null,
        intent: observed.intent,
        source: "public_web",
        source_url: source.url,
        source_id: source.id,
        evidence_score: observed.evidenceScore,
        source_count: observed.sourceCount,
        cluster: observed.cluster,
        volume_source: null,
        position_source: null,
      });
      if (gaps.length >= maxGaps) break;
    }
    if (gaps.length >= maxGaps) break;
  }

  const domainsWithTerms = new Set(gaps.map((gap) => gap.competitor));
  return {
    competitors: [...competitors.values()].filter((competitor) => domainsWithTerms.has(competitor.domain)),
    gaps,
  };
}
