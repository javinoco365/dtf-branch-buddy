-- ============================================================================
-- REVERSIÓN de 20261121100000_pedido_recargo.sql
-- ============================================================================
-- Quita pedidos.recargo. Se pierde cuánto recargo llevaba cada pedido (el
-- total y pedidos.iva no cambian). Pídelo antes: es un DROP COLUMN.
-- ============================================================================

ALTER TABLE public.pedidos DROP COLUMN IF EXISTS recargo;

NOTIFY pgrst, 'reload schema';
