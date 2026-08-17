type RuntimeEnvironment = Record<string, string | undefined>;

function asOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isTrustedVercelOrigin(url: URL): boolean {
  return url.protocol === "https:" && (
    url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app")
  );
}

function isProductionSafeConfiguredOrigin(origin: string): boolean {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  return url.protocol === "https:"
    && hostname !== "localhost"
    && hostname !== "127.0.0.1"
    && hostname !== "::1"
    && hostname !== "[::1]";
}

/**
 * Resolve the dashboard origin for authenticated server-to-server calls.
 * Production never falls back to localhost and never forwards CRON_SECRET to
 * an arbitrary Host header supplied by a caller.
 */
export function resolveInternalDashboardOrigin(
  request: Request,
  env: RuntimeEnvironment = process.env,
): string {
  const configured = [
    env.DASHBOARD_INTERNAL_ORIGIN,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.NEXT_PUBLIC_SITE_URL,
    env.VERCEL_URL,
    env.NEXTAUTH_URL,
    env.AUTH_URL,
  ];

  for (const candidate of configured) {
    const origin = asOrigin(candidate);
    if (origin && (
      env.NODE_ENV !== "production" || isProductionSafeConfiguredOrigin(origin)
    )) return origin;
  }

  const requestUrl = new URL(request.url);
  if (env.NODE_ENV !== "production") return requestUrl.origin;
  if (isTrustedVercelOrigin(requestUrl)) return requestUrl.origin;

  throw new Error("Dashboard internal origin is not configured");
}

export function internalDashboardUrl(
  request: Request,
  pathname: string,
  env: RuntimeEnvironment = process.env,
): string {
  if (!pathname.startsWith("/")) {
    throw new Error("Internal dashboard path must start with /");
  }
  return new URL(pathname, `${resolveInternalDashboardOrigin(request, env)}/`).toString();
}
