import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";
import { buildInternalLinkSuggestions, computePageRank, extractInternalLinks, normalizeUrlForGraph, type PageNode } from "@/lib/pagerank-graph";
import { fetchResearchText, parseResearchPublicUrl, parseSameSiteResearchUrl } from "@/lib/web-research-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PageRankResult {
  rank: number;
  url: string;
  score: number;
  inLinks: number;
  outLinks: number;
  clicks: number;
}

interface ApiResponse {
  top20: PageRankResult[];
  orphans: string[];
  suggestions: string[];
  total: number;
  discovered: number;
  crawled: number;
  failed: number;
  partial?: boolean;
  duration_ms?: number;
  contextual_links: number;
  sitewide_links_excluded: number;
  graph_mode: "contextual" | "all_internal";
}

async function fetchWithTimeout(url: string): Promise<string | null> {
  try {
    const res = await fetchResearchText(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "SEO-Dashboard-PRank/1.0" },
      maxBytes: 1_000_000,
    });
    if (res.status < 200 || res.status >= 300) return null;
    return res.text;
  } catch {
    return null;
  }
}

interface SitemapDiscovery {
  urls: string[];
  discovered: number;
  limited: boolean;
}

async function fetchSitemapUrls(siteUrl: string, limit: number): Promise<SitemapDiscovery> {
  const base = parseResearchPublicUrl(siteUrl);
  const queue = [new URL("/sitemap.xml", base).toString()];
  const visitedSitemaps = new Set<string>();
  const pages = new Map<string, string>();

  while (queue.length > 0) {
    const sitemapUrl = queue.shift()!;
    if (visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);
    const xml = await fetchWithTimeout(sitemapUrl);
    if (!xml) continue;

    for (const match of xml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)) {
      try {
        const candidate = parseSameSiteResearchUrl(match[1].trim(), base);
        if (candidate.pathname.endsWith(".xml")) {
          queue.push(candidate.toString());
        } else {
          pages.set(normalizeUrlForGraph(candidate.toString()), candidate.toString());
        }
      } catch {
        // Ignore malformed or cross-site sitemap entries.
      }
    }
  }

  const allUrls = [...pages.values()];
  return {
    urls: allUrls.slice(0, limit),
    discovered: allUrls.length,
    limited: allUrls.length > limit,
  };
}

