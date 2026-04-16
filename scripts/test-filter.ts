import { isUnusableSeoKeyword } from "../src/lib/autopilot-keywords";

const cases: Array<[string, {name:string,url:string}, string]> = [
  ["site:tesla-mag.ch", {name:"Tesla Mag",url:"https://tesla-mag.ch"}, "fr"],
  ["www.vocalis.pro", {name:"Vocalis Pro",url:"https://vocalis.pro"}, "fr"],
  ["iapme", {name:"IAPME Suisse",url:"https://iapmesuisse.ch"}, "fr"],
  ["trustvault", {name:"Trust Vault",url:"https://trust-vault.com"}, "fr"],
  ["vocalis", {name:"Vocalis Pro",url:"https://vocalis.pro"}, "fr"],
  ["whatsapp marketing kampagnen", {name:"Agentic WhatsApp",url:"https://agentic-whatsup.com"}, "fr"],
  ["automazione ia aziendale", {name:"AI-Due",url:"https://ai-due.com"}, "fr"],
  ["seller master", {name:"Master Seller",url:"https://master-seller.fr"}, "fr"],
  ["celebrity news", {name:"Woman Cute",url:"https://womancute.com"}, "fr"],
  ["best home gym", {name:"Fitness Home Workouts",url:"https://fitnessmaison.vercel.app"}, "fr"],
  ["dsgvo ai outreach", {name:"Lead-Gene",url:"https://lead-gene.com"}, "fr"],
  ["guidecbd com", {name:"CBD Europa",url:"https://cbdeuropa.com"}, "fr"],
  ["agent intelligence artificielle pro", {name:"Agents IA Pro",url:"https://agents-ia.pro"}, "fr"],
  ["vocalis ia", {name:"Vocalis Pro",url:"https://vocalis.pro"}, "fr"],
  ["comment automatiser son service client avec un agent ia", {name:"Vocalis Pro",url:"https://vocalis.pro"}, "fr"],
];
for (const [q, s, l] of cases) {
  console.log((isUnusableSeoKeyword(q, s, l) ? "❌ BLOCKED" : "✅ ACCEPT ") + "  " + q + "  [" + s.name + "]");
}
