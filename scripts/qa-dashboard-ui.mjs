import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.DASHBOARD_QA_URL || "http://localhost:3091";
const artifactDir = resolve("data", "qa-dashboard");
mkdirSync(artifactDir, { recursive: true });

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const splitAt = line.indexOf("=");
    if (splitAt < 1) continue;
    const key = line.slice(0, splitAt).trim();
    let value = line.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value.replace(/\\n/g, "\n");
  }
  return env;
}

const env = {
  ...loadEnvFile(resolve(".env.production")),
  ...loadEnvFile(resolve(".env.local")),
  ...process.env,
};
const username = env.DASHBOARD_AUTH_USER || env.BASIC_AUTH_USER;
const password = env.DASHBOARD_AUTH_PASSWORD || env.BASIC_AUTH_PASS || env.LOCAL_DEV_PASSWORD;
if (!username || !password) throw new Error("Dashboard QA credentials are not configured");

const registry = readFileSync(resolve("src", "lib", "dashboard-tools.ts"), "utf8");
const routes = [...registry.matchAll(/href:\s*"([^"?]+)"/g)].map((match) => match[1]);
const uniqueRoutes = [...new Set(routes)];
const requestedRoutes = (process.env.DASHBOARD_QA_ROUTES || "")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const routesUnderTest = requestedRoutes.length > 0
  ? uniqueRoutes.filter((route) => requestedRoutes.includes(route))
  : uniqueRoutes;
const runPositionCrawlRequested = process.env.RUN_POSITION_CRAWL === "1";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const serverErrors = [];
const serverErrorReads = [];
let activeRoute = "/login";

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ route: activeRoute, text: message.text().slice(0, 500) });
});
page.on("pageerror", (error) => pageErrors.push({ route: activeRoute, text: error.message.slice(0, 500) }));
page.on("response", (response) => {
  if (response.status() >= 500) {
    const record = { route: activeRoute, status: response.status(), url: response.url(), body: "" };
    serverErrors.push(record);
    serverErrorReads.push(response.text().then((body) => { record.body = body.slice(0, 1000); }).catch(() => {}));
  }
});

await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
if (page.url().includes("/login")) {
  await page.getByLabel("Login").fill(username);
  await page.getByLabel("Mot de passe").fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 }),
    page.getByRole("button", { name: "Se connecter" }).click(),
  ]);
}
console.log(`[qa] authenticated at ${new URL(page.url()).pathname}`);

const results = [];
for (const route of routesUnderTest) {
  activeRoute = route;
  console.log(`[qa] ${results.length + 1}/${uniqueRoutes.length} ${route}`);
  let response = null;
  let navigationError = null;
  const scannerReady = route === "/scanner"
    ? page.waitForResponse(
        (candidate) => candidate.url().includes("/api/opportunities/scan") && candidate.request().method() === "GET",
        { timeout: 15000 }
      ).catch(() => null)
    : null;
  try {
    response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 12000 });
  } catch (error) {
    navigationError = error instanceof Error ? error.message.slice(0, 300) : "navigation timeout";
  }
  if (scannerReady) await scannerReady;
  await page.waitForTimeout(150);
  const title = await page.locator("h1").first().textContent().catch(() => null);
  const body = (await page.locator("body").innerText()).slice(0, 20000);
  const encodingError = /\uFFFD|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â[\u0080-\u00BF]|ðŸ|ï¸/.test(body);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  const accessibility = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id).filter(Boolean);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const accessibleName = (element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
        : "";
      const ownLabel = element.id
        ? [...document.querySelectorAll("label")].find((label) => label.htmlFor === element.id)?.textContent || ""
        : "";
      const wrappingLabel = element.closest("label")?.textContent || "";
      const imageAlt = [...element.querySelectorAll("img")].map((image) => image.alt).join(" ");
      const isFormControl = element.matches("input, select, textarea");
      const buttonInputValue = element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)
        ? element.value
        : "";
      const semanticText = isFormControl ? buttonInputValue : element.textContent;
      return [
        element.getAttribute("aria-label"), labelledText, ownLabel, wrappingLabel,
        element.getAttribute("title"), semanticText, imageAlt,
      ].filter(Boolean).join(" ").trim();
    };
    const unnamedInteractive = [...document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, textarea')]
      .filter((element) => !element.hasAttribute("disabled") && accessibleName(element).length === 0)
      .slice(0, 10)
      .map((element) => element.outerHTML.slice(0, 300));
    const missingImageAlt = [...document.querySelectorAll("img:not([alt])")]
      .slice(0, 10)
      .map((element) => element.outerHTML.slice(0, 300));
    return {
      htmlLang: document.documentElement.lang,
      h1Count: document.querySelectorAll("h1").length,
      duplicateIds,
      unnamedInteractive,
      missingImageAlt,
    };
  });
  results.push({
    route,
    status: response?.status() ?? null,
    title: title?.trim() || null,
    loginRedirect: page.url().includes("/login"),
    applicationError: /Application error|Internal Server Error|Unhandled Runtime Error/i.test(body),
    encodingError,
    overflow,
    navigationError,
    accessibility,
  });
}

activeRoute = "/dashboard";
await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(700);
const firstDomainButton = page.locator('button[aria-controls^="site-panel-"]').first();
if (await firstDomainButton.count()) {
  await firstDomainButton.click();
  await page.getByRole("tab", { name: /Mots clés/i }).first().waitFor({ state: "visible", timeout: 10000 });
}
await page.getByRole("button", { name: "Ouvrir l'assistant IA" }).click();
await page.getByRole("dialog", { name: "Assistant IA SEO" }).waitFor({ state: "visible" });
await page.keyboard.press("Escape");
await page.getByRole("dialog", { name: "Assistant IA SEO" }).waitFor({ state: "detached" });
await page.screenshot({ path: resolve(artifactDir, "dashboard-desktop.png"), fullPage: true });

