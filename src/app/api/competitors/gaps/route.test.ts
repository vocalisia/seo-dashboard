import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/db", () => ({ getSQL: () => mocks.sql }));

import { GET } from "./route";

function request(siteId: string): NextRequest {
  return new NextRequest(`http://dashboard.test/api/competitors/gaps?siteId=${siteId}`);
}

describe("competitor gaps source truth", () => {
  beforeEach(() => {
    mocks.requireApiSession.mockResolvedValue({ session: { user: { email: "tester@example.com" } }, unauthorized: null });
    mocks.sql.mockReset();
  });

  it("requires authentication", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    });
    const response = await GET(request("7"));
    expect(response.status).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("rejects malformed site IDs", async () => {
    const response = await GET(request("7 OR 1=1"));
    expect(response.status).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns null volume and an unvalidated zero position without fabricating metrics", async () => {
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = Array.from(strings).join("?");
      if (text.includes("information_schema.tables")) return Promise.resolve([{ cnt: 1 }]);
      if (text.includes("FROM competitor_research cr")) {
        return Promise.resolve([{
          keyword: "actions suisses à surveiller",
          competitor_domain: "cash.ch",
          competitor_position: 0,
          estimated_volume: 0,
        }]);
      }
      if (text.includes("query = ANY")) return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const response = await GET(request("7"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.gaps[0]).toMatchObject({
      keyword: "actions suisses à surveiller",
      volume: null,
      competitor_positions: [{ domain: "cash.ch", pos: 0 }],
    });
  });
});
