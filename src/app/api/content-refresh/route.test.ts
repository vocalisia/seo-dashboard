import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  askAICached: vi.fn(),
  requireApiSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getSQL: () => mocks.sql }));
vi.mock("@/lib/ai-cache", () => ({ askAICached: mocks.askAICached }));
vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));

import { GET, POST } from "./route";

const page = {
  page: "https://example.com/article",
  clicks_now: 10,
  clicks_prev: 25,
  pos_now: "12.50",
  pos_prev: "7.20",
  clicks_decline: 15,
  position_decline: "5.30",
};

const suggestion = {
  id: 3,
  page_url: page.page,
  suggestions: { title: "Nouveau titre" },
  status: "pending",
  created_at: "2026-08-15T12:00:00.000Z",
};

function sqlText(strings: TemplateStringsArray): string {
  return Array.from(strings).join("?").replace(/\s+/g, " ").trim();
}

describe("content refresh route contract", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.askAICached.mockReset();
    mocks.requireApiSession.mockReset();
    mocks.requireApiSession.mockResolvedValue({
      session: { user: { email: "tester@example.com" } },
      unauthorized: null,
    });
  });

  it("rejects unauthenticated requests before validation or database access", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(new NextRequest("http://dashboard.test/api/content-refresh?site_id=all"));

    expect(response.status).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns pages and persisted suggestions using the UI contract", async () => {
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const query = sqlText(strings);
      if (query.includes("CREATE TABLE IF NOT EXISTS content_refresh")) return Promise.resolve([]);
      if (query.includes("WITH current_period AS")) return Promise.resolve([page]);
      if (query.includes("SELECT id, page_url, suggestions")) return Promise.resolve([suggestion]);
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const response = await GET(new NextRequest(
      "http://dashboard.test/api/content-refresh?site_id=7",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      pages: [page],
      suggestions: [suggestion],
    });
  });

  it("returns a real validation failure for an invalid site id", async () => {
    const response = await GET(new NextRequest(
      "http://dashboard.test/api/content-refresh?site_id=all",
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("positive integer"),
    });
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it("returns the persisted refresh object after POST success", async () => {
    mocks.askAICached.mockResolvedValue({ reply: JSON.stringify(suggestion.suggestions) });
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const query = sqlText(strings);
      if (query.includes("CREATE TABLE IF NOT EXISTS content_refresh")) return Promise.resolve([]);
      if (query.includes("SELECT name FROM sites")) return Promise.resolve([{ name: "Example" }]);
      if (query.includes("WITH current_period AS")) {
        return Promise.resolve([{
          clicks_prev: 25,
          clicks_now: 10,
          pos_prev: "7.20",
          pos_now: "12.50",
        }]);
      }
      if (query.includes("INSERT INTO content_refresh")) return Promise.resolve([suggestion]);
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const response = await POST(new NextRequest(
      "http://dashboard.test/api/content-refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site_id: 7, page_url: page.page }),
      },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, refresh: suggestion });
  });

  it("never labels an internal POST error as success", async () => {
    mocks.sql.mockRejectedValue(new Error("Database unavailable"));

    const response = await POST(new NextRequest(
      "http://dashboard.test/api/content-refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site_id: 7, page_url: page.page }),
      },
    ));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Database unavailable",
    });
  });
});
