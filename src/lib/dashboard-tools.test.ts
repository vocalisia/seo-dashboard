import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_TOOLS, dashboardToolForPath } from "./dashboard-tools";

describe("dashboard tool registry", () => {
  it("keeps every destination unique and backed by a page", () => {
    const hrefs = DASHBOARD_TOOLS.map((tool) => tool.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    for (const tool of DASHBOARD_TOOLS) {
      const segments = tool.href.split("/").filter(Boolean);
      const page = join(process.cwd(), "src", "app", ...segments, "page.tsx");
      expect(existsSync(page), `${tool.href} doit pointer vers ${page}`).toBe(true);
    }
  });

  it("covers the previously exposed tools and the new position workspace", () => {
    const hrefs = new Set(DASHBOARD_TOOLS.map((tool) => tool.href));
    for (const required of [
      "/overview", "/reports", "/youtube", "/opportunities", "/audit", "/backlinks",
      "/autopilot", "/countries", "/competitors", "/tracker", "/calendar", "/alerts",
      "/refresh", "/clusters", "/internal-links", "/authority", "/compare", "/health",
      "/scanner", "/striking-distance", "/cannibalization-hhi", "/cross-domain-cannibal",
      "/ctr-anomaly", "/content-decay", "/aio-detector", "/ai-visibility", "/ai-prompts",
      "/keywords-pro", "/content-plan", "/logs", "/schema", "/index-bloat", "/pagerank",
      "/ga4-audit", "/traffic-by-country", "/positions",
    ]) {
      expect(hrefs.has(required), `${required} absent du registre`).toBe(true);
    }
  });

  it("resolves nested routes to their most specific navigation item", () => {
    expect(dashboardToolForPath("/autopilot/roi")?.href).toBe("/autopilot/roi");
    expect(dashboardToolForPath("/competitors/example")?.href).toBe("/competitors");
  });
});
