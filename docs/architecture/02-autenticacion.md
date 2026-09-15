# 02 — Autenticación y gestión de sesiones

La autenticación usa Google OAuth 2.0 como único proveedor, protegida por Cloudflare Turnstile en el formulario de login. Las sesiones se persisten en D1 y se cachean en KV para reducir lecturas repetidas.

## Flujo completo de login

```mermaid
sequenceDiagram
    actor U as Usuario
    participant FE as LoginCard (React)
    participant CF as Cloudflare Turnstile
    participant API as /api/auth/*
    participant Google as Google OAuth
    participant D1 as D1 Database
    participant KV as SESSION_KV

    U->>FE: Abre /login
    FE->>CF: Solicita widget Turnstile (siteKey)
    CF-->>FE: Renderiza widget, genera token
    U->>FE: Click "Continuar con Google"
    FE->>API: POST /api/auth/signin/google\n{ cf-turnstile-response }
    API->>CF: Verifica token Turnstile (secretKey + remoteIp)
    CF-->>API: { success: true }
    API->>Google: Redirect OAuth (client_id, redirect_uri, scopes)
    Google-->>U: Pantalla de consentimiento Google
    U->>Google: Acepta
    Google->>API: GET /api/auth/callback/google?code=...
    API->>Google: Intercambia code → access_token + id_token
    Google-->>API: Datos del usuario (email, name, picture)
    API->>D1: Upsert users + accounts\nCrear o recuperar organization\nInsertar membership\nCrear session con expiresAt
    API->>KV: PUT session:{token} → { tenantId, user, session }
    API-->>U: Set-Cookie: session_token\nRedirect → /dashboard
```

## Caché de sesión en KV

Cada request autenticado pasa por `src/middleware.ts`, que implementa una estrategia de caché read-through sobre KV:

```mermaid
flowchart TD
    A[Request entrante] --> B{¿Tiene cookie\nde sesión?}
    B -->|No| C{¿Ruta pública?}
    C -->|Sí| D[next — sin autenticar]
    C -->|No| E[Redirect /login]
    B -->|Sí| F[Leer session:token de KV]
    F --> G{¿Cache válido\ny no expirado?}
    G -->|Sí| H[Poblar locals.user\nlocals.session\nlocals.tenantId]
    G -->|No| I[JOIN sessions + users\n+ memberships en D1]
    I --> J{¿Registro\nencontrado?}
    J -->|No| K[Clear cookies\n→ redirect /login]
    J -->|Sí| L[Poblar locals.*]
    L --> M[PUT en KV con TTL\n= min restante de expiresAt]
    H --> N[next]
    M --> N
```

**TTL del KV:** se calcula como `max(60s, segundos restantes hasta expiresAt)` para no cachear sesiones casi vencidas más de lo necesario.

## Rutas públicas vs. protegidas

El middleware define dos listas estáticas que se evalúan **antes** de buscar la sesión:

```ts
// src/middleware.ts
const PUBLIC_PATH_PREFIXES = ['/login', '/api/auth', '/favicon', '/_astro'];
const PUBLIC_PATHS = new Set(['/']);
```

Cualquier ruta que no coincida con estas listas requiere sesión válida. Si no la hay, el middleware redirige a `/login`.

## Cookies reconocidas

El middleware busca el token de sesión en estas cookies (en orden):

| Cookie | Propósito |
|--------|-----------|
| `session` | Cookie principal de sesión propia |
| `session_token` | Alias alternativo |
| `authjs.session-token` | Compatibilidad con Auth.js |

La primera cookie con valor no vacío gana.

## Variables de entorno relevantes

| Variable | Tipo | Uso |
|----------|------|-----|
| `GOOGLE_CLIENT_ID` | var pública | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | **secret** | OAuth client secret (no en wrangler.toml) |
| `TURNSTILE_SECRET_KEY` | **secret** | Verificación server-side de Turnstile |
