/**
 * POST /api/keyword-planner/import
 *
 * Accepts a Google Keyword Planner CSV export (UI download) and UPSERTs rows
 * into `tracked_keywords` matched on (site_id, LOWER(keyword)).
 *
 * Why CSV rather than the KP API: the Google Ads / KP API requires OAuth +
 * developer-token approval (1–3 days). CSV upload is instant and uses the same
 * data the user already sees in the KP UI.
 *
 * Accepts either:
 *   - multipart/form-data: fields `site_id`, `file` (the CSV)
 *   - application/json: { site_id: number, csv: string }
 *
 * Recognised CSV columns (Google's export labels — case-insensitive contains-match):
 *   - "Keyword"
 *   - "Avg. monthly searches" (or "Avg monthly searches")
 *   - "Competition"                    (LOW / MEDIUM / HIGH / 0–100)
 *   - "Top of page bid (low range)"
 *   - "Top of page bid (high range)"
 */

import { NextRequest, NextResponse } from "next/server";
import { getSQL } from "@/lib/db";
import { ensureSchema } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { parseCsv, parseVolume, parseDecimal } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ImportSummary {
  success: boolean;
  site_id: number;
  total_rows: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  preview: Array<{
    keyword: string;
    volume_market: number | null;
    competition: string | null;
    cpc_low: number | null;
    cpc_high: number | null;
    action: "insert" | "update";
  }>;
}

function findHeader(headers: string[], needle: string): string | null {
  const n = needle.toLowerCase();
  return headers.find((h) => h.toLowerCase().includes(n)) ?? null;
}

function normalizeCompetition(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "-") return null;
  if (s.startsWith("low") || s === "faible") return "LOW";
  if (s.startsWith("med") || s.startsWith("moy")) return "MEDIUM";
  if (s.startsWith("high") || s.startsWith("éle")) return "HIGH";
  // Numeric index (0-100) — bucket
  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n < 33) return "LOW";
    if (n < 66) return "MEDIUM";
    return "HIGH";
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authState = await requireApiSession();
  if (authState.unauthorized) return authState.unauthorized;

  let siteIdRaw: string | number | null = null;
  let csvText: string | null = null;

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      siteIdRaw = form.get("site_id") as string | null;
      const file = form.get("file");
      if (file && typeof file !== "string") {
        csvText = await file.text();
      } else if (typeof form.get("csv") === "string") {
        csvText = form.get("csv") as string;
      }
    } else {
      const body = (await req.json()) as { site_id?: number | string; csv?: string };
      siteIdRaw = body.site_id ?? null;
      csvText = body.csv ?? null;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const siteId = Number(siteIdRaw);
  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: "site_id required" }, { status: 400 });
  }
  if (!csvText || csvText.trim().length === 0) {
    return NextResponse.json({ error: "csv file required" }, { status: 400 });
  }

  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(csvText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "csv parse error";
    return NextResponse.json({ error: `CSV parse error: ${msg}` }, { status: 400 });
  }

  const kwCol = findHeader(parsed.headers, "keyword");
  const volCol = findHeader(parsed.headers, "monthly searches") ?? findHeader(parsed.headers, "avg. monthly");
  const compCol = findHeader(parsed.headers, "competition");
  const cpcLowCol = findHeader(parsed.headers, "low range") ?? findHeader(parsed.headers, "low bid");
  const cpcHighCol = findHeader(parsed.headers, "high range") ?? findHeader(parsed.headers, "high bid");

  if (!kwCol) {
    return NextResponse.json(
      { error: `No "Keyword" column found. Headers: ${parsed.headers.join(", ")}` },
      { status: 400 }
    );
  }

  await ensureSchema();
  const sql = getSQL();

  const siteRow = (await sql`SELECT id FROM sites WHERE id = ${siteId}`) as Array<{ id: number }>;
  if (siteRow.length === 0) {
    return NextResponse.json({ error: `site_id ${siteId} not found` }, { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const source = `google_kp_csv_${today}`;

  const summary: ImportSummary = {
    success: true,
    site_id: siteId,
    total_rows: parsed.rows.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    preview: [],
  };

  // Batch in a loop. Neon HTTP serverless does not pipeline — keep simple sequential UPSERTs.
  for (const row of parsed.rows) {
    const keyword = (row[kwCol] || "").trim();
    if (!keyword) {
      summary.skipped++;
      continue;
    }
    const volume = volCol ? parseVolume(row[volCol]) : null;
    const competition = normalizeCompetition(compCol ? row[compCol] : undefined);
    const cpcLow = cpcLowCol ? parseDecimal(row[cpcLowCol]) : null;
    const cpcHigh = cpcHighCol ? parseDecimal(row[cpcHighCol]) : null;

    try {
      const result = (await sql`
        INSERT INTO tracked_keywords (
          site_id, keyword, volume_market, volume_source, confidence,
          competition, cpc_low, cpc_high, volume_updated_at, is_active
        ) VALUES (
          ${siteId}, ${keyword}, ${volume}, ${source}, 0.95,
          ${competition}, ${cpcLow}, ${cpcHigh}, NOW(), TRUE
        )
        ON CONFLICT (site_id, (LOWER(keyword))) DO UPDATE SET
          volume_market = EXCLUDED.volume_market,
          volume_source = EXCLUDED.volume_source,
          confidence = EXCLUDED.confidence,
          competition = COALESCE(EXCLUDED.competition, tracked_keywords.competition),
          cpc_low = COALESCE(EXCLUDED.cpc_low, tracked_keywords.cpc_low),
          cpc_high = COALESCE(EXCLUDED.cpc_high, tracked_keywords.cpc_high),
          volume_updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `) as Array<{ inserted: boolean }>;

      const inserted = result[0]?.inserted === true;
      if (inserted) summary.imported++;
      else summary.updated++;

      if (summary.preview.length < 20) {
        summary.preview.push({
          keyword,
          volume_market: volume,
          competition,
          cpc_low: cpcLow,
          cpc_high: cpcHigh,
          action: inserted ? "insert" : "update",
        });
      }
    } catch (err) {
      summary.skipped++;
      if (summary.errors.length < 10) {
        summary.errors.push(
          `${keyword}: ${err instanceof Error ? err.message : "db error"}`
        );
      }
    }
  }

  return NextResponse.json(summary);
}
