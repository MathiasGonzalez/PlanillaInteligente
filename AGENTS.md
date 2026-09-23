# AGENTS.md — PlanillaInteligente

Guía para agentes de IA que trabajan sobre este repositorio. Lee este archivo antes de proponer cualquier cambio.

## Qué es este proyecto

PlanillaInteligente es una aplicación web multi-tenant que transforma planillas Excel en aplicaciones dinámicas. Un usuario sube un `.xlsx`, el sistema lo parsea, infiere metadata de UI con Workers AI y genera una interfaz configurable (tabla, kanban, dashboard).

**Stack principal:**
- **Astro** (SSR en `web-workspace`, estático en `web-landing`)
- **React** 19 — solo para componentes de UI interactivos en `web-workspace`
- **TypeScript** strict — sin `any` implícitos
- **Drizzle ORM** sobre **Cloudflare D1** (SQLite)
- **Cloudflare Pages** — `apps/web-workspace` (producto) y `apps/web-landing` (marketing)
- **Cloudflare Workers** — consumer de queue (`workers/api-enrichment-consumer/`) y cron de retención (`workers/api-maintenance/`)
- **Cloudflare R2** — almacenamiento de archivos `.xlsx`
- **Cloudflare KV** — caché de sesiones
- **Cloudflare Queue** — procesamiento asíncrono de enriquecimiento IA
- **Workers AI** — inferencia de metadata con `@cf/meta/llama-3.1-8b-instruct-fast`
- **Pulumi** — aprovisiona D1, KV, R2, Queues y proyectos Pages (`infra/`). Wrangler sigue desplegando código y migraciones.

## Comandos

Correr desde la raíz del repo (npm workspaces):

```bash
# Validación completa sin runtime de Cloudflare (TypeScript + Astro check + build)
npm run test:local

# Desarrollo local del workspace (runtime simulada de Cloudflare)
npm run dev

# Landing de marketing (puerto 4322)
npm run dev:landing

# Solo TypeScript
npm run typecheck

# Solo Astro check (workspace)
npm run check

# Build de producción (workspace + landing)
npm run build

# Migraciones D1
npm run db:generate     # genera SQL en migrations/ a partir de packages/cloudflare/src/d1/schema.ts
npm run db:migrate:local    # aplica en D1 local (apps/web-workspace/.wrangler/state)
npm run db:migrate      # aplica en producción
npm run db:migrate:preview  # aplica en preview
```

**Antes de commitear un cambio de código**, siempre correr:
```bash
npm run test:local
```

No hay tests unitarios. La validación es: TypeScript + Astro check + build exitoso.

## Estructura del repo

Prefijos: **`apps/web-*`** (Pages), **`workers/api-*`** (Workers extra), **`packages/`** (código compartido). Un `wrangler.jsonc` por deployable; no hay Wrangler en la raíz. La infra Cloudflare vive en **`infra/`** (Pulumi, fuera de los npm workspaces).

