import { resolveSiteRepoConfig, isPublishBlockedByDomain } from "../src/lib/autopilot-config";

const portfolioSites = [
  { name: "vocalis-pro", url: "https://vocalis.pro" },
  { name: "Vocalis Pro", url: "https://vocalis.pro" },
  { name: "vocalis-blog", url: "https://vocalis.blog" },
  { name: "vocalis.blog", url: "https://vocalis.blog" },
  { name: "tesla-mag", url: "https://tesla-mag.ch" },
  { name: "Tesla Mag", url: "https://tesla-mag.ch" },
  { name: "TeslaMag", url: "https://tesla-mag.ch" },
  { name: "tesla-mag.ch", url: "https://tesla-mag.ch" },
  { name: "master-seller", url: "https://master-seller.fr" },
  { name: "MasterSeller", url: "https://master-seller.fr" },
  { name: "iapmesuisse", url: "https://iapmesuisse.ch" },
  { name: "iapme-suisse", url: "https://iapmesuisse.ch" },
  { name: "seo-true", url: "https://seo-true.com" },
  { name: "SEOTrue", url: "https://seo-true.com" },
  { name: "trustly", url: "https://trustly-ai.com" },
  { name: "trustly-ai", url: "https://trustly-ai.com" },
  { name: "trust-vault", url: "https://trust-vault.com" },
  { name: "TrustVault", url: "https://trust-vault.com" },
  { name: "ai-due", url: "https://ai-due.com" },
  { name: "hub-ai", url: "https://ai-due.com" },
  { name: "cbd", url: "https://cbdeuropa.com" },
  { name: "cbdeuropa", url: "https://cbdeuropa.com" },
  { name: "agents-ia", url: "https://agents-ia.pro" },
  { name: "AgentsIA", url: "https://agents-ia.pro" },
  { name: "whatsapp", url: "https://agentic-whatsup.com" },
  { name: "agentic-whatsup", url: "https://agentic-whatsup.com" },
  { name: "lead-gene", url: "https://lead-gene.com" },
  { name: "vocalis-ai", url: "https://vocalis-ai.org" },
  { name: "VocalisAI", url: "https://vocalis-ai.org" },
  { name: "factureimpayée", url: "https://factureimpayée.fr" },
  { name: "Facture Impayée", url: "https://factureimpayée.fr" },
  { name: "woman-cute", url: "https://woman-cute.com" },
  { name: "fitness", url: "https://www.fitnessmaison.fr" },
];

console.log("SITE NAME".padEnd(24) + " | " + "URL".padEnd(33) + " | " + "RESOLVED".padEnd(18) + " | URL-BLOCK | STATUS");
console.log("-".repeat(120));

let pubCount = 0, blockCount = 0, errorCount = 0;
for (const site of portfolioSites) {
  const { siteKey, repoConfig } = resolveSiteRepoConfig(site.name);
  const blocked = isPublishBlockedByDomain(site.url);
  const configEnabled = repoConfig?.enabled !== false;
  
  let status: string;
  if (blocked) { status = "BLOCKED-URL ✅"; blockCount++; }
  else if (!repoConfig) { status = "NO-CONFIG (silent skip)"; errorCount++; }
  else if (!configEnabled) { status = "DISABLED-CONFIG ✅"; blockCount++; }
  else { status = "PUBLISH ✅"; pubCount++; }
  
  console.log(
    site.name.padEnd(24) + " | " +
    site.url.padEnd(33) + " | " +
    (siteKey ?? "(null)").padEnd(18) + " | " +
    String(blocked).padEnd(9) + " | " +
    status
  );
}
console.log("-".repeat(120));
console.log(`TOTAL ${portfolioSites.length} | Publish: ${pubCount} | Blocked: ${blockCount} | No-config: ${errorCount}`);
