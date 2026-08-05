/**
 * GET/POST /api/cron/pagespeed-daily
 *
 * Daily PageSpeed Insights cron. Loops all active sites and runs PSI for both
 * mobile + desktop strategies, storing one row per (site, strategy) in
 * `pagespeed_scores`.
 *
 * Rate limit: Google PSI = 1 QPS without API key, ~400 QPM with key. We sleep
 * ~2500 ms between calls (mobile → sleep → desktop → sleep → next site).
 *
 * Triggered by Vercel cron at 04:00 UTC (see vercel.json).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { getSQL, ensureSchema } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";

interface SiteRow {
  id: number;
  name: string;
  url: string;
}

interface PageSpeedMetrics {
  score: number;
  lcp: number;
  cls: number;
  fcp: number;
  ttfb: number;
}

interface SiteResult {
  site_id: number;
  site_name: string;
  url: string;
  mobile_score: number;
  desktop_score: number;
  status: "ok" | "failed";
  error?: string;
}

const RATE_DELAY_MS = process.env.PAGESPEED_API_KEY?.trim() ? 150 : 1_100;

function extractMetrics(data: Record<string, unknown>): PageSpeedMetrics {
  const lr = data.lighthouseResult as Record<string, unknown> | undefined;
  const cats = lr?.categories as Record<string, Record<string, unknown>> | undefined;
  const score = Math.round(Number(cats?.performance?.score ?? 0) * 100);
  const audits = (lr?.audits ?? {}) as Record<string, Record<string, unknown>>;
  const numVal = (key: string): number => {
    const audit = audits[key];
    if (!audit) return 0;
    return Number(audit.numericValue ?? 0) / 1000;
  };
  return {
    score,
    lcp: Math.round(numVal("largest-contentful-paint") * 100) / 100,
    cls: Math.round(Number(audits["cumulative-layout-shift"]?.numericValue ?? 0) * 1000) / 1000,
    fcp: Math.round(numVal("first-contentful-paint") * 100) / 100,
    ttfb: Math.round(numVal("server-response-time") * 100) / 100,
  };
}

async function fetchPageSpeed(
  url: string,
  strategy: "mobile" | "desktop"
): Promise<PageSpeedMetrics> {
  const encodedUrl = encodeURIComponent(url);
  const apiKey = process.env.PAGESPEED_API_KEY;
  const keyParam = apiKey ? `&key=${apiKey}` : "";
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodedUrl}&strategy=${strategy}${keyParam}`;

  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`PageSpeed API ${strategy} returned ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return extractMetrics(data);
}

async function runPageSpeedCron(request: Request): Promise<NextResponse> {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  await ensureSchema();
  const sql = getSQL();

  let sites: SiteRow[];
  try {
    sites = (await sql`
      SELECT id, name, url FROM sites WHERE is_active = true ORDER BY id
    `) as SiteRow[];
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "db error" },
      { status: 500 }
    );
  }

  if (sites.length === 0) {
    return NextResponse.json({ success: true, message: "No active sites", results: [] });
  }

  const results: SiteResult[] = [];

  for (const site of sites) {
    try {
      const mobile = await fetchPageSpeed(site.url, "mobile");
      await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
      const desktop = await fetchPageSpeed(site.url, "desktop");

      // Single row per (site, day) — combined mobile+desktop metrics for
      // compatibility with existing /api/pagespeed/weekly schema usage.
      await sql`
        INSERT INTO pagespeed_scores
          (site_id, url, strategy, mobile_score, desktop_score,
           mobile_lcp, desktop_lcp, mobile_cls, desktop_cls,
           mobile_fcp, desktop_fcp, mobile_ttfb, desktop_ttfb)
        VALUES
          (${site.id}, ${site.url}, 'daily', ${mobile.score}, ${desktop.score},
           ${mobile.lcp}, ${desktop.lcp}, ${mobile.cls}, ${desktop.cls},
           ${mobile.fcp}, ${desktop.fcp}, ${mobile.ttfb}, ${desktop.ttfb})
      `;

      results.push({
        site_id: site.id,
        site_name: site.name,
        url: site.url,
        mobile_score: mobile.score,
        desktop_score: desktop.score,
        status: "ok",
      });

      // Inter-site gap to be polite to the API
      await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
    } catch (err) {
      results.push({
        site_id: site.id,
        site_name: site.name,
        url: site.url,
        mobile_score: 0,
        desktop_score: 0,
        status: "failed",
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({
    success: true,
    total_sites: sites.length,
    ok: results.filter((r) => r.status === "ok").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}

// Vercel cron invokes configured paths with GET; POST remains available for an
// authenticated manual retry through the dashboard.
export async function GET(request: Request): Promise<NextResponse> {
  return runPageSpeedCron(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return runPageSpeedCron(request);
}
