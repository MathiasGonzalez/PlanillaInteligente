# Documentación de arquitectura — PlanillaInteligente

Esta carpeta es la **fuente de verdad** de cómo funciona la aplicación hoy.

## Contrato de mantenimiento

> **Regla:** Cada cambio en el código que afecte la arquitectura (nuevos bindings, cambios de flujo, nuevas rutas, cambios en el modelo de datos, etc.) debe actualizar el documento correspondiente en esta carpeta.

Esto aplica a:
- Pull requests que modifiquen `src/`, `workers/`, `wrangler.toml` o el esquema D1
- Cambios en cómo se despliega la app en Cloudflare
- Incorporación de nuevos servicios o bindings

Si un agente de IA trabaja sobre el repositorio, debe leer primero los docs relevantes de esta carpeta antes de proponer cambios, y actualizar los diagramas como parte de su diff.

## Índice

| # | Documento | Qué explica |
|---|-----------|-------------|
| — | [agents.md](./agents.md) | Este archivo: índice y reglas de mantenimiento |
| 01 | [01-despliegue-cloudflare.md](./01-despliegue-cloudflare.md) | Infraestructura completa: Pages, Worker consumer, bindings, entornos prod/preview, orden de deploy |
| 02 | [02-autenticacion.md](./02-autenticacion.md) | Flujo de login con Google OAuth, Cloudflare Turnstile, caché de sesión en KV, middleware de rutas |
| 03 | [03-multi-tenancy.md](./03-multi-tenancy.md) | Organizaciones, memberships, roles y aislamiento de datos por `tenant_id` |
| 04 | [04-upload-y-parseo.md](./04-upload-y-parseo.md) | POST /api/upload: validación, almacenamiento en R2, parseo a D1, rollback atómico |
| 05 | [05-enriquecimiento-ia.md](./05-enriquecimiento-ia.md) | Enriquecimiento asíncrono: queue vs inline, Workers AI, AI Gateway, heurística fallback, DLQ |
| 06 | [06-exportacion.md](./06-exportacion.md) | GET /api/export: reconstrucción del xlsx desde D1 + R2 |
| 07 | [07-modelo-datos.md](./07-modelo-datos.md) | Diagrama ER completo de todas las tablas D1 y sus relaciones |

## Alcance de esta carpeta

Estos documentos describen la arquitectura **actual en producción**. No son roadmaps ni especificaciones de features futuros. Para instrucciones de setup o despliegue paso a paso, ver:

- [`SETUP_LOCAL.md`](../SETUP_LOCAL.md) — entorno de desarrollo local
- [`SETUP_CLOUDFLARE.md`](../SETUP_CLOUDFLARE.md) — creación de recursos en Cloudflare
- [`DEPLOY_CLOUDFLARE.md`](../DEPLOY_CLOUDFLARE.md) — proceso de despliegue a producción
