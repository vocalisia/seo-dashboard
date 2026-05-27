import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { getSQL, isDatabaseConfigured } from "@/lib/db";
import { isLocalDevDemoMode } from "@/lib/local-dev";

interface BloatRow {
  url: string;
  reason: string;
  impressions90d: number;
  recommendation: "noindex" | "canonical" | "delete";
}

const THIN_PATTERNS: { reason: string; re: RegExp; rec: BloatRow["recommendation"] }[] = [
  { reason: "Tag page", re: /\/tag[s]?\//i, rec: "noindex" },
  { reason: "Author page", re: /\/(author|auteur)\//i, rec: "noindex" },
  { reason: "Category page", re: /\/(category|cat|categorie)\//i, rec: "noindex" },
  { reason: "WP legacy ID (?p=)", re: /[?&]p=\d+/, rec: "canonical" },
  { reason: "Pagination profonde (page 4+)", re: /\/(page|p)\/[4-9]\d*\/?$/i, rec: "noindex" },
  { reason: "UTM parameter", re: /[?&]utm_/i, rec: "canonical" },
  { reason: "Session parameter", re: /[?&]session[_=]/i, rec: "canonical" },
  { reason: "Ref/referrer parameter", re: /[?&](ref|referrer|source)=/i, rec: "canonical" },
  { reason: "Print version", re: /\/print\/?$|[?&]print=/i, rec: "noindex" },
  { reason: "Search results page", re: /\/(search|recherche|s)\/?(\?|$)/i, rec: "noindex" },
  { reason: "Filter parameter (?filter=, ?sort=)", re: /[?&](filter|sort|order|page_size)=/i, rec: "canonical" },
  { reason: "Comment paged", re: /\/comment-page-\d+/i, rec: "noindex" },
  { reason: "Feed URL", re: /\/feed\/?$|\.rss$|\.atom$/i, rec: "noindex" },
  { reason: "Archive date", re: /\/\d{4}\/\d{2}\/?$/, rec: "noindex" },
  { reason: "Replytocom (WP)", re: /[?&]replytocom=/i, rec: "canonical" },
  { reason: "WP attachment", re: /\?attachment_id=/i, rec: "noindex" },
];

const ORPHAN_IMPRESSION_THRESHOLD = 2;

async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  const base = siteUrl.replace(/\/$/, "");
  try {
    const res = await fetch(base + "/sitemap.xml", {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "SEO-Dashboard/1.0" },
    });
    if (!res.ok) return [];
    const text = await res.text();
    const urls: string[] = [];
    for (const m of text.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)) {
      urls.push(m[1].trim());
    }
    return urls;
  } catch {
    return [];
  }
}

function detectBloat(url: string): { reason: string; rec: BloatRow["recommendation"] } | null {
  for (const { reason, re, rec } of THIN_PATTERNS) {
    if (re.test(url)) return { reason, rec };
  }
  return null;
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

  // Normalize URL: strip trailing slash, lowercase, drop http(s)://www. — for tolerant matching
  function normalizeUrl(u: string): string {
    return u
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/$/, "")
      .replace(/#.*$/, "")
      .trim();
  }

  // Fetch GSC pages summary: low-impression pages (<= ORPHAN_IMPRESSION_THRESHOLD over 90d)
  // Key by normalized URL for tolerant matching with sitemap entries.
  const lowImpPages = new Map<string, number>(); // normalized url -> impressions

  if (!isLocalDevDemoMode() && isDatabaseConfigured()) {
    try {
      const sql = getSQL();
      const rows = await sql`
        SELECT
          page,
          COALESCE(SUM(impressions), 0) AS impressions,
          COALESCE(SUM(clicks), 0) AS clicks
        FROM search_console_data
        WHERE
          site_id = ${siteId}
          AND date >= NOW() - INTERVAL '90 days'
        GROUP BY page
        HAVING SUM(impressions) <= ${ORPHAN_IMPRESSION_THRESHOLD} AND SUM(clicks) = 0
      ` as { page: string; impressions: number; clicks: number }[];
      for (const r of rows) {
        const key = normalizeUrl(r.page);
        if (!lowImpPages.has(key) || (lowImpPages.get(key) ?? Infinity) > r.impressions) {
          lowImpPages.set(key, Number(r.impressions) || 0);
        }
      }
    } catch {
      // DB unavailable — continue with sitemap-only analysis
    }
  }

  const sitemapUrls = await fetchSitemapUrls(siteUrl);

  // Also detect duplicates within sitemap itself (same URL with/without trailing slash, www variants)
  const sitemapByNorm = new Map<string, string[]>();
  for (const u of sitemapUrls) {
    const n = normalizeUrl(u);
    if (!sitemapByNorm.has(n)) sitemapByNorm.set(n, []);
    sitemapByNorm.get(n)!.push(u);
  }

  const bloatRows: BloatRow[] = [];
  const seen = new Set<string>();

  for (const url of sitemapUrls) {
    const norm = normalizeUrl(url);
    if (seen.has(norm)) continue;
    seen.add(norm);

    const pattern = detectBloat(url);
    const impressions = lowImpPages.get(norm) ?? null;
    const dupes = sitemapByNorm.get(norm) ?? [];

    if (pattern) {
      bloatRows.push({
        url,
        reason: pattern.reason,
        impressions90d: impressions ?? 0,
        recommendation: pattern.rec,
      });
      continue;
    }

    // Duplicate in sitemap (same canonical, different variants)
    if (dupes.length > 1) {
      bloatRows.push({
        url,
        reason: `Doublon sitemap (${dupes.length}x variantes)`,
        impressions90d: impressions ?? 0,
        recommendation: "canonical",
      });
      continue;
    }

    // Low-impression orphan: tracked by GSC but <=2 impressions in 90d
    if (impressions !== null && impressions <= ORPHAN_IMPRESSION_THRESHOLD) {
      bloatRows.push({
        url,
        reason: impressions === 0
          ? "Orphan: 0 clic + 0 impression (90j)"
          : `Très faible visibilité: ${impressions} impressions (90j), 0 clic`,
        impressions90d: impressions,
        recommendation: "noindex",
      });
    }
  }

  // Also surface GSC URLs not in sitemap (true orphans that Google found but you don't link)
  for (const [norm, impressions] of lowImpPages.entries()) {
    if (seen.has(norm)) continue;
    bloatRows.push({
      url: "https://" + norm,
      reason: `Orphan: découverte par Google mais pas dans sitemap (${impressions} imp, 90j)`,
      impressions90d: impressions,
      recommendation: "noindex",
    });
    seen.add(norm);
  }

  return NextResponse.json({
    total: sitemapUrls.length,
    bloat_count: bloatRows.length,
    rows: bloatRows.slice(0, 500),
    summary: {
      sitemap_pages: sitemapUrls.length,
      low_impression_pages: lowImpPages.size,
      pattern_bloat: bloatRows.filter((r) => r.reason !== "" && !r.reason.startsWith("Orphan")).length,
      orphan_pages: bloatRows.filter((r) => r.reason.startsWith("Orphan")).length,
    },
  });
}
