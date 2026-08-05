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
