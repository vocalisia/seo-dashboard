import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initDB: vi.fn(),
  sql: vi.fn(),
  askAICached: vi.fn(),
  requireCronOrUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  initDB: mocks.initDB,
  getSQL: () => mocks.sql,
}));
vi.mock("@/lib/ai-cache", () => ({ askAICached: mocks.askAICached }));
vi.mock("@/lib/cron-auth", () => ({ requireCronOrUser: mocks.requireCronOrUser }));

import { POST } from "./route";

const site = { id: 7, name: "Example", url: "https://example.com" };

function request(body: unknown): Request {
  return new Request("http://dashboard.test/api/reports/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sqlText(strings: TemplateStringsArray): string {
  return Array.from(strings).join("?").replace(/\s+/g, " ").trim();
}

describe("reports generation route status contract", () => {
  beforeEach(() => {
    mocks.initDB.mockReset().mockResolvedValue(undefined);
    mocks.sql.mockReset();
    mocks.askAICached.mockReset();
    mocks.requireCronOrUser.mockReset().mockResolvedValue(null);
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ALERT_EMAIL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns HTTP 422 and success false when the site has no reportable data", async () => {
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const query = sqlText(strings);
      if (query.includes("SELECT id, name, url FROM sites")) return Promise.resolve([site]);
      if (query.includes("AS start_date") && query.includes("AS end_date")) {
        return Promise.resolve([{ start_date: "2026-08-04", end_date: "2026-08-10" }]);
      }
      if (query.includes("FROM search_console_query_data scq")) return Promise.resolve([]);
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const response = await POST(request({ site_id: site.id }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      success: false,
      summary: { total: 1, generated: 0, no_data: 1, failed: 0 },
      results: [{
        site_id: site.id,
        site: site.name,
        status: "no_data",
        reason: expect.stringContaining("Aucune donnée GSC"),
      }],
    });
  });

  it("returns HTTP 500 and exposes the per-site internal failure", async () => {
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const query = sqlText(strings);
      if (query.includes("SELECT id, name, url FROM sites")) return Promise.resolve([site]);
      if (query.includes("AS start_date") && query.includes("AS end_date")) {
        return Promise.resolve([{ start_date: "2026-08-04", end_date: "2026-08-10" }]);
      }
      if (query.includes("FROM search_console_query_data scq")) {
        return Promise.reject(new Error("GSC table unavailable"));
      }
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const response = await POST(request({ site_id: site.id }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      success: false,
      summary: { total: 1, generated: 0, no_data: 0, failed: 1 },
      results: [{
        site_id: site.id,
        site: site.name,
        status: "error",
        error: "GSC table unavailable",
      }],
    });
    expect(body.error).toContain("Example (#7): GSC table unavailable");
  });

  it("rejects an invalid targeted site id instead of running every site", async () => {
    const response = await POST(request({ site_id: "7" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "site_id must be a positive integer",
    });
    expect(mocks.initDB).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
