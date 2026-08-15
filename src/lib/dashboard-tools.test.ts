import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_TOOL_GROUPS, DASHBOARD_TOOLS, dashboardToolForPath } from "./dashboard-tools";

describe("dashboard tool manifest", () => {
  it("contains unique routes backed by a page", () => {
    const hrefs = DASHBOARD_TOOLS.map((tool) => tool.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    for (const href of hrefs) {
      const route = href === "/" ? "" : href.slice(1);
      expect(existsSync(resolve(process.cwd(), "src", "app", route, "page.tsx")), href).toBe(true);
    }
  });

  it("only references declared groups and resolves nested routes", () => {
    const groups = new Set(DASHBOARD_TOOL_GROUPS.map((group) => group.id));
    for (const tool of DASHBOARD_TOOLS) expect(groups.has(tool.group), tool.href).toBe(true);
    expect(dashboardToolForPath("/autopilot/roi")).toMatchObject({ href: "/autopilot/roi" });
  });
});
