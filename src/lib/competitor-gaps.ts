export interface CompetitorGap {
  keyword: string;
  our_position: number | null;
  competitor_positions: { domain: string; pos: number }[];
  /** Null when no keyword-volume provider has supplied a value. */
  volume: number | null;
  /** First-party GSC impressions; never a proxy for keyword search volume. */
  impressions?: number;
  source: "competitor_cache" | "gsc_opportunity";
}

export function toGscOpportunities(
  rows: Array<{ keyword: string; our_position: number; impressions: number }>,
): CompetitorGap[] {
  return rows.map((row) => ({
    keyword: row.keyword,
    our_position: Number(row.our_position),
    competitor_positions: [],
    volume: null,
    impressions: Number(row.impressions),
    source: "gsc_opportunity",
  }));
}

export function sortGapsByKnownVolume(gaps: CompetitorGap[]): CompetitorGap[] {
  return [...gaps].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
}

export interface CompetitorArticleRequest {
  site_id: number;
  dry_run: true;
  language: "fr";
  source: "competitor";
  forced_keyword: string;
}

function normalizeActionKeyword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
  return normalized || null;
}

export function buildCompetitorArticleRequest(siteId: number, clickedKeyword: string): CompetitorArticleRequest {
  const keyword = clickedKeyword.trim();
  if (!keyword) throw new Error("Le mot-clé cliqué est vide.");

  return {
    site_id: siteId,
    dry_run: true,
    language: "fr",
    source: "competitor",
    forced_keyword: keyword,
  };
}

export function isSuccessfulCompetitorResponse<T>(
  responseOk: boolean,
  payload: T,
): payload is T & { success: true } {
  return responseOk
    && typeof payload === "object"
    && payload !== null
    && "success" in payload
    && payload.success === true;
}

export function isConfirmedCompetitorKeywordResponse(
  responseOk: boolean,
  payload: unknown,
  clickedKeyword: string,
  confirmationField: "keyword" | "target_keyword" = "keyword",
): boolean {
  if (!isSuccessfulCompetitorResponse(responseOk, payload)) return false;
  const responsePayload = payload as Record<string, unknown>;
  return normalizeActionKeyword(responsePayload[confirmationField]) === normalizeActionKeyword(clickedKeyword);
}

export function competitorContentPlanAvailability(clickedKeyword: string): {
  enabled: false;
  reason: string;
} {
  const keyword = clickedKeyword.trim();
  return {
    enabled: false,
    reason: `Action désactivée pour « ${keyword} » : le générateur actuel recrée un plan GSC complet et ne sait pas enregistrer uniquement le mot-clé cliqué.`,
  };
}