```
infra/                                 # Pulumi — D1, KV, R2, Queues, proyectos Pages (prod + dev)
  index.ts                             # Entry point: lee config del stack, instancia el componente
  planillaEnvironment.ts               # ComponentResource: un ambiente completo
  Pulumi.yaml                          # Metadata del proyecto Pulumi
  Pulumi.prod.yaml / Pulumi.dev.yaml   # Config de stack (sin secretos)
  apply-bindings.mjs                   # CI: pega IDs del stack en wrangler.jsonc
apps/web-workspace/                    # Cloudflare Pages — producto autenticado (Astro SSR)
  src/pages/                           # UI + rutas HTTP /api/* (mismo origen que la sesión)
  src/components/                      # UI (React en auth/, resto Astro)
  src/api/                             # Handlers de API (delegan a packages/)
  src/middleware.ts                    # Auth, sesión KV, tenant isolation
  src/lib/turnstile.ts
  src/app/http/responses.ts            # json() para respuestas HTTP
  wrangler.jsonc                       # Bindings Pages (prod + preview)
  astro.config.mjs
  .dev.vars.example
apps/web-landing/                      # Cloudflare Pages — marketing estático (sin bindings)
  src/pages/index.astro
  wrangler.jsonc
workers/api-enrichment-consumer/       # Worker Queue consumer + DLQ (analyze | apply-proposal)
  src/index.ts                         # Handler fino → packages/apps
  wrangler.jsonc
workers/api-maintenance/               # Cron diario: baja, sesiones, challenges, historial
  src/index.ts
  wrangler.jsonc
packages/cloudflare/                   # Primitivas Cloudflare (1 carpeta = 1 binding)
  src/d1/index.ts                      # createDatabase
  src/d1/schema.ts                     # Esquema Drizzle — fuente de verdad D1
  src/r2/index.ts
  src/kv/index.ts
  src/ai/index.ts
  src/queue/index.ts                   # producer sendEnrichmentJob
  src/mailer/index.ts                  # POST a send.cfemailer.com/send
  src/env.ts                           # cloudflareEnv
packages/spreadsheets/                 # Excel: parseo multi-hoja, candidatos, xlsx puro
  src/parsing/
  src/export/                          # buildWorkbookXlsx (sin D1/R2)
packages/apps/                         # Dominio de la app (spec, records, evolución, equipo)
  src/spec.ts
  src/generation.ts
  src/records.ts
  src/dashboards.ts
  src/evolution.ts                     # propuestas; reexporta operaciones
  src/operations.ts                    # catálogo y applySpecOperations
  src/expressions.ts                   # fórmulas computeField
  src/export.ts                        # orquestación D1/R2 del Excel
  src/import.ts                        # alta de workbook + app + filas
  src/usage.ts                         # cupos y consumo del workspace
  src/billing.ts                       # cuenta de plan y pagos
  src/members.ts
  src/retention.ts
  src/jobs.ts
packages/theme/                        # Tokens y primitivas visuales (landing + workspace)
  tokens.css
  base.css
migrations/                            # SQL D1 (recurso de entorno, raíz)
```

Imports de primitivas: `@planilla/cloudflare/d1`, `/d1/schema`, `/r2`, `/kv`, `/ai`, `/queue`, `/mailer`, `/env`.
Dominio: `@planilla/apps/...` y `@planilla/spreadsheets/...` (solo Excel).
Estilos compartidos: `@planilla/theme/tokens.css` y `@planilla/theme/base.css`. No duplicar la paleta en cada app.

## Cómo agregar una feature

Decidir en este orden:

1. **¿Es UI o una ruta HTTP del producto?** → `apps/web-workspace/` (`src/pages`, `src/components`). Las rutas API son wrappers finos que delegan al package de dominio. Quedan en Astro (mismo origen que la cookie de sesión).
2. **¿Es marketing / landing?** → `apps/web-landing/`. Sin D1/KV/R2/Queue/AI.
3. **¿La lógica la usa más de un deployable o es dominio de producto?** → `packages/<feature>/` (como `packages/spreadsheets`). No poner dominio dentro de `packages/cloudflare`.
4. **¿Es un binding Cloudflare nuevo o acceso a uno existente?** → adapter en `packages/cloudflare/<primitiva>/`. Declarar el binding en el `wrangler.jsonc` de **cada** deployable que lo use (y `env.preview`). Si el recurso Cloudflare (D1, KV, R2, Queue, Pages) no existe, crearlo en `infra/planillaEnvironment.ts`, no a mano. No acceder a `env.DB` / `env.BUCKET` fuera de esos adapters.
5. **¿Hace falta un Worker?** Solo si Pages no puede (queue consumer, cron), hay un segundo cliente / API pública, o el servicio es cross-app de verdad. Carpeta: `workers/api-<servicio>/`. El handler es fino y llama al package de dominio. No extraer `/api/*` a Hono “por si acaso”.
6. **¿Tabla o columna nueva?** → `packages/cloudflare/src/d1/schema.ts` + `npm run db:generate` + commitear `migrations/`. Queries con `eq(table.tenantId, tenantId)`.

**No hacer:**

