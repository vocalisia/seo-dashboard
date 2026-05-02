export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { requireCronOrUser } from "@/lib/cron-auth";

interface Site {
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
  mobile_lcp: number;
  desktop_lcp: number;
  status: string;
  error?: string;
}

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

async function fetchPageSpeed(url: string, strategy: "mobile" | "desktop"): Promise<PageSpeedMetrics> {
  const encodedUrl = encodeURIComponent(url);
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodedUrl}&strategy=${strategy}`;

  const res = await fetch(apiUrl);

  if (!res.ok) {
    throw new Error(`PageSpeed API ${strategy} returned ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return extractMetrics(data);
}

export async function POST(request: Request) {
  const unauthorized = await requireCronOrUser(request);
  if (unauthorized) return unauthorized;

  const sql = getSQL();

  try {
    const sites = (await sql`
      SELECT id, name, url FROM sites WHERE is_active = true ORDER BY id
    `) as Site[];

    if (sites.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No active sites found",
        results: [],
      });
    }

    const results: SiteResult[] = [];

    for (const site of sites) {
      try {
        const [mobile, desktop] = await Promise.all([
          fetchPageSpeed(site.url, "mobile"),
          fetchPageSpeed(site.url, "desktop"),
        ]);

        await sql`
          INSERT INTO pagespeed_scores
            (site_id, url, mobile_score, desktop_score,
             mobile_lcp, desktop_lcp, mobile_cls, desktop_cls,
             mobile_fcp, desktop_fcp, mobile_ttfb, desktop_ttfb)
          VALUES
            (${site.id}, ${site.url}, ${mobile.score}, ${desktop.score},
             ${mobile.lcp}, ${desktop.lcp}, ${mobile.cls}, ${desktop.cls},
             ${mobile.fcp}, ${desktop.fcp}, ${mobile.ttfb}, ${desktop.ttfb})
        `;

        results.push({
          site_id: site.id,
          site_name: site.name,
          url: site.url,
          mobile_score: mobile.score,
          desktop_score: desktop.score,
          mobile_lcp: mobile.lcp,
          desktop_lcp: desktop.lcp,
          status: "ok",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({
          site_id: site.id,
          site_name: site.name,
          url: site.url,
          mobile_score: 0,
          desktop_score: 0,
          mobile_lcp: 0,
          desktop_lcp: 0,
          status: "failed",
          error: message,
        });
      }
    }

    const ok = results.filter((r) => r.status === "ok").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      success: true,
      total_sites: sites.length,
      ok,
      failed,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
