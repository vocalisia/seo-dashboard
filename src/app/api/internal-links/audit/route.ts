export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { listRepoFiles } from "@/lib/github";

// Minimal site → repo map (duplicated from autopilot for independence)
const SITE_REPO_MAP: Record<string, { repo: string; articlePath: string }> = {
  "vocalis-blog": {
    repo: "vocalisia/vocalis-blog",
    articlePath: "content/blog",
  },
  "vocalis-pro": {
    repo: "vocalisia/vocalis-blog",
    articlePath: "content/blog",
  },
  "tesla-mag": {
    repo: "vocalisia/tesla-mag",
    articlePath: "src/data/articles",
  },
  "trust-vault": {
    repo: "vocalisia/trust-vault",
    articlePath: "content/posts",
  },
  trustly: {
    repo: "vocalisia/trust-ai-blog",
    articlePath: "content/blog",
  },
  iapmesuisse: {
    repo: "vocalisia/iapmesuisse",
    articlePath: "content/blog",
  },
  "hub-ai": { repo: "vocalisia/hub-ai", articlePath: "content/blog" },
  "ai-due": { repo: "vocalisia/hub-ai", articlePath: "content/blog" },
  "vocalis-ai": {
    repo: "vocalisia/vocalis-ai",
    articlePath: "content/blog",
  },
};

const ARTICLE_LIMIT = 30;
const LINK_POOR_THRESHOLD = 2;

// Regex to match internal markdown links like [text](/blog/slug) or [text](/slug)
const INTERNAL_LINK_REGEX = /\[([^\]]*)\]\(\/(blog\/)?([a-z0-9][a-z0-9-]*)\)/gi;

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
    links.push(match[3]);
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

    // 2. Find repo config
    const siteName = site.name as string;
    const repoConfig = SITE_REPO_MAP[siteName];
    if (!repoConfig) {
      return NextResponse.json(
        {
          error: `No repo config for site "${siteName}". Available: ${Object.keys(SITE_REPO_MAP).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const { repo, articlePath } = repoConfig;

    // 3. List article slugs from GitHub
    const allSlugs = await listRepoFiles(repo, articlePath);
    if (allSlugs.length === 0) {
      return NextResponse.json(
        { error: "No articles found in repo" },
        { status: 404 }
      );
    }

    const slugsToAudit = allSlugs.slice(0, ARTICLE_LIMIT);

    // 4. Fetch raw content for each article (parallel, batched)
    const articles: ArticleData[] = [];
    const fetchPromises = slugsToAudit.map(async (slug) => {
      const content = await fetchRawContent(
        repo,
        `${articlePath}/${slug}.mdx`
      );
      if (!content) return null;

      const outgoingLinks = extractInternalLinks(content);
      return { slug, content, outgoingLinks };
    });

    const results = await Promise.all(fetchPromises);
    for (const r of results) {
      if (r) articles.push(r);
    }

    // 5-6. Build link matrix + compute stats
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
