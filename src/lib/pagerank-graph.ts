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

export function extractInternalLinks(html: string, baseHost: string): string[] {
  const hrefs: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const resolved = new URL(match[1], `https://${baseHost}`);
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
    for (const [url] of nodes) {
      let sum = 0;
      for (const sourceUrl of incomingByUrl.get(url) ?? []) {
        const source = nodes.get(sourceUrl);
        if (source) sum += source.pr / Math.max(source.outLinks.length, 1);
      }
      next.set(url, (1 - damping) / total + damping * sum);
    }
    for (const [url, score] of next) nodes.get(url)!.pr = score;
  }
}
