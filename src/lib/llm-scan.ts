/**
 * Per-competitor "LLM readiness" scanner.
 *
 * Pure HTTP fetch (no AI). For each domain, fetches:
 *   - /llms.txt        (LLM-instructions file)
 *   - /robots.txt      (AI-bot allow/disallow rules)
 *   - /                (HTML head: JSON-LD schemas, OG, link rel)
 *
 * Returns a 0-100 readiness score + structured findings ready for DB insert
 * (competitor_llm_scan table).
 */

import { logError, logger } from "@/lib/logger";

export interface LLMScanFindings {
  llms_txt_present: boolean;
  llms_txt_valid: boolean; // true only if real text/markdown content, not HTML 404
  llms_txt_content: string | null;
  ai_bots_allowed: string[];
  ai_bots_allowed_explicitly: string[]; // bots with own User-agent block
  ai_bots_disallowed: string[];
  schemas_detected: string[];
  has_open_graph: boolean;
  has_llms_link_rel: boolean;
  application_name: string | null;
  llm_readiness_score: number;
  recommendations: string[];
  fetch_errors: { resource: string; error: string }[];
}

const AI_BOT_NAMES = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Bytespider",
  "OAI-SearchBot",
  "Google-Extended",
  "CCBot",
  "FacebookBot",
  "Applebot-Extended",
  "Amazonbot",
  "Meta-ExternalAgent",
];

const SCHEMA_TYPES_OF_INTEREST = [
  "FAQPage",
  "HowTo",
  "Article",
  "NewsArticle",
  "BlogPosting",
  "TechArticle",
  "Organization",
  "WebSite",
  "Product",
  "Service",
  "BreadcrumbList",
  "VideoObject",
  "Person",
  // Advanced LLM-friendly schemas (bonus tier)
  "DefinedTermSet",
  "DefinedTerm",
  "Dataset",
  "Course",
  "LearningResource",
  "ClaimReview",
  "QAPage",
  "Recipe",
];

const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONTENT_BYTES = 1_000_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; SEODashboardLLMScanner/1.0; +https://github.com)";

/**
 * Normalize a competitor domain to "scheme://host" form (no trailing slash).
 * Accepts "example.com", "https://example.com", "https://example.com/foo".
 */
