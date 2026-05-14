#!/usr/bin/env node
/**
 * Déploie `seo-tag-guard.cjs` dans chaque repo Next.js actif du portfolio.
 * - Copie le script
 * - Ajoute `prebuild: node scripts/seo-tag-guard.cjs` dans package.json
 * - Commit local (push manuel par l'user)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GUARD_SOURCE = path.join(__dirname, "seo-tag-guard.cjs");

// Repos Next.js qui publient via autopilot (cible du guard)
const REPOS = [
  { path: "C:/Users/cohen.000/vocalis-blog-nextjs", name: "vocalis-blog" },
  { path: "C:/Users/cohen.000/hub-ai",              name: "hub-ai (ai-due)" },
  { path: "C:/Users/cohen.000/lead-gene",           name: "lead-gene" },
  { path: "C:/Users/cohen.000/whatsapp-agent-ia",   name: "whatsapp" },
  { path: "C:/Users/cohen.000/iapmesuisse",         name: "iapmesuisse" },
  { path: "C:/Users/cohen.000/trust-ai-blog",       name: "trustly-ai" },
  { path: "C:/Users/cohen.000/seo-dashboard",       name: "seo-dashboard (self)" },
];

function deployToRepo(repo) {
  if (!fs.existsSync(repo.path)) {
    return { repo: repo.name, status: "skip", reason: "path not found" };
  }
  const pkgPath = path.join(repo.path, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { repo: repo.name, status: "skip", reason: "no package.json" };
  }

  const scriptsDir = path.join(repo.path, "scripts");
  if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

  const guardDest = path.join(scriptsDir, "seo-tag-guard.cjs");
  const guardContent = fs.readFileSync(GUARD_SOURCE, "utf8");
  const existed = fs.existsSync(guardDest);
  const existing = existed ? fs.readFileSync(guardDest, "utf8") : null;

  let copied = false;
  if (!existing || existing !== guardContent) {
    fs.writeFileSync(guardDest, guardContent, "utf8");
    copied = true;
  }

  // Ajouter "prebuild" dans package.json
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  let pkgChanged = false;
  if (pkg.scripts.prebuild !== "node scripts/seo-tag-guard.cjs") {
    // Ne pas écraser si l'utilisateur a déjà un prebuild custom
    if (pkg.scripts.prebuild && !pkg.scripts.prebuild.includes("seo-tag-guard")) {
      console.log(`  ⚠ ${repo.name}: prebuild déjà défini (${pkg.scripts.prebuild}) — skip`);
    } else {
      pkg.scripts.prebuild = "node scripts/seo-tag-guard.cjs";
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      pkgChanged = true;
    }
  }

  return {
    repo: repo.name,
    path: repo.path,
    status: copied || pkgChanged ? "updated" : "unchanged",
    copied,
    pkgChanged,
  };
}

console.log("🩺 Déploiement seo-tag-guard.cjs dans les repos Next.js actifs\n");
const results = REPOS.map(deployToRepo);
console.log("\nRécap :");
for (const r of results) {
  const tag = r.status === "updated" ? "✓" : r.status === "skip" ? "✗" : "·";
  const detail = r.status === "updated"
    ? `${r.copied ? "guard+" : ""}${r.pkgChanged ? "pkg+" : ""}`
    : r.reason || "";
  console.log(`  ${tag} ${r.repo.padEnd(28)} ${r.status.padEnd(10)} ${detail}`);
}
const updated = results.filter((r) => r.status === "updated").length;
console.log(`\n${updated}/${results.length} repos mis à jour.`);
console.log("\nProchaine étape manuelle :");
console.log("  Pour chaque repo updated :");
console.log("    cd <path>");
console.log("    git add scripts/seo-tag-guard.cjs package.json");
console.log("    git commit -m 'feat: seo-tag-guard build-time check'");
console.log("    git push");
console.log("  Le guard s'exécutera AUTOMATIQUEMENT au prochain build Vercel.\n");
