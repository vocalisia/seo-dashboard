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

## Observability
- Sentry: set SENTRY_DSN + NEXT_PUBLIC_SENTRY_DSN env vars in Vercel (free tier sentry.io/signup). Optional build-time: SENTRY_ORG, SENTRY_PROJECT, SENTRY_AUTH_TOKEN for source maps.
- Structured logging: use `import { logger, logError } from "@/lib/logger"` instead of console.*
- Log level via LOG_LEVEL env (debug/info/warn/error). Dev defaults to debug+pretty, prod defaults to info+JSON.
- Incremental migration: 5 files already use logger (competitors, ai/assistant, 2 cron jobs, lib/ai). Migrate remaining `console.*` opportunistically.
