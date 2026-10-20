# Proformas de proveedor y líneas por talla: decisiones de Javier (20-10-2026)

Contexto: `docs/proformas/mapa.md` (informe de cinco lectores del código, con fichero:línea).

## Decisiones

1. **La IA clasifica el documento**: `factura` o `proforma`. Si duda, deja el campo vacío y lo
   dice en dudas; la persona elige. La clasificación siempre es visible y corregible en la
   revisión.
2. **La mercancía llega con la proforma.** Registrar una proforma textil mete el stock igual que
   hoy una factura textil (mismo camino: casado de variantes, reparto de portes/descuentos,
   movimientos `compra`, memoria del escáner).
3. **La proforma no es documento fiscal.** No cuenta en IVA (303/111), ni en Gerencia como
   compra, gasto ni amortización, ni va al ZIP de la gestoría, ni suma en el pie de la lista de
   facturas. Sí cuenta en el almacén (sus entradas) y en tesorería (su pago).
4. **Pago por adelantado.** La proforma se concilia con el cargo del banco (o se marca pagada a
   mano). Una proforma pagada sin factura se ve como «anticipo a proveedor» en Tesorería.
5. **Casar factura con proforma.** Al revisar una factura, la app propone las proformas
   pendientes del mismo proveedor (nunca casa sola). Relación 1:1 (una proforma, una factura).
   Al registrar la factura casada, en la MISMA transacción:
   - la factura queda enlazada (`proforma_id`), es el documento fiscal (IVA por su fecha);
   - **no se vuelve a meter el stock de la proforma**;
   - **el pago pasa a la factura**: los enlaces de conciliación bancaria de la proforma se mueven
     a la factura (UPDATE auditado) y la factura hereda `estado_pago`/`fecha_pago`; si el líquido
     difiere, el grupo de conciliación queda en `revisar` con su diferencia;
   - la proforma casada deja de salir en pendientes, conciliables y pagos pendientes.
6. **Unidades distintas → regularizar solo** (por variante, talla a talla):
   - la factura trae MÁS unidades → la diferencia entra al stock (`compra`, enlazada a la línea de
     la factura) al coste de entrada de la factura;
   - la factura trae MENOS → la diferencia sale como `devolucion_proveedor`;
   - variante solo en la factura → entra entera; solo en la proforma → sale entera.
   Antes de confirmar, la pantalla enseña la comparación talla a talla.
7. **Precio/portes/descuento distintos → coste de la factura.** El stock que AÚN queda de esa
   variante se revaloriza con la diferencia de coste unitario (sube o baja el coste medio). Lo ya
   vendido no se toca (su coste quedó congelado en el pedido); esa parte no aplicable se anota.
   Se registra como un movimiento nuevo `ajuste_coste` en el libro de stock (cantidad 0, con su
   importe), enlazado a la factura.
8. **Aviso de proforma sin factura desde el día 1** (sin umbral): en Compras (general y textil),
   en Gerencia (avisos) y en el informe/resumen donde ya salen los controles del almacén.
9. **Líneas con varias tallas**: la IA parte cada línea del papel que trae varias tallas en una
   línea por prenda+color+talla, con su cantidad, el precio unitario (el de esa talla si el papel
   lo distingue) e importe; las partidas de una línea suman exactamente el importe de la línea del
   papel. Cada línea partida lleva el número de la línea del papel de la que sale, para agruparlas
   en la revisión. Si el papel no da el reparto por tallas, no se inventa: se deja la línea y se
   dice en dudas. Vale para proformas y facturas.

## Decisiones técnicas tomadas por el arquitecto (Claude), revisables

- Columnas en `textil_compras`: `tipo_documento TEXT NOT NULL DEFAULT 'factura'` (CHECK factura|
  proforma) y `proforma_id UUID` en la FACTURA (FK a `textil_compras`, ON DELETE RESTRICT,
  CHECK solo en facturas, UNIQUE parcial = 1:1). Ambas en la lista de inmutables de
  `compra_registrada_cabecera()`; `proforma_id` solo se fija dentro de funciones SECURITY DEFINER.
- `textil_compras_factura_unica` se recrea con `tipo_documento` en la clave (mismo nombre).
- El motivo `ajuste_coste` se añade al enum `stock_motivo` en un fichero de migración PROPIO
  (`ALTER TYPE ... ADD VALUE` no se puede usar en la misma transacción); los siguientes ficheros
  ya lo usan. El banco de pruebas aplica cada fichero con `psql -f` sin transacción global.
- La factura casada se registra con una versión nueva de `textil_compra_guardar_y_registrar`
  (parámetro `proforma_id` dentro del JSON), atómica. El camino viejo (`textil_compra_registrar`)
  rechaza cualquier compra con `proforma_id` o de tipo proforma casada; la app nunca cae al
  camino viejo con proforma_id o tipo_documento.
- Fuera de alcance (se anota, no se hace): una proforma con varias facturas (1:N) o varias
  proformas en una factura (N:1); anular una proforma que nunca se factura (reembolso); deshacer
  un casado (igual que hoy una factura textil registrada, no se deshace).
- Sin la migración aplicada, la app no rompe: lo de proformas se oculta y sale un aviso ámbar,
  como `AVISO_MIGRACION_ESCANER`.
- El esquema de la IA no puede tener uniones (`anyOf`/lista de tipos): límite de 16 de la API,
  prueba en `cola-compras.test.ts`. Campos nuevos como `string` con `""` = no aparece, o enum de
  string con `""`.
