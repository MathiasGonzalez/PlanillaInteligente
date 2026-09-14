# Despliegue en Cloudflare

Este documento explica cómo queda desplegada la app en Cloudflare y qué componentes de la infraestructura se utilizan en producción.

## 1. Arquitectura general
La app está construida como un proyecto Astro con adapter de Cloudflare (`@astrojs/cloudflare`) y salida `server`.

Esto significa que la aplicación se ejecuta en Workers/Pages de Cloudflare y no como una app Node pura. El runtime usa bindings de Cloudflare para acceder a la base de datos, sesiones, almacenamiento de archivos y cola de tareas.

## 2. Componentes principales

### 2.1 D1 Database
La app usa `DB` como binding de tipo `D1Database`.

Se utiliza para:
- autenticación y sesiones
- organizaciones y memberships
- spreadsheets y columnas
- row entries
- enriquecimiento IA persistido

La conexión se crea en `src/middleware.ts`:

```ts
const db = drizzle(locals.runtime.env.DB, { schema });
```

Esto implica que la base de datos real debe existir en Cloudflare y estar vinculada al Worker/Pages.

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
- `src/pages/api/upload.ts`

Proceso típico:
1. el cliente sube un archivo
2. el backend lo guarda en R2
3. se recupera para parsear y procesar
4. si falla, se elimina la referencia en storage

### 2.4 Queue para enriquecimiento asíncrono
El binding `ENRICHMENT_QUEUE` se usa para enviar tareas de enriquecimiento IA.

El flujo de la app es:
1. el usuario sube la planilla
2. la app detecta esquema y quiere enriquecer columnas
3. la tarea puede ir a la queue
4. si la queue no existe o falla, la app cae a `inline` y procesa en el mismo request

Esto está implementado en:
- `src/lib/spreadsheet-enrichment.ts`
- `src/pages/api/ai/enrichment.ts`

### 2.5 Workers AI
El binding `AI` se usa para inferir metadata de la planilla mediante IA, por ejemplo:
- semantic type de columnas
- vista recomendada
- etiquetas de campos
- columnas sensibles

En `src/lib/spreadsheet-enrichment.ts` hay una lógica clara:
- si `AI` está disponible, se usa Workers AI
- si no está disponible o falla, se usa un heurístico local

Esto hace que la app no falle si la IA no está configurada.

## 3. Configuración declarada en wrangler.toml
El proyecto define bindings y configuración en `wrangler.toml`:

```toml
[ai]
binding = "AI"

[[d1_databases]]
binding = "DB"
database_name = "planilla-inteligente"
database_id = "replace-with-d1-database-id"

[[kv_namespaces]]
binding = "SESSION_KV"
id = "replace-with-kv-namespace-id"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "planilla-inteligente-assets"

[[queues.producers]]
binding = "ENRICHMENT_QUEUE"
queue = "planilla-inteligente-enrichment"
```

Y además define variables:

```toml
[vars]
GOOGLE_CLIENT_ID = ""
GOOGLE_CLIENT_SECRET = ""
TURNSTILE_SECRET_KEY = ""
WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct"
AI_GATEWAY_ID = ""
```

## 4. Flujo típico de despliegue
En producción, el flujo esperable es:

1. el código se publica con GitHub Actions o con `wrangler pages deploy ./dist`
2. Cloudflare crea/actualiza el proyecto de Pages y asegura que la build de Astro se sirva desde `./dist`
3. la app tiene acceso a D1, KV, R2, Queue y AI por bindings
4. cada request usa esos bindings para operar
5. la sesión y la data se persisten en la infraestructura Cloudflare

## 5. Qué pasa si no hay un binding
El sistema ya está diseñado para tolerar la ausencia de algunos recursos:

- si `ENRICHMENT_QUEUE` no existe, la app usa procesamiento inline
- si `AI` no existe o falla, usa heurística local
- si `SESSION_KV` no está disponible, la app sigue funcionando sin cache de sesión; el middleware valida la presencia del binding antes de leer o guardar en KV

Esto hace que la app sea más robusta y facilite pruebas y migraciones.

## 6. Recomendación para producción
Para un despliegue real, conviene dejar estos elementos bien configurados:
- D1 con IDs reales y esquema aplicado
- KV namespace para sesiones
- bucket R2 para uploads
- queue para enriquecimiento
- secretos de Google y Turnstile cargados fuera del repo
- Workers AI activo o fallback seguro habilitado

## 7. Resumen corto
La app queda desplegada en Cloudflare como un Worker/Pages con:
- D1 para la base de datos relacional
- KV para sesión cacheada
- R2 para archivos de planillas
- Queues para procesamiento asíncrono
- Workers AI para inferencia inteligente

Toda esta integración se declara con `wrangler.toml` y la app la consume vía `locals.runtime.env.*`.
