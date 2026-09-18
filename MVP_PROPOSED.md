# Definición del producto
 
Una plataforma AI-native que transforma planillas Excel utilizadas por pequeñas empresas y profesionales en aplicaciones web estructuradas, multiusuario y listas para operar.
 
El usuario sube un archivo `.xlsx` que ya utiliza en su negocio. La plataforma analiza automáticamente su estructura, identifica entidades, relaciones, campos, reglas implícitas y posibles procesos de negocio, y genera una aplicación web adaptada a esa información.
 
La propuesta central es simple:
 
**Subí tu Excel. Obtené tu app.**
 
El objetivo no es reemplazar Excel como herramienta de cálculo general, sino transformar aquellas planillas que ya funcionan como un sistema informal de gestión en aplicaciones más robustas, seguras y fáciles de usar.
 
Ejemplos:
 
- una planilla de clientes y cobranzas → CRM + gestión de pagos;
- una planilla de stock → sistema de inventario;
- una planilla de presupuestos → cotizador web;
- una planilla de proyectos → gestor de trabajos, horas y costos;
- una planilla inmobiliaria → gestión de propiedades, clientes y contratos.
 
---
 
# Problema
 
Miles de pequeñas empresas y profesionales utilizan Excel o Google Sheets como sistema operativo de facto para procesos críticos:
 
- clientes;
- ventas;
- stock;
- cobranzas;
- presupuestos;
- proveedores;
- proyectos;
- horas;
- gastos;
- reportes.
 
Estas planillas suelen crecer con el negocio y comienzan a presentar problemas:
 
- múltiples versiones del mismo archivo;
- errores manuales;
- fórmulas rotas;
- poca trazabilidad;
- dificultad para trabajar entre varias personas;
- ausencia de permisos;
- dificultad para consultar información;
- falta de dashboards;
- procesos dependientes de una persona;
- información duplicada;
- dificultad para automatizar.
 
El salto hacia un ERP tradicional suele ser demasiado grande en precio, complejidad o esfuerzo de implementación.
 
El producto ocupa el espacio intermedio:
 
**Excel → aplicación operativa simple → sistema de gestión más estructurado**
 
---
 
# Propuesta de valor
 
La plataforma utiliza la planilla existente como punto de partida.
 
El usuario no necesita:
 
- diseñar una base de datos;
- definir tablas;
- crear formularios;
- programar;
- configurar dashboards;
- entender APIs;
- escribir SQL.
 
La propia planilla funciona como una especificación inicial del negocio.
 
La plataforma convierte esa estructura informal en:
 
- entidades;
- relaciones;
- formularios;
- tablas;
- filtros;
- búsquedas;
- dashboards;
- KPIs;
- acciones;
- permisos;
- reglas básicas de negocio.
 
---
 
# Flujo de usuario
 
## 1. Subir
 
El usuario carga la planilla que utiliza actualmente.
 
Ejemplo:
 
`Gestion_Comercial.xlsx`
 
con hojas:
 
- Clientes
- Presupuestos
- Ventas
- Pagos
 
---
 
## 2. Analizar
 
La plataforma detecta automáticamente:
 
- hojas;
- encabezados;
- tipos de datos;
- fechas;
- monedas;
- identificadores;
- referencias;
- relaciones;
- fórmulas;
- valores repetidos;
- posibles entidades.
 
La IA interpreta además la intención del archivo.
 
Por ejemplo:
 
> Esta planilla parece utilizarse para administrar clientes, presupuestos, ventas y cobranzas.
 
---
 
## 3. Proponer
 
La plataforma genera un modelo preliminar:
 
**Clientes**
 
- nombre
- documento
- teléfono
- email
 
**Ventas**
 
- cliente
- fecha
- importe
- estado
 
**Pagos**
 
- venta
- fecha
- importe
- medio de pago
 
Y propone pantallas:
 
- Dashboard
- Clientes
- Ventas
- Pagos
- Reportes
 
---
 
## 4. Previsualizar
 
Antes de crear la aplicación, el usuario puede revisar:
 
- campos detectados;
- relaciones;
- pantallas;
- métricas;
- nombres.
 
Puede corregir errores mediante interfaz o lenguaje natural.
 
Ejemplo:
 
> “La columna Empresa corresponde al cliente.”
 
o:
 
> “No quiero mostrar la columna Observaciones en el listado.”
 
---
 
## 5. Generar
 
La plataforma genera automáticamente la aplicación.
 
Ejemplo:
 
**Dashboard**
 
- ventas del mes;
- pagos pendientes;
- clientes activos;
- facturas vencidas.
 
**Clientes**
 
- listado;
- búsqueda;
- alta;
- edición;
- detalle.
 
**Ventas**
 
- filtros;
- estados;
- cliente asociado;
- importe;
- vencimiento.
 
---
 
## 6. Operar
 
A partir de ese momento, el usuario puede utilizar la aplicación como sistema operativo diario.
 