- Carpeta de feature al lado de `d1`/`r2` (eje incorrecto).
- Meter upload en `r2/` o enrichment en `ai/`.
- Nuevo deployable dentro de `apps/web-workspace` (otro Worker no es una página).
- Wrangler en la raíz (no hay `extends` entre configs).
- Instalar paquetes npm sin confirmación.
- Worker o package que importe desde `apps/*` (dirección: apps/workers → packages, nunca al revés).
- Crear o borrar recursos Cloudflare (D1, KV, R2, Queue, Pages) manualmente desde el dashboard o CLI suelta, fuera de `infra/`.
- Meter el script de un Worker, un `wrangler deploy` o migraciones D1 dentro de Pulumi.

**Checklist del mismo PR:**

- `package.json` workspace si se crea `packages/<feature>`, `workers/api-<nombre>` o `apps/web-<nombre>`.
- Binding + preview en wrangler de los deployables afectados.
- Si el PR crea o modifica un recurso Cloudflare, incluir el cambio en `infra/`, no solo en `wrangler.jsonc`.
- Si el PR modifica `packages/cloudflare/src/d1/schema.ts`, la migración debe ser rollback-safe — ver "Compatibilidad de esquema D1" más abajo.
- Actualizar este archivo si cambia el layout, bindings o la convención de deployables.
- `npm run test:local`.

## Protección de datos (Uruguay)

Restricciones que se desprenden de `DATA_SECURITY.md`. El detalle y la base legal están ahí; acá va lo que un cambio de código no puede violar.

- **`SESSION_KV` no almacena PII.** Solo identificadores opacos (`userId`, `tenantId`, `sessionId`, `expiresAt`). El perfil y el rol se leen de D1. KV no tiene jurisdicción.
- **Los mensajes de Queue transportan referencias, nunca contenido** de celdas ni de perfil. Queues no tiene jurisdicción.
- **El prompt de IA se arma con metadata y estadísticas.** Enviar valores reales de celdas exige opt-in por planilla registrado en `workbooks.sample_consent_at`. Nunca es el default. Columnas `sensitive` (credenciales) y `specialCategory` (art. 17 Ley 18.331) no se envían ni con opt-in.
- **Llamadas a AI Gateway con `collectLog: false`.** Apagar también los logs en el dashboard del gateway.
- **Los logs no contienen PII.** Se referencia por ID (`tenantId`, `appId`, `userId`).
- **Tokens OAuth de Google no se persisten.** Si un destino futuro guarda credenciales de terceros, van cifradas con `TOKEN_ENCRYPTION_KEY`, nunca en claro.
- **Todo store o campo nuevo** necesita clasificación de datos y plazo de conservación declarados en `DATA_SECURITY.md`.
- **Un destino nuevo que reciba datos personales** exige verificar adecuación según la URCDP y declarar el subencargado antes del merge.
- **Pages no soporta** la clave `observability`, el binding `ratelimits` ni cron triggers. Observability de Pages es configuración de dashboard. Un cron va en un Worker (`workers/api-*`). El rate limiting quedó pendiente a propósito.
- **Borrado:** la supresión pedida por el titular es inmediata (`erase`). La baja comercial marca `organizations.deactivatedAt` y el cron la purga a los 30 días.

## Infraestructura (Pulumi)

Pulumi crea recursos. Wrangler despliega código y corre migraciones. El state de Pulumi es un backend DIY en R2 (no Pulumi Cloud).

