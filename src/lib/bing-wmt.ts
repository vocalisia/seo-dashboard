// Bing Webmaster Tools API client.
// Docs: https://learn.microsoft.com/en-us/bingwebmaster/getting-access
// Free + official. Returns clicks/impressions/avgPosition/CTR per query/day.
import { logger, logError } from "@/lib/logger";

export interface BingDailyStat {
  date: string;          // YYYY-MM-DD
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;           // 0-1
  position: number;
}

interface BingRankAndTraffic {
  Query?: string;
  Date?: string;
  AvgImpressionPosition?: number;
  AvgClickPosition?: number;
  Clicks?: number;
  Impressions?: number;
}

interface BingQueryStatsResponse {
  d?: BingRankAndTraffic[];
}

function getApiKey(): string | null {
  const k = process.env.BING_WMT_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

export function isBingWmtConfigured(): boolean {
  return getApiKey() !== null;
}

/** Bing represents .NET dates as `/Date(unix-millis)/`. */
function parseDotNetDate(raw: string | undefined): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const m = raw.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
  if (m) {
    const ts = Number(m[1]);
    return new Date(ts).toISOString().slice(0, 10);
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetch Bing query stats for a verified site over the last `days`.
 * - Returns empty array if no API key (graceful skip).
 * - Throws on transport/auth errors so caller can log and skip the site.
 */
export async function getBingStats(
  siteUrl: string,
  apiKey: string | null = getApiKey(),
  days: number = 30
): Promise<BingDailyStat[]> {
  if (!apiKey) {
    logger.warn({ ctx: "bing-wmt" }, "BING_WMT_API_KEY missing — skipping");
    return [];
  }
  if (!siteUrl) return [];

  // GetQueryStats accepts only the verified siteUrl. Bing returns last 6 months by default,
  // we slice client-side for `days`.
  const url = new URL("https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats");
  url.searchParams.set("siteUrl", siteUrl);
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bing WMT GetQueryStats ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as BingQueryStatsResponse;
  const rows = json.d ?? [];

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  const out: BingDailyStat[] = [];
  for (const r of rows) {
    const date = parseDotNetDate(r.Date);
    if (new Date(date) < cutoff) continue;
    const clicks = Number(r.Clicks ?? 0);
    const impressions = Number(r.Impressions ?? 0);
    const position = Number(r.AvgClickPosition ?? r.AvgImpressionPosition ?? 0);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    out.push({
      date,
      query: (r.Query || "").slice(0, 500),
      clicks,
      impressions,
      ctr: Math.round(ctr * 10000) / 10000,
      position: Math.round(position * 100) / 100,
    });
  }
  return out;
}

export async function logBingError(ctx: string, err: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  logError(ctx, err, extra);
}
