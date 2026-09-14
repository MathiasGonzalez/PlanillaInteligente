# Setup en Cloudflare

Este documento cubre la creación y configuración de todos los recursos necesarios en Cloudflare para desplegar la app por primera vez. Sigue los pasos en orden.

## Requisitos previos

- Cuenta activa en [Cloudflare](https://dash.cloudflare.com/)
- Node.js 20+ y npm instalados
- Proyecto clonado y dependencias instaladas: `npm install`
- Haber corrido `npm run test:local` sin errores

## 1. Autenticar Wrangler

```bash
npx wrangler login
```

Abre el navegador para autorizar tu cuenta. Verificar:

```bash
npx wrangler whoami
```

---

## 2. Crear bases de datos D1

```bash
# Producción
npx wrangler d1 create planilla-inteligente

# Preview (para ramas dev/develop)
npx wrangler d1 create planilla-inteligente-preview
```

Cada comando devuelve un `database_id`. Copiarlos y actualizar `wrangler.toml`:

```toml
# Producción (nivel raíz)
[[d1_databases]]
binding = "DB"
database_name = "planilla-inteligente"
database_id = "PEGAR-ID-AQUI"           # ← reemplazar

# Preview
[[env.preview.d1_databases]]
binding = "DB"
database_name = "planilla-inteligente-preview"
database_id = "PEGAR-ID-PREVIEW-AQUI"  # ← reemplazar
```

Lo mismo en `workers/enrichment-consumer/wrangler.toml`.

### Aplicar el esquema inicial

```bash
# Generar migraciones desde el schema de Drizzle
npm run db:generate

# Aplicar en producción
npm run db:migrate

# Aplicar en preview
npm run db:migrate:preview
```

Los archivos generados en `migrations/` deben commitearse al repositorio.

---

## 3. Crear namespaces KV

```bash
# Producción
npx wrangler kv namespace create SESSION_KV

# Preview
npx wrangler kv namespace create SESSION_KV --preview
```

Cada comando devuelve un `id`. Actualizar `wrangler.toml`:

```toml
# Producción
[[kv_namespaces]]
binding = "SESSION_KV"
id = "PEGAR-ID-AQUI"

# Preview
[[env.preview.kv_namespaces]]
binding = "SESSION_KV"
id = "PEGAR-ID-PREVIEW-AQUI"
```

---

## 4. Crear buckets R2

```bash
# Producción
npx wrangler r2 bucket create planilla-inteligente-assets

# Preview
npx wrangler r2 bucket create planilla-inteligente-assets-preview
```

Los nombres ya están en `wrangler.toml`. No se requiere actualizar nada salvo que se usen nombres distintos.

---

## 5. Crear queues

```bash
# Producción
npx wrangler queues create planilla-inteligente-enrichment

# Preview
npx wrangler queues create planilla-inteligente-enrichment-preview

# Dead-letter queues (capturan mensajes que fallan repetidamente)
npx wrangler queues create planilla-inteligente-enrichment-dlq
npx wrangler queues create planilla-inteligente-enrichment-preview-dlq
```

Los nombres ya están en los `wrangler.toml` — no se requiere actualizar.

---

## 6. Crear el proyecto Pages

```bash
# Crear el proyecto en Cloudflare Pages
npx wrangler pages project create planilla-inteligente
```

Cuando pregunte por el directorio de output, responder: `./dist`

Alternativamente, crear el proyecto desde el [dashboard de Cloudflare](https://dash.cloudflare.com/) → Workers & Pages → Create → Pages → Connect to Git.

---

## 7. Configurar secrets de la app

Los secrets **nunca** van en `wrangler.toml`. Se cargan con wrangler:

```bash
# Secreto de Google OAuth
npx wrangler secret put GOOGLE_CLIENT_SECRET
# (pide el valor interactivamente)

# Secreto de Turnstile
npx wrangler secret put TURNSTILE_SECRET_KEY
# (pide el valor interactivamente)
```

Para el ambiente preview, repetir con `--env preview`:

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
npx wrangler secret put TURNSTILE_SECRET_KEY --env preview
```

Para el Worker consumer:

```bash
# No requiere secrets propios — solo usa D1 y AI.
```

### Vars públicas (sin secret)

Estos valores van en `wrangler.toml [vars]` y ya están configurados:

| Variable | Descripción |
|---|---|
| `GOOGLE_CLIENT_ID` | ID de cliente OAuth de Google (público) |
| `WORKERS_AI_MODEL` | Modelo de IA (`@cf/meta/llama-3.1-8b-instruct` por defecto) |
| `AI_GATEWAY_ID` | ID del AI Gateway (opcional) |

Actualizar `GOOGLE_CLIENT_ID` en `wrangler.toml` con el valor real.

---

## 8. Configurar Google OAuth

1. Ir a [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Crear un proyecto (o usar uno existente)
3. Crear credenciales → OAuth 2.0 Client ID → Web application
4. Agregar en **Authorized redirect URIs**:
   - `https://tu-dominio.pages.dev/api/auth/callback/google`
   - `http://localhost:4321/api/auth/callback/google` (desarrollo local)
5. Copiar **Client ID** → `GOOGLE_CLIENT_ID` en `wrangler.toml [vars]`
6. Copiar **Client Secret** → `wrangler secret put GOOGLE_CLIENT_SECRET`

---

## 9. Configurar Cloudflare Turnstile

1. Ir al [dashboard de Cloudflare](https://dash.cloudflare.com/) → Turnstile
2. Crear un nuevo sitio
3. Agregar los dominios permitidos:
   - `tu-dominio.pages.dev`
   - `localhost` (para desarrollo local)
4. Copiar **Site Key** → usarlo en el frontend (componente Turnstile)
5. Copiar **Secret Key** → `wrangler secret put TURNSTILE_SECRET_KEY`

**Para desarrollo local:** usar las claves de test de Cloudflare:
- Site key: `1x00000000000000000000AA`
- Secret key: `1x0000000000000000000000000000000AA`

---

## 10. Configurar AI Gateway (opcional)

El AI Gateway agrega analíticas, caché y rate limiting sobre Workers AI. Es opcional — si no se configura, las llamadas van directo a Workers AI.

1. Ir al [dashboard de Cloudflare](https://dash.cloudflare.com/) → AI → AI Gateway
2. Crear un gateway con el nombre que prefieras
3. Copiar el **Gateway ID**
4. Actualizar `wrangler.toml [vars]`:
   ```toml
   [vars]
   AI_GATEWAY_ID = "tu-gateway-id"
   ```

---

## 11. Desplegar el Worker consumer

```bash
# Producción
npx wrangler deploy --config workers/enrichment-consumer/wrangler.toml

# Preview
npx wrangler deploy --config workers/enrichment-consumer/wrangler.toml --env preview
```

---

## 12. Primer deploy de Pages

```bash
npm run build
npx wrangler pages deploy ./dist --project-name planilla-inteligente --branch main
```

---

## 13. Configurar secretos en GitHub Actions

Para que el workflow de CI/CD funcione, agregar estos secretos en **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Descripción |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token de API con permisos de Workers, Pages y D1 |
| `CLOUDFLARE_ACCOUNT_ID` | ID de cuenta de Cloudflare |
| `CLOUDFLARE_PAGES_PROJECT_NAME_PROD` | Nombre del proyecto Pages en producción |
| `CLOUDFLARE_PAGES_PROJECT_NAME_DEV` | Nombre del proyecto Pages para preview |

### Crear el API Token

1. Ir a [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Create Token → Custom token
3. Permisos necesarios:
   - `Cloudflare Pages` → Edit
   - `Workers Scripts` → Edit
   - `D1` → Edit
   - `Workers KV Storage` → Edit
   - `Workers R2 Storage` → Edit
   - `Queues` → Edit
4. Account Resources → All accounts (o seleccionar la cuenta específica)
5. Copiar el token generado → GitHub secret `CLOUDFLARE_API_TOKEN`

### Obtener el Account ID

```bash
npx wrangler whoami
```

El `Account ID` aparece en la salida. Agregarlo como `CLOUDFLARE_ACCOUNT_ID`.

---

## 14. Verificar el deploy

1. Abrir la URL del proyecto Pages en el dashboard de Cloudflare
2. Verificar que la app cargue correctamente
3. Intentar login con Google OAuth
4. Subir una planilla de prueba y verificar que el enriquecimiento funcione

---

## Resumen de recursos creados

| Recurso | Nombre producción | Nombre preview |
|---|---|---|
| D1 Database | `planilla-inteligente` | `planilla-inteligente-preview` |
| KV Namespace | `SESSION_KV` | `SESSION_KV` (preview) |
| R2 Bucket | `planilla-inteligente-assets` | `planilla-inteligente-assets-preview` |
| Queue | `planilla-inteligente-enrichment` | `planilla-inteligente-enrichment-preview` |
| Queue DLQ | `planilla-inteligente-enrichment-dlq` | `planilla-inteligente-enrichment-preview-dlq` |
| Pages project | `planilla-inteligente` | mismo proyecto, rama `dev` |
| Worker consumer | `planilla-inteligente-enrichment-consumer` | mismo, env `preview` |
