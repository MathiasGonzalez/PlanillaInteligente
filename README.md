# PlanillaInteligente

SaaS que convierte planillas Excel en aplicaciones web usables.

Hay **dos apps** y **un Worker**:

| Deployable | Carpeta | Puerto local | Qué es |
|---|---|---|---|
| Workspace | `apps/web-workspace` | 4321 | Producto autenticado (D1, KV, R2, Queue, AI) |
| Landing | `apps/web-landing` | 4322 | Marketing estático, sin bindings |
| Enrichment consumer | `workers/api-enrichment-consumer` | — | Worker que consume la queue (no corre con `npm run dev`) |

## Scripts (desde la raíz)

- `npm run dev` — workspace (`apps/web-workspace`, puerto 4321)
- `npm run dev:landing` — landing (`apps/web-landing`, puerto 4322)
- `npm run test:local` — `npm ci` + typecheck + Astro check + build
- `npm run build` — build de workspace y landing
- `npm run db:generate` — genera SQL en `migrations/`
- `npm run db:migrate:local` — aplica migraciones a la **D1 local**
- `npm run db:migrate` / `npm run db:migrate:preview` — D1 **remota** de producción / preview

## Dónde guardar cada clave

Hay tres lugares distintos. No se mezclan.

| Dónde | Qué va | Se commitea |
|---|---|---|
| `apps/web-workspace/.dev.vars` | Secretos **locales** (OAuth secret, Turnstile secret). Copia de `.dev.vars.example`. | **No** (está en `.gitignore`) |
| `apps/web-workspace/wrangler.jsonc` → `vars` | Valores **públicos** del runtime (OAuth client ID, Turnstile site key, modelo de IA). | Sí |
| Cloudflare (`wrangler pages secret put` / `wrangler secret put`) | Secretos **de runtime** en prod y preview. GitHub Actions **no** los inyecta. | No (viven en la cuenta Cloudflare) |
| GitHub → Settings → Secrets and variables → Actions | Solo credenciales de **CI/CD** para que el workflow pueda desplegar. | No |

**Google OAuth**

| Clave | Tipo | Local | Producción / preview |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | pública | `.dev.vars` y/o `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` (el ID real sí se commitea) |
| `GOOGLE_CLIENT_SECRET` | **secreta** | solo `.dev.vars` | `wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name <proyecto-pages>` en **cada** proyecto Pages del workspace (prod y dev). Nunca en `vars` ni en GitHub Actions. |

