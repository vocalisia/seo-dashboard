export interface PageNode {
  url: string;
  outLinks: string[];
  inLinks: string[];
  pr: number;
  clicks: number;
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function normalizeUrlForGraph(rawUrl: string): string {
  const u = new URL(rawUrl);
  const path = u.pathname.replace(/\/$/, "") || "/";
  return `${u.protocol}//${normalizeHost(u.hostname)}${path}`;
}

export function extractInternalLinks(html: string, sourceUrl: string, expectedHost?: string): string[] {
  const source = new URL(sourceUrl);
  const baseHost = expectedHost ?? source.hostname;
  const hrefs: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const resolved = new URL(match[1], source);
      if (
        normalizeHost(resolved.hostname) === normalizeHost(baseHost)
        && !resolved.pathname.match(/\.(jpg|jpeg|png|gif|svg|css|js|woff|pdf|xml)$/i)
      ) {
        hrefs.push(normalizeUrlForGraph(resolved.href));
      }
    } catch {
      // Ignore malformed links.
    }
  }
  return [...new Set(hrefs)];
}

export function computePageRank(nodes: Map<string, PageNode>, iterations: number, damping: number): void {
  const total = nodes.size;
  if (total === 0) return;

  const incomingByUrl = new Map<string, string[]>();
  for (const [url] of nodes) incomingByUrl.set(url, []);
  for (const [sourceUrl, source] of nodes) {
    for (const targetUrl of source.outLinks) incomingByUrl.get(targetUrl)?.push(sourceUrl);
  }

  for (const node of nodes.values()) node.pr = 1 / total;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = new Map<string, number>();
    const danglingMass = [...nodes.values()]
      .filter((node) => node.outLinks.length === 0)
      .reduce((sum, node) => sum + node.pr, 0);
    for (const [url] of nodes) {
      let sum = 0;
      for (const sourceUrl of incomingByUrl.get(url) ?? []) {
        const source = nodes.get(sourceUrl);
        if (source) sum += source.pr / Math.max(source.outLinks.length, 1);
      }
      next.set(url, (1 - damping) / total + damping * (sum + danglingMass / total));
    }
    for (const [url, score] of next) nodes.get(url)!.pr = score;
  }
}

const GENERIC_PATH_TERMS = new Set([
  "fr", "en", "de", "it", "es", "blog", "article", "articles", "page", "index",
]);

function pathTerms(rawUrl: string): Set<string> {
  try {
    const pathname = new URL(rawUrl).pathname;
    return new Set(pathname
      .toLowerCase()
      .split(/[^a-z0-9à-ÿ]+/i)
      .filter((term) => term.length >= 3 && !GENERIC_PATH_TERMS.has(term)));
  } catch {
    return new Set();
  }
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const term of left) if (right.has(term)) count += 1;
  return count;
}

export function buildInternalLinkSuggestions(nodes: Map<string, PageNode>, limit = 10): string[] {
  if (nodes.size < 2) return [];
  const pages = [...nodes.values()];
  const nonHome = pages.filter((node) => new URL(node.url).pathname !== "/");
  if (nonHome.length === 0) return [];
  const sortedInLinks = nonHome.map((node) => node.inLinks.length).sort((a, b) => a - b);
  const medianInLinks = sortedInLinks[Math.floor(sortedInLinks.length / 2)] ?? 0;
  const targets = nonHome
    .filter((node) => node.inLinks.length < medianInLinks || (medianInLinks === 0 && node.inLinks.length === 0))
    .sort((a, b) => a.inLinks.length - b.inLinks.length || a.pr - b.pr);
  const donors = [...pages].sort((a, b) => b.pr - a.pr || b.clicks - a.clicks);
  const suggestions: string[] = [];
  const usedTargets = new Set<string>();

  for (const target of targets) {
    const targetTerms = pathTerms(target.url);
    const candidates = donors
      .filter((source) =>
        source.url !== target.url
        && !source.outLinks.includes(target.url)
      )
      .map((source) => ({
        source,
        overlap: overlapCount(pathTerms(source.url), targetTerms),
      }))
      .sort((a, b) => b.overlap - a.overlap || b.source.pr - a.source.pr || b.source.clicks - a.source.clicks);
    const best = candidates.find((candidate) => candidate.overlap > 0)
      ?? (target.inLinks.length <= 1 ? candidates[0] : undefined);
    if (!best || usedTargets.has(target.url)) continue;
    usedTargets.add(target.url);
    const reason = best.overlap > 0
      ? "proximité thématique du chemin"
      : "page sous-liée et source à forte autorité interne";
    suggestions.push("Ajouter un lien vers " + target.url + " depuis " + best.source.url + " — " + reason + ".");
    if (suggestions.length >= Math.max(1, Math.min(50, limit))) break;
  }
  return suggestions;
}
