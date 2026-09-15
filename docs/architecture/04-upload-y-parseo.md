# 04 — Upload y parseo de planillas

El endpoint `POST /api/upload` es el punto de entrada principal de datos. Recibe un archivo `.xlsx`, lo valida, lo persiste en R2 y lo parsea a D1, todo dentro de una transacción lógica con rollback atómico en caso de fallo.

## Flujo completo

```mermaid
flowchart TD
    A[Cliente envía\nformData: file + turnstileToken] --> B[POST /api/upload]
    B --> C{¿Usuario\nautenticado?}
    C -->|No| Z1[401 Unauthorized]
    C -->|Sí| D[Verificar token Turnstile\ncon secretKey + remoteIp]
    D -->|Falla| Z2[400 Turnstile failed]
    D -->|OK| E{¿Es .xlsx\ny no vacío?}
    E -->|No| Z3[400 Bad request]
    E -->|Sí| F[Calcular SHA-256\ndel ArrayBuffer]
    F --> G[Generar spreadsheetId\nr2Key = tenantId/spreadsheets/id.xlsx]
    G --> H[PUT en R2\narrayBuffer + contentType]
    H --> I[INSERT spreadsheets en D1\nid, tenantId, userId, name, r2Key, checksum...]
    I --> J[parseWorkbookIntoDatabase\nleer primera hoja con xlsx-js-style]
    J --> K[INSERT spreadsheet_columns\npor cada header detectado]
    K --> L[INSERT row_entries\ncomo JSON por cada fila]
    L --> M[UPDATE spreadsheets.sheetName]
    M --> N[scheduleSpreadsheetEnrichment\nver doc 05]
    N --> O[201 Created\n+ resumen + enrichment status]

    H -->|Error| ERR[Rollback atómico]
    I -->|Error| ERR
    J -->|Error| ERR
    ERR --> ER1[DELETE R2 key]
    ERR --> ER2[DELETE row_entries del tenant]
    ERR --> ER3[DELETE spreadsheet_columns del tenant]
    ERR --> ER4[DELETE spreadsheet_enrichments del tenant]
    ERR --> ER5[DELETE spreadsheets del tenant]
    ER1 & ER2 & ER3 & ER4 & ER5 --> Z4[500 Import failed]
```

## Parseo del workbook (`parseWorkbookIntoDatabase`)

`src/lib/excel-parser.ts` lee el workbook con `xlsx-js-style`:

1. **Primera hoja**: solo se procesa la primera hoja del libro (`workbook.SheetNames[0]`).
2. **Headers**: la primera fila se trata como nombres de columnas. Se genera un `key` normalizado (snake_case) y un `label` legible.
3. **Tipo de dato inferido**: se detecta si la columna es `number`, `boolean`, `date` o `string` inspeccionando los valores de la columna.
4. **Row entries**: cada fila se serializa como un objeto JSON `{ key: value }` y se inserta en `row_entries.data`.

```mermaid
flowchart LR
    WB[Workbook .xlsx] --> SH[Primera hoja]
    SH --> HDR[Fila 1 = headers]
    SH --> ROWS[Filas 2..N = datos]
    HDR --> COL["spreadsheet_columns\n(key, label, dataType, columnIndex, required)"]
    ROWS --> RE["row_entries\n(row_index, data: JSON)"]
```

## Rollback atómico

D1 no soporta transacciones distribuidas con R2, por eso el rollback es **best-effort paralelo**: si el import falla en cualquier punto, se lanzan `Promise.all` con todas las operaciones de limpieza. Los fallos de limpieza se ignoran silenciosamente para que el endpoint siempre devuelva el error original.

## Validaciones aplicadas

| Validación | Criterio | Error |
|-----------|---------|-------|
| Autenticación | `locals.user && locals.tenantId` | 401 |
| Turnstile | `verification.success === true` | 400 |
| Extensión | `.xlsx` al final del nombre | 400 |
| Contenido vacío | `arrayBuffer.byteLength > 0` | 400 |
| Tipo MIME | Aceptado o fallback a `application/vnd.openxmlformats-...` | — |

## Respuesta 201

```json
{
  "spreadsheetId": "uuid",
  "tenantId": "uuid",
  "r2Key": "tenantId/spreadsheets/uuid.xlsx",
  "sheetName": "Hoja1",
  "columnsCount": 8,
  "rowsCount": 142,
  "enrichment": {
    "status": "completed",
    "mode": "inline",
    "generatedBy": "ai",
    "model": "@cf/meta/llama-3.1-8b-instruct",
    "fallbackUsed": false,
    "errorMessage": null
  }
}
```
