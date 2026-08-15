export type TrafficWindow = "7d" | "28d" | "90d";

const WINDOW_DAYS: Record<TrafficWindow, number> = { "7d": 7, "28d": 28, "90d": 90 };

interface TrafficSummaryInput {
  site_name: string;
  global: { users: number };
  per_day: { users: number };
  error: string | null;
}

export function buildTrafficSummary<T extends TrafficSummaryInput>(results: T[], win: TrafficWindow) {
  const measuredResults = results.filter((result) => result.error === null);
  const failedResults = results.filter((result) => result.error !== null);
  const totalUsers = measuredResults.reduce((acc, result) => acc + result.global.users, 0);
  const totalPerDay = measuredResults.reduce((acc, result) => acc + result.per_day.users, 0);
  const sortedByUsers = [...measuredResults].sort((a, b) => b.global.users - a.global.users);

  return {
    measuredResults,
    failedResults,
    summary: {
      sites_count: measuredResults.length,
      requested_sites: results.length,
      failed_sites: failedResults.length,
      total_users: totalUsers,
      avg_users_per_day: totalPerDay,
      top_3: sortedByUsers.slice(0, 3).map((result) => ({
        site: result.site_name,
        users: result.global.users,
        per_day: result.per_day.users,
      })),
      bottom_3: sortedByUsers
        .slice(-3)
        .reverse()
        .map((result) => ({
          site: result.site_name,
          users: result.global.users,
          per_day: result.per_day.users,
        })),
      window: win,
      window_days: WINDOW_DAYS[win],
    },
  };
}
