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
  { reason: "Tag page", re: /\/tag\//i, rec: "noindex" },
  { reason: "Author page", re: /\/author\//i, rec: "noindex" },
  { reason: "Category page", re: /\/(category|cat)\//i, rec: "noindex" },
  { reason: "WP legacy ID (?p=)", re: /[?&]p=\d+/, rec: "canonical" },
  { reason: "Pagination profonde", re: /\/(page|p)\/[4-9]\d*\//i, rec: "noindex" },
  { reason: "UTM parameter", re: /[?&]utm_/i, rec: "canonical" },
  { reason: "Session parameter", re: /[?&]session[_=]/i, rec: "canonical" },
  { reason: "Ref parameter", re: /[?&]ref=/i, rec: "canonical" },
];

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

  // Fetch zero-impression pages from DB
  const zeroPages = new Map<string, number>();

  if (!isLocalDevDemoMode() && isDatabaseConfigured()) {
    try {
      const sql = getSQL();
      const rows = await sql`
        SELECT
          page,
          COALESCE(SUM(impressions), 0) AS impressions
        FROM search_console_data
        WHERE
          site_id = ${siteId}
          AND date >= NOW() - INTERVAL '90 days'
        GROUP BY page
        HAVING SUM(clicks) = 0 AND SUM(impressions) = 0
      ` as { page: string; impressions: number }[];
      for (const r of rows) {
        zeroPages.set(r.page, 0);
      }
    } catch {
      // DB unavailable — continue with sitemap-only analysis
    }
  }

  const sitemapUrls = await fetchSitemapUrls(siteUrl);
  const allUrls = new Set<string>([...sitemapUrls, ...zeroPages.keys()]);

  const bloatRows: BloatRow[] = [];

  for (const url of allUrls) {
    const pattern = detectBloat(url);
    if (pattern) {
      bloatRows.push({
        url,
        reason: pattern.reason,
        impressions90d: zeroPages.get(url) ?? 0,
        recommendation: pattern.rec,
      });
      continue;
    }
    // Zero impressions AND zero clicks from GSC data
    if (zeroPages.has(url)) {
      bloatRows.push({
        url,
        reason: "0 clics + 0 impressions (90j)",
        impressions90d: 0,
        recommendation: "noindex",
      });
    }
  }

  return NextResponse.json({
    total: allUrls.size,
    bloat_count: bloatRows.length,
    rows: bloatRows,
  });
}
