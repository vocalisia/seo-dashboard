const targets = [
  { site_id: 10, page_url: "https://vocalis.pro/", note: "4 KW: chatbot vocal ia, vocal ai, chatbot vocal, www.vocalis.pro" },
  { site_id: 16, page_url: "https://trust-vault.com/", note: "trustvault" },
  { site_id: 12, page_url: "https://iapmesuisse.ch/", note: "formation ia pme suisse" },
  { site_id: 12, page_url: "https://www.iapmesuisse.ch/fr/services", note: "agence ia pour pme" },
];

const BASE = "https://seo-dashboard-one.vercel.app";

for (const t of targets) {
  console.log(`\n=== ${t.page_url} (${t.note}) ===`);
  try {
    const r = await fetch(`${BASE}/api/content-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: t.site_id, page_url: t.page_url }),
    });
    const text = await r.text();
    if (!r.ok) { console.log(`  HTTP ${r.status}: ${text.slice(0,200)}`); continue; }
    const data = JSON.parse(text);
    if (data.suggestions) {
      console.log(`  STATUS: ${data.status ?? 'ok'}`);
      const s = data.suggestions;
      const summary = JSON.stringify(s).slice(0, 800);
      console.log(`  SUGGESTIONS: ${summary}...`);
    } else {
      console.log(`  ${text.slice(0,300)}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}
