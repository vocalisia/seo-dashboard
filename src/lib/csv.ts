/**
 * Tiny RFC4180-ish CSV parser (no deps).
 * Handles: quoted fields, escaped quotes (""), comma + tab delimiters, CRLF/LF.
 * Google Keyword Planner exports use comma delimiter, UTF-16 BOM sometimes.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

export function parseCsv(input: string): ParsedCsv {
  const text = stripBom(input);
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      // Skip Google KP "preamble" lines (Keyword Planner exports begin with section
      // labels like "Keyword Plan" before the real header). Non-empty trailing rows
      // are filtered by the caller via header match.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  // Locate header row — first row that contains "Keyword" (case-insensitive).
  let headerIdx = rows.findIndex((r) =>
    r.some((cell) => cell.trim().toLowerCase() === "keyword")
  );
  if (headerIdx < 0) headerIdx = 0;

  const headers = rows[headerIdx].map((h) => h.trim());
  const dataRows = rows.slice(headerIdx + 1);

  const out: Record<string, string>[] = [];
  for (const r of dataRows) {
    if (r.every((c) => c.trim() === "")) continue;
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (r[i] ?? "").trim();
    }
    out.push(obj);
  }
  return { headers, rows: out };
}

/** Parse Google Keyword Planner-style monthly volume value. Examples: "1 000", "1,000", "10K", "—". */
export function parseVolume(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/ /g, "").replace(/\s+/g, "").trim();
  if (!s || s === "-" || s === "—" || s === "0") return s === "0" ? 0 : null;
  const m = s.match(/^([\d.,]+)\s*([KMkm])?$/);
  if (!m) {
    const n = Number(s.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const num = Number(m[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(num)) return null;
  const mult = m[2]?.toUpperCase() === "K" ? 1000 : m[2]?.toUpperCase() === "M" ? 1_000_000 : 1;
  return Math.round(num * mult);
}

/** Google KP CPC bids appear as "0,32 €" / "$1.50". Strip currency / spaces. */
export function parseDecimal(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/[^\d.,-]/g, "").replace(/,/g, ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