Los datos dejan de depender directamente de una planilla compartida.
 
La aplicación incorpora:
 
- usuarios;
- roles;
- permisos;
- historial;
- filtros;
- búsquedas;
- validaciones;
- dashboards.
 
---
 
## 7. Evolucionar con IA
 
El usuario puede modificar la aplicación escribiendo instrucciones simples.
 
Ejemplos:
 
> “Agregá un campo de vendedor.”
 
> “Mostrame clientes con deuda mayor a 30 días.”
 
> “Creá un dashboard de ventas por vendedor.”
 
> “Agregá estado Pendiente, Pagado y Vencido.”
 
> “Quiero registrar pagos parciales.”
 
La IA modifica el modelo declarativo de la aplicación, no genera código arbitrario.
 
---
 
# Flujo técnico resumido
 
A bajo nivel:
 
```text
XLSX
↓
Upload
↓
Parseo determinístico
↓
Análisis de estructura
↓
Inferencia semántica con IA
↓
Modelo de dominio
↓
AppSpec
↓
Validación
↓
Creación de esquema de datos
↓
Importación
↓
Renderizado dinámico de UI
↓
Aplicación publicada
```
 
Separación conceptual:
 
```text
Excel
  ↓
Semantic Model
  ↓
AppSpec
  ↓
Runtime
  ↓
Web App
```
 
## Semantic Model
 
Representa el negocio.
 
Ejemplo:
 
```text
Customer
Invoice
Payment
Project
Product
```
 
## AppSpec
 
Describe cómo debe verse y comportarse la aplicación.
 
Ejemplo:
 
```text
Views
Forms
Tables
Filters
KPIs
Charts
Actions
Permissions
```
 
## Runtime
 
Interpreta el AppSpec y renderiza componentes preconstruidos.
 
Ejemplo:
 
```text
<Table>
<Form>
<Detail>
<Dashboard>
<KPI>
<Chart>
<Kanban>
<Calendar>
```
 
La IA define **qué** debe existir.
 
El runtime define **cómo** funciona.
 
---
 
# Principio central de arquitectura
 
La IA no debería generar aplicaciones mediante código libre.
 
En lugar de generar React, JavaScript o SQL directamente, genera una definición estructurada y validable.
 
Ejemplo conceptual:
 
```json
{
  "entity": "Invoice",
  "fields": [
    "customer",
    "amount",
    "dueDate",
    "status"
  ],
  "views": [
    "list",
    "detail",
    "form"
  ]
}
```
 
Esto permite que la plataforma sea:
 
- más segura;
- más predecible;
- más fácil de mantener;
- más fácil de versionar;
- más fácil de validar;
- menos dependiente del modelo de IA.
 
---
 
# Funcionalidades fuertes
 
## Importación inteligente de Excel
 
Subí la planilla que ya usás.
 
La plataforma reconoce automáticamente hojas, columnas, datos y relaciones.
 
---
 
## App automática en minutos
 
Transforma la estructura de la planilla en una aplicación web usable sin programación.
 
---
 
## Formularios automáticos
 
Cada tabla relevante puede convertirse en formularios de alta y edición.
 
---
 
## Relaciones automáticas
 
La plataforma puede detectar relaciones como:
 
- cliente → venta;
- factura → pago;
- producto → proveedor;
- proyecto → cliente.
 
---
 
## Dashboard automático
 
La aplicación propone indicadores relevantes según los datos encontrados.
 
Ejemplo:
 
- ventas;
- deuda pendiente;
- stock;
- clientes activos;
- gastos;
- rentabilidad.
 
---
 
## Búsqueda y filtros
 
Información que antes requería buscar manualmente dentro de Excel pasa a estar disponible mediante:
 
- búsqueda;
- filtros;
- vistas guardadas;
- ordenamiento.
 
---
 
## Multiusuario
 
Varias personas pueden trabajar sobre el mismo sistema sin enviarse diferentes versiones del archivo.
 
---
 
## Roles y permisos
 
Definir qué puede hacer cada usuario.
 
Ejemplo:
 
- administrador;
- vendedor;
- operador;
- contador;
- solo lectura.
 
---
 
## Historial de cambios
 
Registrar quién modificó qué información y cuándo.
 
---
 
## IA integrada
 
Modificar la aplicación mediante lenguaje natural.
 
Ejemplos:
 
- “agregá una columna”;
- “creá un nuevo estado”;
- “mostrame ventas por mes”;
- “creá una vista para facturas vencidas”.
 
---
 
## Exportar a Excel
 
El usuario nunca queda encerrado dentro de la plataforma.
 
Puede volver a descargar sus datos.
 
---
 
## Mantener Excel como puerta de entrada
 
La adopción no exige abandonar el flujo existente desde el primer día.
 
Excel puede seguir funcionando como:
 
- mecanismo de importación;
- formato de exportación;
- respaldo;
- intercambio con terceros.
 
---
 
# Mensajes fuertes para landing
 
## Hero
 