- **Quién crea qué**: cualquier recurso Cloudflare nuevo o cambio de uno existente (D1, KV, R2, Queue, proyecto Pages) se agrega en `infra/planillaEnvironment.ts`, nunca a mano desde el dashboard ni con `wrangler <recurso> create` contra prod/dev. `wrangler.jsonc` solo referencia IDs; no los origina. CI pega los IDs con `infra/apply-bindings.mjs` desde los outputs del stack; no commitear IDs reales.
- **Wrangler nunca pierde su rol**: Pulumi no despliega Workers scripts, no corre `wrangler deploy`, no toca `wrangler pages deploy` ni ejecuta migraciones D1. Si una tarea es "subir código" o "correr una migración", es Wrangler, no Pulumi.
- **Nombres de binding**: el nombre de binding en `wrangler.jsonc` (`DB`, `SESSION_KV`, `BUCKET`, `ENRICHMENT_QUEUE`, `AI`) es el contrato; los outputs de Pulumi solo proveen IDs/nombres, no deciden el nombre del binding.
- **Pages deploy**: `wrangler pages deploy` no acepta `--config` ni `--env`. Hay que correrlo con cwd en `apps/web-workspace` / `apps/web-landing`. Un proyecto Pages dedicado (`*-dev`) con `production_branch=dev` y `--branch dev` usa el bloque **raíz** de `wrangler.jsonc`; `infra/apply-bindings.mjs` (target preview) reescribe R2/queue/IDs de ese bloque a recursos preview. El consumer sigue usando `--env preview`.
- **Ambientes**: agregar un ambiente nuevo es un archivo `infra/Pulumi.<nombre>.yaml`. Si hace falta tocar `planillaEnvironment.ts`, el cambio debe aplicar a todos los stacks por igual (no lógica condicional por nombre de ambiente dentro del componente).
- **Revisión obligatoria de infra**: todo PR que toque `infra/**` debe traer el output de `pulumi preview` (workflow `.github/workflows/pulumi-preview.yml`, log del check). No mergear si el preview muestra un `replace` o `delete` no esperado en D1, R2 o KV (pérdida de datos).
- **Secretos**: `infra/Pulumi.*.yaml` no lleva secretos ni `pulumi config set --secret`. Los secretos de runtime del producto siguen entrando por `wrangler pages secret put`. Los del backend de Pulumi (R2 API token, passphrase) viven solo en GitHub Secrets.
- **CLI**: CI y local instalan la última CLI con `get.pulumi.com`, sin `--version`.
- `infra/` es un proyecto npm aparte (no está en los workspaces de la raíz). Instalar ahí con `npm ci --workspaces=false`.

## Actualización de dependencias npm

Hay dos árboles. No mezclarlos.

- **Producto**: workspaces de la raíz (`apps/*`, `packages/*`, `workers/*`) y un solo `package-lock.json`. Instalar desde la raíz.
- **Infra**: `infra/` tiene su propio lockfile. `infra/.npmrc` fija `workspaces=false`. Instalar con `npm ci --workspaces=false` (o `npm install <pkg>@<version> --workspaces=false`) dentro de `infra/`.

Las dependencias externas del producto van **sin rango** (`"wrangler": "4.136.2"`, no `"^4.136.2"`). Los paquetes internos (`@planilla/cloudflare`, `@planilla/spreadsheets`) quedan en `"*"`. En `infra/`, `@pulumi/*` puede seguir con `^`. La CLI no se pineá: `get.pulumi.com` instala la última.

**Mismo paquete, misma versión.** Si `typescript`, `wrangler`, `astro`, `drizzle-orm` o `@cloudflare/workers-types` está en más de un `package.json`, el bump actualiza todas las declaraciones a la vez. Incluir `infra/package.json` cuando el paquete también vive ahí (hoy: `typescript`).

**Qué se puede subir sin pedir un major:**

- Patch o minor dentro de la major ya pinneada, si el changelog no toca el camino de deploy: `wrangler deploy`, `wrangler pages deploy`, `wrangler d1 migrations apply`, bindings D1/KV/R2/Queue/AI, ni el adapter `@astrojs/cloudflare`.
- La versión nueva de `wrangler` tiene que satisfacer el peer de `@astrojs/cloudflare` (hoy `^4.125.0`) y seguir en Wrangler 4.
- `astro` y `@astrojs/cloudflare` se suben juntos y tienen que cumplir el peer del adapter (hoy `astro` `^7.2.0`).
- `@cloudflare/workers-types` acompaña a `wrangler`. Es solo tipos: no habilita APIs nuevas en runtime. No subir `compatibility_date` solo porque cambiaron los tipos. Si el código pasa a usar una API posterior a la fecha pinneada, ahí sí se mueve la fecha en **todos** los `wrangler.jsonc`.
- `typescript` se queda en la línea 5 (`5.9.x`). TypeScript 7 es un major aparte y no se instala en un bump de parches.

