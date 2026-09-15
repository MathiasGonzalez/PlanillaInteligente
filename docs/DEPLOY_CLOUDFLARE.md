# Despliegue en Cloudflare

Este documento explica la arquitectura de despliegue y cómo opera la app en producción.
Para crear los recursos desde cero, ver **[SETUP_CLOUDFLARE.md](./SETUP_CLOUDFLARE.md)**.

## 1. Arquitectura general
La app está construida como un proyecto Astro con adapter de Cloudflare (`@astrojs/cloudflare`) y salida `server`.

Esto significa que la aplicación se ejecuta en Workers/Pages de Cloudflare y no como una app Node pura. El runtime usa bindings de Cloudflare para acceder a la base de datos, sesiones, almacenamiento de archivos y cola de tareas.

**Importante:** la app está compuesta por dos piezas desplegables independientes:

| Pieza | Tipo | Directorio |
|---|---|---|
| App principal (UI + API) | 🟧 Cloudflare Pages | raíz del repo |
| Consumer de enriquecimiento | 🧩 Cloudflare Worker | `workers/enrichment-consumer/` |

Cloudflare Pages **solo soporta queue producers**. El handler `queue()` debe vivir en un Worker separado.

## 1.1 Convención visual de recursos Cloudflare

| Icono | Recurso |
|---|---|
| 🟧 | Cloudflare Pages |
| 🧩 | Cloudflare Worker |
| 🗄️ | D1 Database |
| 🧰 | KV Namespace |
| 🪣 | R2 Bucket |
| 📬 | Queue producer |
| 📥 | Queue consumer |
| 🧠 | Workers AI |
| 🚪 | AI Gateway |
| 🧯 | Dead Letter Queue |

## 2. Componentes principales

### 2.1 D1 Database
La app usa `DB` como binding de tipo `D1Database`.

Se utiliza para:
- autenticación y sesiones
- organizaciones y memberships
- spreadsheets y columnas
- row entries
- enriquecimiento IA persistido

La conexión se crea en `src/middleware.ts`, a través del adaptador centralizado en `src/bindings/d1.ts`:

```ts
const db = createDatabase(cloudflareEnv.DB);
```

El esquema está en `src/db/schema.ts`. Las migraciones se generan con:

```bash
npm run db:generate   # genera SQL en migrations/
npm run db:migrate    # aplica en producción
```

### 2.2 KV para sesiones
El binding `SESSION_KV` se usa para cachear la sesión del usuario y reducir lecturas repetidas a D1.

Se usa en:
- `src/middleware.ts`

Flujo:
1. Se lee la sesión por cookie
2. Si existe cache válido, se reutiliza
3. Si no, se consulta D1 y se guarda en KV

### 2.3 R2 para archivos
El binding `BUCKET` se usa para guardar los archivos subidos por usuario, por ejemplo planillas Excel/CSV.

Se usa en:
- `src/features/spreadsheets/api/upload-route.ts`

Proceso típico:
1. el cliente sube un archivo
2. el backend lo guarda en R2
3. se recupera para parsear y procesar
4. si falla, se elimina la referencia en storage

### 2.4 Queue para enriquecimiento asíncrono
El binding `ENRICHMENT_QUEUE` se declara como **producer** en el Pages `wrangler.toml`. El consumer corre como Worker separado.

La arquitectura es:
- **Producer (Pages)**: `src/spreadsheets/enrichment/service.ts` envía mensajes vía `src/bindings/queue.ts` (`sendEnrichmentJob`)
- **Consumer (Worker)**: `workers/enrichment-consumer/wrangler.toml` + `src/queue.ts` delegan en `src/spreadsheets/queue/consumer.ts`

El consumer está configurado con:
- `max_batch_size = 10`
- `max_batch_timeout = 30` (segundos — importante para procesamiento IA)
- `max_retries = 3`
- `dead_letter_queue` para capturar mensajes que fallan repetidamente

Si la queue no existe o falla, la app cae a procesamiento inline en el mismo request.

