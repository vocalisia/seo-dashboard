import { describe, expect, it } from "vitest";
import { dashboardCredentialsMatch, getDashboardCredentials } from "./dashboard-auth";

describe("dashboard credentials", () => {
  it("requires both environment variables and removes line breaks", () => {
    expect(getDashboardCredentials({ DASHBOARD_AUTH_USER: "admin" })).toBeNull();
    expect(getDashboardCredentials({ DASHBOARD_AUTH_USER: " admin\n", DASHBOARD_AUTH_PASSWORD: " secret\r\n" })).toEqual({ user: "admin", password: "secret" });
  });

  it("accepts only the configured username and password", () => {
    const expected = { user: "admin", password: "a-long-secret" };
    expect(dashboardCredentialsMatch(expected, "admin", "a-long-secret")).toBe(true);
    expect(dashboardCredentialsMatch(expected, "admin", "wrong-secret")).toBe(false);
    expect(dashboardCredentialsMatch(expected, "other", "a-long-secret")).toBe(false);
  });
});
