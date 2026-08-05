import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  sql: vi.fn(),
  runWebResearch: vi.fn(),
  askAI: vi.fn(),
  generateImage: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/db", () => ({ getSQL: () => mocks.sql }));
vi.mock("@/lib/web-research", () => ({ runWebResearch: mocks.runWebResearch }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/ai", () => ({
  askAI: mocks.askAI,
  generateImage: mocks.generateImage,
  MODELS: { fast: "fast", smart: "smart", creative: "creative" },
  AIProviderError: class AIProviderError extends Error {},
}));

import { POST } from "./route";

function request(action: string, prompt = "audit SEO suisse"): NextRequest {
  return new NextRequest("http://dashboard.test/api/ai/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, prompt, tone: "journalistique" }),
  });
}

const sourcedReport = {
  query: "audit SEO suisse",
  locale: "fr-FR",
  generated_at: "2026-08-05T10:00:00.000Z",
  data_status: "complete",
  search_providers: { bing_rss: "ok", duckduckgo_html: "ok" },
  answer: "Synthèse documentée [S1]",
  evidence: [{ source_id: "S1", claim: "Un audit vérifie les données accessibles.", score: 2 }],
  sources: [{
    id: "S1",
    url: "https://example.com/audit",
    domain: "example.com",
    title: "Audit SEO",
    snippet: "",
    providers: ["bing_rss"],
    positions: { bing_rss: 1 },
    fetch_status: "ok",
    description: "",
    headings: ["Méthode d'audit"],
    schema_types: [],
    word_count: 100,
    excerpt: "Un audit vérifie les données accessibles.",
  }],
};

describe("assistant grounded actions", () => {
  beforeEach(() => {
    mocks.requireApiSession.mockResolvedValue({ session: { user: { email: "tester@example.com" } }, unauthorized: null });
    mocks.sql.mockReset();
    mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
      const text = Array.from(strings).join("?");
      if (text.includes("SELECT response")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    mocks.runWebResearch.mockReset();
    mocks.askAI.mockReset();
  });

  it("requires an authenticated dashboard session", async () => {
    mocks.requireApiSession.mockResolvedValueOnce({
      session: null,
      unauthorized: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    });
    const response = await POST(request("research"));
    expect(response.status).toBe(401);
    expect(mocks.runWebResearch).not.toHaveBeenCalled();
  });

  it("uses sourced no-key research without calling an AI provider", async () => {
    mocks.runWebResearch.mockResolvedValueOnce(sourcedReport);
    const response = await POST(request("research"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      reply: "Synthèse documentée [S1]",
      data_status: "complete",
      sources: sourcedReport.sources,
      evidence: sourcedReport.evidence,
    });
    expect(mocks.askAI).not.toHaveBeenCalled();
  });

  it("builds the E-E-A-T brief only from returned evidence and URLs", async () => {
    mocks.runWebResearch.mockResolvedValueOnce(sourcedReport);
    const response = await POST(request("eeat", "Comment auditer un site"));
    const body = await response.json();
    expect(body.reply).toContain("Brief E-E-A-T sourcé");
    expect(body.reply).toContain("Un audit vérifie les données accessibles. [S1]");
    expect(body.reply).toContain("https://example.com/audit");
    expect(body.reply).toContain("n'invente ni volume");
    expect(mocks.askAI).not.toHaveBeenCalled();
  });

  it("returns a real failure status when public providers are unavailable", async () => {
    mocks.runWebResearch.mockResolvedValueOnce({
      ...sourcedReport,
      data_status: "unavailable",
      sources: [],
      evidence: [],
      answer: "Aucune source",
    });
    const response = await POST(request("research"));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      data_status: "unavailable",
      sources: [],
    });
  });
});