**Tu Excel ya contiene tu aplicación.**
 
Subí la planilla con la que gestionás tu negocio y convertíla automáticamente en una aplicación web.
 
**Sin programar. Sin configurar bases de datos. Sin empezar desde cero.**
 
CTA:
 
**Crear mi app**
 
---
 
# Alternativa de hero
 
**De Excel a una aplicación real.**
 
Transformá tus planillas de clientes, stock, cobranzas, presupuestos o proyectos en aplicaciones web listas para usar.
 
---
 
# Beneficios para landing
 
### Usá lo que ya tenés
 
No empieces desde cero.
 
Tu planilla ya contiene los datos y gran parte de la lógica de tu negocio.
 
### Sin programación
 
No necesitás saber de bases de datos, APIs ni desarrollo web.
 
### Una única fuente de verdad
 
Dejá atrás archivos como:
 
`clientes-final.xlsx`
 
`clientes-final-2.xlsx`
 
`clientes-final-ahora-si.xlsx`
 
### Trabajo en equipo
 
Todos trabajan sobre la misma información.
 
### Más control
 
Roles, permisos, historial y validaciones.
 
### Información instantánea
 
Convertí datos dispersos en dashboards, indicadores y vistas.
 
### Adaptable
 
Pedile a la IA nuevos campos, vistas o reportes.
 
### Tus datos siguen siendo tuyos
 
Importá y exportá cuando quieras.
 
---
 
# Casos de uso destacados
 
## Clientes y cobranzas
 
De:
 
```text
clientes.xlsx
facturas.xlsx
pagos.xlsx
```
 
A:
 
```text
CRM
+
Cobranzas
+
Dashboard
```
 
---
 
## Inventario
 
De:
 
```text
productos.xlsx
stock.xlsx
proveedores.xlsx
```
 
A:
 
```text
Inventario
+
Movimientos
+
Alertas
```
 
---
 
## Presupuestos
 
De:
 
```text
clientes.xlsx
presupuestos.xlsx
items.xlsx
```
 
A:
 
```text
Cotizador
+
Seguimiento
+
Conversión a venta
```
 
---
 
## Profesionales
 
De:
 
```text
clientes.xlsx
proyectos.xlsx
horas.xlsx
gastos.xlsx
```
 
A:
 
```text
Clientes
+
Proyectos
+
Horas
+
Rentabilidad
```
 
---
 
# Usuario objetivo inicial
 
El producto debería enfocarse primero en:
 
- profesionales independientes;
- estudios pequeños;
- consultoras;
- comercios;
- inmobiliarias;
- empresas de servicios;
- pequeñas constructoras;
- agencias;
- empresas con menos de 20-50 empleados.
 
Especialmente empresas donde Excel ya se haya convertido en una pieza crítica de operación.
 
---
 
# Qué NO intenta ser
 
No es:
 
- un reemplazo completo de Excel;
- un ERP universal;
- un generador libre de código;
- un IDE no-code;
- un editor de spreadsheets;
- un sistema para reproducir cualquier macro VBA.
 
El producto transforma **planillas operativas** en **aplicaciones operativas**.
 
---
 
# Diferencial
 
La mayoría de las herramientas no-code comienzan con:
 
> “Creá una aplicación.”
 
Este producto comienza con:
 
> “Mostrame cómo trabajás hoy.”
 
Y el usuario simplemente sube su Excel.
 
La plataforma utiliza ese archivo como especificación inicial.
 
Ese cambio reduce enormemente la fricción de onboarding.
 
---
 
# Posicionamiento conceptual
 
La categoría podría definirse como:
 
**Spreadsheet-to-App AI**
 
o:
 
**AI Business App Generator**
 
o más específicamente:
 
**AI Operational App Builder for SMEs**
 
La idea central:
 
> La planilla no es solamente una fuente de datos.
 
> Es una representación parcial del modelo de negocio.
 
La plataforma interpreta ese modelo y lo convierte en software.
 
---
 
# Taglines posibles
 
**Tu Excel. Ahora es una app.**
 
**Subí una planilla. Creá tu sistema.**
 
**De planilla a aplicación.**
 
**Convertí cómo trabajás hoy en el software que necesitás mañana.**
 
**El sistema que tu Excel estaba tratando de ser.**
 
**Tus datos. Tu proceso. Tu app.**
 
---
 
# Visión
 
En una primera etapa:
 
```text
Excel
→ CRUD
→ dashboard
```
 
Luego:
 
```text
Excel
→ modelo de negocio
→ workflows
→ automatizaciones
→ IA
```
 
Y finalmente:
 
```text
datos
+
procesos
+
documentos
+
automatizaciones
+
agentes IA
```
 
La evolución natural del producto es pasar de:
 
**“convertir Excel en una app”**
 
a:
 
**“convertir procesos manuales de una pyme en software operativo generado dinámicamente”.**
 
Ese segundo concepto puede convertirse en la visión de largo plazo del producto.