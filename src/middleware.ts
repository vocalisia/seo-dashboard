import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ── HTTP Basic Auth (1ère couche avant NextAuth) ──────────────────────────
function checkBasicAuth(req: NextRequest): NextResponse | null {
  const basicUser = process.env.BASIC_AUTH_USER?.trim();
  const basicPass = process.env.BASIC_AUTH_PASS?.trim();
  if (!basicUser || !basicPass) return null; // désactivé si vars non définies

  const authHeader = req.headers.get("authorization") ?? "";
  const isBearerCron =
    authHeader.startsWith("Bearer ") ||
    req.headers.get("x-cron-secret") != null;

  if (isBearerCron) return null; // cron bypass

  if (authHeader.startsWith("Basic ")) {
    const b64 = authHeader.slice(6);
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    const [user, ...rest] = decoded.split(":");
    const pass = rest.join(":");
    if (user === basicUser && pass === basicPass) return null;
  }

  return new NextResponse("Accès restreint", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="SEO Dashboard"',
    },
  });
}

export default auth((req) => {
  // 1. Basic Auth check
  const basicDenied = checkBasicAuth(req);
  if (basicDenied) return basicDenied;

  const { pathname } = req.nextUrl;

  // Public routes — no auth needed
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/alerts/check") ||
    pathname.startsWith("/api/sync") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/autopilot/run") ||
    pathname.startsWith("/api/weekly-actions");

  const hasBearerToken =
    req.headers.get("authorization")?.startsWith("Bearer ") ||
    req.headers.get("x-cron-secret") != null;

  if (!req.auth && !isPublic && !hasBearerToken) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next|favicon\\.ico|.*\\.(?:svg|png|jpg|ico|css|js)).*)"],
};
