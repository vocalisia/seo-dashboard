import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CP1252_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const suspicious = /[ÃÂâðï]/;

function suspiciousCount(value) {
  return (value.match(/[ÃÂâðï]/g) ?? []).length;
}

function repairLine(line) {
  if (!suspicious.test(line)) return line;
  const bytes = [];
  for (const character of line) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xff) bytes.push(codePoint);
    else if (CP1252_BYTES.has(codePoint)) bytes.push(CP1252_BYTES.get(codePoint));
    else return line;
  }
  try {
    const repaired = decoder.decode(Uint8Array.from(bytes));
    return suspiciousCount(repaired) < suspiciousCount(line) ? repaired : line;
  } catch {
    return line;
  }
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

const write = process.argv.includes("--write");
let changedLines = 0;
let changedFiles = 0;

for (const path of sourceFiles("src")) {
  const source = readFileSync(path, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = source.endsWith("\n");
  const originalLines = source.split(/\r?\n/);
  if (trailingNewline) originalLines.pop();
  let fileChanged = false;
  const repairedLines = originalLines.map((line, index) => {
    const repaired = repairLine(line);
    if (repaired !== line) {
      fileChanged = true;
      changedLines += 1;
      console.log(`${path}:${index + 1}`);
    }
    return repaired;
  });
  const repairedSource = repairedLines.join(eol) + (trailingNewline ? eol : "");
  if (fileChanged) {
    changedFiles += 1;
    if (write) writeFileSync(path, repairedSource, "utf8");
  }
}

console.log(`${write ? "Repaired" : "Detected"}: ${changedLines} line(s) in ${changedFiles} file(s).`);
if (!write && changedLines > 0) process.exitCode = 1;
