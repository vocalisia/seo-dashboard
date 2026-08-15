import { isRecord } from "@/lib/api-response";

export interface SiteOption {
  id: number;
  name: string;
}

export interface DecliningPage {
  page: string;
  clicks_now: number;
  clicks_prev: number;
  pos_now: number | string;
  pos_prev: number | string;
  clicks_decline: number;
  position_decline: number | string;
}

export interface RefreshSuggestion {
  id: number;
  page_url: string;
  suggestions: unknown;
  status: string;
  created_at: string;
}

export interface ContentRefreshListSuccess {
  success: true;
  pages: DecliningPage[];
  suggestions: RefreshSuggestion[];
}

export interface ContentRefreshCreateSuccess {
  success: true;
  refresh: RefreshSuggestion;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNumeric(value: unknown): value is number | string {
  return isFiniteNumber(value) || (typeof value === "string" && Number.isFinite(Number(value)));
}

export function isSiteOptionList(payload: unknown): payload is SiteOption[] {
  return Array.isArray(payload) && payload.every((site) => (
    isRecord(site)
    && isFiniteNumber(site.id)
    && typeof site.name === "string"
  ));
}

function isDecliningPage(payload: unknown): payload is DecliningPage {
  return isRecord(payload)
    && typeof payload.page === "string"
    && isFiniteNumber(payload.clicks_now)
    && isFiniteNumber(payload.clicks_prev)
    && isNumeric(payload.pos_now)
    && isNumeric(payload.pos_prev)
    && isFiniteNumber(payload.clicks_decline)
    && isNumeric(payload.position_decline);
}

function isRefreshSuggestion(payload: unknown): payload is RefreshSuggestion {
  return isRecord(payload)
    && isFiniteNumber(payload.id)
    && typeof payload.page_url === "string"
    && typeof payload.status === "string"
    && typeof payload.created_at === "string"
    && "suggestions" in payload;
}

export function isContentRefreshListSuccess(
  payload: unknown,
): payload is ContentRefreshListSuccess {
  return isRecord(payload)
    && payload.success === true
    && Array.isArray(payload.pages)
    && payload.pages.every(isDecliningPage)
    && Array.isArray(payload.suggestions)
    && payload.suggestions.every(isRefreshSuggestion);
}

export function isContentRefreshCreateSuccess(
  payload: unknown,
): payload is ContentRefreshCreateSuccess {
  return isRecord(payload)
    && payload.success === true
    && isRefreshSuggestion(payload.refresh);
}
