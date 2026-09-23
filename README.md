# PlanillaInteligente

SaaS que convierte planillas Excel en aplicaciones web usables.

Hay **dos apps** y **dos Workers**:


| Deployable          | Carpeta                           | Puerto local | Qué es                                                   |
| ------------------- | --------------------------------- | ------------ | -------------------------------------------------------- |
| Workspace           | `apps/web-workspace`              | 4321         | Producto autenticado (D1, KV, R2, Queue, AI)             |
| Landing             | `apps/web-landing`                | 4322         | Marketing estático, sin bindings                         |
| Enrichment consumer | `workers/api-enrichment-consumer` | —            | Consume la queue (`analyze` y `apply-proposal`) y la DLQ |
| Maintenance         | `workers/api-maintenance`         | —            | Cron: baja, sesiones, challenges, historial y propuestas viejas |


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


| Dónde                                                            | Qué va                                                                                | Se commitea                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| `apps/web-workspace/.dev.vars`                                   | Secretos **locales** (OAuth secret, Turnstile secret). Copia de `.dev.vars.example`.  | **No** (está en `.gitignore`)      |
| `apps/web-workspace/wrangler.jsonc` → `vars`                     | Valores **públicos** del runtime (OAuth client ID, Turnstile site key, modelo de IA). | Sí                                 |
| Cloudflare (`wrangler pages secret put` / `wrangler secret put`) | Secretos **de runtime** en prod y preview. GitHub Actions **no** los inyecta.         | No (viven en la cuenta Cloudflare) |
| GitHub → Settings → Secrets and variables → Actions              | Solo credenciales de **CI/CD** para que el workflow pueda desplegar.                  | No                                 |


**Google OAuth**


| Clave                  | Tipo        | Local                                   | Producción / preview                                                                                                                                                          |
| ---------------------- | ----------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | pública     | `.dev.vars` y/o `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` (el ID real sí se commitea)                                                                                                                           |
| `GOOGLE_CLIENT_SECRET` | **secreta** | solo `.dev.vars`                        | `wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name <proyecto-pages>` en **cada** proyecto Pages del workspace (prod y dev). Nunca en `vars` ni en GitHub Actions. |


