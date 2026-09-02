# CRM DTF — DTI S.L.

CRM/ERP multi-tienda para DTI S.L. (RONOCA DESARROLLOS S.L.). Impresión DTF por metros,
venta B2B. Una sola sociedad, un CIF, varias tiendas WooCommerce.

Stack: TanStack Start v1 · React 19 · Tailwind v4 · shadcn/ui · Supabase (Postgres, Auth,
Storage, Vault). Server functions con `createServerFn`. **No hay Edge Functions y no se van
a añadir.**

## Reglas duras

1. **Nunca apliques migraciones contra producción.** Escribe el `.sql` en
   `supabase/migrations/`, explica qué hace, y para. Javier lo revisa y lo aplica él.
2. **Nada destructivo sin autorización expresa.** `DROP TABLE`, `DELETE FROM` y `TRUNCATE`
   sobre datos reales se preguntan antes, cada vez. Una fila en producción es un dato real
   aunque su contenido sea de ejemplo.
3. **Trabaja en rama.** Una rama por tarea, commits pequeños con mensaje claro. Nada directo
   a `main`.
4. **Una tarea cada vez.** No aproveches para arreglar de paso otra cosa que veas. Anótala y
   sigue.
5. **`src/routeTree.gen.ts` se regenera solo. No se edita nunca.**
6. **No inventes datos.** Si una pantalla no tiene datos, muestra estado vacío. Nunca datos de
   ejemplo, nunca marcadores con números.
7. **Antes de crear algo nuevo, busca si ya existe.** Hay 46 componentes en
   `src/components/ui/`, helpers de formato en `src/lib/format.ts` y lógica pura en
   `src/dominio/`.
8. **Al terminar: `npm run verify`** (lint + tipos + pruebas + compilación). Si algo falla,
   arréglalo antes de decir que está hecho.

## Reglas de datos

- Toda tabla nueva lleva `empresa_id`. Hoy hay una sola empresa; el modelo debe soportar
  varias sin migración.
- Toda tabla nueva nace con RLS. El _event trigger_ `rls_auto_enable()` lo fuerza, pero
  además define políticas explícitas y por operación. **`FOR ALL` es lo que permite borrar
  una factura emitida: no lo uses en tablas de negocio.**
- Los pedidos tienen tres estados independientes: `estado_pago`, `estado_produccion` y
  `estado_envio`. Nunca un campo `estado` único.
- Los importes y costes se congelan en la línea (`coste_unit_snapshot`). Nunca se recalculan
  leyendo el maestro.
- Clientes son globales por `(empresa_id, email)`, no por tienda.
- Claves de sincronización externa: `UNIQUE (tienda_id, woo_order_id)` y equivalentes. Todo
  _upsert_ que venga de fuera tiene que ser idempotente.
- Fechas en base de datos: `timestamptz`, siempre.

## Reglas fiscales (críticas)

DTI S.L. está sujeta a Verifactu desde el **1 de enero de 2027**. No son negociables:

- **Una factura emitida no se edita ni se borra. Nunca.** Ni con `UPDATE`, ni desde la
  aplicación, ni «solo para corregir una errata». Solo rectificativa o anulación, ambas como
  registros nuevos.
- **La numeración es correlativa por serie y sin huecos.** Se asigna dentro de una transacción
  con bloqueo (`SELECT ... FOR UPDATE`). Nunca en el cliente, nunca en paralelo.
- La factura congela _snapshots_ de emisor, receptor y líneas en JSON.
- **La huella, el encadenamiento y el envío a la AEAT los hace un proveedor certificado por
  API.** No implementes SHA-256 encadenado ni SOAP contra la AEAT: eso convierte a DTI en
  productor de SIF, con responsabilidad legal propia. Si un cambio te lleva por ahí, para y
  avisa.

## Auditoría

Los tres usuarios son administradores con permisos idénticos. El único control es el registro.

- La tabla `auditoria` es _append-only_, escrita por trigger y encadenada por hash. No se
  escribe desde la aplicación y no se modifica jamás.
- **Toda server function que use `supabaseAdmin` debe fijar `app.usuario_id` antes de
  escribir**, o el cambio queda sin autor. El punto de enganche es `src/start.ts`, que
  registra el middleware global de todas las server functions: es un solo sitio, no
  diecisiete.
