## Objetivo

Añadir un módulo independiente **Textil Personalizado** (fuera de las tiendas WooCommerce) con sus propios subapartados. Reutilizar los componentes ya creados para pedidos, facturas y clientes. Incluir gestión de **marcas comerciales** (varias) para elegir cuál aparece en cada presupuesto/factura.

## Base de datos (migración)

- `textil_marcas` (id, nombre, logo_url, color, direccion, telefono, email, notas, activa) — marcas comerciales que el usuario puede alternar. RLS: admin escribe, autenticados leen.
- `textil_marca_predeterminada_id` en `empresa_global` (uuid nullable, FK textil_marcas) — la marca por defecto.
- `textil_stock` (id, sku, nombre, categoria, color, talla, cantidad, cantidad_minima, coste_unitario, notas) — inventario textil. RLS por usuario autenticado.
- `textil_clientes` (mismos campos que `clientes` pero sin `tienda_id`) — clientes propios del módulo.
- `textil_presupuestos` (id, numero, cliente_id, marca_id, fecha, validez_dias, estado ['borrador','enviado','aceptado','rechazado','facturado'], subtotal, iva, total, notas, factura_id nullable).
- `textil_presupuesto_items` (id, presupuesto_id, descripcion, cantidad, precio_unitario, iva_pct, subtotal, stock_id nullable).
- `textil_pedidos` + `textil_pedido_items` — clonado ligero de `pedidos` sin `tienda_id`/Woo.
- `textil_facturas` + `textil_factura_items` — clonado ligero de `facturas` sin `tienda_id`, con `marca_id` y `presupuesto_id` nullable.

Todas con `created_at`/`updated_at`, triggers `touch_updated_at`, GRANTs y RLS.

## Rutas nuevas (`src/routes/panel/textil/`)

```
textil/route.tsx          → layout con <Outlet />
textil/index.tsx          → dashboard resumen (KPIs stock bajo, pedidos, ventas mes)
textil/stock.tsx          → tabla CRUD de stock
textil/pedidos.tsx        → reusa componente pedidos (variante sin tienda)
textil/presupuestos.tsx   → tabla + dialog crear/editar/convertir en factura
textil/facturas.tsx       → reusa lógica facturas (con marca)
textil/clientes.tsx       → reusa componente clientes
textil/ajustes.tsx        → gestión de marcas comerciales + marca predeterminada
```

## Sidebar

En `AppSidebar.tsx` añadir grupo **Textil Personalizado** debajo del bloque "Tiendas" con collapsible: Stock, Pedidos, Presupuestos, Facturas, Clientes, Ajustes.

## Server functions nuevas (`src/lib/textil.functions.ts`)

- `listMarcas`, `createMarca`, `updateMarca`, `deleteMarca`, `setMarcaPredeterminada`.
- `listStock`, `upsertStockItem`, `deleteStockItem`, `ajustarStock({id, delta})`.
- `listPresupuestos`, `createPresupuesto`, `updatePresupuesto`, `deletePresupuesto`, `convertirPresupuestoEnFactura({presupuestoId})` → crea `textil_facturas` con la misma `marca_id`, marca presupuesto como `facturado`.
- `listTextilClientes`, `createTextilCliente`, etc.
- `listTextilPedidos`, etc.
- `listTextilFacturas`, `generarPDFTextilFactura` (reutiliza `pdf-factura.ts` inyectando datos de marca en lugar de empresa_global).

## Componentes reutilizados / nuevos

- **Reutilizar sin duplicar** `PedidoFormDialog`, `PedidoTrackingDialog`, `StatusBadge`.
- **Nuevos**:
  - `TextilStockTable.tsx`
  - `PresupuestoFormDialog.tsx` (cliente, marca [Select], líneas, IVA, validez, notas + botón "Convertir en factura")
  - `PresupuestosTable.tsx`
  - `MarcaFormDialog.tsx`
  - Adaptar los componentes de tabla existentes con prop `variant='textil'` cuando sea trivial; si no, crear versión hermana.

## PDF de presupuesto/factura textil

Ampliar `src/lib/pdf-factura.ts` (o crear `pdf-presupuesto.ts`) para aceptar un `emisor` arbitrario. La marca elegida sobrescribe nombre/logo/dirección/contacto; los datos fiscales (CIF, razón social) siguen viniendo de `empresa_global` (misma SL).

## Notas

- No tocar `tiendas` ni los flujos existentes.
- Los estados de pedidos textil son locales (no hay sync WC).
- Estimación: ~10-12 archivos nuevos, 2 modificados (sidebar + empresa_global page para elegir marca por defecto), 1 migración.

¿Procedo?
