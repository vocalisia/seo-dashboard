# seo-dashboard

Dashboard SEO analytics centralisé — aggrège GSC, GA4, Search Console multi-sites.

## Stack
Next.js + Vercel Standard (JAMAIS Turbo)

## Regles
- JAMAIS VAULT 369 LTD dans contenu public
- AI client: Anthropic native (`ANTHROPIC_API_KEY`) prioritaire → Mammouth fallback (budget OUT depuis 2026-05-22)
- OpenAI = images uniquement (DALL-E), pas pour texte
- JAMAIS push Vercel sans test localhost HTTP 200 reel
- GSC service account → Downloads/gsc-service-account.json.json
- API keys → .env.local uniquement, jamais committer
- Build machine = Standard/enhanced (jamais Turbo)
