import { describe, expect, it } from "vitest";
import {
  buildReportGenerationOutcome,
  isReportGenerationSuccess,
  type ReportGenerationResult,
} from "@/lib/report-generation-contract";

const week = "2026-08-10";

function result(
  siteId: number,
  status: ReportGenerationResult["status"],
  detail?: string,
): ReportGenerationResult {
  return {
    site_id: siteId,
    site: `Site ${siteId}`,
    status,
    ...(status === "ok" ? { clicks: 12 } : {}),
    ...(status === "error" ? { error: detail ?? "Erreur interne" } : {}),
    ...(status === "no_data" ? { reason: detail ?? "Aucune donnée GSC" } : {}),
  };
}

describe("report generation outcome", () => {
  it("returns HTTP 200 and success only when every report is generated", () => {
    const outcome = buildReportGenerationOutcome(week, [result(1, "ok"), result(2, "ok")]);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({
      success: true,
      summary: { total: 2, generated: 2, no_data: 0, failed: 0 },
    });
    expect(isReportGenerationSuccess(outcome.body)).toBe(true);
  });

  it("returns HTTP 500 and success false when a partial run contains an internal error", () => {
    const outcome = buildReportGenerationOutcome(week, [
      result(1, "ok"),
      result(2, "error", "Base indisponible"),
    ]);

    expect(outcome.status).toBe(500);
    expect(outcome.body).toMatchObject({
      success: false,
      summary: { total: 2, generated: 1, no_data: 0, failed: 1 },
    });
    expect(outcome.body).toHaveProperty("error", expect.stringContaining("Site 2 (#2): Base indisponible"));
    expect(isReportGenerationSuccess(outcome.body)).toBe(false);
  });

  it("returns HTTP 207 for a partial run with no internal error", () => {
    const outcome = buildReportGenerationOutcome(week, [
      result(1, "ok"),
      result(2, "no_data"),
    ]);

    expect(outcome.status).toBe(207);
    expect(outcome.body).toMatchObject({
      success: false,
      summary: { total: 2, generated: 1, no_data: 1, failed: 0 },
    });
  });

  it("returns HTTP 500 when every attempted report fails internally", () => {
    const outcome = buildReportGenerationOutcome(week, [result(1, "error")]);

    expect(outcome.status).toBe(500);
    expect(outcome.body.success).toBe(false);
  });

  it("returns HTTP 422 when no report can be generated for lack of data", () => {
    const outcome = buildReportGenerationOutcome(week, [result(1, "no_data")]);

    expect(outcome.status).toBe(422);
    expect(outcome.body).toMatchObject({
      success: false,
      summary: { total: 1, generated: 0, no_data: 1, failed: 0 },
    });
  });

  it("returns HTTP 404 when there is no active site to process", () => {
    const outcome = buildReportGenerationOutcome(week, []);

    expect(outcome.status).toBe(404);
    expect(outcome.body).toMatchObject({ success: false, error: "Aucun site actif à traiter" });
  });

  it("rejects a body that claims success while containing an internal error", () => {
    expect(isReportGenerationSuccess({
      success: true,
      week,
      summary: { total: 1, generated: 1, no_data: 0, failed: 0 },
      results: [result(1, "error")],
    })).toBe(false);

    expect(isReportGenerationSuccess({
      success: true,
      week,
      summary: { total: 1, generated: 1, no_data: 0, failed: 1 },
      results: [result(1, "ok")],
    })).toBe(false);
  });
});
