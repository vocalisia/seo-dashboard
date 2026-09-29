import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSQL: vi.fn(),
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: mocks.getSQL }));
vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue({});
});

describe("portfolio overview GSC totals", () => {
  it.each(["summary", "gsc"])("uses property totals for %s", async (type) => {
    const sql = vi.fn().mockResolvedValue([]);
    mocks.getSQL.mockReturnValue(sql);

    const response = await GET(new NextRequest(
      `http://localhost/api/overview?type=${type}&days=28&nocache=1`,
    ));

    expect(response.status).toBe(200);
    expect(sql).toHaveBeenCalledTimes(1);
    const statement = String(sql.mock.calls[0][0]);
    expect(statement).toContain("FROM search_console_daily_totals");
    expect(statement).not.toContain("FROM search_console_data");
    expect(statement).not.toContain("LEFT JOIN pos");
  });
});

describe("portfolio overview GA4 complete-day window", () => {
  it("uses yesterday for a one-day request", async () => {
    const sql = vi.fn().mockResolvedValue([]);
    mocks.getSQL.mockReturnValue(sql);

    const response = await GET(new NextRequest(
      "http://localhost/api/overview?type=ga4&days=1&nocache=1",
    ));

    expect(response.status).toBe(200);
    expect(sql.mock.calls[0].slice(1)).toEqual([1, 1]);
  });
});
