/**
 * Scanner enrichment helpers (v2, 2026-05-27)
 *
 * Pure functions: domain availability heuristic, time-to-rank, launch plan builder,
 * revenue range estimator, "why now" trend signals. Designed to run at request time
 * AND from seed scripts. No AI calls here — those happen in /api/scanner/deep-research.
 */

import { fetchGoogleSerpSnapshot } from "./opportunity-sources";

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
  competitors: Array<{
    rank: number;
    url: string;
    host: string;
    title: string;
    snippet_preview?: string;
    estimated_authority: "low" | "medium" | "high";
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
      title: `Guide complet: ${primary}`,
      target_keyword: primary,
      intent: "informational",
      word_count_target: 2400,
      priority: 1,
    },
    {
      title: `${primary} vs alternatives: comparatif ${new Date().getFullYear()}`,
      target_keyword: `${primary} comparatif`,
      intent: "commercial",
      word_count_target: 1800,
      priority: 2,
    },
    {
      title: questions[0]
        ? questions[0].replace(/\?$/, "").trim().slice(0, 90)
        : `Comment choisir ${secondary} pour ${opts.niche}`,
      target_keyword: secondary,
      intent: "informational",
      word_count_target: 1600,
      priority: 3,
    },
  ];

  // Optional 4th if we have rich tertiary
  if (tertiary && tertiary !== primary && tertiary !== secondary) {
    articles.push({
      title: `${tertiary}: erreurs à éviter en ${new Date().getFullYear()}`,
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

// ---------- Deep research: scrape Google SERP + extract top 3 pages ----------

interface FetchedPage {
  url: string;
  html: string;
  status: number;
}

async function fetchPageTextSafe(url: string, timeoutMs = 6000): Promise<FetchedPage | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("text/html") && !ctype.includes("application/xhtml")) return null;
    const html = await res.text();
    return { url, html, status: res.status };
  } catch {
    return null;
  }
}

function extractTextSummary(html: string): { title?: string; headings: string[]; wordCount: number } {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : undefined;

  const headings: string[] = [];
  for (const m of html.matchAll(/<h[12345][^>]*>([\s\S]*?)<\/h[12345]>/gi)) {
    const text = (m[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text && text.length >= 4 && text.length <= 160) headings.push(text);
    if (headings.length >= 20) break;
  }

  // Cheap word-count estimate from <p> blocks
  const paragraphs: string[] = [];
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = (m[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) paragraphs.push(text);
    if (paragraphs.length >= 80) break;
  }
  const wordCount = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;

  return { title, headings, wordCount };
}

/**
 * Run a deep research scan for a single keyword.
 * Strategy:
 *  1. Use existing fetchGoogleSerpSnapshot (free, no API key) → top URLs + PAA + related searches
 *  2. Fetch top 3 result pages directly → extract title + headings
 *  3. Derive content angles (most-frequent heading n-grams) and content gaps
 *
 * All operations are bounded by short timeouts. Never throws — returns degraded payload on failure.
 */
export async function runDeepResearch(keyword: string, niche: string): Promise<DeepResearchPayload> {
  const fetchedAt = new Date().toISOString();
  const snapshot = await fetchGoogleSerpSnapshot(keyword).catch(() => null);

  const topUrls = (snapshot?.resultUrls ?? []).slice(0, 10);
  const topTitles = snapshot?.resultTitles ?? [];

  const competitors = topUrls.map((url, i) => {
    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      host = url;
    }
    return {
      rank: i + 1,
      url,
      host,
      title: topTitles[i] ?? host,
      estimated_authority: estimateAuthority(host),
    };
  });

  // Fetch top 3 pages in parallel (short timeout each)
  const top3Urls = topUrls.slice(0, 3);
  const pages = await Promise.all(top3Urls.map((u) => fetchPageTextSafe(u, 6000)));
  const extracted: DeepResearchPayload["top_pages_extracted"] = [];
  for (const page of pages) {
    if (!page) continue;
    const { title, headings, wordCount } = extractTextSummary(page.html);
    extracted.push({
      url: page.url,
      title,
      headings: headings.slice(0, 12),
      word_count_estimate: wordCount,
    });
  }

  // Content angles = top headings normalized
  const headingCorpus = extracted.flatMap((p) => p.headings);
  const headingCounts = new Map<string, number>();
  for (const h of headingCorpus) {
    const norm = h.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    if (norm.length < 6 || norm.length > 90) continue;
    headingCounts.set(norm, (headingCounts.get(norm) ?? 0) + 1);
  }
  const contentAngles = [...headingCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([h]) => h);

  // Content gaps = PAA questions not covered by any heading
  const paa = (snapshot?.relatedQuestions ?? []).slice(0, 8);
  const lowerHeadings = headingCorpus.map((h) => h.toLowerCase());
  const contentGaps = paa.filter((q) => {
    const lq = q.toLowerCase();
    return !lowerHeadings.some((h) => h.includes(lq.slice(0, 20)) || lq.includes(h.slice(0, 20)));
  });

  const summary = `Top ${competitors.length} concurrents analysés pour "${keyword}". ${extracted.length} pages extraites (médiane ${Math.round(
    extracted.reduce((s, p) => s + p.word_count_estimate, 0) / Math.max(1, extracted.length)
  )} mots). ${contentGaps.length} gaps PAA détectés.`;

  return {
    niche,
    keyword,
    fetched_at: fetchedAt,
    competitors,
    content_angles: contentAngles,
    content_gaps: contentGaps,
    related_questions: paa,
    related_searches: snapshot?.relatedSearches ?? [],
    top_pages_extracted: extracted,
    summary,
  };
}
