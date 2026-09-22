# Estado del MVP — 22 de septiembre de 2026

Un `.xlsx` de hasta 10 hojas se publica como app dentro del workspace: wizard, listas, ficha, formulario, kanban, resumen, equipo e instrucciones con diff. Login con Google o código por email. La IA devuelve JSON validado y no inventa columnas.

Precios de referencia: AppSheet Starter USD 5 y Core USD 10 por usuario al mes. GlideOS Basic 25, Plus desde 50, Pro desde 125. Softr Business USD 329 al mes en facturación anual.

## Hecho

Subir el libro (10 MB, 200 columnas por hoja, 10.000 filas), tipos y montos, candidatos de relación, wizard y publicación. Tabla con búsqueda, filtros y paginación. Ficha, alta, edición, borrado e historial. Kanban y dashboard. Invitación al mismo workspace. Owner y member. Export a Excel. Evolución por instrucciones (diff, aplicar, restaurar spec, revertir datos). Landing con «Crear mi app», equipo, resumen y qué no es (ERP, editor de planillas).

La app se usa con login, dentro del workspace. No hay URL pública ni dominio por app.

## Parcial

- La relación en el formulario se carga por id, no con un buscador.
- Las fórmulas se guardan como campo de solo lectura. No se evalúan.
- El correo del código de login solo sale si el worker de mail desplegó (plan Workers Paid y `emailSendingEnabled`). Si no, el login muestra el error y el deploy sigue.
- En local el análisis corre inline (`ANALYSIS_MODE=inline`). En prod va por la cola. El consumer lee el `.xlsx` en R2.

## Fuera

Foto, Google Sheets, CSV, reimportar encima, sync, URL pública, clientes externos, filas por persona, workflows y agentes.

## Para cobrar

Sigue fuera del código, prioridad 1 de `DATA_SECURITY.md`: contrato de encargado, DPA de Cloudflare, inscripción URCDP, política de privacidad y términos. El aviso del art. 17 ya está en el upload.
