export interface OpportunityKeywordRow {
  query: string;
  impressions_30d: number;
  impressions_prev_30d: number;
  clicks_30d: number;
  avg_position_30d: number;
  site_count: number;
}

export interface KeywordSignalScore {
  totalScore: number;
  growthScore: number;
  volumeScore: number;
  weaknessScore: number;
  specificityScore: number;
  businessScore: number;
}

export interface OpportunityCandidate {
  clusterKey: string;
  clusterLabel: string;
  keywords: string[];
  monthlyVolume: number;
  momentumPct: number;
  averagePosition: number;
  signalScore: number;
  opportunityType: "question" | "longtail" | "commercial" | "emerging";
  portfolioDistance: number;
  intent: "informational" | "commercial" | "mixed";
  sampleQueries: string[];
  rationale: string[];
  serpEvidence?: {
    relatedQuestions: string[];
    relatedSearches: string[];
    resultTitles: string[];
    resultUrls?: string[];
  };
  scoreBreakdown: {
    growth: number;
    volume: number;
    weakness: number;
    specificity: number;
    business: number;
    portfolioDistance: number;
  };
}

interface BuildOptions {
  minVolume: number;
  maxCandidates: number;
  existingPortfolioHints?: string[];
  portfolioPreference?: "close" | "balanced" | "distant";
  intentFocus?: "any" | "commercial";
}

const QUESTION_PREFIXES = [
  "comment",
  "pourquoi",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "when",
  "what",
  "why",
  "how",
  "who",
  "where",
];

const COMMERCIAL_HINTS = [
  "prix",
  "tarif",
  "cost",
  "pricing",
  "compare",
  "comparatif",
  "meilleur",
  "best",
  "logiciel",
  "software",
  "outil",
  "tool",
  "assurance",
  "mutuelle",
  "devis",
  "quote",
  "crm",
  "saas",
];

