import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";

interface PageNode {
  url: string;
  outLinks: string[];
  inLinks: string[];
  pr: number;
  clicks: number;
}

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
}

async function fetchWithTimeout(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "SEO-Dashboard-PRank/1.0" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  const base = siteUrl.replace(/\/$/, "");
  const html = await fetchWithTimeout(base + "/sitemap.xml");
  if (!html) return [];
  const urls: string[] = [];
  for (const m of html.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)) {
    if (!m[1].includes(".xml")) {
      urls.push(m[1].trim());
    }
    if (urls.length >= 100) break;
  }
  return urls;
}

function extractInternalLinks(html: string, baseHost: string): string[] {
  const hrefs: string[] = [];
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const href = m[1];
    try {
      const resolved = new URL(href, `https://${baseHost}`);
      if (resolved.hostname === baseHost && !resolved.pathname.match(/\.(jpg|jpeg|png|gif|svg|css|js|woff|pdf|xml)$/i)) {
        hrefs.push(resolved.origin + resolved.pathname);
      }
    } catch {
      // ignore malformed href
    }
  }
  return [...new Set(hrefs)];
}

function computePageRank(nodes: Map<string, PageNode>, iterations: number, damping: number): void {
  const N = nodes.size;
  if (N === 0) return;

  for (const node of nodes.values()) {
    node.pr = 1 / N;
  }

  for (let i = 0; i < iterations; i++) {
    const newPr = new Map<string, number>();
    for (const [url] of nodes) {
      let sum = 0;
      for (const [, other] of nodes) {
        if (other.outLinks.includes(url)) {
          sum += other.pr / Math.max(other.outLinks.length, 1);
        }
      }
      newPr.set(url, (1 - damping) / N + damping * sum);
    }
    for (const [url, pr] of newPr) {
      const node = nodes.get(url);
      if (node) node.pr = pr;
    }
  }
}

export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let siteId: number;
  let siteUrl: string;

  try {
    const body = await request.json() as { site_id?: unknown; site_url?: unknown };
    if (typeof body.site_id !== "number") {
      return NextResponse.json({ error: "site_id required" }, { status: 400 });
    }
    siteId = body.site_id;
    if (typeof body.site_url !== "string") {
      return NextResponse.json({ error: "site_url required" }, { status: 400 });
    }
    siteUrl = body.site_url;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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
      for (const r of rows) gscClicks.set(r.page, r.clicks);
    } catch {
      // continue without GSC data
    }
  }

  const sitemapUrls = await fetchSitemapUrls(siteUrl);
  const baseUrl = new URL(siteUrl);
  const baseHost = baseUrl.hostname;

  const nodes = new Map<string, PageNode>();
  for (const url of sitemapUrls) {
    nodes.set(url, { url, outLinks: [], inLinks: [], pr: 0, clicks: gscClicks.get(url) ?? 0 });
  }

  // Crawl pages concurrently in batches of 5
  const urlList = [...nodes.keys()];
  for (let i = 0; i < urlList.length; i += 5) {
    const batch = urlList.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (url) => {
        const html = await fetchWithTimeout(url);
        return { url, html };
      })
    );
    for (const { url, html } of results) {
      if (!html) continue;
      const links = extractInternalLinks(html, baseHost);
      const node = nodes.get(url);
      if (!node) continue;
      node.outLinks = links.filter((l) => nodes.has(l));
      for (const link of node.outLinks) {
        const target = nodes.get(link);
        if (target && !target.inLinks.includes(url)) {
          target.inLinks.push(url);
        }
      }
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

  const orphans = sorted.filter((n) => n.inLinks.length === 0).map((n) => n.url);

  // Suggestions: orphans with 0 links but best PR donors nearby
  const suggestions: string[] = [];
  for (const orphanUrl of orphans.slice(0, 10)) {
    const best = top20[0];
    if (best && best.url !== orphanUrl) {
      suggestions.push(`Ajoute un lien vers ${orphanUrl} depuis ${best.url}`);
    }
  }

  const response: ApiResponse = {
    top20,
    orphans: orphans.slice(0, 50),
    suggestions: suggestions.slice(0, 10),
    total: nodes.size,
  };

  return NextResponse.json(response);
}
