/**
 * Vercel CLI sometimes writes values ending with literal \\n before the closing quote.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
let lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
let changed = false;
lines = lines.map((line) => {
  if (line.endsWith('\\n"')) {
    changed = true;
    return line.slice(0, -3) + '"';
  }
  return line;
});
if (changed) {
  fs.writeFileSync(envPath, lines.join("\n"));
}
console.log(changed ? "Fixed trailing \\n in quoted .env.local lines." : "No trailing \\n fixes needed.");

const raw = fs.readFileSync(envPath, "utf8");
if (!/^NEXTAUTH_SECRET=/m.test(raw) && /^AUTH_SECRET=/m.test(raw)) {
  const m = raw.match(/^AUTH_SECRET="([^"]*)"/m);
  if (m) {
    fs.appendFileSync(
      envPath,
      `\n# Sync for NextAuth (same as AUTH_SECRET from Vercel)\nNEXTAUTH_SECRET="${m[1]}"\nNEXTAUTH_URL=http://localhost:3000\n`,
    );
    console.log("Appended NEXTAUTH_SECRET and NEXTAUTH_URL for local dev.");
  }
}
