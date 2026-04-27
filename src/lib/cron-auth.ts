import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

function extractCronSecret(headers: Headers): string | null {
  const headerSecret = headers.get("x-cron-secret")?.trim();
  if (headerSecret) return headerSecret;

  const authorization = headers.get("authorization")?.trim();
  if (!authorization) return null;

  const bearerPrefix = "Bearer ";
  if (authorization.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length).trim() || null;
  }

  return null;
}

function secretsMatch(expectedSecret: string, providedSecret: string | null): boolean {
  if (!providedSecret) return false;
  const expected = Buffer.from(expectedSecret);
  const provided = Buffer.from(providedSecret);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function hasValidCronSecret(request: Request): boolean {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";
  if (!expectedSecret) return !isProduction;
  return secretsMatch(expectedSecret, extractCronSecret(request.headers));
}

export function requireCronSecret(request: Request): NextResponse | null {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  // Backward compatibility for local dev setups without CRON_SECRET.
  if (!expectedSecret) {
    if (!isProduction) return null;
    return NextResponse.json(
      { success: false, error: "Unauthorized: CRON secret is not configured" },
      { status: 401 }
    );
  }

  if (!secretsMatch(expectedSecret, extractCronSecret(request.headers))) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}
