# Setup local previo

Este documento explica la ruta segura para preparar la app antes de levantar la runtime real de Cloudflare. No crea recursos en Cloudflare ni despliega la aplicación.

## 1. Requisitos previos
- Node.js 20+ y npm
- Acceso a una cuenta de Cloudflare si se quiere lanzar la runtime completa con D1, KV, R2 y Queue
- `wrangler` disponible (instalado como devDependency del proyecto: `npx wrangler`)

## 2. Validación básica sin runtime de Cloudflare
Antes de tocar bindings reales, conviene verificar que el proyecto compila y pasa validación:

```bash
npm ci
npm run typecheck
npm run check
npm run build
```

La forma abreviada del proyecto es:

```bash
npm run test:local
```

Esto valida TypeScript, Astro y build local, pero no levanta la runtime Cloudflare ni crea bases de datos ni namespaces.

## 3. Variables de entorno locales (.dev.vars)
La app requiere variables secretas para funcionar localmente. Estas **no van en `wrangler.toml`** (texto plano visible en el repo); en cambio se cargan desde `.dev.vars`, que wrangler inyecta automáticamente.

```bash
cp .dev.vars.example .dev.vars
# Editar .dev.vars con los valores reales
```

El archivo `.dev.vars` ya está en `.gitignore` — nunca se commitea.

Variables requeridas:

| Variable | Descripción |
|---|---|
| `GOOGLE_CLIENT_ID` | ID de cliente OAuth de Google |
| `GOOGLE_CLIENT_SECRET` | Secret de cliente OAuth de Google |
| `TURNSTILE_SECRET_KEY` | Secret de Turnstile (usa `1x0000000000000000000000000000000AA` para testing local) |

Variables opcionales (ya tienen defaults en `wrangler.toml`):

| Variable | Default |
|---|---|
| `WORKERS_AI_MODEL` | `@cf/meta/llama-3.1-8b-instruct` |
| `AI_GATEWAY_ID` | vacío (llama directo a Workers AI) |

## 4. Levantar la app localmente con runtime de Cloudflare
La forma recomendada es usar `astro dev`, que activa `platformProxy` (declarado en `astro.config.mjs`) para simular los bindings de Cloudflare sin crear recursos reales:

```bash
npm run dev
```

Esto usa wrangler bajo el capó para simular D1, KV, R2 y Queue localmente con datos en `.wrangler/state/`.

Para acceder a la runtime completa (con bindings reales conectados a Cloudflare):

```bash
npm run build
npx wrangler pages dev ./dist
```

## 5. Qué necesita la app en Cloudflare
La configuración actual expone estos bindings esperados en `wrangler.toml`:

- `DB` → D1Database
- `SESSION_KV` → KV namespace
- `BUCKET` → R2 bucket
- `ENRICHMENT_QUEUE` → Cloudflare Queue (producer en Pages)
- `AI` → Workers AI binding
- `WORKERS_AI_MODEL` y `AI_GATEWAY_ID` → configuración de IA

**Importante:** el consumer de la queue **no** está en el proyecto Pages. Vive como Worker separado en `workers/enrichment-consumer/` con su propio `wrangler.toml`. Cloudflare Pages solo soporta queue producers.

## 6. Preparación de recursos reales en Cloudflare
> Para el setup completo paso a paso (D1, KV, R2, Queues, Turnstile, Google OAuth, AI Gateway, Pages, secrets y GitHub Actions), ver **[SETUP_CLOUDFLARE.md](./SETUP_CLOUDFLARE.md)**.

Cuando se confirme activar la runtime completa:

```bash
npx wrangler login

# Crear D1 databases
npx wrangler d1 create planilla-inteligente
npx wrangler d1 create planilla-inteligente-preview

# Crear KV namespaces
npx wrangler kv namespace create SESSION_KV
npx wrangler kv namespace create SESSION_KV --preview

# Crear R2 buckets
npx wrangler r2 bucket create planilla-inteligente-assets
npx wrangler r2 bucket create planilla-inteligente-assets-preview

# Crear queues
npx wrangler queues create planilla-inteligente-enrichment
npx wrangler queues create planilla-inteligente-enrichment-preview
```

Completar `wrangler.toml` con los IDs obtenidos (`database_id`, `id` de KV).

Configurar secrets (no van en `wrangler.toml`):

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

## 7. Migraciones D1
El esquema de la base de datos se define en `src/db/schema.ts`. Para generar y aplicar migraciones:

```bash
# Genera archivos SQL en migrations/ a partir del schema
npm run db:generate

# Aplica las migraciones a la base de datos de producción
npm run db:migrate

# Aplica las migraciones a la base de datos de preview
npm run db:migrate:preview
```

Los archivos generados en `migrations/` deben commitearse al repositorio.

## 8. Cómo simular la IA sin Workers AI
La app ya tiene un fallback robusto:

- Si `env.AI` no está configurado, la función `runSpreadsheetEnrichment` usa una configuración heurística generada localmente.
- Si `AI` falla, el sistema registra el error y continúa con heurísticas, sin romper la operación.

Esto permite probar la app sin una conexión real a Workers AI.

## 9. Recomendación práctica
Para empezar de forma segura:
1. Correr `npm run test:local`
2. Copiar `.dev.vars.example` → `.dev.vars` con valores reales
3. Correr `npm run dev`
4. Activar bindings reales y crear recursos solo cuando se confirme la intención de producción

