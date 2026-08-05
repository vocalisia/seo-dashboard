/**
 * Scanner enrichment helpers (v2, 2026-05-27)
 *
 * Pure functions: domain availability heuristic, time-to-rank, launch plan builder,
 * revenue range estimator, "why now" trend signals. Designed to run at request time
 * AND from seed scripts. No AI calls here — those happen in /api/scanner/deep-research.
 */

import { normalizeSeoTitle } from "./autopilot-utils";
import { runWebResearch } from "./web-research";

// ---------- Types ----------

export interface LaunchPlanArticle {
  title: string;
  target_keyword: string;
  intent: "informational" | "commercial" | "transactional";
  word_count_target: number;
  priority: number; // 1 = launch day, 2 = week 1, 3 = week 2
}

export interface LaunchPlan {
  articles: LaunchPlanArticle[];
  pillar_topic: string;
  launch_horizon_days: number;
}

export interface DomainCheckResult {
  domain: string;
  available: "likely" | "likely_taken" | "unknown";
  reason: string;
}

export interface WhyNowSignal {
  signal: string;
  source: "google_trends" | "reddit" | "product_hunt" | "amazon" | "hn" | "indie_hackers" | "serp";
  detail: string;
}

export interface RevenueRange {
  m6_low: number;
  m6_high: number;
  m12_low: number;
  m12_high: number;
  currency: "EUR";
  assumption: string;
}

export interface DeepResearchPayload {
  niche: string;
  keyword: string;
  fetched_at: string;
  data_status: "complete" | "partial" | "unavailable";
  ranking_scope: "multi_source_fused_discovery";
  search_providers: string[];
  evidence_count: number;
  competitors: Array<{
    rank: number;
    url: string;
    host: string;
    title: string;
    snippet_preview?: string;
    estimated_authority: "low" | "medium" | "high";
    source_score: number;
    source_providers: string[];
  }>;
  content_angles: string[];
  content_gaps: string[];
  related_questions: string[];
  related_searches: string[];
  top_pages_extracted: Array<{
    url: string;
    title?: string;
    headings: string[];
    word_count_estimate: number;
  }>;
  summary: string;
}

// ---------- Domain availability heuristic ----------

const PORTFOLIO_DOMAINS_TAKEN_HOSTS = new Set([
  "vocalis.pro", "vocalis.blog", "vocalis-ai.org",
  "tesla-mag.ch", "master-seller.fr", "iapmesuisse.ch",
  "seo-true.com", "trustly-ai.com", "trust-vault.com", "ai-due.com",
  "cbdeuropa.com", "agents-ia.pro", "agentic-whatsup.com",
  "lead-gene.com", "factureimpayee.fr",
]);

/**
 * Lightweight domain-availability stub. We can't actually query a registrar
 * from a Vercel function without paid creds, so we use heuristics:
 * - short common .com names (≤ 6 chars) → likely_taken
 * - portfolio domains → likely_taken
 * - long/specific 3+ word .com → likely available
 *
 * This is a UI hint, not a guarantee. Real lookup happens via Namecheap link.
 */
export function checkDomainAvailability(domain: string): DomainCheckResult {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed || !trimmed.includes(".")) {
    return { domain: trimmed, available: "unknown", reason: "Invalid domain" };
  }

  if (PORTFOLIO_DOMAINS_TAKEN_HOSTS.has(trimmed)) {
    return { domain: trimmed, available: "likely_taken", reason: "Already in your portfolio" };
  }

  const labels = trimmed.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const root = labels.slice(0, -1).join(".");

  const rootLength = root.replace(/[^a-z0-9]/g, "").length;
  const wordCount = root.split(/[-_]/).filter(Boolean).length;

  // Premium TLDs with very short names → almost always taken
  if (["com", "io", "co"].includes(tld) && rootLength <= 6) {
    return { domain: trimmed, available: "likely_taken", reason: `Short ${tld} domain (≤6 chars) — usually premium/taken` };
  }

  if (["com", "io", "co"].includes(tld) && rootLength <= 9 && wordCount === 1) {
    return { domain: trimmed, available: "unknown", reason: "Short single-word domain — verify on Namecheap" };
  }

  // 3+ word .com → likely available
  if (wordCount >= 3 && ["com", "net", "org", "fr", "ch", "be"].includes(tld)) {
    return { domain: trimmed, available: "likely", reason: `${wordCount}-word combo on .${tld} — usually available` };
  }

  return { domain: trimmed, available: "unknown", reason: "Verify on Namecheap" };
}

// ---------- Time to rank estimator ----------

/**
 * Estimate months to reach page 1 for the cluster.
 * Inputs are intentionally cheap and bounded — no AI call.
 *
 * - competition (low/medium/high): primary driver
 * - average_position: how close the portfolio already is
 * - monthly_volume: bigger volume = more competitive
 */
