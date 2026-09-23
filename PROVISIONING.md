# PROVISIONING.md — PlanillaInteligente desde cero

Pasos para llevar el repo de un clon limpio a producción y dev en Cloudflare. Pulumi crea los recursos, Wrangler sube el código y corre migraciones, GitHub Actions despliega.

## 0. Requisitos

- Node 22+ y npm.
- Cuenta de Cloudflare. El plan Free alcanza.
- Repo en GitHub con Actions habilitado y dos environments: `production` y `development`.
- Proyecto en Google Cloud para el cliente OAuth.
- Pulumi CLI (última estable).

```bash
curl -fsSL https://get.pulumi.com | sh
```

## 1. Local

1. `npm ci` en la raíz.
2. `cp apps/web-workspace/.dev.vars.example apps/web-workspace/.dev.vars` y completar:
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, con redirect `http://localhost:4321/api/auth/callback/google`.
   - `TOKEN_ENCRYPTION_KEY` y `AUTH_HMAC_KEY`, cada una con `openssl rand -base64 32`.
   - `ANALYSIS_MODE=inline`.
   - Turnstile puede quedar con las keys de test.
3. `npm run db:migrate:local`. Si ya había un state viejo, borrá antes `apps/web-workspace/.wrangler/state`.
4. `npm run dev`, en [http://localhost:4321](http://localhost:4321).
5. Antes de subir código: `npm run test:local`.

En local no hace falta ningún recurso de Cloudflare: D1, KV, R2 y la cola se simulan. Con `ANALYSIS_MODE=inline` el OTP de login se imprime en la consola.

## 2. Credenciales

Guardalas en un gestor de contraseñas. En el paso 7 van a GitHub.

| Variable | De dónde sale |
|---|---|
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens. Permiso de edición sobre D1, Workers KV, R2, Queues, Pages y Workers Scripts |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID de la cuenta |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | R2 → Manage API tokens. Token S3 de lectura y escritura. No es el token del API |
| `PULUMI_CONFIG_PASSPHRASE` | `openssl rand -base64 32`. Si se pierde, el state no se puede leer |

## 3. Backend de Pulumi en R2

Con `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` exportadas:

```bash
npx wrangler r2 bucket create planilla-inteligente-pulumi-state
```

`PULUMI_BACKEND_URL`, reemplazando `<ACCOUNT_ID>`:

```text
s3://planilla-inteligente-pulumi-state?endpoint=<ACCOUNT_ID>.r2.cloudflarestorage.com&region=auto&s3ForcePathStyle=true
```

## 4. Stacks

Con las variables del paso 2 y `PULUMI_BACKEND_URL` exportadas:

```bash
cd infra
npm ci --workspaces=false
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack init prod
pulumi stack init dev
pulumi preview --stack prod
pulumi up --yes --stack prod
pulumi up --yes --stack dev
```

Cada stack crea D1 y R2 (sin pin de jurisdicción), el KV de sesiones, la cola con su DLQ y dos proyectos Pages (workspace y landing). Si el `preview` muestra un `replace` o `delete` no esperado sobre D1, R2 o KV, no sigas.

## 5. Google OAuth y Turnstile

### Google, paso a paso

El ejemplo usa el proyecto `planilla-inteligente` y las URLs por defecto de Pages (`planilla-inteligente.pages.dev` y `planilla-inteligente-dev.pages.dev`). Si tenés dominio propio, poné ese.

1. **Crear el proyecto.** Entrá a [console.cloud.google.com](https://console.cloud.google.com/). En el selector de proyecto de arriba elegí **Nuevo proyecto**, con nombre `planilla-inteligente`, y tocá **Crear**. Dejalo seleccionado.
2. **Configurar la pantalla de consentimiento.** Menú → **APIs y servicios** → **Google Auth Platform** (en consolas viejas: **Pantalla de consentimiento de OAuth**). Tocá **Comenzar**.
   - **Información de la app**: nombre `PlanillaInteligente` y tu email de soporte.
   - **Público**: **Externo**, para que entren cuentas de Gmail y de cualquier dominio.
   - **Información de contacto**: tu email.
   - Aceptá la política y tocá **Crear**.
3. **Revisar los permisos.** En **Acceso a los datos**, los alcances tienen que ser solo `openid`, `.../auth/userinfo.email` y `.../auth/userinfo.profile`. Son los que pide el código. No agregues otros: sumar alcances sensibles obliga a una verificación de Google.
4. **Usuarios de prueba.** En **Público**, mientras la app está en *Prueba*, agregá los emails que van a probar. Solo esas cuentas pueden entrar.
5. **Crear un cliente para local y dev.** **Clientes** → **Crear cliente** → tipo **Aplicación web**, con nombre `planilla-local-dev`.
   - **Orígenes de JavaScript autorizados**: `http://localhost:4321` y `https://planilla-inteligente-dev.pages.dev`
   - **URI de redireccionamiento autorizados**: `http://localhost:4321/api/auth/callback/google` y `https://planilla-inteligente-dev.pages.dev/api/auth/callback/google`
   - Tocá **Crear** y copiá el **ID de cliente** y el **Secreto del cliente**. El secreto se ve una sola vez; si lo perdés, generá otro.
6. **Crear otro cliente para producción.** Repetí el paso 5 con nombre `planilla-prod`, origen `https://planilla-inteligente.pages.dev` y redirect `https://planilla-inteligente.pages.dev/api/auth/callback/google`. Así un secreto filtrado en dev no abre producción.
7. **Cargar los valores.**
   - Local: en `.dev.vars`, el `GOOGLE_CLIENT_ID` y el `GOOGLE_CLIENT_SECRET` del cliente de dev.
   - Dev y prod: el ID va en `vars.GOOGLE_CLIENT_ID` de cada bloque de `apps/web-workspace/wrangler.jsonc` (el de dev en `env.preview`). El secreto se carga con `wrangler pages secret put GOOGLE_CLIENT_SECRET` en el proyecto que corresponda (paso 6).
8. **Publicar.** Antes de abrir a clientes, en **Público** tocá **Publicar app**. Con los alcances básicos no hace falta verificación. Antes de publicar, cargá en la pantalla de consentimiento la URL de la política de privacidad, que ya exige `DATA_SECURITY.md`.

Si Google responde `redirect_uri_mismatch`, la URL de la barra no coincide carácter por carácter con la cargada. Revisá `http` o `https`, el puerto y que no haya una barra final.

### Turnstile y valores públicos

- **Turnstile**: un widget con los dominios del workspace de prod y de dev.
- En `apps/web-workspace/wrangler.jsonc`, dentro de `vars` y de `env.preview.vars`, commiteá `GOOGLE_CLIENT_ID` y `TURNSTILE_SITE_KEY` reales. Son públicos.

## 6. Secretos de runtime

Van a los proyectos Pages del workspace, nunca a `wrangler.jsonc` ni a GitHub. Cada uno se carga en `planilla-inteligente` y en `planilla-inteligente-dev`:

```bash
for project in planilla-inteligente planilla-inteligente-dev; do
  npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name "$project"
  npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name "$project"
  npx wrangler pages secret put TOKEN_ENCRYPTION_KEY --project-name "$project"
  npx wrangler pages secret put AUTH_HMAC_KEY --project-name "$project"
done
```

Usá claves distintas para prod y dev.

## 7. GitHub Actions

En Settings → Secrets and variables → Actions, cargá en los environments `production` y `development`:

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

Opcional: `PUBLIC_APP_URL` en el build de la landing, apuntando al workspace.

## 8. Primer deploy

Push a `develop` despliega dev. Push a `main` despliega producción. El workflow (`.github/workflows/deploy-cloudflare-pages.yml`) hace esto en orden:

1. `npm run test:local`.
2. `pulumi up` y lectura de los outputs del stack.
3. `infra/apply-bindings.mjs`: pega los ids en los `wrangler.jsonc`. No se commitean.
4. Migraciones de D1.
5. Deploy del consumer y del cron de mantenimiento.
6. Deploy de los proyectos Pages del workspace y la landing.

Para verificar: abrí el workspace, entrá con Google, subí un `.xlsx` y esperá a que el análisis salga de «Analizando…».

## 9. Dashboard (una vez)

- Workers Logs en el proyecto Pages del workspace. Pages no acepta `observability` en `wrangler.jsonc`.
- Si usás AI Gateway: apagá los logs del gateway y poné su id en `AI_GATEWAY_ID`.

## 10. Correo del login

El workspace hace `POST https://send.cfemailer.com/send` con `{ to, kind: "login-code", code, expiresInMinutes }`. La API externa arma el mail. En local (`ANALYSIS_MODE=inline`) el código se imprime en la consola y no hay HTTP.

Si la API exige auth: `npx wrangler pages secret put EMAIL_API_KEY --project-name <proyecto-pages>` en prod y en el proyecto dev.

## Cumplimiento antes de cobrar

No es código, y bloquea ofrecer el servicio. Está en `DATA_SECURITY.md`, prioridad 1: contrato de encargado, DPA de Cloudflare, inscripción ante la URCDP, política de privacidad y términos.
