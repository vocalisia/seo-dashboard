import fs from 'node:fs';
import { google } from 'googleapis';

const envRaw = fs.readFileSync('C:/Users/cohen.000/seo-dashboard/.env.local','utf8');
const m = envRaw.match(/GOOGLE_CREDENTIALS="([\s\S]+?)"\n/);
const creds = JSON.parse(m[1]);
const auth = new google.auth.GoogleAuth({
  credentials:{client_email:creds.client_email, private_key:creds.private_key.replace(/\\n/g,'\n')},
  scopes:['https://www.googleapis.com/auth/webmasters']
});
const sc = google.searchconsole({version:'v1', auth});
const SITE = 'sc-domain:vocalis.pro';

// 1. Pull ALL URLs from search analytics (last 180 days)
console.log('Fetching URL history from GSC...');
const sa = await sc.searchanalytics.query({siteUrl:SITE, requestBody:{
  startDate: new Date(Date.now()-180*86400000).toISOString().slice(0,10),
  endDate: new Date().toISOString().slice(0,10),
  dimensions:['page'], rowLimit: 25000,
}});
const allUrls = new Set((sa.data.rows||[]).map(r=>r.keys[0]));
console.log(`GSC URLs: ${allUrls.size}`);

// 2. Add sitemap URLs
console.log('Fetching sitemap...');
const sm = await (await fetch('https://vocalis.pro/sitemap.xml')).text();
for (const m of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  allUrls.add(m[1]);
}
console.log(`Total URLs to test: ${allUrls.size}`);

// 3. Test HTTP status
const urls = [...allUrls].filter(u=>u.startsWith('https://vocalis.pro/'));
const results = {200:[], 301:[], 308:[], 404:[], 410:[], 500:[], other:[]};
let done=0;
for (const u of urls) {
  try {
    const r = await fetch(u, {method:'HEAD', redirect:'manual'});
    const c = r.status;
    if (results[c]) results[c].push(u);
    else results.other.push([u,c]);
  } catch{ results.other.push([u,'ERR']); }
  done++;
  if (done%50===0) console.log(`  ${done}/${urls.length}`);
}

console.log('\n=== SUMMARY ===');
for (const [k,v] of Object.entries(results)) {
  console.log(`${k}: ${v.length}`);
}

console.log('\n=== 404 URLs ===');
results['404'].forEach(u=>console.log(' ', u));

console.log('\n=== 500 URLs ===');
results['500'].forEach(u=>console.log(' ', u));

console.log('\n=== OTHER (non 2xx/3xx/404) ===');
results.other.forEach(x=>console.log(' ', x));

fs.mkdirSync('C:/tmp/gsc-fix', {recursive:true});
fs.writeFileSync('C:/tmp/gsc-fix/status_results.json', JSON.stringify(results,null,2));
console.log('\nSaved to C:/tmp/gsc-fix/status_results.json');
