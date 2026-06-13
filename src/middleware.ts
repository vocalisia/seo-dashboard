import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Constant-time secret comparison (Edge-runtime safe — no Node crypto module).
function secretsMatch(expected: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

// True ONLY if the request carries a valid CRON_SECRET (via Bearer or x-cron-secret header).
// Previously this returned true for ANY Bearer token — a critical bypass.
function hasValidCronSecret(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const headerSecret = req.headers.get("x-cron-secret")?.trim();
  if (secretsMatch(cronSecret, headerSecret)) return true;

  const auth = req.headers.get("authorization")?.trim();
  if (auth?.startsWith("Bearer ")) {
    const bearer = auth.slice(7).trim();
    if (secretsMatch(cronSecret, bearer)) return true;
  }

  return false;
}

function hasLocalDevBasicAuth(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const host = req.nextUrl.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocalhost) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Basic ")) return false;
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
  const [user, ...rest] = decoded.split(":");
  const expectedUser = process.env.LOCAL_BASIC_AUTH_USER ?? "1983";
  const expectedPass = process.env.LOCAL_BASIC_AUTH_PASS ?? "1983";
  return user === expectedUser && rest.join(":") === expectedPass;
}

// HTTP Basic Auth (1st layer before NextAuth)
function checkBasicAuth(req: NextRequest): NextResponse | null {
  const basicUser = process.env.BASIC_AUTH_USER?.trim();
  const basicPass = process.env.BASIC_AUTH_PASS?.trim();
  if (!basicUser || !basicPass) return null;

  // Valid CRON_SECRET bypasses Basic Auth (legitimate cron / API access)
  if (hasValidCronSecret(req)) return null;

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Basic ")) {
    const b64 = authHeader.slice(6);
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    const [user, ...rest] = decoded.split(":");
    const pass = rest.join(":");
    if (user === basicUser && pass === basicPass) return null;
    if (hasLocalDevBasicAuth(req)) return null;
  }

  return new NextResponse("Accès restreint", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="SEO Dashboard"',
    },
  });
}

export default auth((req) => {
  // 1. Basic Auth check (also lets valid cron-secret through)
  const { pathname } = req.nextUrl;

  // Truly public routes — no session/cron secret needed
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth");

  if (isPublic) {
    return NextResponse.next();
  }

  // Basic Auth stays as a fallback outer gate for unauthenticated requests.
  // A valid NextAuth session must not be blocked a second time.
  if (!req.auth) {
    const basicDenied = checkBasicAuth(req);
    if (basicDenied) return basicDenied;
  }

  // Routes that require CRON_SECRET (cron jobs, internal automation)
  const isCronProtected =
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/alerts/check") ||
    pathname.startsWith("/api/sync") ||
    pathname.startsWith("/api/reports/generate") ||
    pathname.startsWith("/api/autopilot/weekly") ||
    pathname.startsWith("/api/autopilot/verify-urls") ||
    pathname.startsWith("/api/competitors/weekly") ||
    pathname.startsWith("/api/pagespeed/weekly") ||
    pathname.startsWith("/api/autopilot/run") ||
    pathname.startsWith("/api/weekly-actions");

  // Allow if has valid cron secret on cron-protected routes
  if (isCronProtected && hasValidCronSecret(req)) {
    return NextResponse.next();
  }

  if (hasLocalDevBasicAuth(req)) {
    return NextResponse.next();
  }

  // Reject cron-protected routes without valid secret AND without session
  if (isCronProtected && !req.auth) {
    return new NextResponse(
      JSON.stringify({ success: false, error: "Unauthorized: cron secret or user session required" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Other routes: need session
  if (!req.auth && !isPublic) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next|favicon\\.ico|.*\\.(?:svg|png|jpg|ico|css|js)).*)"],
};
