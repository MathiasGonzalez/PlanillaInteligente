# Estado del MVP — 23 de septiembre de 2026

Un `.xlsx` de hasta 10 hojas se publica como app dentro del workspace: wizard, listas, ficha, formulario, kanban, resumen, equipo e instrucciones con diff. Login con Google o código por email. La IA devuelve JSON validado y no inventa columnas.

Precios de referencia: AppSheet Starter USD 5 y Core USD 10 por usuario al mes. GlideOS Basic 25, Plus desde 50, Pro desde 125. Softr Business USD 329 al mes en facturación anual.

## Hecho

Subir el libro (10 MB, 200 columnas por hoja, 10.000 filas), tipos y montos, candidatos de relación, wizard y publicación. Tabla con búsqueda, filtros y paginación. Ficha, alta, edición, borrado e historial. Kanban y dashboard. Invitación al mismo workspace. Owner y member. Export a Excel. Evolución por instrucciones (diff, aplicar, restaurar spec, revertir datos). Landing con «Crear mi app», equipo, resumen y qué no es (ERP, editor de planillas). El owner ve el consumo del workspace (IA, espacio y filas) y el cupo corta un archivo, una fila o una llamada de IA de más. La pantalla de plan existe; el cobro con Mercado Pago todavía no.

La app se usa con login, dentro del workspace. No hay URL pública ni dominio por app.

## Parcial

- Las fórmulas de Excel se guardan como campo de solo lectura. No se evalúan. Una instrucción `computeField` sí calcula al aplicar (`+`, `-`, `*`, `concat()`, `days()`).
- El código de login se envía a `send.cfemailer.com`. En local (`ANALYSIS_MODE=inline`) se imprime en la consola.
- En local el análisis corre inline (`ANALYSIS_MODE=inline`). En prod va por la cola. El consumer lee el `.xlsx` en R2. Aplicar una instrucción que toca más de 2000 filas también entra a la cola cuando `ANALYSIS_MODE=queue`; en local corre en el request.

## Fuera

Foto, Google Sheets, CSV, reimportar encima, sync, URL pública, clientes externos, filas por persona, workflows y agentes.

## Para cobrar

Sigue fuera del código, prioridad 1 de `DATA_SECURITY.md`: contrato de encargado, DPA de Cloudflare, inscripción URCDP, política de privacidad y términos. El aviso del art. 17 ya está en el upload.
