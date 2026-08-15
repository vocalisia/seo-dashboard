import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCronOrUser: vi.fn(),
  getSQL: vi.fn(),
}));

vi.mock("@/lib/cron-auth", () => ({ requireCronOrUser: mocks.requireCronOrUser }));
vi.mock("@/lib/db", () => ({ getSQL: mocks.getSQL }));

import { POST } from "./route";

describe("weekly autopilot publication guard", () => {
  beforeEach(() => {
    mocks.requireCronOrUser.mockReset();
    mocks.getSQL.mockReset();
    mocks.requireCronOrUser.mockResolvedValue(null);
    vi.stubEnv("ALLOW_SCHEDULED_PUBLICATION", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a truthful skipped result without touching the database", async () => {
    const response = await POST(new Request("http://dashboard.test/api/autopilot/weekly", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      skipped: true,
      manual_review_required: true,
      published: 0,
      failed: 0,
      total_runs: 0,
    });
    expect(mocks.getSQL).not.toHaveBeenCalled();
  });

  it("keeps cron and user authentication as the first gate", async () => {
    mocks.requireCronOrUser.mockResolvedValueOnce(
      NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    );

    const response = await POST(new Request("http://dashboard.test/api/autopilot/weekly", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.getSQL).not.toHaveBeenCalled();
  });
});
