import { describe, expect, it } from "vitest";
import {
  internalDashboardUrl,
  resolveInternalDashboardOrigin,
} from "./internal-api-origin";

describe("internal dashboard origin", () => {
  it("prefers the stable Vercel production origin", () => {
    const request = new Request("https://preview.example.test/api/cron/gsc-daily");
    expect(resolveInternalDashboardOrigin(request, {
      NODE_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "seo-dashboard-one.vercel.app",
    })).toBe("https://seo-dashboard-one.vercel.app");
  });

  it("uses the trusted Vercel request origin when system variables are unavailable", () => {
    const request = new Request("https://seo-dashboard-abc.vercel.app/api/cron/gsc-daily");
    expect(internalDashboardUrl(request, "/api/sync?days=7", {
      NODE_ENV: "production",
    })).toBe("https://seo-dashboard-abc.vercel.app/api/sync?days=7");
  });

  it("ignores a localhost auth URL in production", () => {
    const request = new Request("https://seo-dashboard-abc.vercel.app/api/cron/gsc-daily");
    expect(resolveInternalDashboardOrigin(request, {
      NODE_ENV: "production",
      NEXTAUTH_URL: "http://localhost:3000",
    })).toBe("https://seo-dashboard-abc.vercel.app");
  });

  it("rejects an arbitrary production host instead of leaking the cron secret", () => {
    const request = new Request("https://attacker.example/api/cron/gsc-daily");
    expect(() => resolveInternalDashboardOrigin(request, {
      NODE_ENV: "production",
    })).toThrow("Dashboard internal origin is not configured");
  });

  it("allows the request origin during local development", () => {
    const request = new Request("http://127.0.0.1:3001/api/cron/gsc-daily");
    expect(resolveInternalDashboardOrigin(request, {
      NODE_ENV: "development",
    })).toBe("http://127.0.0.1:3001");
  });
});
