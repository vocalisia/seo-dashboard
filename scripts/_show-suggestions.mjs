import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT id, site_id, page_url, clicks_before, clicks_after, position_before, position_after, suggestions FROM content_refresh ORDER BY id`;
let md = "# Suggestions refresh contenu — KW business chutes\n\n";
md += `Genere: ${new Date().toISOString()}\n\n---\n\n`;
for (const row of r) {
  md += `## ${row.page_url}\n\n`;
  md += `- Clicks 14j: ${row.clicks_before} → ${row.clicks_after}\n`;
  md += `- Position 14j: ${row.position_before} → ${row.position_after}\n\n`;
  let sug = row.suggestions;
  // unwrap raw_response if present
  if (sug?.raw_response) {
    const m = sug.raw_response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const cleanJson = m ? m[1].trim() : sug.raw_response;
    try { sug = JSON.parse(cleanJson); } catch { sug = { raw: cleanJson.slice(0, 4000) }; }
  }
  md += "### Suggestions IA\n\n```json\n" + JSON.stringify(sug, null, 2) + "\n```\n\n---\n\n";
}
writeFileSync("C:/Users/cohen.000/seo-dashboard/CONTENT-REFRESH-SUGGESTIONS.md", md);
console.log(`Wrote ${md.length} chars to CONTENT-REFRESH-SUGGESTIONS.md`);
console.log(`Pages: ${r.length}`);
