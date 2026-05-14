#!/usr/bin/env node
/**
 * SEO Tag Guard — bloque le build Vercel si une balise critique
 * a été retirée ou modifiée dans les templates.
 *
 * Usage dans chaque repo Next.js :
 *   1. Copier ce fichier dans `scripts/seo-tag-guard.cjs`
 *   2. Ajouter dans `package.json` :
 *        "scripts": { "prebuild": "node scripts/seo-tag-guard.cjs" }
 *   3. Vercel exécute prebuild AVANT next build → exit 1 si violation → no deploy
 *
 * Variables d'environnement (optionnelles) :
 *   SEO_GUARD_DISABLE=1  → skip le guard (pour debug local)
 *   SEO_GUARD_GA4=1      → exiger gtag.js + consent mode dans layout
 *
 * © vocalisia · sans dépendances · CommonJS (compatible Vercel Node 22)
 */

"use strict";

const fs = require("fs");
const path = require("path");

if (process.env.SEO_GUARD_DISABLE === "1") {
  console.log("⚠ seo-tag-guard: désactivé via SEO_GUARD_DISABLE=1");
  process.exit(0);
}

// Fichiers candidats pour le layout principal. Le premier trouvé est scanné.
const LAYOUT_CANDIDATES = [
  "app/layout.tsx",
  "src/app/layout.tsx",
  "src/app/[locale]/layout.tsx",
  "app/[locale]/layout.tsx",
];

// Règles : { code, severity, mode: "require"|"forbid", pattern, msg, fix }
const RULES = [
  // ─────────── SEO baseline ───────────
  {
    code: "metadataBase_present",
    severity: "high",
    mode: "require",
    pattern: /metadataBase\s*:/,
    msg: "metadataBase manquant dans Metadata — og:image/canonical relatifs cassés.",
    fix: "Ajouter `metadataBase: new URL('https://yoursite.com')` dans la Metadata du layout.",
  },
  {
    code: "no_inverted_ga4_consent",
    severity: "critical",
    mode: "forbid",
    pattern: /rejected\s*\?\s*['"`]granted['"`]\s*:\s*['"`]denied['"`]/,
    msg: "Logique GA4 consent INVERSÉE détectée (`rejected ? granted : denied`) — tracking activé sur refus EU.",
    fix: "Inverser le ternaire : `rejected ? 'denied' : 'granted'`.",
  },
  {
    code: "no_hardcoded_noindex",
    severity: "critical",
    mode: "forbid",
    pattern: /name=["']robots["'][^>]*content=["'][^"']*noindex/i,
    msg: "noindex hardcodé dans le layout — bloque tout le site des SERPs.",
    fix: "Retirer le meta robots noindex du layout. Utiliser robots.ts par route si besoin.",
  },
  {
    code: "html_lang_present",
    severity: "high",
    mode: "require",
    pattern: /<html[^>]*\slang\s*=/,
    msg: "Attribut <html lang> manquant — accessibilité + hreflang cassés.",
    fix: "Ajouter `<html lang=\"fr\">` (ou la langue de défaut du site).",
  },
];

// Règles spécifiques GA4 (opt-in via SEO_GUARD_GA4=1, car GA4 souvent dans une page séparée)
const GA4_RULES = [
  {
    code: "gtag_js_present",
    severity: "high",
    mode: "require",
    pattern: /googletagmanager\.com\/gtag\/js/,
    msg: "gtag.js absent du layout — pas de tracking GA4.",
    fix: "Ajouter `<Script src='https://www.googletagmanager.com/gtag/js?id=G-XXX' />` dans le layout.",
  },
  {
    code: "consent_default_present",
    severity: "critical",
    mode: "require",
    pattern: /gtag\s*\(\s*['"`]consent['"`]\s*,\s*['"`]default['"`]/,
    msg: "GA4 consent mode default absent — viole RGPD EU.",
    fix: "Ajouter `gtag('consent', 'default', { analytics_storage: 'denied', ... })` AVANT gtag('config').",
  },
];

function findLayoutFile(root) {
  for (const rel of LAYOUT_CANDIDATES) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) return { rel, abs };
  }
  return null;
}

function checkRules(content, rules, sourceFile) {
  const violations = [];
  for (const rule of rules) {
    const matches = rule.pattern.test(content);
    if (rule.mode === "require" && !matches) {
      violations.push({ ...rule, file: sourceFile });
    } else if (rule.mode === "forbid" && matches) {
      violations.push({ ...rule, file: sourceFile });
    }
  }
  return violations;
}

function main() {
  const root = process.cwd();
  console.log(`🩺 seo-tag-guard scanning ${root}`);

  const layout = findLayoutFile(root);
  if (!layout) {
    console.error(
      `✗ seo-tag-guard: aucun fichier layout trouvé parmi ${LAYOUT_CANDIDATES.join(", ")}`
    );
    // Pas de layout = pas une app Next.js standard → skip (don't break unrelated repos)
    process.exit(0);
  }

  const layoutContent = fs.readFileSync(layout.abs, "utf8");

  let allRules = RULES;
  if (process.env.SEO_GUARD_GA4 === "1") {
    allRules = [...RULES, ...GA4_RULES];
  }

  const violations = checkRules(layoutContent, allRules, layout.rel);

  const critical = violations.filter((v) => v.severity === "critical");
  const high = violations.filter((v) => v.severity === "high");

  if (violations.length === 0) {
    console.log(`✓ seo-tag-guard: layout ${layout.rel} pass (${allRules.length} rules)`);
    process.exit(0);
  }

  console.error("");
  console.error("=".repeat(70));
  console.error(`✗ seo-tag-guard BLOCK : ${critical.length} critical + ${high.length} high`);
  console.error("=".repeat(70));
  for (const v of violations) {
    console.error(`  [${v.severity.toUpperCase()}] ${v.code} (${v.file})`);
    console.error(`     ${v.msg}`);
    console.error(`     fix: ${v.fix}`);
    console.error("");
  }
  console.error("=".repeat(70));
  console.error("Pour bypass (à tes risques): SEO_GUARD_DISABLE=1 npm run build");
  console.error("=".repeat(70));

  // Bloque le build uniquement si critical détecté.
  // high = warn mais n'arrête pas (sinon trop strict).
  process.exit(critical.length > 0 ? 1 : 0);
}

main();
