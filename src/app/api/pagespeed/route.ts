import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { assertPublicHttpUrl } from "@/lib/safe-url";
import { requireApiSession } from "@/lib/api-auth";
import { extractPageSpeedMetrics, runOriginPerformanceProbe } from "@/lib/pagespeed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CachedPageSpeedRow {
  url: string;
  mobile_score: number;
  desktop_score: number;
  mobile_lcp: number;
  desktop_lcp: number;
  mobile_cls: number;
  desktop_cls: number;
  mobile_fcp: number;
  desktop_fcp: number;
  mobile_ttfb: number;
  desktop_ttfb: number;
  checked_at: string;
}

async function readCachedMeasurement(siteId: number) {
  try {
    const sql = getSQL();
    const rows = await sql`
      SELECT url, mobile_score, desktop_score,
        mobile_lcp, desktop_lcp, mobile_cls, desktop_cls,
        mobile_fcp, desktop_fcp, mobile_ttfb, desktop_ttfb,
        checked_at::text
      FROM pagespeed_scores
      WHERE site_id = ${siteId}
      ORDER BY checked_at DESC
      LIMIT 1
    ` as CachedPageSpeedRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      mobile: { score: Number(row.mobile_score), lcp: Number(row.mobile_lcp), cls: Number(row.mobile_cls), fcp: Number(row.mobile_fcp), ttfb: Number(row.mobile_ttfb), inp: 0 },
      desktop: { score: Number(row.desktop_score), lcp: Number(row.desktop_lcp), cls: Number(row.desktop_cls), fcp: Number(row.desktop_fcp), ttfb: Number(row.desktop_ttfb), inp: 0 },
      url: row.url,
      measurement_status: "cache" as const,
      checked_at: row.checked_at,
    };
  } catch {
    return null;
  }
}

async function fallbackMeasurementResponse(
  siteId: number | null,
  url: string,
  notice: string,
): Promise<NextResponse | null> {
  if (siteId) {
    const cached = await readCachedMeasurement(siteId);
    if (cached) {
      return NextResponse.json({
        ...cached,
        measurement_notice: notice,
        live_measurement_status: "unavailable",
      });
    }
  }

  try {
    const originProbe = await runOriginPerformanceProbe(url);
    return NextResponse.json({
      url,
      measurement_status: "origin_probe",
      checked_at: new Date().toISOString(),
      measurement_notice: `${notice} Un diagnostic réseau mobile et desktop réel est affiché à la place; il ne s’agit pas d’un score Lighthouse.`,
      live_measurement_status: "unavailable",
      origin_probe: originProbe,
    });
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");
    const siteId = searchParams.get("site_id");
    const cacheOnly = searchParams.get("mode") === "cache";
    const numericSiteId = siteId && /^[1-9]\d*$/.test(siteId) ? Number(siteId) : null;

    if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
    if (siteId && !numericSiteId) return NextResponse.json({ error: "Invalid site_id" }, { status: 400 });
    let safeUrl: URL;
    try {
      safeUrl = await assertPublicHttpUrl(url);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid URL" },
        { status: 400 },
      );
    }

    const normalizedUrl = safeUrl.toString();
    if (cacheOnly) {
      if (!numericSiteId) return NextResponse.json({ error: "site_id required for cache mode" }, { status: 400 });
      const cached = await readCachedMeasurement(numericSiteId);
      if (!cached) return NextResponse.json({ error: "Aucune mesure PageSpeed sauvegardée pour ce site" }, { status: 404 });
      return NextResponse.json(cached);
    }
    const encodedUrl = encodeURIComponent(normalizedUrl);
    const apiKey = process.env.PAGESPEED_API_KEY;
    const keyParam = apiKey ? `&key=${apiKey}` : "";
    const baseUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodedUrl}${keyParam}`;

    const fallbackFor = async (failedResponse: Response) => {
      const errBody = await failedResponse.text().catch(() => "");
      const isQuota = failedResponse.status === 429 || errBody.includes("429");
      const notice = isQuota
        ? "Google limite temporairement les mesures PageSpeed live."
        : `Mesure PageSpeed live indisponible (HTTP ${failedResponse.status}).`;
      const fallback = await fallbackMeasurementResponse(numericSiteId, normalizedUrl, notice);
      if (fallback) return fallback;
      return NextResponse.json(
        { error: isQuota ? "Google PageSpeed limite temporairement les requêtes et le diagnostic de secours a échoué." : `PageSpeed API error (${failedResponse.status})` },
        { status: isQuota ? 429 : 502, headers: isQuota ? { "Retry-After": "60" } : undefined },
      );
    };

    // Séquentiel pour éviter le rate-limit public et arrêt immédiat si le premier appel échoue.
    const mobileRes = await fetch(`${baseUrl}&strategy=mobile`, { signal: AbortSignal.timeout(24000) });
    if (!mobileRes.ok) return fallbackFor(mobileRes);
    await new Promise((r) => setTimeout(r, 1100));
    const desktopRes = await fetch(`${baseUrl}&strategy=desktop`, { signal: AbortSignal.timeout(24000) });
    if (!desktopRes.ok) return fallbackFor(desktopRes);

    const [mobileData, desktopData] = await Promise.all([
      mobileRes.json() as Promise<Record<string, unknown>>,
      desktopRes.json() as Promise<Record<string, unknown>>,
    ]);

    const mobile = extractPageSpeedMetrics(mobileData);
    const desktop = extractPageSpeedMetrics(desktopData);

    if (numericSiteId) {
      try {
        const sql = getSQL();
        await sql`
          INSERT INTO pagespeed_scores
            (site_id, url, mobile_score, desktop_score,
             mobile_lcp, desktop_lcp, mobile_cls, desktop_cls,
             mobile_fcp, desktop_fcp, mobile_ttfb, desktop_ttfb)
          VALUES
            (${numericSiteId}, ${normalizedUrl}, ${mobile.score}, ${desktop.score},
             ${mobile.lcp}, ${desktop.lcp}, ${mobile.cls}, ${desktop.cls},
             ${mobile.fcp}, ${desktop.fcp}, ${mobile.ttfb}, ${desktop.ttfb})
        `;
      } catch {
        // Non-blocking: table may not exist yet
      }
    }

    return NextResponse.json({ mobile, desktop, url: normalizedUrl, measurement_status: "live", checked_at: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    const isTimeout = err instanceof Error && /timeout|timed out|abort/i.test(`${err.name} ${err.message}`);
    const rawSiteId = new URL(req.url).searchParams.get("site_id");
    const fallbackSiteId = rawSiteId && /^[1-9]\d*$/.test(rawSiteId) ? Number(rawSiteId) : null;
    const fallback = await fallbackMeasurementResponse(
      fallbackSiteId,
      new URL(req.url).searchParams.get("url") ?? "",
      isTimeout
        ? "Google PageSpeed n'a pas répondu dans le délai de sécurité."
        : "La mesure PageSpeed live est indisponible.",
    );
    if (fallback) return fallback;
    return NextResponse.json({ error: isTimeout ? "Google PageSpeed n'a pas répondu dans le délai de sécurité. Réessaie plus tard." : "Internal server error" }, { status: isTimeout ? 504 : 500 });
  }
}
