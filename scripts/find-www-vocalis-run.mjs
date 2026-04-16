import fs from "fs";
import { neon } from "@neondatabase/serverless";

const raw = fs.readFileSync(".env.local", "utf8");
const env = Object.fromEntries(
  raw
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "")];
    })
);

const sql = neon(env.DATABASE_URL);

const rows = await sql`
  SELECT ar.id, ar.keyword, ar.github_url, ar.published_url, ar.language, ar.created_at, s.name AS site_name, s.url AS site_url
  FROM autopilot_runs ar
  JOIN sites s ON s.id = ar.site_id
  WHERE LOWER(ar.keyword) LIKE '%www%vocalis%pro%'
     OR LOWER(ar.published_url) LIKE '%wwwvocalispro%'
     OR LOWER(ar.github_url) LIKE '%wwwvocalispro%'
  ORDER BY ar.created_at DESC
`;

console.log(JSON.stringify(rows, null, 2));
