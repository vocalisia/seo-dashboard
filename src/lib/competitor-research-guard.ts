export interface CompetitorGapCandidate {
  keyword: string;
  volume: number | null;
  competitor: string;
  competitor_position: number | null;
  difficulty: string | null;
  intent: string;
  source_url?: string | null;
  source_id?: string | null;
  evidence_score?: number | null;
  source_count?: number | null;
  cluster?: string | null;
}

export interface CompetitorDescription {
  domain: string;
  description: string;
}

export interface CompetitorResearchRow {
  domain: string;
  description: string | null;
  keyword: string;
  volume: number | null;
  position: number | null;
  difficulty: string | null;
  intent: string;
  sourceUrl: string | null;
  sourceId: string | null;
  evidenceScore: number | null;
  sourceCount: number | null;
  cluster: string | null;
}

const MIN_ROWS = 3;
const MIN_DOMAINS = 2;
const MIN_KEYWORDS = 3;

function normalizeDomain(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^https?:/i.test(candidate)) return "";

  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return hostname.includes(".") && !hostname.endsWith(".example") ? hostname : "";
  } catch {
    return "";
  }
}

export function prepareCompetitorResearchRows(
  gaps: CompetitorGapCandidate[],
  competitors: CompetitorDescription[],
): CompetitorResearchRow[] {
  const descriptions = new Map(
    competitors
      .map((competitor) => [normalizeDomain(competitor.domain), competitor.description?.trim() || null] as const)
      .filter(([domain]) => Boolean(domain)),
  );
  const seen = new Set<string>();
  const rows: CompetitorResearchRow[] = [];

  for (const gap of gaps) {
    const domain = normalizeDomain(gap.competitor || "");
    const keyword = (gap.keyword || "").trim();
    const key = `${domain}\u0000${keyword.toLowerCase()}`;
    if (!domain || !keyword || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      domain,
      description: descriptions.get(domain) ?? null,
      keyword,
      volume: gap.volume != null && Number(gap.volume) > 0 ? Number(gap.volume) : null,
      position: gap.competitor_position != null && Number(gap.competitor_position) > 0
        ? Number(gap.competitor_position)
        : null,
      difficulty: gap.difficulty && gap.difficulty !== "unknown" ? gap.difficulty : null,
      intent: gap.intent || "informational",
      sourceUrl: gap.source_url ?? null,
      sourceId: gap.source_id ?? null,
      evidenceScore: gap.evidence_score != null ? Math.max(0, Math.min(100, Number(gap.evidence_score))) : null,
      sourceCount: gap.source_count != null ? Math.max(1, Math.floor(Number(gap.source_count))) : null,
      cluster: gap.cluster ?? null,
    });
  }

  return rows;
}

export function hasSufficientCompetitorResearch(rows: CompetitorResearchRow[]): boolean {
  const domains = new Set(rows.map((row) => row.domain));
  const keywords = new Set(rows.map((row) => row.keyword.toLowerCase()));
  return rows.length >= MIN_ROWS && domains.size >= MIN_DOMAINS && keywords.size >= MIN_KEYWORDS;
}
