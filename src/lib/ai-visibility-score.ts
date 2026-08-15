export interface VisibilityMeasurement {
  measured: boolean;
  mentioned: boolean;
}

export function calculateVisibilityScore(results: VisibilityMeasurement[]): {
  score: number | null;
  measured: number;
  requested: number;
  mentions: number;
} {
  const measuredRows = results.filter((result) => result.measured);
  const mentions = measuredRows.filter((result) => result.mentioned).length;
  return {
    score: measuredRows.length > 0 ? Math.round((mentions / measuredRows.length) * 100) : null,
    measured: measuredRows.length,
    requested: results.length,
    mentions,
  };
}
