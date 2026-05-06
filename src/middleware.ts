import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public routes — no auth needed
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    // Cron/webhook routes handle their own auth via CRON_SECRET or Bearer token
    pathname.startsWith("/api/alerts/check") ||
    pathname.startsWith("/api/sync") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/autopilot/run") ||
    pathname.startsWith("/api/weekly-actions");

  // Also pass through requests carrying a Bearer token (route handlers verify the secret)
  const hasBearerToken = req.headers.get("authorization")?.startsWith("Bearer ") ||
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
