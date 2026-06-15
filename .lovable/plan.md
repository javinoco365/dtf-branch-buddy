## Objetivo

Reemplazar `PedidosTable` (datos demo) por una tabla real que lea/escriba en Supabase (`pedidos`, `pedido_items`), con el formato del screenshot — agrupado por día, con totales diarios — y funcionalidad CRUD + sync con WooCommerce.

## Cambios

### 1. Migración SQL (nuevas columnas)
- `pedidos.cliente_nombre TEXT`, `cliente_email TEXT` (snapshot para pedidos manuales sin cliente_id)
- `pedidos.tracking_url TEXT`, `pedidos.tracking_numero TEXT`, `pedidos.tracking_empresa TEXT`
- `pedidos.envio NUMERIC` ya existe; `metodo_pago` ya existe; `origen` ya existe (`manual` | `woocommerce`).
- Enum `pedido_estado`: verificar que incluye `pendiente`, `procesando`, `completado`, `cancelado`. Si falta `procesando`, añadirlo.

### 2. Server functions (`src/lib/pedidos.functions.ts` nuevo)
- `listPedidos({ tiendaId?, desde, hasta })` → pedidos con items y datos cliente.
- `createPedidoManual({ tiendaId, cliente, items, metodo_pago, envio, notas })` — calcula totales, inserta `pedidos` + `pedido_items`, genera `numero` tipo `MAN-YYYYMMDD-####`.
- `updatePedido({ id, ...patch })` — edita cabecera (estado, metodo_pago, tracking, fechas, notas).
- `updatePedidoEstado({ id, estado })` — cambio rápido. Si el pedido tiene `woo_order_id` y `origen='woocommerce'`, hace `PUT /wp-json/wc/v3/orders/{id}` con `{status}` (mapeo: completado→completed, procesando→processing, cancelado→cancelled, pendiente→on-hold).
- `updatePedidoTracking({ id, empresa, numero, url })` — guarda en BBDD; si es Woo, intenta añadir nota al pedido vía WC API.
- `deletePedido({ id })` — borra en BBDD; si Woo, hace `DELETE` en WC (force=true) opcional.
- `replacePedidoItems({ pedidoId, items })` — para editar líneas.

Todas usan `requireSupabaseAuth` + admin client para llamadas WC (credenciales en `tienda_credenciales`).

### 3. UI — nuevo `PedidosTable` real (`src/components/PedidosTable.tsx` reescrito)
- Usa `useQuery` con `listPedidos`.
- Mantiene controles superiores (mes/semana, navegación, búsqueda, filtros estado/tienda, exportar CSV).
- **Nuevo:** botón "Nuevo pedido" (abre dialog).
- **Render agrupado por día** (como el screenshot):
  - Por cada día con pedidos: cabecera `LUNES, 15 DE JUNIO 2026` a la izquierda y `1218.90 € · 7 pedidos` a la derecha.
  - Columnas: ▸ · Nº Pedido · Cliente (nombre + email) · Origen (badge Manual/WooCommerce) · Estado (Select inline) · Pago · Total · Env. (icono camión, indica si hay tracking) · ⋮ menú.
  - Estado: `Select` inline que llama `updatePedidoEstado` con optimistic update + toast.
  - Menú ⋮: Editar / Tracking / Borrar.
  - Fila expandible: líneas del pedido (igual que ahora).

### 4. Dialogs
- **`PedidoFormDialog`** (crear/editar): cliente (nombre + email), método de pago (Select: Transferencia, Bizum, Tarjeta, Contra reembolso, Otro), envío, notas, líneas (añadir/quitar, producto descripción, cantidad, precio, IVA).
- **`PedidoTrackingDialog`**: empresa transporte, número, URL.
- **`PedidoDeleteDialog`**: AlertDialog confirmación.

### 5. Rutas
- `src/routes/panel/pedidos.tsx` y `src/routes/panel/tiendas/$tiendaId/pedidos.tsx` siguen usando `<PedidosTable tienda={...} />`. Sin cambios estructurales.

## Notas técnicas
- Sync WC bidireccional: solo PUT estado y nota de tracking. Si la llamada WC falla, se guarda local y se muestra warning toast.
- Datos demo (`demo-data.ts`) ya no se usan en pedidos; se mantiene el archivo para otras vistas.
- El formato `LUNES, 15 DE JUNIO 2026` usa `format(d, "EEEE, d 'DE' MMMM yyyy", { locale: es }).toUpperCase()`.

¿Procedo?