export function normalizeDomain(input: string): string {
  let raw = input.trim().toLowerCase();
  raw = raw.replace(/^https?:\/\//, "");
  raw = raw.replace(/^www\./, "");
  raw = raw.split("/")[0];
  raw = raw.split("?")[0];
  return `https://${raw}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/plain,text/html;q=0.9,*/*;q=0.8",
        ...(init.headers || {}),
      },
      redirect: "follow",
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        chunks.push(value);
        if (received >= MAX_CONTENT_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(merged);
  } catch (err) {
    logger.debug({ ctx: "llm-scan.fetchText", url, err: String(err) });
    return null;
  }
}

/**
 * Parse robots.txt to find which AI bots are explicitly allowed/disallowed.
 *
 * Returns 3 buckets:
 *  - ai_bots_allowed_explicitly: bots with their OWN User-agent block (allowed via Allow:/ or empty Disallow:)
 *  - ai_bots_allowed: ANY bot not blocked (includes wildcard permissive defaults — false positive risk)
 *  - ai_bots_disallowed: explicitly disallowed for "/"
 *
 * Scoring should prefer ai_bots_allowed_explicitly to avoid rewarding sites that
 * simply have no robots.txt or a generic User-agent: * with no AI mention.
 */
export function parseRobotsTxt(content: string): {
  ai_bots_allowed: string[];
  ai_bots_allowed_explicitly: string[];
  ai_bots_disallowed: string[];
} {
  const blocks: { agents: string[]; rules: { type: string; value: string }[] }[] = [];
  let current: { agents: string[]; rules: { type: string; value: string }[] } | null = null;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const directive = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (directive === "user-agent") {
      if (current && current.rules.length === 0 && blocks.length > 0) {
        // multiple consecutive UA → merge agents into current block
        current.agents.push(value);
      } else {
        current = { agents: [value], rules: [] };
        blocks.push(current);
      }
    } else if (current && (directive === "allow" || directive === "disallow")) {
      current.rules.push({ type: directive, value });
    }
  }

  function isDisallowedAll(rules: { type: string; value: string }[]): boolean {
    return rules.some((r) => r.type === "disallow" && r.value === "/");
  }

  const wildcardBlock = blocks.find((b) =>
    b.agents.some((a) => a.trim() === "*"),
  );
  const wildcardDisallowAll = wildcardBlock
    ? isDisallowedAll(wildcardBlock.rules)
    : false;

  const allowed: string[] = [];
  const allowedExplicitly: string[] = [];
  const disallowed: string[] = [];

  for (const botName of AI_BOT_NAMES) {
    const botBlock = blocks.find((b) =>
      b.agents.some((a) => a.toLowerCase() === botName.toLowerCase()),
    );
    if (botBlock) {
      if (isDisallowedAll(botBlock.rules)) {
        disallowed.push(botName);
      } else {
        allowed.push(botName);
        allowedExplicitly.push(botName);
      }
    } else {
      // No explicit rule — falls under "*" wildcard (PASSIVE allow if wildcard not blocked)
      if (wildcardDisallowAll) disallowed.push(botName);
      else allowed.push(botName); // NOT in allowedExplicitly (passive)
    }
  }

  return {
    ai_bots_allowed: allowed,
    ai_bots_allowed_explicitly: allowedExplicitly,
    ai_bots_disallowed: disallowed,
  };
}

/**
 * Extract JSON-LD blocks from an HTML page and return the set of @type values found.
 * Handles arrays, @graph, nested types. Best-effort, tolerant to malformed JSON.
 */
export function extractSchemaTypes(html: string): string[] {
  const types = new Set<string>();
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      collectTypes(parsed, types);
    } catch {
      // Try to extract @type values via regex on malformed JSON
      const typeMatches = raw.match(/"@type"\s*:\s*"([^"]+)"/g);
      if (typeMatches) {
        for (const m of typeMatches) {
          const t = m.match(/"@type"\s*:\s*"([^"]+)"/);
          if (t?.[1]) types.add(t[1]);
        }
      }
    }
  }
  return Array.from(types);
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) {
    for (const it of t) if (typeof it === "string") out.add(it);
  }
  for (const key of Object.keys(obj)) {
    if (key === "@type" || key === "@context") continue;
    collectTypes(obj[key], out);
  }
}

function hasOpenGraph(html: string): boolean {
  return /<meta[^>]+property=["']og:(title|description|image|url|type)["']/i.test(html);
}

function hasLlmsLinkRel(html: string): boolean {
  return /<link[^>]+rel=["']llms[-_.]?txt["']/i.test(html);
}

function extractApplicationName(html: string): string | null {
  const m = html.match(
    /<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i,
  );
  return m?.[1] ?? null;
}

/**
 * Heuristically detect whether the /llms.txt response is a REAL llms.txt or a
 * WordPress-style HTML 404 served with HTTP 200 (false positive).
 *
 * Real llms.txt: plain text/markdown. Starts with "#" (markdown header), or "---"
 * front-matter, or "User-agent:"/"Allow:" rules, or has many ">" lines (markdown bullets).
 * False positive: starts with "<!DOCTYPE", "<html", or contains "<head>" etc.
 */
export function isValidLlmsTxt(content: string | null): boolean {
  if (!content) return false;
  const t = content.trim();
  if (t.length < 20) return false;
  const lower = t.slice(0, 200).toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<html") || lower.includes("<head>")) return false;
  // Must look like markdown/text: has at least one structural marker
  const startsWithHeader = /^#\s+\w/m.test(t);
  const hasMarkdownLinks = /\[.+\]\(https?:\/\/.+\)/.test(t);
  const hasUserAgent = /^user-agent\s*:/im.test(t);
  const hasAllowOrSitemap = /^(allow|disallow|sitemap)\s*:/im.test(t);
  const hasFrontmatter = t.startsWith("---");
  return startsWithHeader || hasMarkdownLinks || hasUserAgent || hasAllowOrSitemap || hasFrontmatter;
}

/**
 * Compute the LLM-readiness score (0-110, capped at 100) with stricter logic
 * that avoids the 2 false positives in the v1 scorer:
 *   1. llms.txt: only counts if content is plain text/markdown (not HTML 404)
 *   2. AI bots: prefers EXPLICIT mention in robots.txt over permissive default
 *
 * Base weights:
 *   - llms.txt VALID                     +30  (was: any HTTP 200, now: real content)
 *   - AI bots explicitly allowed (>=1)   +20  (named GPTBot/ClaudeBot blocks)
 *   - AI bots passively allowed (no explicit block) +5 (partial credit only)
 *   - FAQPage schema                     +15
 *   - HowTo schema                       +10
 *   - Article + Person/author            +10
 *   - Organization schema                +10
 *   - Open Graph complete                +5
 *
 * Bonus (LLM-authority schemas, common in top-cited sites):
 *   - DefinedTermSet/DefinedTerm         +5  (glossaries: LLMs cite definitions)
 *   - Dataset                            +5  (LLMs cite data sources)
 *   - Course / LearningResource          +3  (education signal)
 *   - ClaimReview                        +2  (fact-check signal)
 */
export function scoreReadiness(
  llmsTxtValid: boolean,
  aiBotsAllowedExplicitly: string[],
  aiBotsAllowedPassively: string[],
  schemasDetected: string[],
  hasOG: boolean,
): { score: number; recommendations: string[] } {
  let score = 0;
  const recs: string[] = [];

  if (llmsTxtValid) {
    score += 30;
  } else {
    recs.push("Créer un VRAI /llms.txt à la racine (texte markdown, pas HTML 404) (+30 pts)");
  }

  if (aiBotsAllowedExplicitly.length > 0) {
    score += 20;
  } else if (aiBotsAllowedPassively.length > 0) {
    score += 5;
    recs.push(
      "Mentionner explicitement les bots IA (User-agent: GPTBot / ClaudeBot / PerplexityBot) dans robots.txt avec Allow: / (+15 pts)",
    );
  } else {
    recs.push(
      "Autoriser au moins un AI bot (GPTBot, ClaudeBot, PerplexityBot…) dans robots.txt (+20 pts)",
    );
  }

  const hasSchema = (name: string) =>
    schemasDetected.some((s) => s.toLowerCase() === name.toLowerCase());

  if (hasSchema("FAQPage") || hasSchema("QAPage")) {
    score += 15;
  } else {
    recs.push("Ajouter un schema JSON-LD FAQPage sur pages clés (+15 pts)");
  }

  if (hasSchema("HowTo") || hasSchema("Recipe")) {
    score += 10;
  } else {
    recs.push("Ajouter un schema HowTo sur tutoriels/guides (+10 pts)");
  }

  const hasArticle =
    hasSchema("Article") || hasSchema("NewsArticle") || hasSchema("BlogPosting") || hasSchema("TechArticle");
  const hasAuthor = hasSchema("Person");
  if (hasArticle && hasAuthor) {
    score += 10;
  } else if (hasArticle) {
    recs.push("Ajouter un author Person au schema Article (+10 pts)");
  } else {
    recs.push("Ajouter un schema Article (ou BlogPosting) avec author Person (+10 pts)");
  }

  if (hasSchema("Organization")) {
    score += 10;
  } else {
    recs.push("Ajouter un schema Organization global (+10 pts)");
  }

  if (hasOG) {
    score += 5;
  } else {
    recs.push("Compléter les balises Open Graph (og:title, og:image, og:type) (+5 pts)");
  }

  // Bonus tier (LLM-citation magnets)
  if (hasSchema("DefinedTermSet") || hasSchema("DefinedTerm")) {
    score += 5;
  } else {
    recs.push("BONUS: ajouter un schema DefinedTermSet (glossaire) — les LLM citent les définitions (+5 pts)");
  }
  if (hasSchema("Dataset")) {
    score += 5;
  } else {
    recs.push("BONUS: ajouter un schema Dataset si tu publies des données chiffrées (+5 pts)");
  }
  if (hasSchema("Course") || hasSchema("LearningResource")) {
    score += 3;
  }
  if (hasSchema("ClaimReview")) {
    score += 2;
  }

  return { score: Math.min(100, score), recommendations: recs };
}

/**
 * Scan a single competitor domain.
 * Always resolves — never throws — so a single failure doesn't break a batch scan.
 */
export async function scanCompetitor(domain: string): Promise<LLMScanFindings> {
  const base = normalizeDomain(domain);
  const errors: { resource: string; error: string }[] = [];

  // 1) /llms.txt
  let llmsTxtContent: string | null = null;
  try {
    llmsTxtContent = await fetchText(`${base}/llms.txt`);
  } catch (err) {
    errors.push({ resource: "/llms.txt", error: String(err) });
  }
  const llmsTxtPresent = !!llmsTxtContent && llmsTxtContent.length > 10;
  const llmsTxtValid = isValidLlmsTxt(llmsTxtContent);

  // 2) /robots.txt
  let robotsContent: string | null = null;
  try {
    robotsContent = await fetchText(`${base}/robots.txt`);
  } catch (err) {
    errors.push({ resource: "/robots.txt", error: String(err) });
  }
  const { ai_bots_allowed, ai_bots_allowed_explicitly, ai_bots_disallowed } = robotsContent
    ? parseRobotsTxt(robotsContent)
    : { ai_bots_allowed: AI_BOT_NAMES, ai_bots_allowed_explicitly: [], ai_bots_disallowed: [] };

  // 3) HTML head
  let html: string | null = null;
  try {
    html = await fetchText(base);
  } catch (err) {
    errors.push({ resource: "/", error: String(err) });
  }
  const allTypes = html ? extractSchemaTypes(html) : [];
  const schemasDetected = allTypes.filter((t) =>
    SCHEMA_TYPES_OF_INTEREST.some((s) => s.toLowerCase() === t.toLowerCase()),
  );
  const ogPresent = html ? hasOpenGraph(html) : false;
  const linkRel = html ? hasLlmsLinkRel(html) : false;
  const appName = html ? extractApplicationName(html) : null;

  // 4) Score (uses STRICT signals: valid llms.txt content + explicitly-named AI bots)
  const passiveAllowed = ai_bots_allowed.filter((b) => !ai_bots_allowed_explicitly.includes(b));
  const { score, recommendations } = scoreReadiness(
    llmsTxtValid,
    ai_bots_allowed_explicitly,
    passiveAllowed,
    schemasDetected,
    ogPresent,
  );

  return {
    llms_txt_present: llmsTxtPresent,
    llms_txt_valid: llmsTxtValid,
    llms_txt_content: llmsTxtContent ? llmsTxtContent.slice(0, 8000) : null,
    ai_bots_allowed,
    ai_bots_allowed_explicitly,
    ai_bots_disallowed,
    schemas_detected: schemasDetected,
    has_open_graph: ogPresent,
    has_llms_link_rel: linkRel,
    application_name: appName,
    llm_readiness_score: score,
    recommendations,
    fetch_errors: errors,
  };
}

/**
 * Scan a batch of competitor domains in parallel with bounded concurrency.
 * Returns one findings object per domain (in input order).
 */
export async function scanCompetitors(
  domains: string[],
  concurrency = 4,
): Promise<{ domain: string; findings: LLMScanFindings }[]> {
  const results: { domain: string; findings: LLMScanFindings }[] = [];
  const queue = [...domains];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const d = queue.shift();
      if (!d) return;
      try {
        const findings = await scanCompetitor(d);
        results.push({ domain: d, findings });
      } catch (err) {
        logError("llm-scan.scanCompetitor", err, { domain: d });
        results.push({
          domain: d,
          findings: {
            llms_txt_present: false,
            llms_txt_valid: false,
            llms_txt_content: null,
            ai_bots_allowed: [],
            ai_bots_allowed_explicitly: [],
            ai_bots_disallowed: [],
            schemas_detected: [],
            has_open_graph: false,
            has_llms_link_rel: false,
            application_name: null,
            llm_readiness_score: 0,
            recommendations: ["Scan failed — réessayer plus tard"],
            fetch_errors: [{ resource: "all", error: String(err) }],
          },
        });
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  // Re-sort by input order
  const order = new Map(domains.map((d, i) => [d, i]));
  results.sort((a, b) => (order.get(a.domain) ?? 0) - (order.get(b.domain) ?? 0));
  return results;
}
