import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);
const envPath = join(projectRoot, ".env.local");
const allowedEndpoints = new Set([
  "/api/alerts/check",
  "/api/sync",
  "/api/autopilot/verify-urls",
  "/api/autopilot/weekly",
  "/api/competitors/weekly",
  "/api/pagespeed/weekly",
]);

function readEnvValue(name) {
  const source = readFileSync(envPath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || match[1] !== name) continue;
    let value = match[2].trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

const endpoint = process.argv[2];
const isProbe = endpoint === "--probe";
if (!isProbe && !allowedEndpoints.has(endpoint)) {
  throw new Error(`Unsupported endpoint: ${endpoint || "(missing)"}`);
}

const cronSecret = readEnvValue("CRON_SECRET");
if (!cronSecret) {
  throw new Error("CRON_SECRET is missing from .env.local");
}

const path = isProbe ? "/api/cron/__auth_probe__" : endpoint;
const response = await fetch(`http://127.0.0.1:3001${path}`, {
  method: isProbe ? "GET" : "POST",
  headers: {
    "x-cron-secret": cronSecret,
  },
  signal: AbortSignal.timeout(isProbe ? 15_000 : 600_000),
});

const expected = isProbe ? response.status === 404 : response.ok;
console.log(JSON.stringify({
  endpoint: path,
  status: response.status,
  success: expected,
}));
if (!expected) {
  process.exitCode = 1;
}
