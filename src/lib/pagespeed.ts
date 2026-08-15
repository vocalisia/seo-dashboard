import { fetchPublicUrl } from "@/lib/safe-url";

export interface PageSpeedMetrics {
  score: number;
  lcp: number;
  cls: number;
  fcp: number;
  ttfb: number;
  inp: number;
}

export interface OriginProbeMetrics {
  status_code: number;
  ok: boolean;
  ttfb: number;
  total: number;
  transfer_kb: number;
  transfer_capped: boolean;
  content_type: string | null;
  compression: string | null;
  cache_control: string | null;
  final_url: string;
}

export interface OriginProbeResult {
  mobile: OriginProbeMetrics;
  desktop: OriginProbeMetrics;
}

const MAX_PROBE_BYTES = 5 * 1024 * 1024;

const USER_AGENTS = {
  mobile: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 SEO-Dashboard-Probe/1.0",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 SEO-Dashboard-Probe/1.0",
} as const;

function roundedSeconds(milliseconds: number): number {
  return Math.round((milliseconds / 1000) * 1000) / 1000;
}

function lighthouseRoot(data: Record<string, unknown>): Record<string, unknown> {
  const nested = data.lighthouseResult;
  return nested && typeof nested === "object"
    ? nested as Record<string, unknown>
    : data;
}

export function extractPageSpeedMetrics(data: Record<string, unknown>): PageSpeedMetrics {
  const root = lighthouseRoot(data);
  const categories = root.categories as Record<string, Record<string, unknown>> | undefined;
  const audits = (root.audits ?? {}) as Record<string, Record<string, unknown>>;
  const numericSeconds = (key: string): number => {
    const value = Number(audits[key]?.numericValue);
    return Number.isFinite(value) ? Math.round((value / 1000) * 1000) / 1000 : 0;
  };
  const rawScore = Number(categories?.performance?.score);

  return {
    score: Number.isFinite(rawScore) ? Math.round(rawScore * 100) : 0,
    lcp: numericSeconds("largest-contentful-paint"),
    cls: Math.round(Number(audits["cumulative-layout-shift"]?.numericValue ?? 0) * 1000) / 1000,
    fcp: numericSeconds("first-contentful-paint"),
    ttfb: numericSeconds("server-response-time"),
    inp: numericSeconds("interaction-to-next-paint"),
  };
}

async function readResponseBody(response: Response): Promise<{ bytes: number; capped: boolean }> {
  if (!response.body) return { bytes: 0, capped: false };
  const reader = response.body.getReader();
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { bytes, capped: false };
      bytes += value.byteLength;
      if (bytes >= MAX_PROBE_BYTES) {
        await reader.cancel();
        return { bytes: MAX_PROBE_BYTES, capped: true };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function runOriginProbe(url: string, strategy: keyof typeof USER_AGENTS): Promise<OriginProbeMetrics> {
  const startedAt = performance.now();
  const response = await fetchPublicUrl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-encoding": "gzip, br",
      "user-agent": USER_AGENTS[strategy],
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }, 5);
  const headersAt = performance.now();
  const body = await readResponseBody(response);
  const completedAt = performance.now();

  return {
    status_code: response.status,
    ok: response.ok,
    ttfb: roundedSeconds(headersAt - startedAt),
    total: roundedSeconds(completedAt - startedAt),
    transfer_kb: Math.round((body.bytes / 1024) * 10) / 10,
    transfer_capped: body.capped,
    content_type: response.headers.get("content-type"),
    compression: response.headers.get("content-encoding"),
    cache_control: response.headers.get("cache-control"),
    final_url: response.url || url,
  };
}

export async function runOriginPerformanceProbe(url: string): Promise<OriginProbeResult> {
  const [mobile, desktop] = await Promise.all([
    runOriginProbe(url, "mobile"),
    runOriginProbe(url, "desktop"),
  ]);
  return { mobile, desktop };
}
