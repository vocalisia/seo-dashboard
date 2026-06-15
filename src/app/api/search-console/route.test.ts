import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureSchemaOnce: vi.fn(),
  sql: vi.fn(),
  sqlCalls: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  ensureSchemaOnce: mocks.ensureSchemaOnce,
  getSQL: () => mocks.sql,
}));

vi.mock("@/lib/local-dev", () => ({
  isLocalDevDemoMode: () => false,
}));

import { GET } from "./route";

function request(path: string) {
  return new NextRequest(`http://dashboard.test${path}`);
}

function queryText(strings: TemplateStringsArray | string): string {
  return Array.isArray(strings) ? strings.join("?") : String(strings);
}

describe("search-console keyword data correctness", () => {
  beforeEach(() => {
    mocks.ensureSchemaOnce.mockResolvedValue(undefined);
    mocks.sql.mockReset();
    mocks.sqlCalls.length = 0;
  });

  it("returns only current positioned rows when strict mode is enabled", async () => {
    const currentRows = [
      {
        query: "agent vocal ia",
        total_clicks: 3,
        total_impressions: 90,
        avg_ctr: 0.033,
        avg_position: 8.4,
        page_weighted_position: 14.2,
        volume_market: 720,
        volume_source: "google_kp_real_csv_fr",
        row_source: "current",
      },
      {
        query: "site:example.com agent vocal ia",
        total_clicks: 1,
        total_impressions: 20,
        avg_position: 6,
        row_source: "current",
      },
    ];
    const recentRows = [
      {
        query: "recent but not current",
        total_clicks: 0,
        total_impressions: 12,
        avg_position: 22,
        row_source: "recent_30d",
      },
    ];
    const trackedRows = [
      {
        query: "tracked with volume",
        total_clicks: 0,
        total_impressions: 0,
        avg_position: null,
        volume_market: 1000,
        volume_source: "google_kp_real_csv_fr",
        row_source: "tracked",
      },
    ];

    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = queryText(strings);
      mocks.sqlCalls.push(text);
      if (text.includes("WITH anchor") && text.includes("'current'::varchar AS row_source")) {
        return Promise.resolve([...currentRows, ...recentRows, ...trackedRows]);
      }
      return Promise.resolve([]);
    });

    const response = await GET(request("/api/search-console?siteId=7&type=queries&strict=1"));
    const rows = await response.json();

    expect(rows).toEqual([currentRows[0]]);
    expect(rows.every((row: Record<string, unknown>) => row.row_source === "current")).toBe(true);
  });

  it("keeps tracked keyword volume but does not invent a position without GSC rows", async () => {
    const trackedRows = [
      {
        query: "tracked keyword only",
        total_clicks: 0,
        total_impressions: 0,
        avg_ctr: 0,
        avg_position: null,
        page_weighted_position: null,
        first_seen: null,
        volume_market: 1300,
        volume_fr: 1300,
        volume_ch: null,
        market: "FRA",
        volume_source: "google_kp_real_csv_fr",
        row_source: "tracked",
      },
    ];

    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = queryText(strings);
      mocks.sqlCalls.push(text);
      if (text.includes("WITH anchor") && text.includes("tracked_only AS")) return Promise.resolve(trackedRows);
      return Promise.resolve([]);
    });

    const response = await GET(request("/api/search-console?siteId=7&type=queries"));
    const rows = await response.json();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      query: "tracked keyword only",
      row_source: "tracked",
      avg_position: null,
      page_weighted_position: null,
      volume_market: 1300,
      volume_source: "google_kp_real_csv_fr",
    });
    expect(rows[0]).not.toHaveProperty("current_position");
    expect(mocks.sqlCalls.join("\n")).toContain("MAX(date) AS end_date");
  });

  it("uses latest available GSC data and complete weekly buckets for gains", async () => {
    const gainRows = [
      {
        query: "agent vocal ia",
        position_now: 6.5,
        position_prev: 11.2,
        position_w2: 14.1,
        position_w3: 17.4,
        position_w4: 19.9,
        gain: 4.7,
        clicks_now: 8,
        impressions_now: 120,
        volume_market: 720,
        volume_source: "google_kp_real_csv_fr",
      },
      {
        query: "inurl:polluted gain",
        position_now: 4,
        position_prev: 8,
        gain: 4,
      },
    ];

    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = queryText(strings);
      mocks.sqlCalls.push(text);
      return Promise.resolve(gainRows);
    });

    const response = await GET(request("/api/search-console?siteId=7&type=gains&limit=10"));
    const body = await response.json();
    const gainsSql = mocks.sqlCalls.join("\n");

    expect(body.rows).toEqual([gainRows[0]]);
    expect(body.labels).toEqual(
      expect.objectContaining({
        w0: expect.any(String),
        w1: expect.any(String),
        w2: expect.any(String),
        w3: expect.any(String),
        w4: expect.any(String),
      }),
    );
    expect(gainsSql).toContain("COALESCE(MAX(date)");
    expect(gainsSql).toContain("INTERVAL '6 days'");
    expect(gainsSql).toContain("INTERVAL '13 days'");
    expect(gainsSql).toContain("INTERVAL '34 days'");
    expect(gainsSql).toContain("FROM search_console_query_data");
  });
});
