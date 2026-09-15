# 04 — Upload y parseo de planillas

El endpoint `POST /api/upload` es el punto de entrada principal de datos. Recibe un archivo `.xlsx`, lo valida, lo persiste en R2 y lo parsea a D1, todo dentro de una transacción lógica con limpieza best-effort en caso de fallo.

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
    I --> J[parseWorkbookIntoDatabase\nleer primera hoja con xlsx-populate]
    J --> K[INSERT spreadsheet_columns\npor cada header detectado]
    K --> L[INSERT row_entries\ncomo JSON por cada fila]
    L --> M[UPDATE spreadsheets.sheetName]
    M --> N[scheduleSpreadsheetEnrichment\nver doc 05]
    N --> O[201 Created\n+ resumen + enrichment status]

    H -->|Error| ERR[Limpieza best-effort]
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

`src/spreadsheets/parsing/parse-workbook.ts` lee el workbook con `xlsx-populate`:

1. **Primera hoja**: solo se procesa la primera hoja del libro (`workbook.sheet(0)`).
2. **Headers**: la primera fila se trata como nombres de columnas. Se genera un `key` normalizado (snake_case) y un `label` legible.
3. **Tipo de dato inferido**: se detecta si la columna es `number`, `boolean`, `date` o `string` inspeccionando los valores de la columna.
4. **Matriz de celdas**: los valores se obtienen desde `worksheet.usedRange()?.value()` y luego se normalizan a una matriz procesable.
5. **Row entries**: cada fila se serializa como un objeto JSON `{ key: value }` y se inserta en `row_entries.data`.

```mermaid
flowchart LR
    WB[Workbook .xlsx] --> SH[Primera hoja]
    SH --> HDR[Fila 1 = headers]
    SH --> ROWS[Filas 2..N = datos]
    HDR --> COL["spreadsheet_columns\n(key, label, dataType, columnIndex, required)"]
    ROWS --> RE["row_entries\n(row_index, data: JSON)"]
```

## Limpieza best-effort (rollback)

D1 no soporta transacciones distribuidas con R2, por eso no existe un rollback atómico real entre ambos sistemas. Si el import falla en cualquier punto, el endpoint ejecuta una **limpieza best-effort en paralelo** mediante `Promise.all(...)` para intentar borrar el objeto en R2 y los registros ya insertados en D1. Los fallos de limpieza se ignoran silenciosamente para que el endpoint siempre devuelva el error original, por lo que la reversión no está garantizada.

## Validaciones aplicadas

| Validación | Criterio | Error |
|-----------|---------|-------|
| Autenticación | `locals.user && locals.tenantId` | 401 |
| Turnstile | `verification.success === true` | 400 |
| Extensión | `.xlsx` al final del nombre | 400 |
| Contenido vacío | `arrayBuffer.byteLength > 0` | 400 |
| Tipo MIME | Aceptado o fallback a `application/vnd.openxmlformats-...` | — |

## Respuesta 201

Ejemplo común cuando el enriquecimiento queda **en cola**:

```json
{
  "spreadsheetId": "uuid",
  "tenantId": "uuid",
  "r2Key": "tenantId/spreadsheets/uuid.xlsx",
  "sheetName": "Hoja1",
  "columnsCount": 8,
  "rowsCount": 142,
  "enrichment": {
    "status": "pending",
    "mode": "queue",
    "generatedBy": null,
    "model": null,
    "fallbackUsed": false,
    "errorMessage": null
  }
}
```

Si el enriquecimiento se resuelve inline, la respuesta puede llegar como `status: "completed"` y `mode: "inline"`, con `generatedBy: "workers-ai"` cuando usa Workers AI o `generatedBy: "heuristic"` junto con `fallbackUsed: true` cuando entra en fallback heurístico.
