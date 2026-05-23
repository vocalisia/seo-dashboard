<!-- BEGIN: seo-notouch-rules -->
## SEO No-Touch Zones — RÈGLES STRICTES (lues par tout AI agent avant Edit)

Le repo a un `scripts/seo-tag-guard.cjs` (prebuild) qui **BLOQUE** Vercel si certaines règles sont violées. Avant toute modification de fichiers `layout.tsx` / `page.tsx` / template, respecter :

### Interdictions absolues (build fail si violé)

1. **JAMAIS inverser la logique GA4 consent**
   - ✗ Interdit : `rejected ? 'granted' : 'denied'`
   - ✓ Correct : `rejected ? 'denied' : 'granted'`
   - Raison : un utilisateur qui REFUSE le consent doit avoir tracking DÉSACTIVÉ.

2. **JAMAIS hardcoder `noindex` dans le layout principal**
   - ✗ Interdit : `<meta name="robots" content="noindex">` global
   - ✓ Si besoin par route : utiliser `robots.ts` ou `generateMetadata` ciblé.

3. **JAMAIS retirer `<html lang="...">`**
   - Casse accessibilité + signal hreflang Google.

4. **JAMAIS retirer `metadataBase`** dans la Metadata
   - Sans lui, `og:image` et `canonical` relatifs deviennent invalides.

### Règles fortes (warning au build, sera bloquant à terme)

5. **JAMAIS retirer le snippet `gtag('consent', 'default', ...)`** s'il est présent — exigé pour RGPD EU.
6. **JAMAIS dupliquer le snippet gtag.js** — chaque snippet supplémentaire = double-fire `page_view`, sessions gonflées.
7. **Toujours placer `gtag('consent','default',...)` AVANT le chargement de `gtag.js`** — sinon la 1ʳᵉ page vue est trackée sans consentement.

8. **JAMAIS `<script async src="gtag.js">` direct en JSX (App Router Next.js)** — Next.js hoist les `<script src>` AVANT les `dangerouslySetInnerHTML`, cassant l'ordre consent-first. Utiliser un `createElement` dynamique DANS le script inline :
   ```js
   (function(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-XXX';document.head.appendChild(s);})()
   ```
   Règle `no_raw_gtag_script_src` dans `seo-tag-guard.cjs` — bloque le build si violée.

### Avant de modifier `layout.tsx` / `page.tsx`

1. Run le guard local : `node scripts/seo-tag-guard.cjs`
2. Si CRITICAL → corriger AVANT de commit
3. Le build Vercel exécute le guard en `prebuild` → exit 1 si violé → no deploy

### Bypass d'urgence (à tes risques)

```bash
SEO_GUARD_DISABLE=1 npm run build
```

À utiliser UNIQUEMENT en cas d'urgence prod avec justification dans le commit.
<!-- END: seo-notouch-rules -->
