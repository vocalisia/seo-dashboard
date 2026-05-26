import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";

// Si un package-lock.json existe plus haut (ex. C:\Users\cohen.000), Next 15+ peut
// inférer une mauvaise racine → Turbopack sert des chunks incorrects (page blanche).
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  // HSTS — force HTTPS for 1 year + subdomains + preload
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Prevent MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Restrict referrer
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Block opt-out telemetry-style features
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      // OpenAI DALL-E 3 CDN
      { protocol: "https", hostname: "oaidalleapiprodscus.blob.core.windows.net" },
      { protocol: "https", hostname: "*.openai.com" },
      // Gemini / Google image CDN
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "*.google.com" },
      // Pollinations Flux
      { protocol: "https", hostname: "image.pollinations.ai" },
      // Vercel Blob
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Only run Sentry's webpack plugin in CI / when org+project+token are present
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
  // Skip source map upload when DSN missing (local dev / preview without Sentry)
  sourcemaps: {
    disable: !process.env.SENTRY_DSN,
  },
});
