export const DEFAULT_SYNC_DAYS = 45;

export function parseSyncDays(value: string | null, defaultDays = DEFAULT_SYNC_DAYS): number {
  const parsed = value === null ? defaultDays : Number.parseInt(value, 10);
  return Math.max(1, Math.min(365, Number.isFinite(parsed) ? parsed : defaultDays));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker())
  );
  return results;
}
