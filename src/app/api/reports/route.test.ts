import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/db", () => ({ getSQL: () => mocks.sql }));

import { GET } from "./route";

describe("reports list route contract", () => {
  beforeEach(() => {
    mocks.requireApiSession.mockReset().mockResolvedValue({
      session: { user: { email: "tester@example.com" } },
      unauthorized: null,
    });
    mocks.sql.mockReset();
  });

  it("returns the report array directly on success", async () => {
    const reports = [{
      id: 1,
      site_id: 7,
      week_start: "2026-08-10",
      summary: "Résumé",
      recommendations: "Actions",
      top_opportunities: [],
      created_at: "2026-08-15T12:00:00.000Z",
      site_name: "Example",
      site_url: "https://example.com",
    }];
    mocks.sql.mockResolvedValue(reports);

    const response = await GET(new NextRequest("http://dashboard.test/api/reports"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(reports);
  });

  it("rejects an invalid siteId before querying the database", async () => {
    const response = await GET(new NextRequest(
      "http://dashboard.test/api/reports?siteId=all",
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns success false with HTTP 500 on a database error", async () => {
    mocks.sql.mockRejectedValue(new Error("Reports unavailable"));

    const response = await GET(new NextRequest("http://dashboard.test/api/reports"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Reports unavailable",
    });
  });

  it("preserves the authentication response", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      ),
    });

    const response = await GET(new NextRequest("http://dashboard.test/api/reports"));

    expect(response.status).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
