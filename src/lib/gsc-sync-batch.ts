export interface RawGscSyncRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

export interface PageLevelGscRow {
  date: string;
  query: string;
  page: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryLevelGscRow {
  date: string;
  query: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function validDate(value: unknown): string | null {
  const date = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function acceptedPosition(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 200 ? parsed : null;
}

export function normalizePageLevelGscRows(
  rows: RawGscSyncRow[],
  indexes: { date: number; country?: number },
): PageLevelGscRow[] {
  return rows.flatMap((row) => {
    const date = validDate(row.keys?.[indexes.date]);
    const position = acceptedPosition(row.position);
    if (!date || position == null) return [];

    return [{
      date,
      query: String(row.keys?.[0] ?? ""),
      page: String(row.keys?.[1] ?? ""),
      country: indexes.country == null
        ? ""
        : String(row.keys?.[indexes.country] ?? "").toUpperCase(),
      device: "",
      clicks: nonNegativeInteger(row.clicks),
      impressions: nonNegativeInteger(row.impressions),
      ctr: Math.max(0, finiteNumber(row.ctr)),
      position,
    }];
  });
}

export function normalizeQueryLevelGscRows(rows: RawGscSyncRow[]): QueryLevelGscRow[] {
  return rows.flatMap((row) => {
    const query = String(row.keys?.[0] ?? "").trim();
    const date = validDate(row.keys?.[2]);
    const position = acceptedPosition(row.position);
    if (!query || !date || position == null) return [];

    return [{
      date,
      query,
      country: String(row.keys?.[1] ?? "").toUpperCase(),
      device: "",
      clicks: nonNegativeInteger(row.clicks),
      impressions: nonNegativeInteger(row.impressions),
      ctr: Math.max(0, finiteNumber(row.ctr)),
      position,
    }];
  });
}