- Datos sensibles (`consumer_key`, `consumer_secret`, tokens) van enmascarados en el log. Si
  añades un campo sensible nuevo, añádelo a `auditoria_enmascarar()`.

## Seguridad

- `supabaseAdmin` (service role) **solo en servidor** y solo tras verificar rol o pertenencia.
  Nunca en un fichero que pueda acabar en el bundle del cliente: impórtalo dinámicamente
  dentro del handler, nunca en el nivel superior de un `*.functions.ts`.
- Credenciales de terceros en Vault. Nunca en tablas en claro, nunca en el frontend, nunca en
  logs.
- Webhooks entrantes: verificar firma siempre, responder en menos de 2 s, procesar en segundo
  plano.
- Nada de secretos en el código ni en commits. `.env` está ignorado por git; usa
  `.env.example` como plantilla. Si encuentras un secreto versionado, avisa; no lo muevas de
  sitio tú.

## Estilo

- **Todo en español**: interfaz, nombres de tablas y columnas, mensajes de error, comentarios.
- Columnas en `snake_case`, componentes en `PascalCase`.
- Server functions en `src/lib/*.functions.ts`, validación con `zod` en la primera línea.
- **Lógica de negocio pura en `src/dominio/`**, sin importar nada de `routes/` ni de
  integraciones. Debe poder testearse sin base de datos. Si calculas un IVA, un total, un
  redondeo o un margen fuera de `src/dominio/`, lo estás haciendo mal.
- Formateo de números, fechas y euros: usa siempre `src/lib/format.ts`.

## Comandos

```sh
npm install          # fichero de bloqueo: package-lock.json, registro público
npm run dev          # desarrollo
npm run verify       # lint + tipos + pruebas + compilación  ← antes de dar nada por hecho
npm run test         # solo las pruebas de dominio
```

El repositorio arrastra un `bun.lock` generado dentro del sandbox de Lovable que fija 62
paquetes al registro privado `lovable-core-prod`. Ese registro no resuelve fuera de Lovable,
así que **no uses bun**: `bun install` falla con 403. El fichero de bloqueo vivo es
`package-lock.json`.

## Qué de estas reglas todavía NO existe

Las reglas de arriba son el objetivo, no una descripción del repositorio. A fecha de hoy
**no existen** y no debes dar por hecho que puedes usarlas:

| Regla                                       | Estado                                                    |
| ------------------------------------------- | --------------------------------------------------------- |
| `empresa_id` en las tablas                  | No existe. Ninguna de las 25 tablas lo lleva              |
| Tabla `auditoria`, `auditoria_enmascarar()` | No existen                                                |
| `rls_auto_enable()`                         | No existe                                                 |
| Tres estados de pedido                      | No existe. Hay un enum único `pedido_estado` de 7 valores |
| `coste_unit_snapshot`                       | No existe                                                 |
| Credenciales en Vault                       | No. Están en claro en `tienda_credenciales`               |
| Clientes globales                           | No. Son `UNIQUE (tienda_id, woo_customer_id)`             |
| Numeración de factura con bloqueo           | No. Se asigna desde el navegador                          |

Sí existen ya: `src/dominio/` con `importes.ts` y sus pruebas, la integración continua, y el
formateo en verde.

El orden de trabajo para cerrar esa tabla está en la hoja de ruta del proyecto. **No
empieces por las pantallas**: el alcance por empresa cambia las consultas, así que hacerlo al
revés obliga a tocarlas dos veces.

## Cómo entregas una tarea

1. Qué has cambiado y por qué, en tres líneas.
2. Ficheros tocados.
3. Si hay migración: el SQL, qué hace, y si es reversible.
4. Qué hay que probar a mano para verificar que funciona.
5. Qué te has encontrado por el camino que convenga arreglar (sin arreglarlo).

## Nota sobre Lovable

Este proyecto nació en Lovable y su historial de `main` son commits del editor. **A partir de
la fase 1 del plan de cimientos, Lovable está congelado**: el desarrollo va por rama y pull
request. Si vuelves a abrir el editor de Lovable y escribe en `main`, deshará trabajo de
refactor y generará conflictos.
