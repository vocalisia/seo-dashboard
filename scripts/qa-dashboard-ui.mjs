import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const startedAt = new Date();

function normalizeBaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("DASHBOARD_QA_URL must use HTTP or HTTPS");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("DASHBOARD_QA_URL must be a credential-free origin without a path, query, or hash");
  }
  return url.origin;
}

function currentCommitSha() {
  const candidates = [process.env.VERCEL_GIT_COMMIT_SHA, process.env.GITHUB_SHA, process.env.CI_COMMIT_SHA];
  for (const candidate of candidates) {
    if (/^[0-9a-f]{7,40}$/i.test(candidate || "")) return candidate;
  }
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : "unknown";
  } catch {
    return "unknown";
  }
}

const baseUrl = normalizeBaseUrl(process.env.DASHBOARD_QA_URL || "http://localhost:3091");
const commitSha = currentCommitSha();
const artifactDir = resolve("data", "qa-dashboard");
const artifactPath = "data/qa-dashboard";

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
const runLiveActions = env.DASHBOARD_QA_LIVE_ACTIONS === "true";
const username = env.DASHBOARD_AUTH_USER || env.BASIC_AUTH_USER;
const password = env.DASHBOARD_AUTH_PASSWORD || env.BASIC_AUTH_PASS || env.LOCAL_DEV_PASSWORD;
if (!username || !password) throw new Error("Dashboard QA credentials are not configured");

const sensitiveValues = [...new Set([
  username,
  password,
  ...Object.entries(env)
    .filter(([key, value]) => typeof value === "string" && value.length > 0 && /(?:PASSWORD|PASS|SECRET|TOKEN|API_KEY|PRIVATE_KEY)/i.test(key))
    .map(([, value]) => value),
])].sort((left, right) => right.length - left.length);

function sanitizeText(value, maxLength = 1000) {
  let safe = String(value ?? "");
  for (const sensitiveValue of sensitiveValues) safe = safe.split(sensitiveValue).join("[REDACTED]");
  safe = safe
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|api_key|auth|authorization|code|key|password|secret|token)=)[^&\s#]+/gi, "$1[REDACTED]");
  return safe.slice(0, maxLength);
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return sanitizeText(rawUrl, 500);
  }
}

function sanitizeForReport(value) {
  if (typeof value === "string") return sanitizeText(value, 20000);
  if (Array.isArray(value)) return value.map(sanitizeForReport);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeForReport(entry)]));
  }
  return value;
}

const registry = readFileSync(resolve("src", "lib", "dashboard-tools.ts"), "utf8");
const routes = [...registry.matchAll(/href:\s*"([^"?]+)"/g)].map((match) => match[1]);
const uniqueRoutes = [...new Set(routes)];
if (uniqueRoutes.length === 0) throw new Error("No dashboard routes were found in the route registry");

const routeSelection = env.DASHBOARD_QA_ROUTES;
let routesUnderTest = uniqueRoutes;
if (routeSelection !== undefined) {
  const routeEntries = routeSelection.split(",").map((route) => route.trim());
  if (!routeSelection.trim() || routeEntries.some((route) => route.length === 0)) {
    throw new Error("DASHBOARD_QA_ROUTES must contain at least one non-empty route and no empty entries");
  }
  const requestedRoutes = [...new Set(routeEntries)];
  const unknownRoutes = requestedRoutes.filter((route) => !uniqueRoutes.includes(route));
  if (unknownRoutes.length > 0) throw new Error(`Unknown DASHBOARD_QA_ROUTES: ${unknownRoutes.join(", ")}`);
  routesUnderTest = requestedRoutes;
}
if (routesUnderTest.length === 0) throw new Error("DASHBOARD_QA_ROUTES resolved to no routes");

if (Object.prototype.hasOwnProperty.call(env, "RUN_POSITION_CRAWL")) {
  throw new Error("RUN_POSITION_CRAWL is disabled: dashboard QA is read-only and never starts a position crawl");
}

mkdirSync(artifactDir, { recursive: true });

