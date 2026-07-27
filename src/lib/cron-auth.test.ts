import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/auth";
import { hasValidCronSecret, requireCronOrUser, requireCronSecret } from "./cron-auth";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllEnvs();
});

describe("cron authentication", () => {
  it("never treats a missing secret as valid", () => {
    delete process.env.CRON_SECRET;
    vi.stubEnv("NODE_ENV", "development");
    expect(hasValidCronSecret(new Request("https://example.test"))).toBe(false);
  });

  it("accepts only the configured bearer or cron header", () => {
    process.env.CRON_SECRET = "a-long-random-secret";
    expect(hasValidCronSecret(new Request("https://example.test", {
      headers: { authorization: "Bearer a-long-random-secret" },
    }))).toBe(true);
    expect(hasValidCronSecret(new Request("https://example.test", {
      headers: { "x-cron-secret": "wrong" },
    }))).toBe(false);
  });

  it("fails closed in production when CRON_SECRET is absent", () => {
    delete process.env.CRON_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    const response = requireCronSecret(new Request("https://example.test"));
    expect(response?.status).toBe(401);
  });

  it("requires the cron secret for GET requests to scheduled routes", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "dashboard-user" } } as never);

    const response = await requireCronOrUser(
      new Request("https://dashboard.test/api/cron/gsc-daily", { method: "GET" })
    );

    expect(response?.status).toBe(401);
  });

  it("keeps authenticated POST manual actions available", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "dashboard-user" } } as never);

    await expect(
      requireCronOrUser(new Request("https://dashboard.test/api/cron/gsc-daily", { method: "POST" }))
    ).resolves.toBeNull();
  });
});
