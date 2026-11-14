-- ============================================================================
-- Devoluciones por el día del reembolso
-- ============================================================================
-- La cuenta de resultados resta cada devolución el día en que se devolvió el
-- dinero (decisión de Javier, 14-11-2026), así que la aplicación lee
-- `pedido_devoluciones` por `fecha` (src/lib/periodo.ts,
-- useDevolucionesPeriodo), con o sin tienda. Hasta ahora solo había índices
-- por pedido y por tienda: este deja leer un periodo sin recorrer la tabla.
--
-- Solo añade un índice: no toca datos ni permisos.
-- Reversible: supabase/reversiones/20261118103000_devoluciones_por_fecha.sql.

CREATE INDEX IF NOT EXISTS idx_pedido_devoluciones_fecha
  ON public.pedido_devoluciones (fecha);

CREATE INDEX IF NOT EXISTS idx_pedido_devoluciones_tienda_fecha
  ON public.pedido_devoluciones (tienda_id, fecha);