export function estimateTimeToRankMonths(opts: {
  competition: string;
  average_position?: number;
  monthly_volume: number;
}): number {
  const compBase: Record<string, number> = { low: 3, medium: 6, high: 12 };
  let months = compBase[opts.competition] ?? 6;

  const pos = opts.average_position ?? 0;
  if (pos > 0 && pos <= 20) months = Math.max(2, months - 2);
  else if (pos > 0 && pos <= 40) months = Math.max(3, months - 1);

  if (opts.monthly_volume > 50000) months += 2;
  else if (opts.monthly_volume > 20000) months += 1;

  return Math.max(2, Math.min(18, Math.round(months)));
}

// ---------- Revenue range ----------

export function estimateRevenueRange(opts: {
  monthly_volume: number;
  monetization: string;
  competition: string;
}): RevenueRange {
  const ctrBase: Record<string, number> = { low: 0.18, medium: 0.10, high: 0.05 };
  const ctr = ctrBase[opts.competition] ?? 0.08;
  const expectedTraffic = opts.monthly_volume * ctr;

  // RPM ranges per monetization model (EUR per 1000 visitors, conservative)
  const rpmTable: Record<string, [number, number]> = {
    "ads": [3, 14],
    "affiliate": [10, 50],
    "lead-gen": [40, 200],
    "e-commerce": [20, 90],
    "subscription": [25, 120],
  };
  const [rpmLow, rpmHigh] = rpmTable[opts.monetization] ?? [5, 20];

  const m6Low = Math.round((expectedTraffic * 0.4 * rpmLow) / 1000);
  const m6High = Math.round((expectedTraffic * 0.7 * rpmHigh) / 1000);
  const m12Low = Math.round((expectedTraffic * 0.9 * rpmLow) / 1000);
  const m12High = Math.round((expectedTraffic * 1.5 * rpmHigh) / 1000);

  return {
    m6_low: m6Low,
    m6_high: m6High,
    m12_low: m12Low,
    m12_high: m12High,
    currency: "EUR",
    assumption: `CTR ${(ctr * 100).toFixed(0)}% × RPM €${rpmLow}-${rpmHigh} (${opts.monetization})`,
  };
}

// ---------- Launch plan ----------

/**
 * Build a 3-article launch plan from existing opportunity signals.
 * Uses sample_queries / serp_evidence.relatedQuestions / core_keywords.
 */
export function buildLaunchPlan(opts: {
  niche: string;
  core_keywords: string[];
  sample_queries?: string[];
  related_questions?: string[];
}): LaunchPlan {
  const kw = (opts.core_keywords ?? []).filter((k) => typeof k === "string" && k.trim().length > 0);
  const questions = (opts.related_questions ?? []).filter((q) => typeof q === "string" && q.length > 6);
  const samples = (opts.sample_queries ?? []).filter((q) => typeof q === "string" && q.length > 4);

  const primary = kw[0] ?? opts.niche;
  const secondary = kw[1] ?? primary;
  const tertiary = kw[2] ?? questions[0] ?? samples[0] ?? primary;

  const articles: LaunchPlanArticle[] = [
    {
      title: normalizeSeoTitle(primary, primary),
      target_keyword: primary,
      intent: "informational",
      word_count_target: 2400,
      priority: 1,
    },
    {
      title: normalizeSeoTitle(`${primary}: comparatif ${new Date().getFullYear()}`, primary),
      target_keyword: `${primary} comparatif`,
      intent: "commercial",
      word_count_target: 1800,
      priority: 2,
    },
    {
      title: normalizeSeoTitle(
        questions[0]
          ? questions[0].replace(/\?$/, "").trim().slice(0, 90)
          : `Comment choisir ${secondary} pour ${opts.niche}`,
        secondary
      ),
      target_keyword: secondary,
      intent: "informational",
      word_count_target: 1600,
      priority: 3,
    },
  ];

  // Optional 4th if we have rich tertiary
  if (tertiary && tertiary !== primary && tertiary !== secondary) {
    articles.push({
      title: normalizeSeoTitle(`${tertiary}: erreurs à éviter en ${new Date().getFullYear()}`, tertiary),
      target_keyword: tertiary,
      intent: "informational",
      word_count_target: 1400,
      priority: 3,
    });
  }

  return {
    pillar_topic: opts.niche,
    articles,
    launch_horizon_days: 14,
  };
}

// ---------- Why now signals (heuristic from existing serp evidence) ----------

