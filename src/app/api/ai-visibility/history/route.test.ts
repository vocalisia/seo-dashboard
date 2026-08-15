import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getSQL: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/db", () => ({ getSQL: mocks.getSQL }));

import { GET } from "./route";

function request(siteId?: number): NextRequest {
  const suffix = siteId ? `?siteId=${siteId}` : "";
  return new NextRequest(`http://dashboard.test/api/ai-visibility/history${suffix}`);
}

describe("AI visibility history route authentication", () => {
  beforeEach(() => {
    mocks.requireApiSession.mockReset();
    mocks.getSQL.mockReset();
    mocks.sql.mockReset();
    mocks.requireApiSession.mockResolvedValue({
      session: { user: { email: "tester@example.com" } },
      unauthorized: null,
    });
    mocks.getSQL.mockReturnValue(mocks.sql);
  });

  it("returns the shared 401 response before touching the database", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(mocks.getSQL).not.toHaveBeenCalled();
  });

  it("returns history for an authenticated session", async () => {
    const history = [{ score: 60, created_at: "2026-08-15T12:00:00.000Z" }];
    mocks.sql.mockResolvedValueOnce([]).mockResolvedValueOnce(history);

    const response = await GET(request(7));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, history });
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });
});
