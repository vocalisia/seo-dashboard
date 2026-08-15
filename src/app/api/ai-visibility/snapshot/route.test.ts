import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  getSQL: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/db", () => ({ getSQL: mocks.getSQL }));

import { POST } from "./route";

function request(
  body = JSON.stringify({ siteId: 7, score: 60, results: [] })
): NextRequest {
  return new NextRequest("http://dashboard.test/api/ai-visibility/snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("AI visibility snapshot route authentication", () => {
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
  });

  it("returns the shared 401 response before touching the database", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    });

    const response = await POST(request("{"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(mocks.getSQL).not.toHaveBeenCalled();
  });

  it("stores a snapshot for an authenticated session", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.sql).toHaveBeenCalledTimes(2);
  });
});
