import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSQL: vi.fn(),
  requireApiSession: vi.fn(),
  isLocalDevDemoMode: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: mocks.getSQL }));
vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/local-dev", () => ({ isLocalDevDemoMode: mocks.isLocalDevDemoMode }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue({});
  mocks.isLocalDevDemoMode.mockReturnValue(false);
});

describe("site GA4 complete-day window", () => {
  it("reads yesterday when one day is requested", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    mocks.getSQL.mockReturnValue(sql);

    const response = await GET(new NextRequest(
      "http://localhost/api/analytics?siteId=7&days=1",
    ));

    expect(response.status).toBe(200);
    expect(sql.mock.calls[0].slice(1)).toEqual([7, 1]);
    expect(String(sql.mock.calls[0][0])).toContain("date < CURRENT_DATE");
  });
});
