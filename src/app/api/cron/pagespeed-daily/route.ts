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
import { runOutcome } from "@/lib/run-outcome";
import {
  extractPageSpeedMetrics,
  runOriginPerformanceProbe,
  type OriginProbeResult,
  type PageSpeedMetrics,
} from "@/lib/pagespeed";
import { mapWithConcurrency } from "@/lib/data-sync";

interface SiteRow {
  id: number;
  name: string;
  url: string;
}

interface SiteResult {
  site_id: number;
  site_name: string;
  url: string;
  mobile_score: number | null;
  desktop_score: number | null;
  status: "ok" | "probe" | "failed";
  measurement_status: "lighthouse" | "origin_probe" | "failed";
  origin_probe?: OriginProbeResult;
  error?: string;
}

const RATE_DELAY_MS = process.env.PAGESPEED_API_KEY?.trim() ? 150 : 1_100;

async function ensureOriginProbeTable(sql: ReturnType<typeof getSQL>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS performance_origin_probes (
      id BIGSERIAL PRIMARY KEY,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      mobile_status INTEGER NOT NULL,
      desktop_status INTEGER NOT NULL,
      mobile_ttfb REAL NOT NULL,
      desktop_ttfb REAL NOT NULL,
      mobile_total REAL NOT NULL,
      desktop_total REAL NOT NULL,
      mobile_transfer_kb REAL NOT NULL,
      desktop_transfer_kb REAL NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_origin_probes_site_checked
      ON performance_origin_probes(site_id, checked_at DESC)
  `;
}

async function saveOriginProbe(
  sql: ReturnType<typeof getSQL>,
  site: SiteRow,
  probe: OriginProbeResult,
): Promise<void> {
  await sql`
    INSERT INTO performance_origin_probes (
      site_id, url, mobile_status, desktop_status,
      mobile_ttfb, desktop_ttfb, mobile_total, desktop_total,
      mobile_transfer_kb, desktop_transfer_kb
    ) VALUES (
      ${site.id}, ${site.url}, ${probe.mobile.status_code}, ${probe.desktop.status_code},
      ${probe.mobile.ttfb}, ${probe.desktop.ttfb}, ${probe.mobile.total}, ${probe.desktop.total},
      ${probe.mobile.transfer_kb}, ${probe.desktop.transfer_kb}
    )
  `;
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
  return extractPageSpeedMetrics(data);
}

async function runPageSpeedCron(request: Request): Promise<NextResponse> {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  await ensureSchema();
  const sql = getSQL();
  await ensureOriginProbeTable(sql);

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
    return NextResponse.json({ success: true, partial: false, skipped: true, message: "No active sites", results: [] });
  }

  const apiConfigured = Boolean(process.env.PAGESPEED_API_KEY?.trim());
  const measureSite = async (site: SiteRow): Promise<SiteResult> => {
    try {
      if (!apiConfigured) {
        const originProbe = await runOriginPerformanceProbe(site.url);
        await saveOriginProbe(sql, site, originProbe);
        return {
          site_id: site.id,
          site_name: site.name,
          url: site.url,
          mobile_score: null,
          desktop_score: null,
          status: "probe",
          measurement_status: "origin_probe",
          origin_probe: originProbe,
        };
      }

      const mobile = await fetchPageSpeed(site.url, "mobile");
      await new Promise((resolve) => setTimeout(resolve, RATE_DELAY_MS));
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

      return {
        site_id: site.id,
        site_name: site.name,
        url: site.url,
        mobile_score: mobile.score,
        desktop_score: desktop.score,
        status: "ok",
        measurement_status: "lighthouse",
      };
    } catch (err) {
      // A live origin probe remains useful and truthful when Google PSI is
      // unavailable. It is stored separately and never labelled Lighthouse.
      try {
        const originProbe = await runOriginPerformanceProbe(site.url);
        await saveOriginProbe(sql, site, originProbe);
        return {
          site_id: site.id,
          site_name: site.name,
          url: site.url,
          mobile_score: null,
          desktop_score: null,
          status: "probe",
          measurement_status: "origin_probe",
          origin_probe: originProbe,
          error: err instanceof Error ? err.message : "PageSpeed unavailable",
        };
      } catch (probeError) {
        return {
          site_id: site.id,
          site_name: site.name,
          url: site.url,
          mobile_score: null,
          desktop_score: null,
          status: "failed",
          measurement_status: "failed",
          error: probeError instanceof Error ? probeError.message : "unknown",
        };
      }
    }
  };

  const results = apiConfigured
    ? await (async () => {
        const sequential: SiteResult[] = [];
        for (const site of sites) {
          sequential.push(await measureSite(site));
          await new Promise((resolve) => setTimeout(resolve, RATE_DELAY_MS));
        }
        return sequential;
      })()
    : await mapWithConcurrency(sites, 3, measureSite);

  const lighthouse = results.filter((result) => result.status === "ok").length;
  const originProbes = results.filter((result) => result.status === "probe").length;
  const ok = lighthouse + originProbes;
  const failed = results.filter((result) => result.status === "failed").length;
  const outcome = runOutcome(ok, failed, sites.length);

  return NextResponse.json({
    success: outcome.success,
    partial: outcome.partial,
    skipped: outcome.skipped,
    total_sites: sites.length,
    ok,
    failed,
    lighthouse,
    origin_probes: originProbes,
    measurement_notice: originProbes > 0
      ? "Origin probes are real network measurements, not Lighthouse scores."
      : "All stored scores came from Google PageSpeed Insights.",
    results,
  }, { status: outcome.statusCode });
}

// Vercel cron invokes configured paths with GET; POST remains available for an
// authenticated manual retry through the dashboard.
export async function GET(request: Request): Promise<NextResponse> {
  return runPageSpeedCron(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return runPageSpeedCron(request);
}
