import type { ResearchSource, WebResearchReport } from "@/lib/web-research";

export interface PublicCompetitor {
  domain: string;
  description: string;
}

export interface PublicCompetitorGap {
  keyword: string;
  volume: 0;
  competitor: string;
  competitor_position: 0;
  difficulty: "unknown";
  intent: "informational" | "commercial" | "transactional";
  source: "public_web";
  source_url: string;
  source_id: string;
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
    for (const keyword of phrasesFromSource(source)) {
      const normalized = normalizeComparable(keyword);
      const key = `${domain}\u0000${normalized}`;
      if (!normalized || ownKeywords.has(normalized) || seenRows.has(key)) continue;
      seenRows.add(key);
      gaps.push({
        keyword,
        volume: 0,
        competitor: domain,
        competitor_position: 0,
        difficulty: "unknown",
        intent: inferIntent(keyword),
        source: "public_web",
        source_url: source.url,
        source_id: source.id,
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
