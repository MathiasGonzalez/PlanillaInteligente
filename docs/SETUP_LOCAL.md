# Setup local previo

Este documento explica la ruta segura para preparar la app antes de levantar la runtime real de Cloudflare. No crea recursos en Cloudflare ni despliega la aplicación.

## 1. Requisitos previos
- Node.js 20+ y npm
- Acceso a una cuenta de Cloudflare si se quiere lanzar la runtime completa con D1, KV, R2 y Queue
- `wrangler` disponible (localmente o con `npx wrangler`)

## 2. Validación básica sin runtime de Cloudflare
Antes de tocar bindings reales, conviene verificar que el proyecto compila y pasa validación:

```bash
npm ci
npm run typecheck
npm run check
npx astro build
```

La forma abreviada del proyecto es:

```bash
npm run test:local
```

Esto valida TypeScript, Astro y build local, pero no levanta la runtime Cloudflare ni crea bases de datos ni namespaces.

## 3. Qué necesita la app en Cloudflare
La configuración actual expone estos bindings esperados en `wrangler.toml`:

- `DB` -> D1Database
- `SESSION_KV` -> KV namespace
- `BUCKET` -> R2 bucket
- `ENRICHMENT_QUEUE` -> Cloudflare Queue
- `AI` -> Workers AI binding
- `WORKERS_AI_MODEL` y `AI_GATEWAY_ID` -> configuración de IA

El código usa estos bindings en:
- `src/middleware.ts` para la sesión y la base de datos
- `src/pages/api/upload.ts` para R2
- `src/lib/spreadsheet-enrichment.ts` para la IA y la cola

## 4. Preparación de la runtime real (solo cuando se confirme)
Cuando el usuario decida activar la runtime completa, se deben crear los recursos reales con Wrangler:

```bash
npx wrangler login
npx wrangler d1 create planilla-inteligente
```

Luego revisar y completar `wrangler.toml` con:
- `database_id` del D1
- `id` del KV namespace
- nombre del bucket R2
- nombre de la queue

Para este proyecto, la ejecución local de la runtime de Cloudflare debe seguir el modelo de Pages, no el de un Worker suelto. La forma recomendada es:

```bash
npx wrangler pages dev ./dist
```

Esto refleja mejor el despliegue real del repositorio, que usa `pages_build_output_dir = "./dist"` y el workflow de Pages.

## 5. Cómo simular la IA sin Workers AI
La app ya tiene un fallback robusto:

- Si `env.AI` no está configurado, la función `runSpreadsheetEnrichment` usa una configuración heurística generada localmente.
- Si `AI` falla, el sistema registra el error y continúa con heurísticas, sin romper la operación.

Esto permite probar la app sin una conexión real a Workers AI. La lógica de fallback vive en `src/lib/spreadsheet-enrichment.ts` y se usa como comportamiento seguro en ausencia de IA.

## 6. Recomendación práctica
Para empezar de forma segura:
1. correr `npm run test:local`
2. revisar que la app compila
3. documentar el setup real de Cloudflare
4. activar bindings reales solo cuando se confirme la intención de usar la runtime completa

Esto evita crear recursos de Cloudflare sin necesidad, y deja la app lista para una activación controlada más adelante.