### 2.5 Workers AI
El binding `AI` se usa para inferir metadata de la planilla mediante IA.

Si `AI_GATEWAY_ID` está configurado, todas las llamadas se enrutan a través de AI Gateway para analytics, caché y control de costos:

```ts
const options = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
const response = await env.AI.run(model, input, options);
```

Si `AI` no está disponible o falla, se usa heurística local como fallback.

## 3. Gestión de secrets

**Nunca** poner secrets en `wrangler.toml` (`[vars]` es texto plano y visible en el repo).

| Variable | Tipo | Configuración |
|---|---|---|
| `GOOGLE_CLIENT_ID` | var pública | `wrangler.toml [vars]` |
| `GOOGLE_CLIENT_SECRET` | **secret** | `wrangler secret put GOOGLE_CLIENT_SECRET` |
| `TURNSTILE_SECRET_KEY` | **secret** | `wrangler secret put TURNSTILE_SECRET_KEY` |
| `WORKERS_AI_MODEL` | var pública | `wrangler.toml [vars]` |
| `AI_GATEWAY_ID` | var pública | `wrangler.toml [vars]` |

Para desarrollo local, usar `.dev.vars` (ver `SETUP_LOCAL.md`).

## 4. Configuración declarada en wrangler.toml

### Pages (raíz)
```toml
[vars]
GOOGLE_CLIENT_ID = ""
WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct"
AI_GATEWAY_ID = ""

[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "planilla-inteligente"
database_id = "..."
migrations_dir = "migrations"

[[kv_namespaces]]
binding = "SESSION_KV"
id = "..."

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "planilla-inteligente-assets"

[[queues.producers]]
binding = "ENRICHMENT_QUEUE"
queue = "planilla-inteligente-enrichment"
```

### Worker consumer (workers/enrichment-consumer/)
```toml
[[queues.consumers]]
queue = "planilla-inteligente-enrichment"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "planilla-inteligente-enrichment-dlq"
```

## 5. Separación de ambientes (producción / preview)
El `wrangler.toml` de Pages usa `[env.preview]` para aislar recursos del ambiente preview:

- DB de preview: `planilla-inteligente-preview`
- KV de preview: namespace separado
- R2 de preview: bucket separado
- Queue de preview: `planilla-inteligente-enrichment-preview`

Esto evita que un deploy a una rama `dev` toque datos de producción.

## 6. Flujo típico de despliegue
El workflow `.github/workflows/deploy-cloudflare-pages.yml` orquesta el deploy en este orden:

1. Validar que los secrets requeridos existen
2. Aplicar migraciones D1 (`wrangler d1 migrations apply ... --remote`)
3. Desplegar el Worker consumer (`wrangler deploy --config workers/enrichment-consumer/wrangler.toml`)
4. Desplegar el proyecto Pages (`wrangler pages deploy ./dist`)

Este orden garantiza que la base de datos esté actualizada antes de que el código nuevo entre en producción.

## 7. Qué pasa si no hay un binding
El sistema está diseñado para tolerar la ausencia de algunos recursos:

- si `ENRICHMENT_QUEUE` no existe, la app usa procesamiento inline
- si `AI` no existe o falla, usa heurística local
- si `SESSION_KV` no está disponible, la app sigue funcionando sin cache de sesión

## 8. Resumen corto
La app queda desplegada en Cloudflare como:

| Componente | Tipo | Bindings usados |
|---|---|---|
| App principal | 🟧 Pages (SSR Worker) | 🗄️ D1, 🧰 KV, 🪣 R2, 📬 Queue producer, 🧠 AI |
| Consumer queue | 🧩 Worker standalone | 🗄️ D1, 📥 Queue consumer, 🧠 AI |

Toda la configuración se declara en los respectivos `wrangler.toml`. En Pages, la app accede a los bindings vía `src/platform/cloudflare/env.ts` (`cloudflareEnv.*`) y los usa a través de los adaptadores en `src/bindings/`; en el consumer de queue, el Worker recibe `env.*` directamente en el handler y lo pasa a los adaptadores.
