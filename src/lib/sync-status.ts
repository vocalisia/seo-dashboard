import { getSQL } from "@/lib/db";

export type SyncSource = "gsc" | "ga4";

export async function ensureSyncStatusTable(): Promise<void> {
  const sql = getSQL();
  await sql`
    CREATE TABLE IF NOT EXISTS data_sync_status (
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      source VARCHAR(10) NOT NULL,
      status VARCHAR(10) NOT NULL,
      rows_synced INTEGER NOT NULL DEFAULT 0,
      latest_data_date DATE,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (site_id, source)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_data_sync_status_finished
      ON data_sync_status(finished_at DESC)
  `;
}

export async function saveSyncStatus(input: {
  siteId: number;
  source: SyncSource;
  status: "success" | "error" | "skipped";
  rowsSynced: number;
  latestDataDate: string | null;
  error?: string | null;
  startedAt: Date;
}): Promise<void> {
  const sql = getSQL();
  await sql`
    INSERT INTO data_sync_status
      (site_id, source, status, rows_synced, latest_data_date, error, started_at, finished_at)
    VALUES (
      ${input.siteId}, ${input.source}, ${input.status}, ${input.rowsSynced},
      ${input.latestDataDate}, ${input.error ?? null}, ${input.startedAt.toISOString()}, NOW()
    )
    ON CONFLICT (site_id, source) DO UPDATE SET
      status = EXCLUDED.status,
      rows_synced = EXCLUDED.rows_synced,
      latest_data_date = EXCLUDED.latest_data_date,
      error = EXCLUDED.error,
      started_at = EXCLUDED.started_at,
      finished_at = EXCLUDED.finished_at
  `;
}