export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let siteId: number;
  let siteUrl: string;
  let maxPages = 600;
  const startedAt = Date.now();

  try {
    const body = await request.json() as { site_id?: unknown; site_url?: unknown; max_pages?: unknown };
    if (typeof body.site_id !== "number") {
      return NextResponse.json({ error: "site_id required" }, { status: 400 });
    }
    siteId = body.site_id;
    if (typeof body.site_url !== "string") {
      return NextResponse.json({ error: "site_url required" }, { status: 400 });
    }
    siteUrl = body.site_url;
    if (typeof body.max_pages === "number" && body.max_pages > 0) {
      maxPages = Math.min(600, Math.floor(body.max_pages));
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    siteUrl = parseResearchPublicUrl(siteUrl).toString();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid site_url" }, { status: 400 });
  }

  // GSC clicks per page
  const gscClicks = new Map<string, number>();
  if (!isLocalDevDemoMode() && isDatabaseConfigured()) {
    try {
      const sql = getSQL();
      const rows = await sql`
        SELECT page, SUM(clicks)::int AS clicks
        FROM search_console_data
        WHERE site_id = ${siteId}
          AND date >= NOW() - INTERVAL '30 days'
        GROUP BY page
      ` as { page: string; clicks: number }[];
      for (const r of rows) {
        try {
          gscClicks.set(normalizeUrlForGraph(r.page), Number(r.clicks) || 0);
        } catch {
          // Ignore malformed GSC URLs instead of corrupting the graph keyspace.
        }
      }
    } catch {
      // continue without GSC data
    }
  }

  const sitemap = await fetchSitemapUrls(siteUrl, maxPages);
  if (sitemap.urls.length === 0) {
    return NextResponse.json({ error: "Aucune URL exploitable trouvée dans le sitemap" }, { status: 422 });
  }
  const baseUrl = new URL(siteUrl);
  const baseHost = baseUrl.hostname;

  const candidateNodes = new Map<string, PageNode>();
  for (const url of sitemap.urls) {
    const normalized = normalizeUrlForGraph(url);
    candidateNodes.set(normalized, { url: normalized, outLinks: [], inLinks: [], pr: 0, clicks: gscClicks.get(normalized) ?? 0 });
  }

  // Crawl the whole graph when possible. A strict deadline keeps the handler inside its runtime.
  const urlList = [...candidateNodes.keys()];
  const capturedLinks = new Map<string, string[]>();
  const crawlDeadline = Date.now() + 48_000;
  let cursor = 0;
  async function crawlWorker() {
    while (Date.now() < crawlDeadline) {
      const url = urlList[cursor++];
      if (!url) return;
      const html = await fetchWithTimeout(url);
      if (html) capturedLinks.set(url, extractInternalLinks(html, url, baseHost));
    }
  }
  await Promise.all(Array.from({ length: Math.min(12, urlList.length) }, () => crawlWorker()));

  // Only calculate graph metrics from pages actually fetched. Missing pages cannot be labelled orphaned.
  const nodes = new Map<string, PageNode>();
  for (const url of capturedLinks.keys()) {
    const candidate = candidateNodes.get(url);
    if (candidate) nodes.set(url, candidate);
  }
  const linkOccurrences = new Map<string, number>();
  for (const links of capturedLinks.values()) {
    for (const target of new Set(links.filter((link) => nodes.has(link)))) {
      linkOccurrences.set(target, (linkOccurrences.get(target) ?? 0) + 1);
    }
  }
  const sitewideThreshold = Math.max(3, Math.ceil(nodes.size * 0.7));
  const homeUrl = normalizeUrlForGraph(new URL("/", baseUrl).toString());
  const sitewideTargets = new Set(
    [...linkOccurrences.entries()]
      .filter(([target, occurrences]) => target !== homeUrl && occurrences >= sitewideThreshold)
      .map(([target]) => target),
  );
  let sitewideLinksExcluded = 0;
  for (const [url, node] of nodes) {
    const observed = (capturedLinks.get(url) ?? []).filter((link) => nodes.has(link));
    const contextual = observed.filter((link) => !sitewideTargets.has(link));
    sitewideLinksExcluded += observed.length - contextual.length;
    node.outLinks = contextual;
    for (const link of node.outLinks) {
      const target = nodes.get(link);
      if (target && !target.inLinks.includes(url)) target.inLinks.push(url);
    }
  }

  computePageRank(nodes, 20, 0.85);

  const sorted = [...nodes.values()].sort((a, b) => b.pr - a.pr);

  const top20: PageRankResult[] = sorted.slice(0, 20).map((n, i) => ({
    rank: i + 1,
    url: n.url,
    score: Math.round(n.pr * 10000) / 10000,
    inLinks: n.inLinks.length,
    outLinks: n.outLinks.length,
    clicks: n.clicks,
  }));

  const partial = sitemap.limited || nodes.size < candidateNodes.size;
  const baseGraphUrl = normalizeUrlForGraph(siteUrl);
  const orphans = partial
    ? []
    : sorted.filter((n) => n.inLinks.length === 0 && n.url !== baseGraphUrl).map((n) => n.url);

  // Suggestions include observed orphans and under-linked pages, never uncrawled pages.
  const suggestions = buildInternalLinkSuggestions(nodes, 10);
  const contextualLinks = [...nodes.values()].reduce((sum, node) => sum + node.outLinks.length, 0);

  const response: ApiResponse = {
    top20,
    orphans: orphans.slice(0, 50),
    suggestions: suggestions.slice(0, 10),
    total: nodes.size,
    discovered: sitemap.discovered,
    crawled: nodes.size,
    failed: candidateNodes.size - nodes.size,
    partial,
    duration_ms: Date.now() - startedAt,
    contextual_links: contextualLinks,
    sitewide_links_excluded: sitewideLinksExcluded,
    graph_mode: sitewideTargets.size > 0 ? "contextual" : "all_internal",
  };

  return NextResponse.json(response);
}
