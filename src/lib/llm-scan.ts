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
  llms_txt_content: string | null;
  ai_bots_allowed: string[];
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
  "Organization",
  "WebSite",
  "Product",
  "Service",
  "BreadcrumbList",
  "VideoObject",
  "Person",
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
 * Returns names of bots EXPLICITLY allowed (i.e. NOT disallowed for "/" in their User-agent block).
 *
 * Heuristic:
 *  - A bot is "disallowed" if its User-agent block contains `Disallow: /`.
 *  - A bot is "allowed" if its block exists with `Allow: /` or `Disallow:` (empty), or no rule at all.
 *  - "*"" wildcard with `Disallow: /` is treated as disallow for all bots.
 */
export function parseRobotsTxt(content: string): {
  ai_bots_allowed: string[];
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
  const disallowed: string[] = [];

  for (const botName of AI_BOT_NAMES) {
    const botBlock = blocks.find((b) =>
      b.agents.some((a) => a.toLowerCase() === botName.toLowerCase()),
    );
    if (botBlock) {
      if (isDisallowedAll(botBlock.rules)) disallowed.push(botName);
      else allowed.push(botName);
    } else {
      // No explicit rule for this bot — falls under "*" wildcard
      if (wildcardDisallowAll) disallowed.push(botName);
      else allowed.push(botName);
    }
  }

  return { ai_bots_allowed: allowed, ai_bots_disallowed: disallowed };
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
 * Compute the LLM-readiness score (0-100) and the list of human-readable recommendations.
 *
 * Weights (per spec):
 *   - llms.txt present         +30
 *   - AI bots allowed (>=1)    +20
 *   - FAQPage schema           +15
 *   - HowTo schema             +10
 *   - Article + Person/author  +10
 *   - Organization schema      +10
 *   - Open Graph complete      +5
 */
export function scoreReadiness(
  llmsTxtPresent: boolean,
  aiBotsAllowed: string[],
  schemasDetected: string[],
  hasOG: boolean,
): { score: number; recommendations: string[] } {
  let score = 0;
  const recs: string[] = [];

  if (llmsTxtPresent) {
    score += 30;
  } else {
    recs.push("Ajouter un fichier /llms.txt à la racine (+30 pts)");
  }

  if (aiBotsAllowed.length > 0) {
    score += 20;
  } else {
    recs.push(
      "Autoriser au moins un AI bot (GPTBot, ClaudeBot, PerplexityBot…) dans robots.txt (+20 pts)",
    );
  }

  const hasSchema = (name: string) =>
    schemasDetected.some((s) => s.toLowerCase() === name.toLowerCase());

  if (hasSchema("FAQPage")) {
    score += 15;
  } else {
    recs.push("Ajouter un schema JSON-LD FAQPage sur pages clés (+15 pts)");
  }

  if (hasSchema("HowTo")) {
    score += 10;
  } else {
    recs.push("Ajouter un schema HowTo sur tutoriels/guides (+10 pts)");
  }

  const hasArticle =
    hasSchema("Article") || hasSchema("NewsArticle") || hasSchema("BlogPosting");
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

  // 2) /robots.txt
  let robotsContent: string | null = null;
  try {
    robotsContent = await fetchText(`${base}/robots.txt`);
  } catch (err) {
    errors.push({ resource: "/robots.txt", error: String(err) });
  }
  const { ai_bots_allowed, ai_bots_disallowed } = robotsContent
    ? parseRobotsTxt(robotsContent)
    : { ai_bots_allowed: AI_BOT_NAMES, ai_bots_disallowed: [] };

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

  // 4) Score
  const { score, recommendations } = scoreReadiness(
    llmsTxtPresent,
    ai_bots_allowed,
    schemasDetected,
    ogPresent,
  );

  return {
    llms_txt_present: llmsTxtPresent,
    llms_txt_content: llmsTxtContent ? llmsTxtContent.slice(0, 8000) : null,
    ai_bots_allowed,
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
            llms_txt_content: null,
            ai_bots_allowed: [],
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