**No hacer en un bump de dependencias:**

- Agregar un paquete que el repo no tenía, sin confirmación explícita.
- Saltar de major (`typescript` 7, Wrangler 5, Astro 8, Drizzle 1) salvo pedido explícito y revisión del changelog.
- Correr `wrangler preview`. Desde Wrangler 4.133, si falta el bloque `previews`, ese comando puede reescribir el `wrangler.jsonc`. `env.preview` de Pages es otra cosa y no se reemplaza por ese bloque.
- Subir `@pulumi/pulumi` o `@pulumi/cloudflare` "de paso" en un bump del producto.
- Dejar versiones distintas del mismo paquete entre workspaces.

**Después del bump:** `npm install` en la raíz (y en `infra/` solo si cambió ese árbol) para refrescar el lockfile, luego `npm run test:local`.

## Convenciones de código

- **Sin instalar paquetes** sin confirmación explícita del usuario — consultar antes de agregar cualquier dependencia. Subir una dependencia que ya está pinneada sigue las reglas de "Actualización de dependencias npm".
- **TypeScript estricto**: no usar `as any`, no suprimir errores con `@ts-ignore` salvo justificación documentada.
- **Aislamiento por tenant**: toda query a tablas operativas (`apps`, `workbooks`, `records`, `app_spec_versions`, `record_changes`, `app_change_proposals`, `invitations`) debe incluir `eq(table.tenantId, tenantId)` como condición. Nunca omitir este filtro. `email_login_challenges` no tiene tenant: se busca por hash.
- **API routes**: usar `apps/web-workspace/src/app/http/responses.ts` (`json()`) para respuestas JSON consistentes.
- **Bindings opcionales**: diseñar código que tolere la ausencia de bindings (`AI`, `ENRICHMENT_QUEUE`, `SESSION_KV`).
- **Acceso a bindings**: usar los adaptadores `@planilla/cloudflare/*` (d1, r2, kv, ai, queue); nunca acceder a los bindings directamente desde fuera de esos módulos salvo en tests o entry points.
- **Secrets**: nunca poner secretos en `wrangler.jsonc` (`vars` es texto plano). Usar `wrangler secret put` para producción y `apps/web-workspace/.dev.vars` para desarrollo local.
- **Migraciones**: al modificar `packages/cloudflare/src/d1/schema.ts`, siempre generar la migración con `npm run db:generate` y commitear los archivos de `migrations/`. El modelo de datos vive en ese schema, no en un documento aparte.

## Compatibilidad de esquema D1 (rollback-safe)

`wrangler d1 migrations apply` solo aplica hacia adelante — no existe "down migration". El único rollback real disponible es volver el **deploy de código** (Pages/Worker) a la versión anterior mientras el esquema D1 sigue en la versión nueva. Por eso toda migración debe dejar el esquema en un estado donde **la versión de código anterior (N-1) siga funcionando sin errores**. Regla general: expandir primero, contraer después, en migraciones separadas.

- **Agregar columna**: siempre `nullable` o con `default`. Nunca `NOT NULL` sin default en una tabla con filas existentes — el código viejo que no la escribe rompería el insert.
- **Agregar constraint** (`NOT NULL`, `UNIQUE`, foreign key): solo después de confirmar (o backfillear) que todas las filas existentes ya lo cumplen. Nunca en la misma migración que crea la columna que aún no tiene datos.
- **Eliminar o renombrar columna/tabla**: patrón expand→contract en migraciones y PRs **separados**:
  1. *Expand*: agregar la columna/tabla nueva. Desplegar código que escribe en ambas (vieja y nueva) y lee de la nueva con fallback a la vieja.
  2. Esperar a confirmar en producción que el código nuevo es estable (no hace falta un rollback).
  3. *Contract*: en una migración posterior, eliminar la columna/tabla vieja — y solo cuando ningún código en producción o preview la referencia ya.
  - No hacer expand y contract en el mismo PR/migración: si hay que revertir el deploy, el contract ya habría roto la versión anterior.