let browser = null;
try {
browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const blockedMutations = [];
let activeRoute = "/login";
const safePostPaths = new Set(["/api/ai-prompts/generate"]);
if (runLiveActions) {
  safePostPaths.add("/api/pagerank");
  safePostPaths.add("/api/ai/assistant");
  safePostPaths.add("/api/keywords-pro/cluster");
  safePostPaths.add("/api/youtube/scan");
}
await context.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const method = request.method();
  const authRequest = pathname.startsWith("/api/auth/");
  if (["GET", "HEAD"].includes(method) || authRequest || (method === "POST" && safePostPaths.has(pathname))) {
    await route.continue();
    return;
  }
  blockedMutations.push({ route: activeRoute, method, url: sanitizeUrl(request.url()) });
  await route.abort("blockedbyclient");
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
let ignoredNavigationAborts = 0;
let ignoredAuthSessionAborts = 0;
const ignoredNavigationAbortSamples = [];
const unexpectedHttpErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ route: activeRoute, text: sanitizeText(message.text(), 500) });
});
page.on("pageerror", (error) => pageErrors.push({ route: activeRoute, text: sanitizeText(error.message, 500) }));
page.on("requestfailed", (request) => {
  const errorText = request.failure()?.errorText || "request failed";
  const expectedNavigationAbort = request.method() === "GET"
    && request.resourceType() !== "document"
    && /(?:net::ERR_ABORTED|NS_BINDING_ABORTED)/i.test(errorText);
  if (expectedNavigationAbort) {
    ignoredNavigationAborts += 1;
    if (new URL(request.url()).pathname === "/api/auth/session") ignoredAuthSessionAborts += 1;
    if (ignoredNavigationAbortSamples.length < 25) {
      ignoredNavigationAbortSamples.push({
        route: activeRoute,
        method: request.method(),
        resourceType: request.resourceType(),
        url: sanitizeUrl(request.url()),
      });
    }
    return;
  }
  requestFailures.push({
    route: activeRoute,
    method: request.method(),
    resourceType: request.resourceType(),
    url: sanitizeUrl(request.url()),
    error: sanitizeText(errorText, 500),
  });
});
page.on("response", (response) => {
  if (response.status() >= 400) {
    unexpectedHttpErrors.push({
      route: activeRoute,
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      status: response.status(),
      statusText: sanitizeText(response.statusText(), 200),
      url: sanitizeUrl(response.url()),
    });
  }
});

function waitForPositionDetailResponse() {
  return page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.origin === baseUrl
      && url.pathname === "/api/position-crawl"
      && candidate.request().method() === "GET"
      && url.searchParams.has("site_id");
  }, { timeout: 20000 });
}

async function waitForPositionsReady(detailResponsePromise, { mobile = false } = {}) {
  const detailResponse = await detailResponsePromise;
  if (!detailResponse.ok()) throw new Error(`Positions detail request failed with HTTP ${detailResponse.status()}`);
  const domainReady = mobile
    ? Promise.all([
        page.locator("#mobile-position-domain").waitFor({ state: "visible", timeout: 20000 }),
        page.waitForFunction(() => {
          const select = document.querySelector("#mobile-position-domain");
          return select instanceof HTMLSelectElement && select.value.length > 0;
        }, undefined, { timeout: 20000 }),
      ])
    : Promise.all([
        page.getByTestId("position-domain").first().waitFor({ state: "visible", timeout: 20000 }),
        page.locator('button[data-testid="position-domain"][aria-pressed="true"]').first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
  await Promise.all([
    page.getByRole("heading", { name: "Positions et mots-clés par domaine" }).waitFor({ state: "visible", timeout: 20000 }),
    domainReady,
    page.getByRole("status").filter({ hasText: /Chargement des positions/i }).waitFor({ state: "detached", timeout: 20000 }),
  ]);
  return detailResponse;
}

async function gotoPositions(options) {
  const readyPromise = waitForPositionsReady(waitForPositionDetailResponse(), options);
  const [navigationResponse] = await Promise.all([
    page.goto(`${baseUrl}/positions`, { waitUntil: "domcontentloaded", timeout: 20000 }),
    readyPromise,
  ]);
  return navigationResponse;
}

activeRoute = "/positions";
await page.goto(`${baseUrl}/positions`, { waitUntil: "domcontentloaded" });
if (!page.url().includes("/login")) {
  await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 10000 });
}
const loginUrl = new URL(page.url());
const requestedCallback = loginUrl.searchParams.get("callbackUrl") ?? "";
const deepLinkCallbackPresent = requestedCallback.includes("/positions");
await page.getByLabel("Login").fill(username);
await page.getByLabel("Mot de passe").fill(password);
await Promise.all([
  page.waitForURL((url) => url.pathname === "/positions", { timeout: 20000 }),
  page.getByRole("button", { name: "Se connecter" }).click(),
]);
const deepLinkReturned = new URL(page.url()).pathname === "/positions";
console.log(`[qa] authenticated at ${new URL(page.url()).pathname}`);

