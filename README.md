# PlanillaInteligente
PlanillaInteligente - App saas que permite subir tus planillas o de tu empresa y convertirlas en apps (web) usables

## Scripts

- `npm run test:local`: instala dependencias del lockfile y luego ejecuta typecheck, validación de Astro y build local.

## Deploy

- GitHub Actions despliega a Cloudflare Pages según la rama:
  - `main` o `master` -> `production`
  - `dev` o `develop` -> `development`
- Workflow: `.github/workflows/deploy-cloudflare-pages.yml`
- Secretos a definir más adelante en GitHub:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_PAGES_PROJECT_NAME_PROD`
  - `CLOUDFLARE_PAGES_PROJECT_NAME_DEV`
- Secretos sensibles de Cloudflare/Runtime a cargar fuera del repo:
  - `GOOGLE_CLIENT_SECRET`
  - `TURNSTILE_SECRET_KEY`

## AI enrichment

- El upload ahora dispara un enriquecimiento post-proceso sobre el esquema detectado de la planilla.
- Bindings/vars de Cloudflare usados para esta etapa:
  - `AI` (Workers AI binding)
  - `ENRICHMENT_QUEUE` (Cloudflare Queue producer para procesamiento asíncrono)
  - `WORKERS_AI_MODEL`
  - `AI_GATEWAY_ID`
- Si `ENRICHMENT_QUEUE` no está configurada o falla, el enriquecimiento cae en modo inline.
- Si `AI` no está configurado o la inferencia falla, se guarda una configuración heurística multi-tenant como fallback.
- Endpoint manual para reintentar o consultar la configuración IA:
  - `GET /api/ai/enrichment?spreadsheetId=...`
  - `POST /api/ai/enrichment` con `{ "spreadsheetId": "...", "mode": "inline|queue" }`

- Queue consumer handler: `src/queue.ts`