Redirect URIs a cargar en [Google Cloud Console](https://console.cloud.google.com/) → APIs y servicios → Credenciales → cliente OAuth **tipo Web**:

- Local: `http://localhost:4321/api/auth/callback/google`
- Preview / development: `https://<url-del-workspace-dev>/api/auth/callback/google`
- Producción: `https://<url-del-workspace-prod>/api/auth/callback/google`

**Turnstile** ([dashboard Cloudflare](https://dash.cloudflare.com/) → Turnstile)

| Clave | Tipo | Local | Producción / preview |
|---|---|---|---|
| `TURNSTILE_SITE_KEY` | pública | test `1x00000000000000000000AA` (ya está en `.dev.vars.example` y `vars`) | site key real del widget, en `wrangler.jsonc` `vars` |
| `TURNSTILE_SECRET_KEY` | **secreta** | test `1x0000000000000000000000000000000AA` en `.dev.vars` | `wrangler pages secret put TURNSTILE_SECRET_KEY --project-name <proyecto-pages>` |

Las keys de test de Cloudflare siempre pasan; no las uses en producción.

**Opcional (IA)**

| Clave | Dónde |
|---|---|
| `WORKERS_AI_MODEL` | `wrangler.jsonc` `vars` (default `@cf/meta/llama-3.1-8b-instruct`) |
| `AI_GATEWAY_ID` | `wrangler.jsonc` `vars`; vacío = Workers AI directo |
| `PUBLIC_APP_URL` | env de **build** de la landing (CTA). Local fallback: `http://localhost:4321` |

El consumer **no** usa Google ni Turnstile.

## Setup local

No hace falta crear D1/KV/R2/Queue en Cloudflare: `astro dev` los simula y persiste en `apps/web-workspace/.wrangler/state`.

1. Node 22+ y `npm ci`.
2. `cp apps/web-workspace/.dev.vars.example apps/web-workspace/.dev.vars` y completar:
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` del cliente OAuth (redirect local de arriba).
   - Turnstile: dejar las keys de test, o poner las de un widget real.
3. `npm run db:migrate:local` (si cambió el schema: `npm run db:generate` antes y commitear `migrations/`).
   Siempre con el script de la raíz. Migrar Wrangler **sin** `--config apps/web-workspace/wrangler.jsonc` escribe otra SQLite en la raíz y el workspace no la ve.
4. `npm run dev` → [http://localhost:4321](http://localhost:4321) (redirige a `/login`).
5. `npm run dev:landing` → [http://localhost:4322](http://localhost:4322).

En local el upload enriquece **inline** (el consumer no corre). Workers AI es opcional: `npx wrangler login`; si no hay AI, se usan heurísticas. Eso **sí consume cuota** de la cuenta Cloudflare.

## Aprovisionar Cloudflare (antes del primer deploy)

Una vez, en la cuenta Cloudflare (`npx wrangler login`):

```bash
# D1
npx wrangler d1 create planilla-inteligente
npx wrangler d1 create planilla-inteligente-preview

# KV
npx wrangler kv namespace create SESSION_KV
npx wrangler kv namespace create SESSION_KV --preview

# R2
npx wrangler r2 bucket create planilla-inteligente-assets
npx wrangler r2 bucket create planilla-inteligente-assets-preview

# Queues (+ DLQ que declara el consumer)
npx wrangler queues create planilla-inteligente-enrichment
npx wrangler queues create planilla-inteligente-enrichment-dlq
npx wrangler queues create planilla-inteligente-enrichment-preview
npx wrangler queues create planilla-inteligente-enrichment-preview-dlq
```

Pegar los IDs resultantes en:

- `apps/web-workspace/wrangler.jsonc` (`database_id`, KV `id`; lo mismo en `env.preview`)
- `workers/api-enrichment-consumer/wrangler.jsonc` (mismo `database_id` de D1)

Crear **cuatro** proyectos Pages (o reutilizar nombres) y anotarlos: workspace prod, workspace dev, landing prod, landing dev.

Secretos de runtime del **workspace** (repetir por proyecto Pages prod y dev):

```bash
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name <workspace-pages>
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name <workspace-pages>
```

En `wrangler.jsonc` `vars` poner el `GOOGLE_CLIENT_ID` y el `TURNSTILE_SITE_KEY` reales (no el secret).

## Deploy (GitHub Actions)

Workflow: `.github/workflows/deploy-cloudflare-pages.yml`

- `main` → production
- `develop` → development

**Secrets de GitHub** (solo para que CI pueda hablar con Cloudflare; no son las claves OAuth):

| Secret | Para qué |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token con permiso de Pages, Workers, D1 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| `CLOUDFLARE_PAGES_PROJECT_NAME_PROD` | Proyecto Pages del workspace (prod) |
| `CLOUDFLARE_PAGES_PROJECT_NAME_DEV` | Proyecto Pages del workspace (dev) |
| `CLOUDFLARE_PAGES_PROJECT_NAME_LANDING_PROD` | Landing prod |
| `CLOUDFLARE_PAGES_PROJECT_NAME_LANDING_DEV` | Landing dev |

El CTA de la landing en CI puede recibir `PUBLIC_APP_URL` apuntando al workspace desplegado.

Convenciones de código, layout y bindings: `AGENTS.md`. Definición de producto: `MVP.md`.
