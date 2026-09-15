> ⚠️ **DEPRECADO** — Este documento ya no se mantiene.
> Ver el reemplazo en `docs/architecture/`:
> - [07-modelo-datos.md](./architecture/07-modelo-datos.md) — diagrama ER completo y actualizado

---

# Modelo de datos multi-tenant

Este diagrama muestra las entidades principales persistidas en D1 y sus relaciones para autenticación, tenancy, planillas y enriquecimiento IA.

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ USERS : "default organization"
    ORGANIZATIONS ||--o{ MEMBERSHIPS : contains
    USERS ||--o{ MEMBERSHIPS : joins
    USERS ||--o{ ACCOUNTS : authenticates_with
    USERS ||--o{ SESSIONS : owns
    ORGANIZATIONS ||--o{ ACCOUNTS : scopes
    ORGANIZATIONS ||--o{ SESSIONS : active_in
    ORGANIZATIONS ||--o{ SPREADSHEETS : owns
    USERS ||--o{ SPREADSHEETS : uploads
    SPREADSHEETS ||--o{ SPREADSHEET_COLUMNS : defines
    SPREADSHEETS ||--o{ ROW_ENTRIES : contains
    SPREADSHEETS ||--|| SPREADSHEET_ENRICHMENTS : enriches
    ORGANIZATIONS ||--o{ SPREADSHEET_COLUMNS : scopes
    ORGANIZATIONS ||--o{ ROW_ENTRIES : scopes
    ORGANIZATIONS ||--o{ SPREADSHEET_ENRICHMENTS : scopes

    ORGANIZATIONS {
      text id PK
      text name
      text slug
      text owner_user_id
      timestamp created_at
      timestamp updated_at
    }

    USERS {
      text id PK
      text email
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
      text provider
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
      text role
      timestamp created_at
      timestamp updated_at
    }

    SESSIONS {
      text id PK
      text user_id FK
      text active_organization_id FK
      text session_token
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
      text r2_key
      text source_type
      text sheet_name
      text checksum
      timestamp created_at
      timestamp updated_at
    }

    SPREADSHEET_COLUMNS {
      text id PK
      text tenant_id FK
      text spreadsheet_id FK
      text key
      text label
      text data_type
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
      json data
      timestamp created_at
      timestamp updated_at
    }

    SPREADSHEET_ENRICHMENTS {
      text id PK
      text tenant_id FK
      text spreadsheet_id FK
      text status
      text provider
      text model
      json config
      text error_message
      text last_triggered_by
      timestamp last_enqueued_at
      timestamp last_processed_at
      timestamp created_at
      timestamp updated_at
    }
```

## Ideas clave

- Todas las tablas operativas relevantes usan `tenant_id` para aislar organizaciones.
- El esquema dinámico vive en `spreadsheet_columns`.
- Las filas flexibles viven en `row_entries.data` como JSON.
- La capa de IA persiste sugerencias y estado en `spreadsheet_enrichments` sin mezclar UI metadata con datos operativos.
