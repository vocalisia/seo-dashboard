/**
 * Google Trends fetcher — direct unauthenticated calls to trends.google.com.
 *
 * This mirrors what `pytrends` does in Python (no public API exists). The
 * 2-step protocol:
 *   1) GET /trends/api/explore  →  returns a token for each requested widget
 *   2) GET /trends/api/widgetdata/multiline?token=…  →  returns the time-series
 *
 * Both endpoints return JSON prefixed with ")]}'" (XSSI guard). We strip it.
 *
 * Reliability: Google rate-limits aggressively. We add a 600 ms gap between
 * consecutive fetches and accept that fetches may fail with HTTP 429. Callers
 * MUST treat errors as soft-failures and cache results in `keyword_trends`
 * for ~7 days.
 *
 * Returns 12 months of weekly relative-interest values [0..100], 53 points max.
 */

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  value: number; // 0..100
  hasData: boolean;
}

export interface TrendResult {
  keyword: string;
  geo: string;
  points: TrendPoint[];
  fetched_at: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function stripXssi(s: string): string {
  // Google prefixes JSON responses with ")]}'\n"
  if (s.startsWith(")]}'")) return s.slice(4).trim();
  if (s.startsWith(")]}")) return s.slice(3).trim();
  return s.trim();
}

interface ExploreResponse {
  widgets: Array<{
    id?: string;
    token?: string;
    request?: unknown;
  }>;
}

interface MultilineResponse {
  default?: {
    timelineData?: Array<{
      time?: string;
      formattedTime?: string;
      formattedAxisTime?: string;
      value?: number[];
      hasData?: boolean[];
    }>;
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Google Trends HTTP ${res.status}`);
  }
  const text = await res.text();
  const clean = stripXssi(text);
  return JSON.parse(clean) as T;
}

/**
 * Fetch a 12-month weekly trend series for one keyword.
 * `geo` is a 2-letter ISO country code ("" for worldwide).
 */
export async function fetchKeywordTrend(keyword: string, geo: string = ""): Promise<TrendResult> {
  const cleanGeo = geo.trim().toUpperCase();
  const req = {
    comparisonItem: [{ keyword, geo: cleanGeo, time: "today 12-m" }],
    category: 0,
    property: "",
  };
  const exploreUrl =
    "https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=" +
    encodeURIComponent(JSON.stringify(req));

  const explore = await fetchJson<ExploreResponse>(exploreUrl);
  const widget = (explore.widgets ?? []).find((w) => w.id === "TIMESERIES");
  if (!widget?.token || !widget.request) {
    throw new Error("TIMESERIES widget not found in explore response");
  }

  const widgetUrl =
    "https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0" +
    `&req=${encodeURIComponent(JSON.stringify(widget.request))}` +
    `&token=${encodeURIComponent(widget.token)}`;

  const multi = await fetchJson<MultilineResponse>(widgetUrl);
  const series = multi.default?.timelineData ?? [];

  const points: TrendPoint[] = series.map((row) => {
    const epoch = Number(row.time ?? 0);
    const d = new Date(epoch * 1000);
    const date = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
    const value = Array.isArray(row.value) && row.value.length > 0 ? Number(row.value[0]) : 0;
    const hasData =
      Array.isArray(row.hasData) && row.hasData.length > 0 ? Boolean(row.hasData[0]) : value > 0;
    return { date, value: Number.isFinite(value) ? value : 0, hasData };
  });

  return {
    keyword,
    geo: cleanGeo,
    points,
    fetched_at: new Date().toISOString(),
  };
}
