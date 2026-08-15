import { isRecord } from "@/lib/api-response";

export interface ReportOpportunity {
  query: string;
  clicks?: number;
  impressions: number;
  position: number;
  ctr?: number;
  source_volume?: number;
  volume_source?: string | null;
  volume_status?: "imported" | "missing";
  priority_score?: number;
  reason?: string;
  data_source?: string;
}

export interface WeeklyReport {
  id: number;
  site_id: number;
  site_name: string;
  site_url: string;
  week_start: string;
  summary: string;
  recommendations: string;
  top_opportunities: ReportOpportunity[];
  created_at: string;
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isReportOpportunity(payload: unknown): payload is ReportOpportunity {
  return isRecord(payload)
    && typeof payload.query === "string"
    && typeof payload.impressions === "number"
    && Number.isFinite(payload.impressions)
    && typeof payload.position === "number"
    && Number.isFinite(payload.position)
    && isOptionalFiniteNumber(payload.clicks)
    && isOptionalFiniteNumber(payload.ctr)
    && isOptionalFiniteNumber(payload.source_volume)
    && isOptionalFiniteNumber(payload.priority_score)
    && (payload.volume_source === undefined || payload.volume_source === null || typeof payload.volume_source === "string")
    && (payload.volume_status === undefined || payload.volume_status === "imported" || payload.volume_status === "missing")
    && (payload.reason === undefined || typeof payload.reason === "string")
    && (payload.data_source === undefined || typeof payload.data_source === "string");
}

export function isWeeklyReportList(payload: unknown): payload is WeeklyReport[] {
  return Array.isArray(payload) && payload.every((report) => (
    isRecord(report)
    && typeof report.id === "number"
    && typeof report.site_id === "number"
    && typeof report.site_name === "string"
    && typeof report.site_url === "string"
    && typeof report.week_start === "string"
    && typeof report.summary === "string"
    && typeof report.recommendations === "string"
    && Array.isArray(report.top_opportunities)
    && report.top_opportunities.every(isReportOpportunity)
    && typeof report.created_at === "string"
  ));
}

export type ReportGenerationStatus = "ok" | "no_data" | "error";

export interface ReportGenerationResult {
  site_id: number;
  site: string;
  status: ReportGenerationStatus;
  clicks?: number;
  error?: string;
  reason?: string;
}

export interface ReportGenerationSummary {
  total: number;
  generated: number;
  no_data: number;
  failed: number;
}

export interface ReportGenerationSuccess {
  success: true;
  week: string;
  summary: ReportGenerationSummary;
  results: ReportGenerationResult[];
}

export interface ReportGenerationFailure {
  success: false;
  week: string;
  error: string;
  summary: ReportGenerationSummary;
  results: ReportGenerationResult[];
}

export type ReportGenerationResponse =
  | ReportGenerationSuccess
  | ReportGenerationFailure;

export interface ReportGenerationOutcome {
  status: 200 | 207 | 404 | 422 | 500;
  body: ReportGenerationResponse;
}

export function summarizeReportGeneration(
  results: ReportGenerationResult[],
): ReportGenerationSummary {
  return {
    total: results.length,
    generated: results.filter((result) => result.status === "ok").length,
    no_data: results.filter((result) => result.status === "no_data").length,
    failed: results.filter((result) => result.status === "error").length,
  };
}

function issueDetail(result: ReportGenerationResult): string {
  const detail = result.error ?? result.reason ?? result.status;
  return `${result.site} (#${result.site_id}): ${detail}`;
}

export function buildReportGenerationOutcome(
  week: string,
  results: ReportGenerationResult[],
): ReportGenerationOutcome {
  const summary = summarizeReportGeneration(results);

  if (summary.total === 0) {
    return {
      status: 404,
      body: {
        success: false,
        week,
        error: "Aucun site actif à traiter",
        summary,
        results,
      },
    };
  }

  if (summary.generated === summary.total) {
    return {
      status: 200,
      body: { success: true, week, summary, results },
    };
  }

  const issues = results.filter((result) => result.status !== "ok");
  const prefix = summary.generated > 0
    ? `Génération partielle: ${summary.generated}/${summary.total} rapport(s) généré(s)`
    : "Aucun rapport généré";
  const error = `${prefix}. ${issues.map(issueDetail).join("; ")}`;

  if (summary.failed > 0) {
    return {
      status: 500,
      body: { success: false, week, error, summary, results },
    };
  }

  if (summary.generated > 0) {
    return {
      status: 207,
      body: { success: false, week, error, summary, results },
    };
  }

  return {
    status: 422,
    body: { success: false, week, error, summary, results },
  };
}

function isReportGenerationResult(payload: unknown): payload is ReportGenerationResult {
  return isRecord(payload)
    && typeof payload.site_id === "number"
    && Number.isFinite(payload.site_id)
    && typeof payload.site === "string"
    && (payload.status === "ok" || payload.status === "no_data" || payload.status === "error")
    && (payload.clicks === undefined || (typeof payload.clicks === "number" && Number.isFinite(payload.clicks)))
    && (payload.error === undefined || typeof payload.error === "string")
    && (payload.reason === undefined || typeof payload.reason === "string");
}

function isReportGenerationSummary(payload: unknown): payload is ReportGenerationSummary {
  return isRecord(payload)
    && ["total", "generated", "no_data", "failed"].every((key) => (
      typeof payload[key] === "number"
      && Number.isInteger(payload[key])
      && payload[key] >= 0
    ));
}

export function isReportGenerationSuccess(
  payload: unknown,
): payload is ReportGenerationSuccess {
  return isRecord(payload)
    && payload.success === true
    && typeof payload.week === "string"
    && isReportGenerationSummary(payload.summary)
    && Array.isArray(payload.results)
    && payload.results.length > 0
    && payload.results.every(isReportGenerationResult)
    && payload.results.every((result) => result.status === "ok")
    && payload.summary.total === payload.results.length
    && payload.summary.generated === payload.summary.total
    && payload.summary.no_data === 0
    && payload.summary.failed === 0;
}

export interface InitSuccess {
  success: true;
  message: string;
}

export function isInitSuccess(payload: unknown): payload is InitSuccess {
  return isRecord(payload)
    && payload.success === true
    && typeof payload.message === "string";
}
