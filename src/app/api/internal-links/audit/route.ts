export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { listRepoFiles } from "@/lib/github";
import { resolveSiteRepoConfig } from "@/lib/autopilot-config";
import { requireApiSession } from "@/lib/api-auth";

const ARTICLE_LIMIT = 30;
const LINK_POOR_THRESHOLD = 2;

// Match locale-prefixed and non-prefixed internal links, e.g.
// [text](/fr/blog/slug), [text](/blog/slug), or [text](/slug).
const INTERNAL_LINK_REGEX =
  /\[([^\]]*)\]\(\/(?:(?:[a-z]{2}(?:-[A-Z]{2})?)\/)?(?:blog\/)?([a-z0-9][a-z0-9-]*)(?:[?#][^)]*)?\)/gi;

interface ArticleData {
  slug: string;
  content: string;
  outgoingLinks: string[];
}

interface LinkPoorPage {
  slug: string;
  outgoing_links: number;
}

interface Suggestion {
  from: string;
  to: string;
  reason: string;
}
function pageKey(url: URL): string {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return pathname === "/" ? "home" : pathname.replace(/^\/+/, "");
}

function sitemapUrls(xml: string, origin: string): URL[] {
  const urls: URL[] = [];
  const seen = new Set<string>();
  const matches = xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
  for (const match of matches) {
    try {
      const url = new URL(match[1].trim());
      if (url.origin !== origin || seen.has(url.href)) continue;
      seen.add(url.href);
      urls.push(url);
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return urls;
}

function publicInternalLinks(html: string, origin: string): string[] {
  const links: string[] = [];
  const matches = html.matchAll(/\shref\s*=\s*["']([^"'#][^"']*)["']/gi);
  for (const match of matches) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin === origin) links.push(pageKey(url));
    } catch {
      // Ignore malformed href values.
    }
  }
  return links;
}

async function fetchPublicPages(siteUrl: string): Promise<ArticleData[]> {
  const origin = new URL(siteUrl).origin;
  const response = await fetch(`${origin}/sitemap.xml`, {
    headers: { "User-Agent": "SEO-Dashboard-InternalLinks/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return [];

  const urls = sitemapUrls(await response.text(), origin).slice(0, ARTICLE_LIMIT);
  const results = await Promise.all(urls.map(async (url) => {
    try {
      const page = await fetch(url, {
        headers: { "User-Agent": "SEO-Dashboard-InternalLinks/1.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!page.ok) return null;
      return {
        slug: pageKey(url),
        content: "",
        outgoingLinks: publicInternalLinks(await page.text(), origin),
      };
    } catch {
      return null;
    }
  }));

  return results.filter((page): page is ArticleData => page !== null);
}

/** Fetch raw MDX content from GitHub */
async function fetchRawContent(
  repo: string,
  filePath: string
): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!res.ok) return null;
  return res.text();
}

/** Extract internal link slugs from MDX content */
function extractInternalLinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(INTERNAL_LINK_REGEX.source, "gi");

  while ((match = regex.exec(content)) !== null) {
    links.push(match[2]);
  }
  return links;
}

/** Extract significant keywords from slug (split on hyphens, drop short words) */
function slugToKeywords(slug: string): Set<string> {
  const stopWords = new Set([
    "le",
    "la",
    "les",
    "de",
    "du",
    "des",
    "un",
    "une",
    "et",
    "en",
    "au",
    "aux",
    "pour",
    "par",
    "sur",
    "avec",
    "dans",
    "the",
    "a",
    "an",
    "of",
    "to",
    "and",
    "in",
    "on",
    "for",
    "with",
    "is",
    "at",
    "by",
    "how",
    "what",
    "why",
    "best",
    "top",
    "guide",
    "your",
    "our",
  ]);

  return new Set(
    slug
      .split("-")
      .filter((w) => w.length > 2 && !stopWords.has(w))
  );
}

/** Compute keyword overlap score between two slugs */
function keywordOverlap(kwA: Set<string>, kwB: Set<string>): string[] {
  const shared: string[] = [];
  for (const w of kwA) {
    if (kwB.has(w)) shared.push(w);
  }
  return shared;
}

export async function POST(request: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;
  try {
    const body = (await request.json()) as { site_id?: number };
    const siteId = body.site_id;

    if (!siteId) {
      return NextResponse.json(
        { error: "site_id required" },
        { status: 400 }
      );
    }

    // 1. Get site from DB
    const sql = getSQL();
    const sites = await sql`SELECT * FROM sites WHERE id = ${siteId}`;
    if (sites.length === 0) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    const site = sites[0];
    const siteName = site.name as string;

    // 2. Read Git-backed articles when available; otherwise audit the live sitemap.
    const { repoConfig, siteKey, normalizedSiteName } = resolveSiteRepoConfig(siteName);
    let articles: ArticleData[];
    let auditSource: "github" | "sitemap";

    if (!repoConfig) {
      articles = await fetchPublicPages(site.url as string);
      auditSource = "sitemap";
      if (articles.length === 0) {
        return NextResponse.json(
          { error: `No repository config and no readable sitemap for site "${siteName}".` },
          { status: 404 }
        );
      }
    } else {
      const { repo, articlePath, format } = repoConfig;
      const allSlugs = await listRepoFiles(repo, articlePath);
      if (allSlugs.length === 0) {
        return NextResponse.json(
          { error: "No articles found in repo" },
          { status: 404 }
        );
      }

      const slugsToAudit = allSlugs.slice(0, ARTICLE_LIMIT);
      const results = await Promise.all(slugsToAudit.map(async (slug) => {
        const content = await fetchRawContent(repo, `${articlePath}/${slug}.${format}`);
        if (!content) return null;
        return { slug, content, outgoingLinks: extractInternalLinks(content) };
      }));
      articles = results.filter((article): article is ArticleData => article !== null);
      auditSource = "github";
    }

    // 5-6. Build link matrix
    const slugSet = new Set(articles.map((a) => a.slug));
    const incomingCount: Record<string, number> = {};
    let totalInternalLinks = 0;

    // Init incoming counts
    for (const slug of slugSet) {
      incomingCount[slug] = 0;
    }

    // Count outgoing → incoming
    for (const article of articles) {
      for (const target of article.outgoingLinks) {
        if (slugSet.has(target)) {
          incomingCount[target] = (incomingCount[target] ?? 0) + 1;
          totalInternalLinks++;
        }
      }
    }

    // 7. Identify issues
    const orphanPages: string[] = [];
    const linkPoorPages: LinkPoorPage[] = [];

    for (const article of articles) {
      // Orphans: 0 incoming links
      if (incomingCount[article.slug] === 0) {
        orphanPages.push(article.slug);
      }
      // Link-poor: fewer than threshold outgoing
      if (article.outgoingLinks.length < LINK_POOR_THRESHOLD) {
        linkPoorPages.push({
          slug: article.slug,
          outgoing_links: article.outgoingLinks.length,
        });
      }
    }

    // Top opportunities: related articles (keyword overlap) not linking each other
    const suggestions: Suggestion[] = [];
    const keywordCache = new Map<string, Set<string>>();

    for (const a of articles) {
      keywordCache.set(a.slug, slugToKeywords(a.slug));
    }

    const outgoingSets = new Map<string, Set<string>>();
    for (const a of articles) {
      outgoingSets.set(a.slug, new Set(a.outgoingLinks));
    }

    for (let i = 0; i < articles.length && suggestions.length < 20; i++) {
      for (
        let j = i + 1;
        j < articles.length && suggestions.length < 20;
        j++
      ) {
        const a = articles[i];
        const b = articles[j];
        const kwA = keywordCache.get(a.slug)!;
        const kwB = keywordCache.get(b.slug)!;
        const shared = keywordOverlap(kwA, kwB);

        if (shared.length >= 2) {
          const aLinksB = outgoingSets.get(a.slug)!.has(b.slug);
          const bLinksA = outgoingSets.get(b.slug)!.has(a.slug);

          if (!aLinksB) {
            suggestions.push({
              from: a.slug,
              to: b.slug,
              reason: `Both about '${shared.join("', '")}'`,
            });
          }
          if (!bLinksA && suggestions.length < 20) {
            suggestions.push({
              from: b.slug,
              to: a.slug,
              reason: `Both about '${shared.join("', '")}'`,
            });
          }
        }
      }
    }

    // 8. Return audit result
    const avgLinks =
      articles.length > 0
        ? Math.round((totalInternalLinks / articles.length) * 10) / 10
        : 0;

    return NextResponse.json({
      success: true,
      site_key: siteKey ?? normalizedSiteName,
      source: auditSource,
      total_articles: articles.length,
      total_internal_links: totalInternalLinks,
      avg_links_per_article: avgLinks,
      orphan_pages: orphanPages,
      link_poor_pages: linkPoorPages,
      suggestions,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
