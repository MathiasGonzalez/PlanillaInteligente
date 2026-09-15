# 07 — Modelo de datos

Todas las tablas viven en D1 (SQLite gestionado por Cloudflare). El esquema está definido en `src/db/schema.ts` con Drizzle ORM y las migraciones se generan con `npm run db:generate`.

## Diagrama ER completo

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ USERS : "defaultOrganizationId"
    ORGANIZATIONS ||--o{ MEMBERSHIPS : contains
    USERS ||--o{ MEMBERSHIPS : joins
    USERS ||--o{ ACCOUNTS : authenticates_with
    USERS ||--o{ SESSIONS : owns
    ORGANIZATIONS ||--o{ SESSIONS : active_in
    ORGANIZATIONS ||--o{ SPREADSHEETS : owns
    USERS ||--o{ SPREADSHEETS : uploads
    SPREADSHEETS ||--o{ SPREADSHEET_COLUMNS : defines
    SPREADSHEETS ||--o{ ROW_ENTRIES : contains
    SPREADSHEETS ||--|| SPREADSHEET_ENRICHMENTS : enriches

    ORGANIZATIONS {
      text id PK
      text name
      text slug "único"
      text owner_user_id FK
      timestamp created_at
      timestamp updated_at
    }

    USERS {
      text id PK
      text email "único"
      text name
      text image
      timestamp email_verified_at
      text default_organization_id FK
      timestamp created_at
      timestamp updated_at
    }

    ACCOUNTS {
      text id PK
      text user_id FK
      text tenant_id FK
      text provider "google"
      text provider_account_id
      text access_token
      text refresh_token
      integer expires_at
      timestamp created_at
      timestamp updated_at
    }

    MEMBERSHIPS {
      text id PK
      text organization_id FK
      text user_id FK
      text role "owner|admin|member"
      timestamp created_at
      timestamp updated_at
    }

    SESSIONS {
      text id PK
      text user_id FK
      text active_organization_id FK
      text session_token "único"
      integer expires_at
      timestamp created_at
      timestamp updated_at
    }

    SPREADSHEETS {
      text id PK
      text tenant_id FK
      text uploaded_by_user_id FK
      text name
      text original_filename
      text r2_key "ruta en R2 bucket"
      text source_type "excel"
      text sheet_name "nombre de la hoja parseada"
      text checksum "SHA-256 del archivo"
      timestamp created_at
      timestamp updated_at
    }

    SPREADSHEET_COLUMNS {
      text id PK
      text tenant_id FK
      text spreadsheet_id FK
      text key "nombre normalizado"
      text label "nombre original del header"
      text data_type "string|number|boolean|date|json"
      integer column_index
      boolean required
      timestamp created_at
      timestamp updated_at
    }

    ROW_ENTRIES {
      text id PK
      text tenant_id FK
      text spreadsheet_id FK
      integer row_index
      json data "objeto {key: value} por fila"
      timestamp created_at
      timestamp updated_at
    }

    SPREADSHEET_ENRICHMENTS {
      text id PK
      text tenant_id FK
      text spreadsheet_id FK
      text status "pending|processing|completed|failed"
      text provider "workers-ai|heuristic"
      text model "nombre del modelo IA"
      json config "SpreadsheetEnrichmentConfiguration"
      text error_message
      text last_triggered_by "upload|manual"
      timestamp last_enqueued_at
      timestamp last_processed_at
      timestamp created_at
      timestamp updated_at
    }
```

## Ideas clave

### Aislamiento multi-tenant
Todas las tablas operativas (`SPREADSHEETS`, `SPREADSHEET_COLUMNS`, `ROW_ENTRIES`, `SPREADSHEET_ENRICHMENTS`) incluyen `tenant_id`. Todas las queries del código incluyen este campo como filtro obligatorio.

### Esquema dinámico
El esquema de cada planilla vive en `SPREADSHEET_COLUMNS`, no en columnas fijas de la DB. Esto permite importar cualquier planilla sin migraciones adicionales.

### Datos flexibles
Las filas se almacenan en `ROW_ENTRIES.data` como JSON `{ key: value }`. Las claves corresponden a los `key` de `SPREADSHEET_COLUMNS`, lo que permite reconstruir la tabla original en cualquier momento.

### Separación de metadata de UI
`SPREADSHEET_ENRICHMENTS.config` guarda las sugerencias de IA (tipos semánticos, vista recomendada, título) sin mezclarlas con los datos operativos de `ROW_ENTRIES`. Esto permite re-enriquecer sin tocar los datos.

### Estructura de `config` (SpreadsheetEnrichmentConfiguration)
```ts
{
  title: string
  summary: string
  viewType: 'table' | 'kanban' | 'dashboard' | 'calendar' | 'gallery'
  columns: Array<{
    key: string
    semanticType: 'email' | 'amount' | 'status' | 'date' | 'category' |
                  'assignee' | 'phone' | 'url' | 'identifier' | 'name' |
                  'long-text' | 'generic'
    displayAs?: string
    isPrimary?: boolean
    isGroupBy?: boolean
  }>
}
```

## Migraciones

```bash
npm run db:generate   # genera SQL en migrations/ a partir de src/db/schema.ts
npm run db:migrate    # aplica las migraciones en producción (--remote)
```

Las migraciones se aplican como **primer paso** en el pipeline de CI antes de desplegar código nuevo. Ver [01-despliegue-cloudflare.md](./01-despliegue-cloudflare.md).