Redirect URIs a cargar en [Google Cloud Console](https://console.cloud.google.com/) → APIs y servicios → Credenciales → cliente OAuth **tipo Web**:

- Local: `http://localhost:4321/api/auth/callback/google`
- Preview / development: `https://<url-del-workspace-dev>/api/auth/callback/google`
- Producción: `https://<url-del-workspace-prod>/api/auth/callback/google`

**Turnstile** ([dashboard Cloudflare](https://dash.cloudflare.com/) → Turnstile)


| Clave                  | Tipo        | Local                                                                     | Producción / preview                                                             |
| ---------------------- | ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `TURNSTILE_SITE_KEY`   | pública     | test `1x00000000000000000000AA` (ya está en `.dev.vars.example` y `vars`) | site key real del widget, en `wrangler.jsonc` `vars`                             |
| `TURNSTILE_SECRET_KEY` | **secreta** | test `1x0000000000000000000000000000000AA` en `.dev.vars`                 | `wrangler pages secret put TURNSTILE_SECRET_KEY --project-name <proyecto-pages>` |


Las keys de test de Cloudflare siempre pasan; no las uses en producción.

Otras claves, todas en `.dev.vars` en local y `wrangler pages secret put` en prod salvo que se indique:

- `TOKEN_ENCRYPTION_KEY` y `AUTH_HMAC_KEY`: 32 bytes en base64 (`openssl rand -base64 32`). Sin la segunda, el login por email responde que el correo no está disponible.
- `ANALYSIS_MODE`: `inline` en local (también imprime el OTP de login en la consola). `queue` en `wrangler.jsonc` para prod y preview.
- `WORKERS_AI_MODEL` y `AI_GATEWAY_ID`: públicas, en `vars`. Gateway vacío llama a Workers AI directo. Con id, el código manda `collectLog: false`. Apagá también los logs en el dashboard.
- `PUBLIC_APP_URL`: env de build de la landing. Local: `http://localhost:4321`.
- `EMAIL_SEND_URL`: pública, default `https://send.cfemailer.com/send`. `EMAIL_API_KEY`: secret opcional.

El consumer no usa Google ni Turnstile. El de mantenimiento tampoco.

**Observabilidad.** Los Workers declaran `observability` en su `wrangler.jsonc`. Pages no acepta esa clave: en el proyecto Pages del workspace hay que activar Workers Logs desde el dashboard. En el plan Free son 200.000 eventos por día y 3 días de retención.

## Setup local

No hace falta crear D1/KV/R2/Queue en Cloudflare: `astro dev` los simula y persiste en `apps/web-workspace/.wrangler/state`.

1. Node 22+ y `npm ci`.
2. `cp apps/web-workspace/.dev.vars.example apps/web-workspace/.dev.vars` y completar OAuth, `TOKEN_ENCRYPTION_KEY`, `AUTH_HMAC_KEY` y `ANALYSIS_MODE=inline`. Turnstile puede quedar en las keys de test.
3. Si ya habías migrado el esquema viejo, borrá `apps/web-workspace/.wrangler/state`. Después `npm run db:migrate:local`. Siempre el script de la raíz: sin `--config apps/web-workspace/wrangler.jsonc`, Wrangler escribe otra SQLite y el workspace no la ve.
4. `npm run dev` → [http://localhost:4321](http://localhost:4321). `npm run dev:landing` → [http://localhost:4322](http://localhost:4322).

Con `ANALYSIS_MODE=inline` el análisis corre en el request y el OTP de login se imprime en la consola. Workers AI es opcional (`npx wrangler login`). Sin AI queda la heurística. Si hay AI, consume cuota. Google sigue funcionando.

## Aprovisionar Cloudflare (una vez, antes del primer deploy)

El local no necesita esto: `npm run dev` simula los bindings. El deploy de GitHub Actions sí: el workflow asume que el backend de Pulumi y los stacks ya existen.

Pulumi (`infra/`) crea D1, KV, R2, queues y los proyectos Pages. Wrangler corre migraciones y sube el código. El state no está en Pulumi Cloud: vive en un bucket R2.

```bash
curl -fsSL https://get.pulumi.com | sh
```

### 1. Generar credenciales

Guardarlas en un gestor de contraseñas. En el paso 5 van a GitHub; acá solo se usan en la terminal.


| Variable | De dónde sale |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Dashboard → My Profile → API Tokens. Edición de D1, Workers KV, R2, Queues, Pages y Workers Scripts. |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID de la cuenta. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Dashboard → R2 → Manage API tokens. Token S3, lectura y escritura. Es otro token, no el del API. |
| `PULUMI_CONFIG_PASSPHRASE` | `openssl rand -base64 32`. Si se pierde, el state cifrado no se puede leer. |

### 2. Crear el bucket de state

Con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` en el entorno:

```bash
npx wrangler r2 bucket create planilla-inteligente-pulumi-state
```

`PULUMI_BACKEND_URL` (reemplazar `<ACCOUNT_ID>`):

```text
s3://planilla-inteligente-pulumi-state?endpoint=<ACCOUNT_ID>.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true
```

### 3. Inicializar los stacks

Exportar las variables del paso 1 y `PULUMI_BACKEND_URL`. Después:

```bash
cd infra
npm ci --workspaces=false
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack init prod
pulumi stack init dev
pulumi up --yes --stack prod
pulumi up --yes --stack dev
```

`pulumi up` crea, por stack, la D1, el KV, el R2 de archivos, las queues y los proyectos Pages (`planilla-inteligente` / `planilla-inteligente-dev` para el workspace).

### 4. Secretos de runtime del workspace

En `apps/web-workspace/wrangler.jsonc` → `vars`, commitear `GOOGLE_CLIENT_ID` y `TURNSTILE_SITE_KEY` reales. Los secrets no van ahí:

```bash
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name planilla-inteligente
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name planilla-inteligente
npx wrangler pages secret put TOKEN_ENCRYPTION_KEY --project-name planilla-inteligente
npx wrangler pages secret put AUTH_HMAC_KEY --project-name planilla-inteligente
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name planilla-inteligente-dev
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name planilla-inteligente-dev
npx wrangler pages secret put TOKEN_ENCRYPTION_KEY --project-name planilla-inteligente-dev
npx wrangler pages secret put AUTH_HMAC_KEY --project-name planilla-inteligente-dev
```

El login por email llama a `https://send.cfemailer.com/send`. Si la API pide auth: `npx wrangler pages secret put EMAIL_API_KEY --project-name <proyecto-pages>`.

Cargar en Google Cloud las redirect URIs de producción y de dev (ver arriba).

### 5. Cargar los secrets de CI

GitHub → Settings → Secrets and variables → Actions, en los environments `production` y `development`:

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

El primer push a `main` o `develop` ya puede desplegar. El workflow corre `pulumi up`, pega los IDs en `wrangler.jsonc` (no se commitean), aplica migraciones y despliega.

## Deploy (GitHub Actions)

Workflows:

- `.github/workflows/deploy-cloudflare-pages.yml` — `main` → production (`pulumi up` stack `prod` + Wrangler); `develop` → development (stack `dev`, consumer `--env preview`).
- `.github/workflows/pulumi-preview.yml` — PRs a `main`/`develop` que toquen `infra/**`. Solo `pulumi preview`; el diff queda en el log del check.

**Secrets de GitHub** (solo CI; no son las claves OAuth):


| Secret                     | Para qué                                                |
| -------------------------- | ------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`     | Token con permiso de Pages, Workers, D1, KV, R2, Queues |
| `CLOUDFLARE_ACCOUNT_ID`    | Account ID (Wrangler y Pulumi)                          |
| `PULUMI_BACKEND_URL`       | URL S3-compatible del bucket de state                   |
| `PULUMI_CONFIG_PASSPHRASE` | Cifrado del state DIY                                   |
| `AWS_ACCESS_KEY_ID`        | Access key del R2 API token (backend de state)          |
| `AWS_SECRET_ACCESS_KEY`    | Secret del R2 API token                                 |


El CTA de la landing en CI puede recibir `PUBLIC_APP_URL` apuntando al workspace desplegado.

Setup desde cero: `PROVISIONING.md`. Convenciones: `AGENTS.md`. Producto: `MVP_PROPOSED.md`. Estado: `MVP_STATUS.md`. Datos: `DATA_SECURITY.md`.

El workspace autentica, guarda el `.xlsx` en R2 y las filas en D1. Con `ANALYSIS_MODE=queue` encola el análisis. El consumer lee R2, escribe la spec y puede llamar a Workers AI. En local el análisis corre en el request. El código de login se envía a `send.cfemailer.com`.