activeRoute = "/api/auth/session";
const authSession = await page.evaluate(async () => {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The report records only the status and authentication boolean, never the session payload.
  }
  return {
    status: response.status,
    authenticated: Boolean(payload && typeof payload === "object" && payload.user),
  };
});
if (authSession.status !== 200 || !authSession.authenticated) {
  throw new Error(`Authenticated session check failed with HTTP ${authSession.status}`);
}
console.log("[qa] authenticated session verified");

const results = [];
for (const route of routesUnderTest) {
  activeRoute = route;
  console.log(`[qa] ${results.length + 1}/${routesUnderTest.length} ${route}`);
  let response = null;
  let navigationError = null;
  const positionsReady = route === "/positions"
    ? waitForPositionsReady(waitForPositionDetailResponse())
    : null;
  const scannerReady = route === "/scanner"
    ? page.waitForResponse(
        (candidate) => candidate.url().includes("/api/opportunities/scan") && candidate.request().method() === "GET",
        { timeout: 15000 }
      ).catch(() => null)
    : null;
  try {
    const navigation = page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (positionsReady) {
      [response] = await Promise.all([navigation, positionsReady]);
    } else {
      response = await navigation;
    }
  } catch (error) {
    navigationError = sanitizeText(error instanceof Error ? error.message : "navigation timeout", 300);
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
    title: title ? sanitizeText(title.trim(), 300) : null,
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
await gotoPositions();
const positionDomainCount = await page.getByTestId("position-domain").count();
const seoSwissPresent = await page.getByTestId("position-domain").filter({ hasText: /SEO Swiss|seo-swiss\.ch/i }).count();
const positionPageSize = await page.getByLabel("Nombre de mots-clés par page").inputValue();
const positionRowsOnFirstPage = await page.locator("table tbody tr").count();
await page.screenshot({ path: resolve(artifactDir, "positions-desktop.png"), fullPage: true });

activeRoute = "/ai-prompts";
await page.goto(`${baseUrl}/ai-prompts`, { waitUntil: "domcontentloaded" });
await page.getByPlaceholder("ex: logiciel comptabilité PME").fill("SEO local suisse");
await page.getByRole("button", { name: "Générer 30 prompts" }).click();
await page.getByText("30 prompts générés localement sans API.").waitFor({ state: "visible", timeout: 10000 });
const generatedPrompts = await page.getByTestId("prompt-item").count();

activeRoute = "/autopilot";
await page.goto(`${baseUrl}/autopilot`, { waitUntil: "domcontentloaded" });
await page.getByText("Publication automatique verrouillée", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
const scheduledPublicationLocked = await page.getByText("Publication automatique verrouillée", { exact: true }).count() === 1;

const liveActionChecks = [];
if (runLiveActions) {
  activeRoute = "/api/sites";
  const actionSite = await page.evaluate(async () => {
    const response = await fetch("/api/sites", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    const sites = Array.isArray(payload) ? payload : (payload?.sites ?? []);
    const eligible = sites.filter((site) => typeof site?.url === "string" && /^https?:\/\//i.test(site.url));
    const site = eligible.find((candidate) => /seo[- ]?swiss|seo-swiss\.ch/i.test(`${candidate.name} ${candidate.url}`)) ?? eligible[0] ?? null;
    return {
      status: response.status,
      site: site ? {
        id: site.id,
        name: site.name,
        url: site.url,
        gscConfigured: Boolean(site.gsc_property),
        ga4Configured: Boolean(site.ga_property_id),
      } : null,
    };
  });
  liveActionChecks.push({ name: "live-action-site", passed: actionSite.status === 200 && Boolean(actionSite.site), status: actionSite.status });

  if (actionSite.site) {
    liveActionChecks.push({
      name: "site-search-analytics-properties",
      passed: actionSite.site.gscConfigured && actionSite.site.ga4Configured,
      gscConfigured: actionSite.site.gscConfigured,
      ga4Configured: actionSite.site.ga4Configured,
    });

    activeRoute = "/api/position-crawl";
    const positionAction = await page.evaluate(async (site) => {
      const query = new URLSearchParams({ site_id: String(site.id), page: "1", limit: "20" });
      const response = await fetch(`/api/position-crawl?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      const selected = payload?.sites?.find((candidate) => candidate.id === site.id) ?? null;
      return {
        status: response.status,
        success: payload?.success === true,
        keywords: payload?.keywords?.total ?? 0,
        gscConfigured: selected?.gsc_configured === true,
        dataStatus: selected?.data_status ?? null,
      };
    }, actionSite.site);
    liveActionChecks.push({
      name: "site-position-keywords",
      passed: positionAction.status === 200 && positionAction.success && positionAction.gscConfigured && positionAction.keywords > 0,
      status: positionAction.status,
      keywords: positionAction.keywords,
      gscConfigured: positionAction.gscConfigured,
      dataStatus: positionAction.dataStatus,
    });

    activeRoute = "/api/ga4-traffic";
    const analyticsAction = await page.evaluate(async (site) => {
      const query = new URLSearchParams({ siteId: String(site.id), window: "28d" });
      const response = await fetch(`/api/ga4-traffic?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      const result = payload?.sites?.find((candidate) => candidate.site_id === site.id) ?? null;
      return {
        status: response.status,
        success: payload?.success === true,
        configured: Boolean(result?.ga_property_id),
        error: result?.error ?? null,
        fetched: Boolean(result?.fetched_at),
      };
    }, actionSite.site);
    liveActionChecks.push({
      name: "ga4-live-query",
      passed: analyticsAction.status === 200 && analyticsAction.success && analyticsAction.configured && !analyticsAction.error && analyticsAction.fetched,
      status: analyticsAction.status,
      configured: analyticsAction.configured,
      error: analyticsAction.error ? sanitizeText(analyticsAction.error, 300) : null,
      fetched: analyticsAction.fetched,
    });

    activeRoute = "/api/keywords-pro/cluster";
    const clusterAction = await page.evaluate(async () => {
      const response = await fetch("/api/keywords-pro/cluster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords: ["seo suisse", "agence seo suisse", "audit seo suisse", "seo genève"] }),
      });
      const payload = await response.json().catch(() => null);
      return { status: response.status, success: payload?.success === true, source: payload?.source, clusters: payload?.clusters?.length ?? 0 };
    });
    liveActionChecks.push({
      name: "local-keyword-clustering",
      passed: clusterAction.status === 200 && clusterAction.success && clusterAction.source === "local_semantic_tokens" && clusterAction.clusters > 0,
      status: clusterAction.status,
      clusters: clusterAction.clusters,
      source: clusterAction.source,
    });

    activeRoute = "/api/ai/assistant";
    const researchAction = await page.evaluate(async () => {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "research", prompt: "SEO local suisse bonnes pratiques officielles" }),
      });
      const payload = await response.json().catch(() => null);
      return {
        status: response.status,
        success: payload?.success === true,
        sources: payload?.sources?.length ?? 0,
        dataStatus: payload?.data_status ?? null,
      };
    });
    liveActionChecks.push({
      name: "sourced-web-research",
      passed: researchAction.status === 200 && researchAction.success && researchAction.sources > 0 && researchAction.dataStatus !== "unavailable",
      status: researchAction.status,
      sources: researchAction.sources,
      dataStatus: researchAction.dataStatus,
    });

    activeRoute = "/api/pagerank";
    const pageRankAction = await page.evaluate(async (site) => {
      const response = await fetch("/api/pagerank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site_id: site.id, site_url: site.url, max_pages: 30 }),
      });
      const payload = await response.json().catch(() => null);
      return {
        status: response.status,
        error: payload?.error ?? null,
        total: payload?.total ?? 0,
        discovered: payload?.discovered ?? 0,
        crawled: payload?.crawled ?? 0,
        top: payload?.top20?.length ?? 0,
        graphMode: payload?.graph_mode ?? null,
      };
    }, actionSite.site);
    liveActionChecks.push({
      name: "pagerank-live-crawl",
      passed: pageRankAction.status === 200 && !pageRankAction.error && pageRankAction.crawled > 0 && pageRankAction.top > 0,
      status: pageRankAction.status,
      discovered: pageRankAction.discovered,
      crawled: pageRankAction.crawled,
      top: pageRankAction.top,
      graphMode: pageRankAction.graphMode,
    });

    activeRoute = "/api/pagespeed";
    const pageSpeedAction = await page.evaluate(async (site) => {
      const query = new URLSearchParams({ site_id: String(site.id), url: site.url });
      const response = await fetch(`/api/pagespeed?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      return {
        status: response.status,
        error: payload?.error ?? null,
        measurementStatus: payload?.measurement_status ?? null,
        mobile: payload?.mobile?.score ?? null,
        desktop: payload?.desktop?.score ?? null,
        probeMobileTtfb: payload?.origin_probe?.mobile?.ttfb ?? null,
        probeDesktopTtfb: payload?.origin_probe?.desktop?.ttfb ?? null,
        probeMobileStatus: payload?.origin_probe?.mobile?.status_code ?? null,
        probeDesktopStatus: payload?.origin_probe?.desktop?.status_code ?? null,
      };
    }, actionSite.site);
    const validLighthouseMeasurement = ["live", "cache"].includes(pageSpeedAction.measurementStatus)
      && Number.isFinite(pageSpeedAction.mobile)
      && Number.isFinite(pageSpeedAction.desktop);
    const validOriginProbe = pageSpeedAction.measurementStatus === "origin_probe"
      && Number.isFinite(pageSpeedAction.probeMobileTtfb)
      && Number.isFinite(pageSpeedAction.probeDesktopTtfb)
      && Number.isInteger(pageSpeedAction.probeMobileStatus)
      && Number.isInteger(pageSpeedAction.probeDesktopStatus);
    liveActionChecks.push({
      name: "pagespeed-measurement",
      passed: pageSpeedAction.status === 200 && !pageSpeedAction.error && (validLighthouseMeasurement || validOriginProbe),
      status: pageSpeedAction.status,
      measurementStatus: pageSpeedAction.measurementStatus,
      mobile: pageSpeedAction.mobile,
      desktop: pageSpeedAction.desktop,
      probeMobileTtfb: pageSpeedAction.probeMobileTtfb,
      probeDesktopTtfb: pageSpeedAction.probeDesktopTtfb,
      probeMobileStatus: pageSpeedAction.probeMobileStatus,
      probeDesktopStatus: pageSpeedAction.probeDesktopStatus,
    });

    activeRoute = "/api/youtube/scan";
    const youtubeAction = await page.evaluate(async () => {
      const response = await fetch("/api/youtube/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords: ["seo suisse"] }),
      });
      const payload = await response.json().catch(() => null);
      const result = Array.isArray(payload?.results) ? payload.results[0] : null;
      return {
        status: response.status,
        success: payload?.success === true,
        partial: payload?.partial === true,
        error: payload?.error ?? result?.error ?? null,
        channels: result?.topChannels?.length ?? 0,
        videos: result?.recentTopVideos?.length ?? 0,
        monetizationBasis: result?.monetizationBasis ?? null,
        measurementSource: result?.measurementSource ?? null,
      };
    });
    liveActionChecks.push({
      name: "youtube-live-niche-scan",
      passed: youtubeAction.status === 200
        && youtubeAction.success
        && !youtubeAction.partial
        && !youtubeAction.error
        && youtubeAction.channels + youtubeAction.videos > 0
        && youtubeAction.monetizationBasis === "keyword_category_heuristic"
        && ["youtube_data_api", "youtube_public_search"].includes(youtubeAction.measurementSource),
      status: youtubeAction.status,
      channels: youtubeAction.channels,
      videos: youtubeAction.videos,
      monetizationBasis: youtubeAction.monetizationBasis,
      measurementSource: youtubeAction.measurementSource,
      error: youtubeAction.error ? sanitizeText(youtubeAction.error, 300) : null,
    });
  }
}

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
await gotoPositions({ mobile: true });
const mobilePositionsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
await page.screenshot({ path: resolve(artifactDir, "positions-mobile.png"), fullPage: true });

await page.setViewportSize({ width: 320, height: 700 });
activeRoute = "/dashboard";
await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
const narrowDashboardOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
activeRoute = "/positions";
await gotoPositions({ mobile: true });
const narrowPositionsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
await page.waitForTimeout(500);

await browser.close();

const routeFailed = (result) => result.status !== 200
  || result.loginRedirect
  || result.applicationError
  || result.encodingError
  || result.overflow
  || result.navigationError
  || !result.accessibility.htmlLang
  || result.accessibility.h1Count !== 1
  || result.accessibility.duplicateIds.length > 0
  || result.accessibility.unnamedInteractive.length > 0
  || result.accessibility.missingImageAlt.length > 0;
const failures = results.filter(routeFailed);
const successfulRoutes = results.filter((result) => !routeFailed(result));
const checks = [
  { name: "auth-session", passed: authSession.status === 200 && authSession.authenticated, status: authSession.status },
  { name: "auth-deep-link", passed: deepLinkCallbackPresent && deepLinkReturned },
  { name: "generated-prompts", passed: generatedPrompts === 30, actual: generatedPrompts, expected: 30 },
  { name: "scheduled-publication-locked", passed: scheduledPublicationLocked },
  { name: "ai-visibility-prefill", passed: prefilledQuery === 1 },
  { name: "positions-domains", passed: positionDomainCount > 0, actual: positionDomainCount },
  { name: "seo-swiss-position-domain", passed: seoSwissPresent === 1 },
  { name: "positions-pagination", passed: positionPageSize === "25" && positionRowsOnFirstPage <= 25, pageSize: positionPageSize, rows: positionRowsOnFirstPage },
  { name: "mobile-dashboard-overflow", passed: !mobileDashboardOverflow },
  { name: "mobile-positions-overflow", passed: !mobilePositionsOverflow },
  { name: "narrow-dashboard-overflow", passed: !narrowDashboardOverflow, viewport: 320 },
  { name: "narrow-positions-overflow", passed: !narrowPositionsOverflow, viewport: 320 },
  ...liveActionChecks,
];
const failedChecks = checks.filter((check) => !check.passed);
const successfulChecks = checks.filter((check) => check.passed);
let authSessionAbortBudget = ignoredAuthSessionAborts;
const ignoredConsoleErrors = [];
const actionableConsoleErrors = consoleErrors.filter((entry) => {
  const expectedAuthAbort = authSessionAbortBudget > 0
    && /Failed to fetch[\s\S]*errors\.authjs\.dev#autherror/i.test(entry.text);
  if (!expectedAuthAbort) return true;
  authSessionAbortBudget -= 1;
  ignoredConsoleErrors.push(entry);
  return false;
});
const hasFailures = failures.length > 0
  || failedChecks.length > 0
  || actionableConsoleErrors.length > 0
  || pageErrors.length > 0
  || requestFailures.length > 0
  || blockedMutations.length > 0
  || unexpectedHttpErrors.length > 0;
const report = {
  metadata: {
    date: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    sha: commitSha,
    baseUrl,
    readOnly: !runLiveActions,
    liveActions: runLiveActions,
    ignoredNavigationAborts,
    ignoredAuthSessionAborts,
    ignoredNavigationAbortSamples,
  },
  summary: {
    routes: results.length,
    successfulRoutes: successfulRoutes.length,
    failedRoutes: failures.length,
    successfulChecks: successfulChecks.length,
    failedChecks: failedChecks.length,
    passed: !hasFailures,
  },
  successfulResults: {
    routes: successfulRoutes,
    checks: successfulChecks,
  },
  failures,
  failedChecks,
  consoleErrors: actionableConsoleErrors,
  ignoredConsoleErrors,
  pageErrors,
  requestFailures,
  blockedMutations,
  unexpectedHttpErrors,
  generatedPrompts,
  prefilledQuery: prefilledQuery === 1,
  positionDomainCount,
  positionPageSize,
  positionRowsOnFirstPage,
  seoSwissPresent: seoSwissPresent === 1,
  mobileDashboardOverflow,
  mobilePositionsOverflow,
  narrowDashboardOverflow,
  narrowPositionsOverflow,
  artifacts: artifactPath,
};
const safeReport = sanitizeForReport(report);
writeFileSync(resolve(artifactDir, "qa-report.json"), JSON.stringify(safeReport, null, 2));
console.log(JSON.stringify(safeReport, null, 2));

if (hasFailures) process.exitCode = 1;
} catch (error) {
  console.error(`[qa] failed: ${sanitizeText(error instanceof Error ? error.message : error, 1000)}`);
  process.exitCode = 1;
} finally {
  if (browser?.isConnected()) await browser.close();
}
