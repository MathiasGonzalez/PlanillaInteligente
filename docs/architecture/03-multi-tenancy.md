# 03 — Multi-tenancy

PlanillaInteligente es multi-tenant: cada organización tiene sus propios datos completamente aislados. El aislamiento se logra mediante un `tenant_id` presente en todas las tablas operativas.

## Modelo de entidades

```mermaid
graph TD
    subgraph Auth ["Autenticación"]
        U[Users]
        A[Accounts\nGoogle OAuth]
        S[Sessions]
    end

    subgraph Tenancy ["Tenancy"]
        O[Organizations]
        M[Memberships\nowner · admin · member]
    end

    subgraph Data ["Datos operativos — aislados por tenant_id"]
        SP[Spreadsheets]
        SC[Spreadsheet Columns]
        RE[Row Entries]
        SE[Spreadsheet Enrichments]
    end

    U -->|"defaultOrganizationId"| O
    U -->|"1:N"| A
    U -->|"1:N"| S
    O -->|"1:N"| M
    U -->|"1:N"| M
    S -->|"activeOrganizationId"| O

    O -->|"tenant_id"| SP
    U -->|"uploadedByUserId"| SP
    SP -->|"1:N"| SC
    SP -->|"1:N"| RE
    SP -->|"1:1"| SE
```

## Ciclo de vida de un tenant

Cuando un usuario se autentica por primera vez, el sistema crea automáticamente:

```mermaid
sequenceDiagram
    participant Auth as /api/auth/callback
    participant D1 as D1 Database

    Auth->>D1: UPSERT users (email, name, image)
    Auth->>D1: UPSERT accounts (provider=google, tokens)
    Auth->>D1: INSERT organizations\n(name derivado del email, slug único)
    Auth->>D1: INSERT memberships (role=owner)
    Auth->>D1: UPDATE users.defaultOrganizationId
    Auth->>D1: INSERT sessions (activeOrganizationId = nueva org)
```

El usuario queda como `owner` de su propia organización y puede invitar a otros miembros.

## Aislamiento de datos

Cada tabla operativa tiene una columna `tenant_id` que referencia al `id` de la organización. **Todas** las queries del código de aplicación incluyen `eq(table.tenantId, locals.tenantId)` como condición obligatoria:

```ts
// Ejemplo de query aislada por tenant
await db
  .select()
  .from(spreadsheets)
  .where(and(
    eq(spreadsheets.tenantId, locals.tenantId),   // ← aislamiento
    eq(spreadsheets.id, spreadsheetId),
  ));
```

El `tenantId` fluye desde el middleware → `locals.tenantId` → todos los handlers de API.

## Roles

| Rol | Quién lo tiene | Acceso |
|-----|---------------|--------|
| `owner` | Creador de la organización | Acceso total |
| `admin` | Invitado con privilegios | Gestión de datos |
| `member` | Miembro básico | Solo lectura (por definir) |

El rol se lee en el middleware junto con la sesión y se expone en `locals.user.role`.

## Sesión activa vs. organización por defecto

Un usuario puede pertenecer a múltiples organizaciones. El middleware usa `sessions.activeOrganizationId` para determinar qué tenant está activo en cada request, no `users.defaultOrganizationId`. El campo `defaultOrganizationId` solo se usa como destino inicial al crear la primera sesión.
