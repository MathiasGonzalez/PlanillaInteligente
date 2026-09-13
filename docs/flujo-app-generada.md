# Flujo de generación y enriquecimiento de la app

Este diagrama resume cómo una planilla se transforma en la base de una aplicación multi-tenant dentro de PlanillaInteligente.

```mermaid
flowchart TD
    A[Usuario autenticado en un tenant] --> B[POST /api/upload]
    B --> C[Validar Turnstile]
    C -->|OK| D[Guardar .xlsx en R2]
    C -->|Error| Z1[Responder 400]
    D --> E[Crear registro en spreadsheets]
    E --> F[parseWorkbookIntoDatabase]
    F --> G[Leer primera hoja y headers]
    G --> H[Guardar columnas en spreadsheet_columns]
    H --> I[Guardar filas JSON en row_entries]
    I --> J[Actualizar sheetName en spreadsheets]
    J --> K[scheduleSpreadsheetEnrichment]
    K -->|Queue disponible| L[Enviar mensaje a ENRICHMENT_QUEUE]
    K -->|Sin Queue o falla| M[runSpreadsheetEnrichment inline]
    L --> N[src/queue.ts consume mensaje]
    N --> O[runSpreadsheetEnrichment]
    M --> P[Construir configuración heurística]
    O --> P
    P --> Q{Workers AI disponible}
    Q -->|Sí| R[Inferencia con Workers AI]
    Q -->|No| S[Usar heurística como fallback]
    R -->|Éxito| T[Normalizar sugerencias IA]
    R -->|Falla| S
    T --> U[Guardar config en spreadsheet_enrichments]
    S --> U
    U --> V[UI futura lee metadata enriquecida]
    V --> W[Generar tabla/formulario/kanban/dashboard]
    I --> X[GET /api/export]
    X --> Y[Reconstruir workbook desde D1 + R2]
    Y --> Z[Descargar .xlsx actualizado]
```

## Resultado

- `spreadsheet_columns` define la estructura dinámica.
- `row_entries` almacena los datos operativos del tenant.
- `spreadsheet_enrichments` guarda metadata de UI y sugerencias IA para mejorar la app generada.