export function deriveWhyNow(opts: {
  signal_source?: string;
  momentum_pct?: number;
  opportunity_type?: string;
  sample_queries?: string[];
  serp_evidence?: { relatedQuestions?: string[]; relatedSearches?: string[] };
}): WhyNowSignal[] {
  const signals: WhyNowSignal[] = [];

  if (typeof opts.momentum_pct === "number" && opts.momentum_pct >= 25) {
    signals.push({
      signal: `Momentum +${opts.momentum_pct.toFixed(0)}%`,
      source: "google_trends",
      detail: "Impressions GSC 30d vs 30d précédents",
    });
  }

  const src = opts.signal_source ?? "";
  if (src.includes("reddit")) {
    signals.push({ signal: "Discussion Reddit active", source: "reddit", detail: src });
  }
  if (src.includes("product_hunt") || src.includes("ph")) {
    signals.push({ signal: "Product Hunt activity", source: "product_hunt", detail: src });
  }
  if (src.includes("amazon")) {
    signals.push({ signal: "Amazon Best Sellers Rising", source: "amazon", detail: src });
  }
  if (src.includes("hn")) {
    signals.push({ signal: "Hacker News front page", source: "hn", detail: src });
  }
  if (src.includes("indie") || src.includes("ih")) {
    signals.push({ signal: "Indie Hackers verified revenue", source: "indie_hackers", detail: src });
  }

  const paaCount = opts.serp_evidence?.relatedQuestions?.length ?? 0;
  if (paaCount >= 4) {
    signals.push({
      signal: `${paaCount} questions PAA détectées`,
      source: "serp",
      detail: "Forte demande informationnelle",
    });
  }

  if (opts.opportunity_type === "emerging") {
    signals.push({
      signal: "Niche émergente",
      source: "serp",
      detail: "Faible saturation SERP",
    });
  }

  return signals.slice(0, 6);
}

// ---------- Authority heuristic for top SERP hosts ----------

const HIGH_AUTHORITY_PATTERNS = [
  /wikipedia\.org$/, /^\w*amazon\./, /youtube\.com$/, /linkedin\.com$/,
  /forbes\.com$/, /nytimes\.com$/, /lemonde\.fr$/, /lefigaro\.fr$/,
  /reddit\.com$/, /quora\.com$/, /github\.com$/, /medium\.com$/,
  /shopify\.com$/, /hubspot\.com$/, /salesforce\.com$/,
];
const LOW_AUTHORITY_PATTERNS = [
  /\.blogspot\./, /\.wordpress\.com$/, /\.wixsite\./, /\.weebly\./,
];

export function estimateAuthority(host: string): "low" | "medium" | "high" {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (HIGH_AUTHORITY_PATTERNS.some((p) => p.test(h))) return "high";
  if (LOW_AUTHORITY_PATTERNS.some((p) => p.test(h))) return "low";
  // .com / .net / .org with TLD-only 2-word root → medium
  const parts = h.split(".");
  if (parts.length === 2 && parts[0].length >= 4) return "medium";
  return "medium";
}

// ---------- Deep research: bounded multi-source discovery + safe extraction ----------

export async function runDeepResearch(keyword: string, niche: string): Promise<DeepResearchPayload> {
  const fetchedAt = new Date().toISOString();
  const report = await runWebResearch(keyword, {
    locale: "fr-FR",
    maxSources: 12,
    maxQueries: 8,
    depth: "deep",
    focus: "content",
  });
  const competitors = report.sources.slice(0, 10).map((source, index) => ({
    rank: index + 1,
    url: source.url,
    host: source.domain,
    title: source.title,
    snippet_preview: source.description,
    estimated_authority: estimateAuthority(source.domain),
    source_score: source.source_score ?? 0,
    source_providers: source.providers,
  }));
  const extracted: DeepResearchPayload["top_pages_extracted"] = report.sources
    .filter((source) => source.fetch_status === "ok")
    .slice(0, 8)
    .map((source) => ({
      url: source.url,
      title: source.title,
      headings: source.headings.slice(0, 12),
      word_count_estimate: source.word_count,
    }));
  const contentAngles = (report.keyword_clusters ?? [])
    .flatMap((cluster) => cluster.keywords.map((item) => item.keyword))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8);
  const relatedQuestions = (report.keyword_clusters ?? [])
    .flatMap((cluster) => cluster.keywords)
    .filter((item) =>
      item.intent === "informational"
      && /^(comment|pourquoi|quel|quelle|quels|quelles|combien|how|why|what|which)\b/i.test(item.keyword)
    )
    .map((item) => item.keyword)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8);
  const contentGaps = (report.claims ?? [])
    .filter((claim) => claim.confidence === "corroborated")
    .map((claim) => claim.statement)
    .slice(0, 8);
  const relatedSearches = (report.query_plan ?? [])
    .map((step) => step.query)
    .filter((query, index, values) => query !== keyword && values.indexOf(query) === index)
    .slice(0, 10);
  const activeProviders = Object.entries(report.search_providers)
    .filter(([, status]) => status === "ok")
    .map(([provider]) => provider);
  const summary = report.data_status === "unavailable"
    ? `Recherche publique indisponible pour "${keyword}". Aucune métrique n'a été inventée.`
    : `${competitors.length} sources concurrentes observées pour "${keyword}" via ${activeProviders.join(", ")}. ${extracted.length} pages extraites et ${(report.claims ?? []).length} affirmations reliées à leurs preuves.`;

  return {
    niche,
    keyword,
    fetched_at: fetchedAt,
    data_status: report.data_status,
    ranking_scope: "multi_source_fused_discovery",
    search_providers: activeProviders,
    evidence_count: report.evidence.length,
    competitors,
    content_angles: contentAngles,
    content_gaps: contentGaps,
    related_questions: relatedQuestions,
    related_searches: relatedSearches,
    top_pages_extracted: extracted,
    summary,
  };
}
