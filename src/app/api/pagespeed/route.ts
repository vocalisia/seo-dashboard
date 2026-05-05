import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PageSpeedMetrics {
  score: number;
  lcp: number;
  cls: number;
  fcp: number;
  ttfb: number;
  inp: number;
}

function extractMetrics(data: Record<string, unknown>): PageSpeedMetrics {
  const cats = data.categories as Record<string, Record<string, unknown>> | undefined;
  const score = Math.round(Number(cats?.performance?.score ?? 0) * 100);

  const audits = data.lighthouseResult
    ? (data.lighthouseResult as Record<string, unknown>).audits as Record<string, Record<string, unknown>>
    : {};

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
    inp: Math.round(numVal("interaction-to-next-paint") * 100) / 100,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");
    const siteId = searchParams.get("site_id");

    if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

    const encodedUrl = encodeURIComponent(url);
    const apiKey = process.env.PAGESPEED_API_KEY;
    const keyParam = apiKey ? `&key=${apiKey}` : "";
    const baseUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodedUrl}${keyParam}`;

    // Séquentiel pour éviter le rate-limit (1 QPS sans clé)
    const mobileRes = await fetch(`${baseUrl}&strategy=mobile`);
    await new Promise((r) => setTimeout(r, 1100));
    const desktopRes = await fetch(`${baseUrl}&strategy=desktop`);

    if (!mobileRes.ok || !desktopRes.ok) {
      const errBody = await mobileRes.text().catch(() => "");
      const isQuota = errBody.includes("429") || mobileRes.status === 429;
      return NextResponse.json({
        error: isQuota
          ? "Quota Google PageSpeed dépassé — réessaie dans 1 minute ou ajoute PAGESPEED_API_KEY dans Vercel"
          : `PageSpeed API error (${mobileRes.status})`,
      }, { status: 502 });
    }

    const [mobileData, desktopData] = await Promise.all([
      mobileRes.json() as Promise<Record<string, unknown>>,
      desktopRes.json() as Promise<Record<string, unknown>>,
    ]);

    const mobile = extractMetrics(mobileData);
    const desktop = extractMetrics(desktopData);

    if (siteId) {
      try {
        const sql = getSQL();
        await sql`
          INSERT INTO pagespeed_scores
            (site_id, url, mobile_score, desktop_score,
             mobile_lcp, desktop_lcp, mobile_cls, desktop_cls,
             mobile_fcp, desktop_fcp, mobile_ttfb, desktop_ttfb)
          VALUES
            (${parseInt(siteId, 10)}, ${url}, ${mobile.score}, ${desktop.score},
             ${mobile.lcp}, ${desktop.lcp}, ${mobile.cls}, ${desktop.cls},
             ${mobile.fcp}, ${desktop.fcp}, ${mobile.ttfb}, ${desktop.ttfb})
        `;
      } catch {
        // Non-blocking: table may not exist yet
      }
    }

    return NextResponse.json({ mobile, desktop, url });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
