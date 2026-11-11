-- ============================================================================
-- CATEGORÍA DE COMPRA «DTF UV SUBCONTRATADO»
-- ============================================================================
--
-- QUÉ RESUELVE
--   El DTF UV lo imprime una subcontrata (15 € + IVA el metro) y cada pedido
--   ya cuenta ese coste (metros_uv × coste_uv_snapshot). Si su factura se
--   registraba como compra de «Servicios» u «Otros», Gerencia la restaba otra
--   vez como gasto: el coste del UV contado dos veces.
--
-- QUÉ CAMBIA
--   textil_compras.categoria admite 'subcontrata_uv'. En la aplicación es una
--   categoría «para comparar» (como la tinta o la mensajería): su IVA va al
--   303, pero no resta en el resultado; Gerencia la compara con lo que ya
--   cuentan los pedidos de UV.
--
-- LO QUE NO TOCA
--   Ninguna fila. Facturas, tickets, cobros, banco, caja e impuestos.
--
-- REVERSIBLE
--   Sí, mientras no haya compras con esa categoría: se vuelve a crear la
--   restricción con la lista anterior. Se puede aplicar dos veces.
-- ============================================================================

ALTER TABLE public.textil_compras DROP CONSTRAINT IF EXISTS compra_categoria;

ALTER TABLE public.textil_compras
  ADD CONSTRAINT compra_categoria
    CHECK (categoria IN ('textil', 'consumibles', 'envios', 'subcontrata_uv', 'maquinaria',
                         'informatica', 'publicidad', 'material', 'reparaciones',
                         'suministros', 'servicios', 'otros'));
