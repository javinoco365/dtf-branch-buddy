-- ============================================================================
-- REVERSIÓN de 20261118103000_devoluciones_por_fecha.sql
-- ============================================================================
-- Quita los dos índices por fecha de las devoluciones. No se pierde ningún
-- dato: la lectura por periodo sigue funcionando, solo más despacio.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_pedido_devoluciones_tienda_fecha;
DROP INDEX IF EXISTS public.idx_pedido_devoluciones_fecha;
