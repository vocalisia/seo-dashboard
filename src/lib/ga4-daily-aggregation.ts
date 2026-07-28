export interface Ga4Row {
  dimensionValues?: Array<{ value?: string | null }> | null;
  metricValues?: Array<{ value?: string | null }> | null;
}

export interface Ga4DailyStats {
  sessions: number;
  users: number;
  newUsers: number;
  pageviews: number;
  bounceRate: number;
  averageSessionDuration: number;
  organic: number;
  direct: number;
  referral: number;
  social: number;
}

function parseNumber(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(compactDate: string | null | undefined): string | null {
  const value = compactDate ?? "";
  if (!/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function emptyStats(): Ga4DailyStats {
  return {
    sessions: 0,
    users: 0,
    newUsers: 0,
    pageviews: 0,
    bounceRate: 0,
    averageSessionDuration: 0,
    organic: 0,
    direct: 0,
    referral: 0,
    social: 0,
  };
}

/**
 * GA4 users are not additive across channel groups. Global daily metrics come
 * from the date-only report; the channel report contributes sessions only.
 */
export function aggregateGa4Daily(
  dailyRows: Ga4Row[],
  channelRows: Ga4Row[],
): Map<string, Ga4DailyStats> {
  const byDate = new Map<string, Ga4DailyStats>();

  for (const row of dailyRows) {
    const date = isoDate(row.dimensionValues?.[0]?.value);
    if (!date) continue;
    byDate.set(date, {
      ...emptyStats(),
      sessions: parseNumber(row.metricValues?.[0]?.value),
      users: parseNumber(row.metricValues?.[1]?.value),
      newUsers: parseNumber(row.metricValues?.[2]?.value),
      pageviews: parseNumber(row.metricValues?.[3]?.value),
      bounceRate: parseNumber(row.metricValues?.[4]?.value),
      averageSessionDuration: parseNumber(row.metricValues?.[5]?.value),
    });
  }

  for (const row of channelRows) {
    const date = isoDate(row.dimensionValues?.[0]?.value);
    if (!date) continue;
    const stats = byDate.get(date) ?? emptyStats();
    const sessions = parseNumber(row.metricValues?.[0]?.value);
    const channel = (row.dimensionValues?.[1]?.value ?? "").toLowerCase();
    if (channel.includes("social")) stats.social += sessions;
    else if (channel.includes("organic")) stats.organic += sessions;
    else if (channel.includes("direct")) stats.direct += sessions;
    else if (channel.includes("referral")) stats.referral += sessions;
    byDate.set(date, stats);
  }

  return byDate;
}
