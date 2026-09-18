# PlanillaInteligente

SaaS que convierte planillas Excel en aplicaciones web usables.

## Scripts (desde la raíz)

- `npm run dev` — workspace autenticado (`apps/web-workspace`, puerto 4321)
- `npm run dev:landing` — landing de marketing (`apps/web-landing`, puerto 4322)
- `npm run test:local` — `npm ci` + typecheck + Astro check + build de workspace y landing
- `npm run build` — build de workspace y landing
- `npm run db:generate` / `npm run db:migrate` / `npm run db:migrate:preview`

## Setup local

1. `npm ci`
2. Copiar `apps/web-workspace/.dev.vars.example` → `apps/web-workspace/.dev.vars` y completar secretos (no commitear `.dev.vars`).
3. `npm run dev` para el workspace. Bindings de Cloudflare se simulan con `platformProxy`.
4. `npm run dev:landing` para la landing. El CTA usa `PUBLIC_APP_URL` o, si no está, `http://localhost:4321`.

El consumer de la queue no corre dentro de Pages. Vive en `workers/api-enrichment-consumer/`.

## Deploy

GitHub Actions (`.github/workflows/deploy-cloudflare-pages.yml`):

- `main` / `master` → production
- `dev` / `develop` → development

Secretos de GitHub:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT_NAME_PROD`
- `CLOUDFLARE_PAGES_PROJECT_NAME_DEV`
- `CLOUDFLARE_PAGES_PROJECT_NAME_LANDING_PROD`
- `CLOUDFLARE_PAGES_PROJECT_NAME_LANDING_DEV`

Secrets de runtime (fuera del repo): `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`.

El build de la landing puede recibir `PUBLIC_APP_URL` para apuntar el CTA al workspace de producción.

Convenciones de código, layout y bindings: `AGENTS.md`. Definición de producto: `MVP.md`.
