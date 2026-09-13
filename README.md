# PlanillaInteligente
PlanillaInteligente - App saas que permite subir tus planillas o de tu empresa y convertirlas en apps (web) usables

## Scripts

- `npm run test:local`: instala dependencias del lockfile y luego ejecuta typecheck, validación de Astro y build local.

## Deploy

- GitHub Actions despliega a Cloudflare Pages según la rama:
  - `main` o `master` -> `production`
  - `dev` o `develop` -> `development`
- Workflow: `/home/runner/work/PlanillaInteligente/PlanillaInteligente/.github/workflows/deploy-cloudflare-pages.yml`
- Secretos a definir más adelante en GitHub:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_PAGES_PROJECT_NAME_PROD`
  - `CLOUDFLARE_PAGES_PROJECT_NAME_DEV`
