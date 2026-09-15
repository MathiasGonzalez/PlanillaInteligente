# Documentación de arquitectura — PlanillaInteligente

Índice de los documentos de arquitectura de la aplicación. Para instrucciones dirigidas a agentes de IA, ver [`AGENTS.md`](../../AGENTS.md) en la raíz del repositorio.

## Documentos

| # | Documento | Qué explica |
|---|-----------|-------------|
| 01 | [01-despliegue-cloudflare.md](./01-despliegue-cloudflare.md) | Infraestructura completa: Pages, Worker consumer, bindings, entornos prod/preview, orden de deploy |
| 02 | [02-autenticacion.md](./02-autenticacion.md) | Flujo de login con Google OAuth, Cloudflare Turnstile, caché de sesión en KV, middleware de rutas |
| 03 | [03-multi-tenancy.md](./03-multi-tenancy.md) | Organizaciones, memberships, roles y aislamiento de datos por `tenant_id` |
| 04 | [04-upload-y-parseo.md](./04-upload-y-parseo.md) | POST /api/upload: validación, almacenamiento en R2, parseo a D1, rollback atómico |
| 05 | [05-enriquecimiento-ia.md](./05-enriquecimiento-ia.md) | Enriquecimiento asíncrono: queue vs inline, Workers AI, AI Gateway, heurística fallback, DLQ |
| 06 | [06-exportacion.md](./06-exportacion.md) | GET /api/export: reconstrucción del xlsx desde D1 + R2 |
| 07 | [07-modelo-datos.md](./07-modelo-datos.md) | Diagrama ER completo de todas las tablas D1 y sus relaciones |

## Regla de mantenimiento

Cada cambio en el código que afecte la arquitectura (nuevos bindings, cambios de flujo, nuevas rutas, cambios en el modelo de datos) debe actualizar el documento correspondiente en esta carpeta como parte del mismo PR.

## Alcance

Estos documentos describen la arquitectura **actual en producción**. Para instrucciones de setup o despliegue paso a paso, ver:

- [`SETUP_LOCAL.md`](../SETUP_LOCAL.md)
- [`SETUP_CLOUDFLARE.md`](../SETUP_CLOUDFLARE.md)
- [`DEPLOY_CLOUDFLARE.md`](../DEPLOY_CLOUDFLARE.md)
