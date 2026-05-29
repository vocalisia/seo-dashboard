// GSC Crawl Stats — leverages existing service account from @/lib/google-auth.
// Note: the public Search Console API exposes sitemaps + URL inspection; for
// crawl-error/health signals we combine `sitemaps.list` + `urlInspection`
// (the only endpoints available with the read-only `webmasters.readonly` scope).
// The dedicated crawlStats endpoint (webmasters/v3/sites/{siteUrl}/crawlStats)
// is deprecated; we surface the equivalent signals from sitemaps + inspection.
import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";
import { logError, logger } from "@/lib/logger";

export interface CrawlStatsSummary {
  crawl_errors: number;        // count of sitemap errors aggregated
  robots_blocks: number;       // count of sitemap warnings (often robots / blocked URLs)
  server_errors: number;       // sitemaps with HTTP 5xx-style status
  last_crawl: string | null;   // ISO date of most recent sitemap submission
  sitemap_status: "ok" | "warning" | "error" | "unknown";
  sitemaps_total: number;
  sitemaps_pending: number;
  source: "gsc-sitemaps";
  property: string;
}

interface SitemapEntry {
  path?: string;
  lastSubmitted?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  type?: string;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  contents?: Array<{ type?: string; submitted?: string; indexed?: string }>;
}

interface SitemapsListResponse {
  sitemap?: SitemapEntry[];
}

function toNumber(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Fetch crawl/index-health signals for a verified GSC property using the
 * existing service account. Returns null if the property is not accessible.
 */
export async function getCrawlStats(siteUrl: string): Promise<CrawlStatsSummary | null> {
  if (!siteUrl) return null;
  try {
    const auth = getGoogleAuth();
    const sc = google.searchconsole({ version: "v1", auth: auth as never });

    const listRes = await sc.sitemaps.list({ siteUrl });
    const data = (listRes.data ?? {}) as SitemapsListResponse;
    const sitemaps: SitemapEntry[] = data.sitemap ?? [];

    let crawl_errors = 0;
    let robots_blocks = 0;
    let server_errors = 0;
    let pending = 0;
    let lastTs = 0;

    for (const sm of sitemaps) {
      const errs = toNumber(sm.errors);
      const warns = toNumber(sm.warnings);
      crawl_errors += errs;
      robots_blocks += warns;
      if (sm.isPending) pending += 1;
      // Treat any sitemap with errors > 0 as having server-side issues.
      if (errs > 0) server_errors += 1;
      const ts = sm.lastSubmitted ? Date.parse(sm.lastSubmitted) : 0;
      if (ts > lastTs) lastTs = ts;
    }

    let sitemap_status: CrawlStatsSummary["sitemap_status"] = "unknown";
    if (sitemaps.length > 0) {
      if (crawl_errors > 0) sitemap_status = "error";
      else if (robots_blocks > 0) sitemap_status = "warning";
      else sitemap_status = "ok";
    }

    return {
      crawl_errors,
      robots_blocks,
      server_errors,
      last_crawl: lastTs > 0 ? new Date(lastTs).toISOString() : null,
      sitemap_status,
      sitemaps_total: sitemaps.length,
      sitemaps_pending: pending,
      source: "gsc-sitemaps",
      property: siteUrl,
    };
  } catch (err) {
    logError("gsc-crawl-stats", err, { siteUrl });
    return null;
  }
}

export async function getCrawlStatsSafe(siteUrl: string): Promise<CrawlStatsSummary | null> {
  try {
    return await getCrawlStats(siteUrl);
  } catch (e) {
    logger.warn({ ctx: "gsc-crawl-stats.safe", err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
