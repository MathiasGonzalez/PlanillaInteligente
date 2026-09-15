# AGENTS.md — PlanillaInteligente

Guía para agentes de IA que trabajan sobre este repositorio. Lee este archivo antes de proponer cualquier cambio.

## Qué es este proyecto

PlanillaInteligente es una aplicación web multi-tenant que transforma planillas Excel en aplicaciones dinámicas. Un usuario sube un `.xlsx`, el sistema lo parsea, infiere metadata de UI con Workers AI y genera una interfaz configurable (tabla, kanban, dashboard).

**Stack principal:**
- **Astro** (SSR, output `server`, adapter `@astrojs/cloudflare`)
- **React** 19 — solo para componentes de UI interactivos
- **TypeScript** strict — sin `any` implícitos
- **Drizzle ORM** sobre **Cloudflare D1** (SQLite)
- **Cloudflare Pages** — app principal
- **Cloudflare Worker** — consumer de queue (`workers/enrichment-consumer/`)
- **Cloudflare R2** — almacenamiento de archivos `.xlsx`
- **Cloudflare KV** — caché de sesiones
- **Cloudflare Queue** — procesamiento asíncrono de enriquecimiento IA
- **Workers AI** — inferencia de metadata con `@cf/meta/llama-3.1-8b-instruct`

## Comandos

```bash
# Validación completa sin runtime de Cloudflare (TypeScript + Astro check + build)
npm run test:local

# Desarrollo local con runtime simulada de Cloudflare
npm run dev

# Solo TypeScript
npm run typecheck

# Solo Astro check
npm run check

# Build de producción
npm run build

# Migraciones D1
npm run db:generate     # genera SQL en migrations/ a partir de src/db/schema.ts
npm run db:migrate      # aplica en producción
npm run db:migrate:preview  # aplica en preview
```

**Antes de commitear un cambio de código**, siempre correr:
```bash
npm run test:local
```

No hay tests unitarios. La validación es: TypeScript + Astro check + build exitoso.

## Estructura del repo

```
src/
  components/       # Componentes UI (React en auth/, resto Astro)
  db/schema.ts      # Definición del esquema Drizzle — única fuente de verdad del modelo de datos
  lib/              # Lógica de negocio reutilizable
    excel-parser.ts         # Parseo de .xlsx a D1
    excel-exporter.ts       # Reconstrucción de .xlsx desde D1 + R2
    spreadsheet-enrichment.ts  # Orquestación de enriquecimiento IA
    spreadsheet-enrichment-types.ts
    spreadsheet-matrix.ts
    turnstile.ts
    api-response.ts
  middleware.ts     # Autenticación, sesión KV, tenant isolation
  pages/
    api/            # Endpoints REST (Astro API routes)
      upload.ts
      export.ts
      ai/enrichment.ts
    api/auth/       # Handlers OAuth (Google)
  queue.ts          # Entry point del Worker consumer (no mover)
  types/            # Tipos globales y extensión de Locals de Astro
workers/
  enrichment-consumer/  # Worker standalone que consume la queue
    wrangler.toml
docs/
  architecture/     # Documentación de arquitectura por feature (ver más abajo)
  SETUP_LOCAL.md
  SETUP_CLOUDFLARE.md
  DEPLOY_CLOUDFLARE.md
wrangler.toml       # Configuración Pages (prod + preview)
drizzle.config.ts
```

## Arquitectura — documentación por feature

Cada feature tiene su propio documento en `docs/architecture/`. **Leer el doc relevante antes de modificar esa área.**

| Feature | Documento |
|---------|-----------|
| Despliegue Cloudflare (infraestructura) | [`docs/architecture/01-despliegue-cloudflare.md`](./docs/architecture/01-despliegue-cloudflare.md) |
| Autenticación y sesiones | [`docs/architecture/02-autenticacion.md`](./docs/architecture/02-autenticacion.md) |
| Multi-tenancy y roles | [`docs/architecture/03-multi-tenancy.md`](./docs/architecture/03-multi-tenancy.md) |
| Upload y parseo de planillas | [`docs/architecture/04-upload-y-parseo.md`](./docs/architecture/04-upload-y-parseo.md) |
| Enriquecimiento IA | [`docs/architecture/05-enriquecimiento-ia.md`](./docs/architecture/05-enriquecimiento-ia.md) |
| Exportación de planillas | [`docs/architecture/06-exportacion.md`](./docs/architecture/06-exportacion.md) |
| Modelo de datos (ER) | [`docs/architecture/07-modelo-datos.md`](./docs/architecture/07-modelo-datos.md) |

**Regla de mantenimiento:** Si un cambio de código afecta la arquitectura (nuevos bindings, flujos, rutas, modelo de datos), actualizar el doc correspondiente como parte del mismo PR.

## Convenciones de código

- **Sin instalar paquetes** sin confirmación explícita del usuario — consultar antes de agregar cualquier dependencia.
- **TypeScript estricto**: no usar `as any`, no suprimir errores con `@ts-ignore` salvo justificación documentada.
- **Aislamiento por tenant**: toda query a tablas operativas (`spreadsheets`, `spreadsheet_columns`, `row_entries`, `spreadsheet_enrichments`) debe incluir `eq(table.tenantId, tenantId)` como condición. Nunca omitir este filtro.
- **API routes**: usar `src/lib/api-response.ts` (`json()`) para respuestas JSON consistentes.
- **Bindings opcionales**: diseñar código que tolere la ausencia de bindings (`AI`, `ENRICHMENT_QUEUE`, `SESSION_KV`) — ver tolerancia a fallos en el doc de despliegue.
- **Secrets**: nunca poner secretos en `wrangler.toml` (`[vars]` es texto plano). Usar `wrangler secret put` para producción y `.dev.vars` para desarrollo local.
- **Migraciones**: al modificar `src/db/schema.ts`, siempre generar la migración con `npm run db:generate` y commitear los archivos de `migrations/`.

## Reglas de seguridad

- No leer ni modificar archivos en `.dev.vars` — contiene secretos locales.
- No commitear el archivo `.dev.vars`.
- No exponer tokens, claves ni credenciales en código ni en commits.
- No modificar `src/pages/api/auth/` sin revisión humana explícita — es la capa de autenticación.
- El `tenant_id` de un request siempre viene de `locals.tenantId` (middleware validado), nunca de parámetros del usuario.

## Convenciones de commits y PRs

- Prefijo de tipo: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Incluir el trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>` en commits generados por agentes.
- Actualizar el doc de arquitectura relevante si el cambio afecta la estructura de la app.

## Variables de entorno

| Variable | Tipo | Fuente local | Fuente producción |
|----------|------|-------------|------------------|
| `GOOGLE_CLIENT_ID` | pública | `wrangler.toml [vars]` | `wrangler.toml [vars]` |
| `GOOGLE_CLIENT_SECRET` | **secret** | `.dev.vars` | `wrangler secret put` |
| `TURNSTILE_SECRET_KEY` | **secret** | `.dev.vars` | `wrangler secret put` |
| `WORKERS_AI_MODEL` | pública | `wrangler.toml [vars]` | `wrangler.toml [vars]` |
| `AI_GATEWAY_ID` | pública | `wrangler.toml [vars]` | `wrangler.toml [vars]` |

Ver `.dev.vars.example` para la lista completa de variables requeridas en desarrollo local.
