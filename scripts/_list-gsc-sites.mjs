import { google } from "googleapis";
import { readFileSync } from "fs";
const env = readFileSync("C:/Users/cohen.000/seo-dashboard/.env.local","utf-8");
for (const l of env.split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,""); }
const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
console.log("service_account:", creds.client_email);
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] });
const wm = google.searchconsole({ version: "v1", auth });
const r = await wm.sites.list();
console.log("\nProperties accessibles au service account:");
for (const s of (r.data.siteEntry || [])) console.log(`  ${s.permissionLevel.padEnd(25)} ${s.siteUrl}`);
