import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getSQL: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/db", () => ({ getSQL: mocks.getSQL }));

import { GET, POST } from "./route";

describe("autopilot scheduled publication lock", () => {
  beforeEach(() => {
    mocks.requireApiSession.mockReset();
    mocks.getSQL.mockReset();
    mocks.sql.mockReset();
    mocks.requireApiSession.mockResolvedValue({
      session: { user: { email: "tester@example.com" } },
      unauthorized: null,
    });
    mocks.getSQL.mockReturnValue(mocks.sql);
    mocks.sql.mockResolvedValue([]);
    vi.stubEnv("ALLOW_SCHEDULED_PUBLICATION", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when the server has not explicitly unlocked scheduling", async () => {
    mocks.sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: true, updated_at: "2026-08-15T12:00:00.000Z" }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, enabled: false, locked: true });
  });

  it("refuses an enable request while manual validation is required", async () => {
    const response = await POST(new NextRequest("http://dashboard.test/api/autopilot/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, enabled: false, locked: true });
  });

  it("checks authentication before touching configuration", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getSQL).not.toHaveBeenCalled();
  });
});