const STOPWORDS = new Set([
  "de", "du", "des", "la", "le", "les", "et", "ou", "pour", "avec", "sans", "sur", "dans",
  "how", "what", "why", "when", "where", "the", "and", "for", "with", "from", "best",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(query: string): string[] {
  return normalize(query)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

export function isQuestionKeyword(query: string): boolean {
  const normalized = normalize(query);
  return QUESTION_PREFIXES.some((prefix) => normalized.startsWith(`${prefix} `));
}

export function classifyIntent(query: string): "informational" | "commercial" {
  const normalized = normalize(query);
  if (isQuestionKeyword(normalized) && !/\b(prix|tarif|devis|quote|comparatif|compare)\b/.test(normalized)) {
    return "informational";
  }
  return COMMERCIAL_HINTS.some((hint) => normalized.includes(hint)) ? "commercial" : "informational";
}

function computeGrowthPct(row: OpportunityKeywordRow): number {
  if (row.impressions_prev_30d <= 0) {
    return row.impressions_30d > 0 ? 200 : 0;
  }
  return ((row.impressions_30d - row.impressions_prev_30d) / row.impressions_prev_30d) * 100;
}

function portfolioDistance(query: string, hints: string[]): number {
  if (!hints.length) return 1;
  const normalized = normalize(query);
  const closest = hints.reduce((best, hint) => {
    const overlap = tokenize(hint).filter((token) => normalized.includes(token)).length;
    return Math.max(best, overlap);
  }, 0);
  return closest === 0 ? 1 : clamp(1 - closest / 3, 0.2, 1);
}

export function scoreKeywordSignal(row: OpportunityKeywordRow): KeywordSignalScore {
  const growthPct = computeGrowthPct(row);
  const words = tokenize(row.query).length;

  const growthScore = clamp(growthPct / 120, 0, 1);
  const volumeScore = clamp(row.impressions_30d / 20000, 0, 1);
  const weaknessScore = clamp((row.avg_position_30d - 8) / 18, 0, 1);
  const specificityScore = clamp((words - 2) / 5, 0, 1);
  const businessScore = classifyIntent(row.query) === "commercial" ? 1 : isQuestionKeyword(row.query) ? 0.75 : 0.55;

  const totalScore =
    growthScore * 0.28 +
    volumeScore * 0.24 +
    weaknessScore * 0.18 +
    specificityScore * 0.12 +
    businessScore * 0.18;

  return {
    totalScore: Number(totalScore.toFixed(4)),
    growthScore,
    volumeScore,
    weaknessScore,
    specificityScore,
    businessScore,
  };
}

function buildClusterKey(query: string): string {
  const tokens = tokenize(query);
  return tokens.slice(0, 3).join(" ");
}

const LABEL_STOPWORDS = new Set([
  "the", "and", "but", "are", "was", "were", "been", "being",
  "for", "with", "from", "about", "into", "through",
  "you", "this", "that", "these", "those", "your",
  "les", "des", "mais", "est", "sont",
  "aux", "dans", "sur", "pour", "avec", "par", "que", "qui", "quoi", "pourquoi",
  "comment", "pas", "plus", "moins", "tout", "tous", "toute", "toutes", "cette", "ces",
  "what", "why", "how", "who", "where", "when", "does", "did", "can", "should",
]);

function topicalKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !LABEL_STOPWORDS.has(w) && !STOPWORDS.has(w))
    .slice(0, 4);
}

function buildClusterLabel(queries: string[]): string {
  if (queries.length === 0) return "untitled niche";

  const wordFreq = new Map<string, number>();
  for (const q of queries) {
    for (const w of topicalKeywords(q)) {
      wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
    }
  }
  const topWords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  if (topWords.length >= 2) {
    return topWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  const best = [...queries].sort((a, b) => a.length - b.length)[0] ?? "";
  if (best.length <= 60 && !/[?!]/.test(best)) return best;

  return topWords[0] ?? "untitled niche";
}

export function buildOpportunityCandidates(
  rows: OpportunityKeywordRow[],
  options: BuildOptions
): OpportunityCandidate[] {
  const hints = (options.existingPortfolioHints ?? []).map(normalize);
  const portfolioPreference = options.portfolioPreference ?? "balanced";
  const intentFocus = options.intentFocus ?? "any";
  const filtered = rows.filter((row) => normalize(row.query).length >= 8);

  const clusters = new Map<string, OpportunityKeywordRow[]>();
  for (const row of filtered) {
    const key = buildClusterKey(row.query);
    if (!key) continue;
    const bucket = clusters.get(key) ?? [];
    bucket.push(row);
    clusters.set(key, bucket);
  }

  const candidates: OpportunityCandidate[] = [];

  for (const [clusterKey, bucket] of clusters) {
    const monthlyVolume = bucket.reduce((sum, row) => sum + row.impressions_30d, 0);
    if (monthlyVolume < options.minVolume) continue;

    const weightedPrev = bucket.reduce((sum, row) => sum + row.impressions_prev_30d, 0);
    const averagePosition = bucket.reduce((sum, row) => sum + row.avg_position_30d, 0) / bucket.length;
    const momentumPct = weightedPrev > 0 ? ((monthlyVolume - weightedPrev) / weightedPrev) * 100 : 200;
    const sampleQueries = bucket
      .sort((a, b) => b.impressions_30d - a.impressions_30d)
      .slice(0, 5)
      .map((row) => row.query);

    const perRowScores = bucket.map((row) => scoreKeywordSignal(row));
    const rawSignal =
      perRowScores.reduce((sum, score) => sum + score.totalScore, 0) / perRowScores.length;
    const distance = portfolioDistance(sampleQueries[0] ?? clusterKey, hints);
    const intentKinds = new Set(bucket.map((row) => classifyIntent(row.query)));
    const intent =
      intentKinds.size > 1 ? "mixed" : (intentKinds.values().next().value as "informational" | "commercial");
    const opportunityType = sampleQueries.some(isQuestionKeyword)
      ? "question"
      : intent === "commercial"
        ? "commercial"
        : tokenize(sampleQueries[0] ?? "").length >= 4
          ? "longtail"
          : "emerging";

    if (intentFocus === "commercial" && intent === "informational") {
      continue;
    }

    const portfolioBoost =
      portfolioPreference === "close"
        ? 0.75 + (1 - distance) * 0.35
        : portfolioPreference === "distant"
          ? 0.75 + distance * 0.35
          : 0.75 + distance * 0.25;
    const signalScore = Number((rawSignal * portfolioBoost).toFixed(4));
    const rationale = [
      momentumPct >= 40 ? "fast-rising demand" : "stable demand with content gap",
      averagePosition >= 12 ? "SERP gap remains accessible" : "already somewhat competitive",
      distance >= 0.7 ? "far from existing portfolio" : "adjacent to current portfolio",
      intent === "commercial" ? "clear monetization intent" : "strong informational demand",
    ];

    candidates.push({
      clusterKey,
      clusterLabel: buildClusterLabel(sampleQueries),
      keywords: sampleQueries,
      monthlyVolume,
      momentumPct: Number(momentumPct.toFixed(1)),
      averagePosition: Number(averagePosition.toFixed(1)),
      signalScore,
      opportunityType,
      portfolioDistance: Number(distance.toFixed(2)),
      intent,
      sampleQueries,
      rationale,
      scoreBreakdown: {
        growth: Number(
          (perRowScores.reduce((sum, score) => sum + score.growthScore, 0) / perRowScores.length).toFixed(2)
        ),
        volume: Number(
          (perRowScores.reduce((sum, score) => sum + score.volumeScore, 0) / perRowScores.length).toFixed(2)
        ),
        weakness: Number(
          (perRowScores.reduce((sum, score) => sum + score.weaknessScore, 0) / perRowScores.length).toFixed(2)
        ),
        specificity: Number(
          (perRowScores.reduce((sum, score) => sum + score.specificityScore, 0) / perRowScores.length).toFixed(2)
        ),
        business: Number(
          (perRowScores.reduce((sum, score) => sum + score.businessScore, 0) / perRowScores.length).toFixed(2)
        ),
        portfolioDistance: Number(distance.toFixed(2)),
      },
    });
  }

  return candidates
    .sort((a, b) => {
      if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
      return b.monthlyVolume - a.monthlyVolume;
    })
    .slice(0, options.maxCandidates);
}
