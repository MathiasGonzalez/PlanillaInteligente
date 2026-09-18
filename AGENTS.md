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
- **Cloudflare Worker** — consumer de queue (`workers/api-enrichment-consumer/`)
- **Cloudflare R2** — almacenamiento de archivos `.xlsx`
- **Cloudflare KV** — caché de sesiones
- **Cloudflare Queue** — procesamiento asíncrono de enriquecimiento IA
- **Workers AI** — inferencia de metadata con `@cf/meta/llama-3.1-8b-instruct`

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
npm run db:migrate      # aplica en producción
npm run db:migrate:preview  # aplica en preview
```

**Antes de commitear un cambio de código**, siempre correr:
```bash
npm run test:local
```

No hay tests unitarios. La validación es: TypeScript + Astro check + build exitoso.

## Estructura del repo

Prefijos: **`apps/web-*`** (Pages), **`workers/api-*`** (Workers extra), **`packages/`** (código compartido). Un `wrangler.jsonc` por deployable; no hay Wrangler en la raíz.

```
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
workers/api-enrichment-consumer/       # Worker Queue consumer
  src/index.ts                         # Handler fino → packages/spreadsheets
  wrangler.jsonc
packages/cloudflare/                   # Primitivas Cloudflare (1 carpeta = 1 binding)
  src/d1/index.ts                      # createDatabase
  src/d1/schema.ts                     # Esquema Drizzle — fuente de verdad D1
  src/r2/index.ts
  src/kv/index.ts
  src/ai/index.ts
  src/queue/index.ts                   # producer sendEnrichmentJob
  src/env.ts                           # cloudflareEnv
packages/spreadsheets/                 # Dominio de planillas (lo usan workspace y el worker)
  src/parsing/
  src/export/
  src/enrichment/
migrations/                            # SQL D1 (recurso de entorno, raíz)
```

Imports de primitivas: `@planilla/cloudflare/d1`, `/d1/schema`, `/r2`, `/kv`, `/ai`, `/queue`, `/env`.
Dominio: `@planilla/spreadsheets/...`.

## Cómo agregar una feature

Decidir en este orden:

1. **¿Es UI o una ruta HTTP del producto?** → `apps/web-workspace/` (`src/pages`, `src/components`). Las rutas API son wrappers finos que delegan al package de dominio. Quedan en Astro (mismo origen que la cookie de sesión).
2. **¿Es marketing / landing?** → `apps/web-landing/`. Sin D1/KV/R2/Queue/AI.
3. **¿La lógica la usa más de un deployable o es dominio de producto?** → `packages/<feature>/` (como `packages/spreadsheets`). No poner dominio dentro de `packages/cloudflare`.
4. **¿Es un binding Cloudflare nuevo o acceso a uno existente?** → adapter en `packages/cloudflare/<primitiva>/`. Declarar el binding en el `wrangler.jsonc` de **cada** deployable que lo use (y `env.preview`). No acceder a `env.DB` / `env.BUCKET` fuera de esos adapters.
5. **¿Hace falta un Worker?** Solo si Pages no puede (queue consumer, cron, email), hay un segundo cliente / API pública, o el servicio es cross-app de verdad. Carpeta: `workers/api-<servicio>/`. El handler es fino y llama al package de dominio. No extraer `/api/*` a Hono “por si acaso”.
6. **¿Tabla o columna nueva?** → `packages/cloudflare/src/d1/schema.ts` + `npm run db:generate` + commitear `migrations/`. Queries con `eq(table.tenantId, tenantId)`.

**No hacer:**

- Carpeta de feature al lado de `d1`/`r2` (eje incorrecto).
- Meter upload en `r2/` o enrichment en `ai/`.
- Nuevo deployable dentro de `apps/web-workspace` (otro Worker no es una página).
- Wrangler en la raíz (no hay `extends` entre configs).
- Instalar paquetes npm sin confirmación.
- Worker o package que importe desde `apps/*` (dirección: apps/workers → packages, nunca al revés).

**Checklist del mismo PR:**

- `package.json` workspace si se crea `packages/<feature>`, `workers/api-<nombre>` o `apps/web-<nombre>`.
- Binding + preview en wrangler de los deployables afectados.
- Actualizar este archivo si cambia el layout, bindings o la convención de deployables.
- `npm run test:local`.

## Convenciones de código

- **Sin instalar paquetes** sin confirmación explícita del usuario — consultar antes de agregar cualquier dependencia.
- **TypeScript estricto**: no usar `as any`, no suprimir errores con `@ts-ignore` salvo justificación documentada.
- **Aislamiento por tenant**: toda query a tablas operativas (`spreadsheets`, `spreadsheet_columns`, `row_entries`, `spreadsheet_enrichments`) debe incluir `eq(table.tenantId, tenantId)` como condición. Nunca omitir este filtro.
- **API routes**: usar `apps/web-workspace/src/app/http/responses.ts` (`json()`) para respuestas JSON consistentes.
- **Bindings opcionales**: diseñar código que tolere la ausencia de bindings (`AI`, `ENRICHMENT_QUEUE`, `SESSION_KV`).
- **Acceso a bindings**: usar los adaptadores `@planilla/cloudflare/*` (d1, r2, kv, ai, queue); nunca acceder a los bindings directamente desde fuera de esos módulos salvo en tests o entry points.
- **Secrets**: nunca poner secretos en `wrangler.jsonc` (`vars` es texto plano). Usar `wrangler secret put` para producción y `apps/web-workspace/.dev.vars` para desarrollo local.
- **Migraciones**: al modificar `packages/cloudflare/src/d1/schema.ts`, siempre generar la migración con `npm run db:generate` y commitear los archivos de `migrations/`. El modelo de datos vive en ese schema, no en un documento aparte.

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
| `TURNSTILE_SECRET_KEY` | **secret** | `apps/web-workspace/.dev.vars` | `wrangler secret put` |
| `WORKERS_AI_MODEL` | pública | `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` |
| `AI_GATEWAY_ID` | pública | `wrangler.jsonc` `vars` | `wrangler.jsonc` `vars` |
| `PUBLIC_APP_URL` | pública | build del landing (fallback `http://localhost:4321`) | env de build / CI |

Ver `apps/web-workspace/.dev.vars.example` para la lista completa de variables requeridas en desarrollo local del workspace.