activeRoute = "/positions";
await page.goto(`${baseUrl}/positions`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "Positions et mots-clés par domaine" }).waitFor({ state: "visible" });
await page.getByTestId("position-domain").first().waitFor({ state: "visible", timeout: 20000 });
const positionDomainCount = await page.getByTestId("position-domain").count();
const seoSwissPresent = await page.getByTestId("position-domain").filter({ hasText: /SEO Swiss|seo-swiss\.ch/i }).count();
await page.locator('button[data-testid="position-domain"][aria-pressed="true"]').first().waitFor({ state: "visible", timeout: 20000 });
await page.getByRole("status").filter({ hasText: /Chargement des positions/i }).waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
await page.screenshot({ path: resolve(artifactDir, "positions-desktop.png"), fullPage: true });

activeRoute = "/ai-prompts";
await page.goto(`${baseUrl}/ai-prompts`, { waitUntil: "domcontentloaded" });
await page.getByPlaceholder("ex: logiciel comptabilité PME").fill("SEO local suisse");
await page.getByRole("button", { name: "Générer 30 prompts" }).click();
await page.getByText("30 prompts générés localement sans API.").waitFor({ state: "visible", timeout: 10000 });
const generatedPrompts = await page.getByTestId("prompt-item").count();

activeRoute = "/ai-visibility";
await page.goto(`${baseUrl}/ai-visibility?query=meilleur%20outil%20seo%20suisse`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  (expected) => [...document.querySelectorAll("input")].some((input) => input.value === expected),
  "meilleur outil seo suisse",
  { timeout: 10000 }
).catch(() => {});
const prefilledQuery = await page.locator("input").evaluateAll(
  (inputs, expected) => inputs.filter((input) => input instanceof HTMLInputElement && input.value === expected).length,
  "meilleur outil seo suisse"
);

await page.setViewportSize({ width: 375, height: 812 });
activeRoute = "/dashboard";
await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
await page.getByRole("dialog", { name: "SEO Dashboard" }).waitFor({ state: "visible" });
await page.keyboard.press("Escape");
await page.getByRole("dialog", { name: "SEO Dashboard" }).waitFor({ state: "detached" });
const mobileDashboardOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
await page.screenshot({ path: resolve(artifactDir, "dashboard-mobile.png"), fullPage: true });

activeRoute = "/positions";
await page.goto(`${baseUrl}/positions`, { waitUntil: "domcontentloaded" });
await page.getByTestId("position-domain").first().waitFor({ state: "visible", timeout: 20000 });
const mobilePositionsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
await page.screenshot({ path: resolve(artifactDir, "positions-mobile.png"), fullPage: true });
await page.waitForTimeout(500);

let positionCrawl = null;
let positionCrawlVerification = null;
if (runPositionCrawlRequested) {
  activeRoute = "/positions#crawl";
  console.log("[qa] launching authenticated 45-day portfolio position crawl");
  positionCrawl = await page.evaluate(async () => {
    const response = await fetch("/api/position-crawl?days=45&concurrency=2", { method: "POST" });
    return { statusCode: response.status, body: await response.json() };
  });
  console.log(`[qa] position crawl finished with HTTP ${positionCrawl.statusCode}`);
  positionCrawlVerification = await page.evaluate(async () => {
    const response = await fetch("/api/position-crawl?days=45&page=1&limit=100&filter=all&sort=impressions&direction=desc");
    const body = await response.json();
    const seoSwiss = Array.isArray(body.sites)
      ? body.sites.find((site) => /seo-swiss\.ch/i.test(`${site.name} ${site.url}`))
      : null;
    return {
      statusCode: response.status,
      success: body.success === true,
      summary: body.summary ?? null,
      latestRun: body.latest_run ?? null,
      seoSwiss: seoSwiss ?? null,
    };
  });
}
await Promise.allSettled(serverErrorReads);

await browser.close();

const failures = results.filter((result) => result.status !== 200
  || result.loginRedirect
  || result.applicationError
  || result.encodingError
  || result.overflow
  || result.navigationError
  || !result.accessibility.htmlLang
  || result.accessibility.h1Count !== 1
  || result.accessibility.duplicateIds.length > 0
  || result.accessibility.unnamedInteractive.length > 0
  || result.accessibility.missingImageAlt.length > 0);
const report = {
  routes: results.length,
  failures,
  consoleErrors,
  pageErrors,
  serverErrors,
  generatedPrompts,
  prefilledQuery: prefilledQuery === 1,
  positionDomainCount,
  seoSwissPresent: seoSwissPresent === 1,
  positionCrawl,
  positionCrawlVerification,
  mobileDashboardOverflow,
  mobilePositionsOverflow,
  artifacts: artifactDir,
};
writeFileSync(resolve(artifactDir, "qa-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (failures.length || pageErrors.length || serverErrors.length || generatedPrompts !== 30 || prefilledQuery !== 1 || positionDomainCount === 0 || seoSwissPresent !== 1 || mobileDashboardOverflow || mobilePositionsOverflow || (runPositionCrawlRequested && positionCrawl?.body?.success !== true) || (runPositionCrawlRequested && positionCrawlVerification?.success !== true)) process.exitCode = 1;
