# DATA_SECURITY.md — PlanillaInteligente

Ley 18.331, Ley 19.670 arts. 37-40 y Decreto 64/020. Los IDs (`ARQ-*`, `INF-*`, `APP-*`, `IA-*`, `DER-*`, `TIF-*`, `ORG-*`, `INC-*`) son estables.

Cloudflare es encargado. PlanillaInteligente es responsable ante la URCDP. La ley aplica desde el primer cliente en Uruguay (Decreto 64/020 art. 1).

| Rol | Datos |
|---|---|
| Responsable | Cuenta y sesión: `users`, `accounts`, `sessions`, `memberships`, `organizations`, `invitations` |
| Encargado | Planillas de terceros: `records.data`, `.xlsx` en R2, `record_changes`, instrucciones de evolución |

**N3** credenciales y art. 17. **N2** email, nombre, celdas, nombres de archivo, texto de una instrucción. **N1** hashes de login, ids, rol. **N0** landing. `records.data` es N2 y pasa a N3 si la hoja trae datos del art. 17.

D1 y R2 van con jurisdicción `eu` (Res. URCDP 23/021). Se fija al crear el recurso y todavía no hay deploy: el primer `up` con state viejo hace replace de D1 y R2. KV, Queues y Workers AI no tienen jurisdicción.

## En el código

- KV de sesión: `userId`, `tenantId`, `role`, `sessionId`, `expiresAt`. Sin PII.
- Cola: `{ kind, tenantId, appId, refId, requestedByUserId }`. La DLQ loguea `tenantId` y `appId`.
- R2: `{tenantId}/workbooks/{id}.xlsx`. El consumer de análisis tiene D1, R2 y AI. No tiene KV.
- Queries operativas con `eq(table.tenantId, locals.tenantId)`.
- Tokens OAuth cifrados (`TOKEN_ENCRYPTION_KEY`). El login por email guarda HMAC del email y del código (`AUTH_HMAC_KEY`), nunca el código en claro.
- IA: metadata y ejemplos sintéticos. Celdas reales solo con `sampleConsentAt`. `sensitive` y `specialCategory` no se envían ni con opt-in. `collectLog: false`. La instrucción de evolución es N2 y no lleva valores de celdas.
- Upload: aviso del art. 17, ZIP/OOXML, 10 MB, 200 columnas, 10.000 filas, hasta 10 hojas.
- Errores de API genéricos con id de correlación. El upload sí devuelve el error de validación del archivo.
- Borrar app (owner), erase inmediato y baja a 30 días (`deactivatedAt` + cron).
- Cabeceras CSP/HSTS. Cookies `httpOnly`, `sameSite: lax`, `secure` fuera de localhost. Sesión 7 días.

| Dato | Plazo |
|---|---|
| Sesión y KV | 7 días |
| Cookies OAuth y código de email | 10 minutos |
| `email_login_challenges` | 24 horas |
| Invitación no aceptada | 7 días |
| `record_changes` | 180 días |
| Propuesta no aplicada | 30 días |
| Planilla | Mientras el cliente la conserve |
| Cuenta activa / dada de baja | El contrato / 30 días |
| Logs de Workers | 3 días (Free) o 7 (Paid) |
| Registro de incidentes | 5 años, fuera del producto |

Email Service, si está prendido, recibe el email y el código. Es el mismo encargado. Sin plan Paid el binding no se despliega y el login muestra el error.

## Pendiente para ofrecer el servicio

Prioridad 1, no es código: contrato de encargado (ORG-1 a 3), DPA de Cloudflare (TIF-2), inscripción URCDP (ORG-4), política y términos con el art. 13 (ORG-7, TIF-4), y apagar los logs del AI Gateway en el dashboard (IA-3). El aviso del art. 17 en el upload ya está. Los términos que lo prohíban no.

Prioridad 2: Workers Logs de Pages, rate limit del export (APP-2), runbook de incidentes, EIPD, export de los datos de la cuenta.

Vulneración (Decreto 64/020 arts. 3 y 4): mitigar en 24 h, URCDP en 72 h, titulares si la afectación es significativa.

## Invariantes

- Jurisdicción `eu` en todo D1 o R2 nuevo.
- KV sin PII. Cola sin celdas. Logs sin PII.
- Celdas reales al modelo solo con opt-in. `sensitive` y `specialCategory` nunca.
- Tokens cifrados. Secretos fuera de `wrangler.jsonc`. `collectLog: false`.
- Store nuevo: clasificación y plazo antes del merge. Destino nuevo: adecuación URCDP y subencargado declarado.
- Borrado del titular: inmediato. Baja comercial: 30 días.
- Datos de producción no se copian a dev ni preview.
- Pages no tiene `observability`, `ratelimits` ni cron.

No hay residencia en Uruguay. Sin Enterprise, el descifrado de la request queda fuera de la UE. Un cliente que exija residencia uruguaya no entra en este stack.
