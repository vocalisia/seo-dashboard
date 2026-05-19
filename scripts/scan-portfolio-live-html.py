import urllib.request, urllib.error, re, json, sys
from concurrent.futures import ThreadPoolExecutor

SITES = [
    "https://vocalis.pro/",
    "https://vocalis.blog/",
    "https://vocalis-ai.org/",
    "https://www.vocalis-ai.org/",
    "https://ai-due.com/fr",
    "https://trust-vault.com/fr",
    "https://trustly-ai.com/",
    "https://master-seller.fr/",
    "https://iapmesuisse.ch/",
    "https://seo-true.com/",
    "https://agentic-whatsup.com/",
    "https://lead-gene.com/fr",
    "https://woman-cute.com/",
    "https://factureimpayee.fr/",
    "https://tesla-mag.ch/",
    "https://tesla-mag.ca/",
    "https://cbdeuropa.com/",
    "https://agents-ia.pro/",
    "https://boursier.ch/",
]

def fetch(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (HealthCheck)'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read().decode('utf-8', errors='replace')
        return resp.status, data
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        return 0, str(e)[:100]

def analyze(url, html):
    issues = []
    # GA4 measurement IDs
    ga_ids = list(set(re.findall(r'G-[A-Z0-9]{8,12}', html)))
    has_gtm = bool(re.search(r'GTM-[A-Z0-9]{6,}', html))
    if not ga_ids and not has_gtm:
        issues.append(('CRIT', 'no_ga4', 'No GA4 nor GTM container'))
    elif len(ga_ids) > 1:
        issues.append(('HIGH', 'multi_ga4', f'{len(ga_ids)} GA4 IDs: {ga_ids}'))
    # Consent mode default
    has_consent = bool(re.search(r"gtag\s*\(\s*['\"]consent['\"]\s*,\s*['\"]default['\"]", html))
    has_gtag_js = bool(re.search(r'googletagmanager\.com/gtag/js', html))
    if has_gtag_js and not has_consent:
        issues.append(('CRIT', 'no_consent', 'gtag.js without consent default — RGPD risk'))
    # Inverted pattern (rejected ? granted : denied)
    if re.search(r"rejected\s*\?\s*['\"]granted['\"]\s*:\s*['\"]denied['\"]", html):
        issues.append(('CRIT', 'inverted', "rejected ? granted : denied (tracks on refusal)"))
    # Opt-out pattern (rejected/declined ? denied : granted)
    if re.search(r"(?:rejected|declined)\s*\?\s*['\"]denied['\"]\s*:\s*['\"]granted['\"]", html):
        issues.append(('CRIT', 'opt_out', "rejected/declined ? denied : granted (opt-out, tracks by default)"))
    # Consent after gtag.js position-wise
    consent_pos = -1
    for pat in (r"gtag\s*\(\s*['\"]consent['\"]\s*,\s*['\"]default['\"]",):
        m = re.search(pat, html)
        if m: consent_pos = m.start(); break
    gtag_pos = html.find('googletagmanager.com/gtag/js')
    if consent_pos > -1 and gtag_pos > -1 and consent_pos > gtag_pos:
        issues.append(('CRIT', 'consent_after', f'Consent default AFTER gtag.js (Next.js hoisting bug)'))
    return ga_ids, issues

def scan(url):
    status, html = fetch(url)
    if status != 200:
        return url, status, [], [('ERR', 'http', f'status {status}')]
    ga_ids, issues = analyze(url, html)
    return url, status, ga_ids, issues

with ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(scan, SITES))

print(f"\n{'='*90}\nPORTFOLIO SCAN RESULTS\n{'='*90}\n")
total_crit = 0
broken = []
for url, status, ga_ids, issues in results:
    badge = '[OK]   ' if not any(s == 'CRIT' for s,_,_ in issues) else '[BROKEN]'
    ga = ga_ids[0] if ga_ids else 'NO_GA4'
    print(f"{badge} {url:45} GA4={ga:18} {status}")
    crits = [i for i in issues if i[0] == 'CRIT']
    total_crit += len(crits)
    if crits:
        broken.append(url)
        for sev, code, msg in crits:
            print(f"          [{sev}] {code}: {msg}")
print(f"\n{'='*90}\nTotal CRITICAL: {total_crit} across {len(broken)} sites\n{'='*90}\n")