- **Cambiar el tipo de una columna**: no se hace con `ALTER COLUMN` en SQLite. Crear columna nueva del tipo correcto, migrar datos, cambiar el código para usarla, y recién en otra migración borrar la vieja (mismo patrón expand→contract).
- **No reusar** el nombre de una columna/tabla eliminada para algo con semántica distinta — el código de una versión vieja en curso (o un rollback tardío) podría interpretar los datos nuevos con el significado viejo.
- **Enums de `schema.ts`** (`SPREADSHEET_*_TYPES`, etc.): agregar valores es seguro; quitar o renombrar un valor existente no lo es si hay filas con ese valor — tratarlo como el caso "eliminar columna": deprecar primero, migrar filas, remover después.
- **Checklist del PR de migración**: si el cambio no es puramente aditivo (rename, drop, cambio de tipo, constraint nuevo sobre datos existentes), el PR debe indicar explícitamente que es un paso de "expand" o de "contract", y el "contract" no se mergea en el mismo PR que introdujo el "expand".

## Reglas de seguridad

- No leer ni modificar archivos en `.dev.vars` — contiene secretos locales.
- No commitear el archivo `.dev.vars`.
- No exponer tokens, claves ni credenciales en código ni en commits.
- No modificar `apps/web-workspace/src/pages/api/auth/` sin revisión humana explícita — es la capa de autenticación.
- El `tenant_id` de un request siempre viene de `locals.tenantId` (middleware validado), nunca de parámetros del usuario.

## Convenciones de commits y PRs

- Prefijo de tipo: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Incluir el trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>` en commits generados por agentes.

## Variables de entorno

| Variable | Tipo | Fuente local | Fuente producción |
|----------|------|-------------|------------------|
| `GOOGLE_CLIENT_ID` | pública | `apps/web-workspace/wrangler.jsonc` `vars` | mismo archivo `vars` |
| `GOOGLE_CLIENT_SECRET` | **secret** | `apps/web-workspace/.dev.vars` | `wrangler secret put` |
| `TURNSTILE_SITE_KEY` | pública | `wrangler.jsonc` `vars` / `.dev.vars` (test: `1x00000000000000000000AA`) | `wrangler.jsonc` `vars` |
| `TURNSTILE_SECRET_KEY` | **secret** | `apps/web-workspace/.dev.vars` | `wrangler secret put` |
| `WORKERS_AI_MODEL` | pública | `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` |
| `AI_GATEWAY_ID` | pública | `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` |
| `PUBLIC_APP_URL` | pública | build del landing (fallback `http://localhost:4321`) | env de build / CI |
| `TOKEN_ENCRYPTION_KEY` | **secret** | `apps/web-workspace/.dev.vars` (32 bytes en base64, `openssl rand -base64 32`) | `wrangler pages secret put` |
| `AUTH_HMAC_KEY` | **secret** | `.dev.vars` (32 bytes base64). Hashea email y código de login | `wrangler pages secret put` |
| `ANALYSIS_MODE` | pública | `.dev.vars` = `inline` para que `npm run dev` no deje el análisis en `pending` y loguee el OTP | `wrangler.jsonc` `vars` = `queue` |
| `EMAIL_SEND_URL` | pública | default `https://send.cfemailer.com/send` | mismo `vars` |
| `EMAIL_API_KEY` | **secret** opcional | `.dev.vars` si la API lo exige | `wrangler pages secret put` |
| `MERCADOPAGO_PUBLIC_KEY` | pública | `.dev.vars` / `wrangler.jsonc` `vars` (vacía hasta el checkout) | `wrangler.jsonc` `vars` |
| `MERCADOPAGO_ACCESS_TOKEN` | **secret** opcional | `.dev.vars` cuando se conecte el cobro | `wrangler pages secret put` |
| `MERCADOPAGO_WEBHOOK_SECRET` | **secret** opcional | `.dev.vars` cuando exista el webhook | `wrangler pages secret put` |

Ver `apps/web-workspace/.dev.vars.example` para la lista completa de variables requeridas en desarrollo local del workspace.
