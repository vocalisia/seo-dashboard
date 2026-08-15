import { describe, expect, it } from "vitest";
import {
  isContentRefreshCreateSuccess,
  isContentRefreshListSuccess,
} from "@/lib/content-refresh-contract";

const page = {
  page: "https://example.com/article",
  clicks_now: 10,
  clicks_prev: 25,
  pos_now: "12.5",
  pos_prev: "7.2",
  clicks_decline: 15,
  position_decline: "5.3",
};

const suggestion = {
  id: 1,
  page_url: page.page,
  suggestions: { title: "Nouveau titre" },
  status: "pending",
  created_at: "2026-08-15T12:00:00.000Z",
};

describe("content refresh contracts", () => {
  it("accepts the exact GET response consumed by the UI", () => {
    expect(isContentRefreshListSuccess({
      success: true,
      pages: [page],
      suggestions: [suggestion],
    })).toBe(true);
  });

  it("rejects the obsolete declining field", () => {
    expect(isContentRefreshListSuccess({
      success: true,
      declining: [page],
      suggestions: [suggestion],
    })).toBe(false);
  });

  it("requires the persisted refresh object before accepting POST success", () => {
    expect(isContentRefreshCreateSuccess({ success: true })).toBe(false);
    expect(isContentRefreshCreateSuccess({ success: true, refresh: suggestion })).toBe(true);
  });
});
